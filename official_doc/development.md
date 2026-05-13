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
│       ├── stores/             # Zustand 状态管理
│       ├── pages/              # 页面组件
│       ├── components/         # UI 组件
│       └── styles/             # 全局样式
├── arthas-server/              # 后端 (Go)
│   ├── go.mod                  # Go 模块定义
│   ├── go.sum                  # 依赖锁定
│   ├── Dockerfile              # Docker 构建
│   ├── cmd/server/main.go      # 服务器入口
│   └── internal/
│       ├── room/               # 房间管理
│       └── network/            # 网络层
├── docs/                       # 项目文档
└── official_doc/               # 官方文档
```

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

# 运行（带热重载，需安装 air）
# go install github.com/cosmtrek/air@latest
# air

# 或直接运行
go run cmd/server/main.go

# 运行测试
go test ./...

# 构建
go build -o server ./cmd/server

# 代码检查
go vet ./...
```

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

```go
type Hub struct {
    roomManager *room.RoomManager
    clients     map[*Client]bool
    register    chan *Client
    unregister  chan *Client
    mu          sync.RWMutex
}
```

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

## 下一步

- [贡献指南](contributing.md) — 如何提交代码
- [架构文档](architecture.md) — 深入设计理解
