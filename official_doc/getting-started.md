# 快速开始 (Getting Started)

本指南帮助你在 5 分钟内本地运行 Arthas 项目。

---

## 环境要求

| 工具 | 最低版本 | 说明 |
|------|----------|------|
| Go | 1.22+ | 后端编译运行 |
| Node.js | 18+ | 前端构建运行 |
| npm | 9+ | 包管理器 |
| Git | 2.x | 代码克隆 |

### 浏览器支持

| 浏览器 | 最低版本 |
|--------|----------|
| Chrome | 90+ |
| Firefox | 90+ |
| Safari | 15+ |
| Edge | 90+ |

> Web Crypto API 需要现代浏览器支持。不支持 IE。

---

## 第一步：克隆项目

```bash
git clone https://github.com/michaelwang123/arthas.git
cd arthas
```

---

## 第二步：启动后端

### 方式 A：Docker 一键启动（推荐，无需安装 Go/Node.js）

```bash
# 从项目根目录构建完整镜像（前端 + 后端）
docker build -f deploy/Dockerfile -t arthas-server .

# 启动容器
docker run -d -p 8080:8080 --name arthas arthas-server
```

构建完成后直接访问 `http://localhost:8080` 即可使用，前端和后端在同一个端口。

验证：

```bash
# 健康检查
curl http://localhost:8080/ping
# 返回 "pong" 表示正常

# 查看容器状态
docker ps --filter name=arthas
# STATUS 应显示 "healthy"
```

停止和清理：

```bash
docker rm -f arthas
```

### 方式 B：源码启动（开发模式，前后端分离）

```bash
cd arthas-server

# 下载依赖
go mod tidy

# 启动服务器（开发模式，不含前端）
go build -tags dev -o server ./cmd/server && ./server
```

成功启动后你会看到：

```
[2024-01-01T12:00:00Z] [INFO] [Server] started on :8080 (version dev)
```

服务器默认监听 `8080` 端口，WebSocket 端点为 `ws://localhost:8080/ws`。

> **注意：** 开发模式下后端不服务前端页面（访问根路径返回 501），需要单独启动前端开发服务器。

---

## 第三步：启动前端

> **如果你使用了方式 A（Docker），跳过此步骤。** 前端已内嵌在 Docker 镜像中。

打开新的终端窗口（仅方式 B 源码开发需要）：

```bash
cd arthas-client

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

成功启动后你会看到：

```
  VITE v6.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

---

## 第四步：开始使用

### 方式一：Docker 部署（方式 A）

1. 打开浏览器访问 `http://localhost:8080`
2. 输入昵称，点击 **"创建房间"**
3. 复制生成的分享码
4. 打开另一个浏览器窗口（或隐身模式）
5. 输入昵称和分享码，点击 **"加入"**
6. 开始加密聊天！

### 方式二：源码开发模式（方式 B）

1. 打开浏览器访问 `http://localhost:5173`
2. 输入昵称，点击 **"创建房间"**
3. 复制生成的分享码
4. 打开另一个浏览器窗口（或隐身模式）
5. 输入昵称和分享码，点击 **"加入"**
6. 开始加密聊天！

### 方式三：CLI 客户端

```bash
cd arthas-cli

# 编译
go build -o arthas-cli ./cmd/arthas-cli/

# 创建房间
./arthas-cli create --server ws://localhost:8080/ws --name Alice
# 输出分享码，复制它

# 在另一个终端加入
./arthas-cli join <share_code> --server ws://localhost:8080/ws --name Bob
```

CLI 和 Web 客户端可以互操作——用 Web 创建的房间可以用 CLI 加入，反之亦然。

### 方式四：通过 Arthas Hub 加入公开房间

如果有人创建了公开房间，你可以直接浏览和加入，无需分享码：

1. 在首页底部点击 **「🌐 浏览公开房间」**
2. 进入 Hub 页面，浏览公开房间列表
3. 选择感兴趣的房间，输入昵称
4. 点击"加入" — 即刻进入加密聊天

创建公开房间的步骤：

1. 在首页的创建区域，勾选 **「🌐 在 Arthas Hub 公开展示」**
2. 填写房间标题（必填）、描述（选填）、标签（选填）
3. 点击"创建房间" — 房间会自动出现在 Hub 目录中

<p align="center">
  <img src="../docs/diagrams/arthas-hub-flow.svg" alt="Arthas Hub 流程" width="800"/>
</p>

> **提示：** Hub 中的房间仍然使用端到端加密。公开房间的加密密钥包含在分享码中，允许任何人加入。如需限制访问，可在创建时设置房间密码。

---

## 验证加密

你可以通过以下方式验证消息确实是加密的：

1. **查看服务器日志** — 服务器日志中只有连接/房间事件，没有任何消息内容
2. **浏览器开发者工具** — Network 面板中 WebSocket 消息显示为二进制数据（MessagePack 编码的密文）
3. **不同密钥** — 使用错误的分享码加入，收到的消息会显示"无法解密此消息"

---

## 常见问题

### 前端连不上后端？

检查 `.env.development` 文件中的 WebSocket URL：

```env
VITE_WS_URL=ws://localhost:8080/ws
```

确保后端已启动且端口匹配。

### 端口被占用？

后端端口可通过环境变量修改：

```bash
PORT=9090 go run cmd/server/main.go
```

前端端口在 `vite.config.ts` 中配置：

```typescript
server: {
  port: 4000,
}
```

### Go 依赖下载失败？

设置 Go 代理（中国大陆用户）：

```bash
go env -w GOPROXY=https://goproxy.cn,direct
```

---

## 下一步

- [系统架构](architecture.md) — 了解整体设计
- [CLI 客户端指南](cli-guide.md) — 终端客户端详细用法
- [开发指南](development.md) — 深入代码结构
- [自托管部署](self-hosting.md) — 部署到生产环境
