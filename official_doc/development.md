# 开发指南 (Development Guide)

本文档帮助开发者理解代码结构并参与开发。

---

## 项目结构

```
arthas/
├── arthas-client/              # 前端 (React + TypeScript)
│   ├── index.html              # HTML 入口
│   ├── package.json            # 依赖管理
│   ├── vite.config.ts          # Vite 构建配置
│   ├── tsconfig.json           # TypeScript 配置
│   ├── tailwind.config.js      # Tailwind CSS 配置
│   ├── postcss.config.js       # PostCSS 配置
│   ├── .env.development        # 开发环境变量
│   └── src/
│       ├── main.tsx            # React 入口
│       ├── App.tsx             # 根组件 + ErrorBoundary
│       ├── crypto/             # E2EE 加密层
│       ├── network/            # WebSocket 网络层
│       ├── file-transfer/      # 加密文件分享模块
│       ├── stores/             # Zustand 状态管理
│       ├── pages/              # 页面组件
│       ├── components/         # UI 组件
│       └── styles/             # 全局样式
├── arthas-server/              # 后端 (Go)
│   ├── go.mod                  # Go 模块定义
│   ├── go.sum                  # 依赖锁定
│   ├── Dockerfile              # HF Spaces 部署（仅后端，不含前端）
│   ├── cmd/server/main.go      # 服务器入口（CLI flags + 优雅关闭）
│   └── internal/
│       ├── network/            # 网络层（Hub + Client + Origin + Protocol）
│       ├── room/               # 房间管理
│       ├── static/             # 嵌入式前端服务（Go embed + SPA fallback）
│       └── logger/             # 结构化日志
├── arthas-cli/                 # CLI 客户端 (独立 Go 二进制)
│   ├── cmd/arthas-cli/         # 入口（子命令: create, join）
│   └── internal/
│       ├── protocol/           # MessagePack 协议编解码
│       ├── crypto/             # AES-256-GCM 加密/解密 + 分享码
│       ├── network/            # WebSocket 连接管理
│       ├── ui/                 # 终端输出格式化 + 颜色
│       └── chat/               # 会话协调（状态机 + 事件循环）
├── packages/openclaw-channel/  # OpenClaw AI Agent 通道插件
├── deploy/                     # 自托管部署基础设施
│   ├── Dockerfile              # 三阶段构建（前端→Go embed→Alpine）← 自托管用这个
│   ├── docker-compose.yml      # Caddy + Backend 编排
│   ├── deploy.sh               # 一键部署脚本
│   ├── .env.example            # 环境变量模板
│   └── Caddyfile.*.example     # Caddy 配置模板
├── website/                    # 项目官网 (Astro)
├── docs/                       # 内部文档
└── official_doc/               # 用户文档
```

> **注意：** 项目有两个 Dockerfile：
> - `deploy/Dockerfile` — 自托管部署，三阶段构建（前端+后端嵌入），访问 `/` 返回完整 UI
> - `arthas-server/Dockerfile` — HF Spaces 部署，仅编译后端，前端需单独部署到 Vercel

---

## 开发环境搭建

### 前置条件

```bash
# Go 1.22+
go version

# Node.js 18+
node --version

# npm 9+
npm --version
```

### 后端开发

```bash
cd arthas-server

# 下载依赖
go mod tidy

# 开发模式运行（不需要前端 dist/ 目录）
go build -tags dev -o server ./cmd/server && ./server

# 或直接运行（需要 dist/ 目录存在）
go run cmd/server/main.go

# 运行测试
go test ./...

# 构建生产版本（需要先构建前端到 internal/static/dist/）
go build -o server ./cmd/server

# 代码检查
go vet ./...
```

> **开发模式 (`-tags dev`)：** 跳过 Go embed，后端不服务前端文件（访问 `/` 返回 501）。前端使用 Vite dev server（端口 5173）独立运行。这样后端和前端可以独立开发，互不依赖。

### 前端开发

```bash
cd arthas-client

# 安装依赖
npm install

# 启动开发服务器（HMR）
npm run dev

# 类型检查
npx tsc --noEmit

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

---

## 代码架构详解

### 后端核心模块

#### Hub (`internal/network/hub.go`)

连接管理中心，负责：
- 注册/注销 WebSocket 连接
- 消息路由（根据消息类型分发到 handler）
- 断线处理（自动离开房间）
- 房间过期扫描与预警
- 优雅关闭（done channel + WaitGroup）

```go
type Hub struct {
    roomManager  *room.RoomManager
    clients      map[*Client]bool
    register     chan *Client
    unregister   chan *Client
    mu           sync.RWMutex
    warnedExpiry map[string]bool   // 已发送过期预警的房间
    done         chan struct{}      // 关闭信号（close 广播模式）
    wg           sync.WaitGroup    // 跟踪所有 readPump/writePump goroutine
}
```

关键方法：
- `Run()` — 事件循环（select 多路复用 register/unregister/done）
- `Stop()` — 关闭 done channel，通知所有 goroutine 退出
- `Wait()` — 阻塞等待所有 client goroutine 退出

#### Client (`internal/network/client.go`)

单个 WebSocket 连接的抽象：
- `readPump()` — 读取消息 goroutine
- `writePump()` — 发送消息 + 心跳 goroutine
- `Send(data []byte)` — 非阻塞发送
- `IsRateLimited()` — 滑动窗口频率限制

#### RoomManager (`internal/room/manager.go`)

房间生命周期管理：
- `CreateRoom(roomId)` — 创建房间
- `GetRoom(roomId)` — 查找房间
- `RemoveRoom(roomId)` — 销毁房间

#### Room (`internal/room/room.go`)

单个房间的成员管理：
- `AddMember(member)` — 加入成员
- `RemoveMember(id)` — 移除成员
- `Broadcast(senderId, data)` — 广播消息（排除发送者）

### 前端核心模块

#### 加密层 (`src/crypto/`)

| 文件 | 职责 |
|------|------|
| `keys.ts` | 密钥生成、导入、导出 |
| `encrypt.ts` | AES-GCM 加密 |
| `decrypt.ts` | AES-GCM 解密 |
| `shareKey.ts` | 分享码编解码 |
| `utils.ts` | base64url 工具函数 |

#### 网络层 (`src/network/`)

| 文件 | 职责 |
|------|------|
| `protocol.ts` | 消息类型常量和 TypeScript 接口 |
| `websocket.ts` | WebSocket 连接管理、重连、MessagePack 编解码 |

#### 状态管理 (`src/stores/chatStore.ts`)

Zustand store，集成加密层和网络层：
- 连接状态管理
- 房间操作（创建/加入/离开）
- 消息发送（加密）和接收（解密）
- 输入状态管理
- 频率限制

---

## 添加新功能

### 添加新的消息类型

1. **后端** — `internal/network/protocol.go` 添加常量和数据结构
2. **后端** — `internal/network/hub.go` 添加 handler
3. **前端** — `src/network/protocol.ts` 添加常量和接口
4. **前端** — `src/stores/chatStore.ts` 的 `handleServerMessage` 添加 case

### 添加新的 UI 组件

1. 创建 `src/components/YourComponent.tsx`
2. 在 `ChatRoom.tsx` 或 `Home.tsx` 中引入
3. 从 `chatStore` 获取所需状态

---

## 测试

### 后端测试

```bash
cd arthas-server

# 运行所有测试
go test ./...

# 带详细输出
go test -v ./...

# 运行特定包的测试
go test -v ./internal/room/...

# 竞态检测
go test -race ./...
```

### 前端类型检查

```bash
cd arthas-client

# TypeScript 类型检查
npx tsc --noEmit
```

### 手动集成测试

1. 启动后端和前端
2. 打开两个浏览器窗口
3. 窗口 A 创建房间，复制分享码
4. 窗口 B 使用分享码加入
5. 双向发送消息，验证加密/解密正常
6. 检查服务器日志无明文

---

## 代码风格

### Go

- 遵循标准 Go 格式化 (`gofmt`)
- 使用 `go vet` 检查
- 注释使用中文（与项目一致）
- 错误处理不使用 panic

### TypeScript

- 严格模式 (`strict: true`)
- 使用函数组件 + Hooks
- 状态管理通过 Zustand
- 样式使用 Tailwind CSS 类名

---

## 依赖说明

### 后端依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `gorilla/websocket` | v1.5.3 | WebSocket 服务器 |
| `vmihailenco/msgpack/v5` | v5.4.1 | MessagePack 序列化 |
| `matoous/go-nanoid/v2` | v2.1.0 | 房间 ID 生成 |
| `google/uuid` | v1.6.0 | 客户端 ID 生成 |

### 前端依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `react` | ^18.3.1 | UI 框架 |
| `react-dom` | ^18.3.1 | DOM 渲染 |
| `zustand` | ^5.0.3 | 状态管理 |
| `@msgpack/msgpack` | ^3.0.0 | MessagePack 编解码 |

---

## 生产部署

### 自托管部署（Docker，推荐）

从项目根目录构建包含前端和后端的完整镜像：

```bash
# 构建（使用 deploy/Dockerfile，三阶段构建）
docker build -f deploy/Dockerfile -t arthas-server .

# 运行
docker run -d -p 8080:8080 --name arthas arthas-server

# 验证
curl http://localhost:8080/ping  # 返回 "pong"
# 浏览器访问 http://localhost:8080 即可看到前端页面
```

> **注意：** 不要使用 `arthas-server/Dockerfile`，那个只构建后端（用于 HF Spaces），不包含前端。

详细部署指南请参考 [自托管文档](self-hosting.md)。

### 后端部署（HF Spaces，前后端分离）

后端以 Docker 容器形式部署到 Hugging Face Spaces。

#### 前置条件

1. 注册 [Hugging Face](https://huggingface.co) 账号
2. 创建 Access Token（Settings → Tokens，权限选 Write）
3. 创建 Space：https://huggingface.co/new-space
   - SDK: **Docker**
   - Hardware: **CPU Basic**（免费）
   - Visibility: **Public**（Private 的 URL 需要认证，前端无法连接）

#### 一键部署脚本

```powershell
# 从项目根目录执行
.\official_doc\scripts\deploy-hf-space.ps1

# 自定义用户名和 Space 名称
.\official_doc\scripts\deploy-hf-space.ps1 -HfUsername "your-username" -SpaceName "arthas-server"
```

脚本会提示输入 HF 用户名和 Token 进行认证。

#### 手动部署步骤

```powershell
# 1. 复制 arthas-server 到临时目录
$tmp = "$env:TEMP\hf-deploy"
Copy-Item -Recurse arthas-server $tmp
cd $tmp

# 2. 清理编译产物
Remove-Item -Force *.exe, *.test -ErrorAction SilentlyContinue

# 3. 初始化 git 并提交
git init
git add -A
git commit -m "deploy: arthas production server"

# 4. 推送到 HF Space
git remote add space https://huggingface.co/spaces/你的用户名/arthas-server
git push space master:main --force

# 5. 清理
cd ..
Remove-Item -Recurse -Force $tmp
```

#### 重要文件

- `arthas-server/Dockerfile` — 多阶段构建，最终镜像 < 30MB
- `arthas-server/README.md` — 包含 HF Space 所需的 YAML front matter（`sdk: docker`）
- `arthas-server/.dockerignore` — 排除不需要的文件加速构建

#### 验证

构建完成后（约 2-3 分钟）访问：
```
https://你的用户名-arthas-server.hf.space/ping
```
返回 `pong` 表示部署成功。

#### 环境变量配置

在 Space Settings → Repository secrets 中设置：

| 变量 | 值 | 说明 |
|------|-----|------|
| `ALLOWED_ORIGINS` | `https://your-frontend.vercel.app` | 允许的前端域名（逗号分隔多个） |

设置后需重启 Space 生效。

---

### 前端部署（Vercel）

前端部署到 Vercel，从 GitHub monorepo 中选择 `arthas-client` 子目录。

#### 步骤

1. 将整个 arthas 项目推送到 GitHub
2. 访问 [vercel.com/new](https://vercel.com/new)，导入 GitHub 仓库
3. 配置：
   - **Root Directory**: `arthas-client`
   - **Framework Preset**: Vite
   - **Environment Variables**: `VITE_WS_URL` = `wss://你的用户名-arthas-server.hf.space/ws`
4. 点击 Deploy

#### 验证

部署完成后打开 Vercel 分配的域名，检查浏览器 Network 面板中 WebSocket 连接使用 `wss://`。

---

### 保活配置（cron-job.org）

HF Spaces 免费层在无流量时会休眠。配置定时健康检查保持活跃：

1. 注册 [cron-job.org](https://cron-job.org)
2. 创建任务：
   - URL: `https://你的用户名-arthas-server.hf.space/ping`
   - 间隔: 每 10 分钟
   - 超时: 30 秒
   - 失败重试: 1 次

---

### 部署后验证清单

| # | 验证项 | 方法 | 预期结果 |
|---|--------|------|----------|
| 1 | 健康检查 | 访问 `/ping` | 200 + "pong" |
| 2 | WSS 连接 | 浏览器 Network 面板 | WebSocket 使用 wss:// |
| 3 | 跨网络聊天 | 两台设备创建/加入房间 | 消息正常加解密 |
| 4 | 日志无明文 | 查看 HF Space 日志 | 无消息内容 |
| 5 | CORS 拦截 | 从非授权域名连接 | 返回 403 |

---

## 下一步

- [贡献指南](contributing.md) — 如何提交代码
- [架构文档](architecture.md) — 深入设计理解
