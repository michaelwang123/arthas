# 配置参考 (Configuration Reference)

本文档列出 Arthas 所有可配置参数。

---

## 后端配置

### 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--port` | `8080`（或 `$PORT` 环境变量） | HTTP 监听端口 |
| `--allowed-origins` | `*`（允许所有来源） | WebSocket CORS 白名单，多个用逗号分隔 |
| `--version` | — | 打印版本号并退出 |

配置优先级：`--port` flag > `PORT` 环境变量 > 默认值 `8080`

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `8080` | HTTP/WebSocket 服务器监听端口 |
| `ALLOWED_ORIGINS` | 空（允许所有来源） | WebSocket CORS 白名单，多个用逗号分隔。设置后仅允许指定 Origin 的连接 |

### 内置常量

以下参数在代码中定义，修改需重新编译：

| 参数　　　　　　　　| 值　　　　 | 文件　　　　　　　　　　　　 | 说明　　　　　　　　　|
| ---------------------| ------------| ------------------------------| -----------------------|
| `MaxMembers`　　　　| 50　　　　 | `internal/room/room.go`　　　| 单房间最大成员数　　　|
| `writeWait`　　　　 | 10s　　　　| `internal/network/client.go` | WebSocket 写超时　　　|
| `pongWait`　　　　　| 40s　　　　| `internal/network/client.go` | 读超时（心跳 1.5 倍） |
| `sendBufferSize`　　| 256　　　　| `internal/network/client.go` | 发送缓冲区大小　　　　|
| `maxMessageSize`　　| 102400 bytes | `internal/network/client.go` | 单条消息最大字节数（含文件分片）|
| `rateLimitWindow`　 | 10s　　　　| `internal/network/client.go` | 频率限制滑动窗口　　　|
| `rateLimitMaxCount` | 10　　　　 | `internal/network/client.go` | 窗口内最大消息数　　　|
| Ping 间隔　　　　　 | 25s　　　　| `internal/network/client.go` | 心跳发送间隔　　　　　|
| NanoID 长度　　　　 | 21 chars　 | `internal/network/hub.go`　　| 房间 ID 长度　　　　　|

### Arthas Hub 参数

| 参数　　　　　　　　　　| 默认值 | CLI Flag / 环境变量　　　　　　　　　　 | 说明　　　　　　　　　　　　|
| -------------------------| --------| -----------------------------------------| -----------------------------|
| 最大公开房间数　　　　　| 200　　| `--max-public-rooms` / `MAX_PUBLIC_ROOMS`| Hub 目录房间上限　　　　　　|
| Hub API 频率限制　　　　| 30/min | `internal/hub/ratelimit.go`　　　　　　　| 每 IP 每分钟最大请求数　　　|
| Hub 轮询间隔（前端）　　| 30s　　| `arthas-client/src/hub/hubStore.ts`　　　| 客户端刷新频率　　　　　　　|
| 搜索防抖延迟（前端）　　| 300ms　| `arthas-client/src/hub/hubStore.ts`　　　| 输入后延迟触发搜索　　　　　|

---

## 前端配置

### 环境变量

| 变量名　　　　| 默认值　　　　　　　　　 | 文件　　　　　　　 | 说明　　　　　　　　 |
| ---------------| --------------------------| --------------------| ----------------------|
| `VITE_WS_URL` | `ws://localhost:8080/ws` | `.env.development` | WebSocket 服务器地址 |

### 环境文件

- `.env.development` — 开发环境配置
- `.env.production` — 生产环境配置（需创建）

生产环境示例 `.env.production`：

```env
VITE_WS_URL=wss://your-backend-domain.com/ws
```

### 内置常量

| 参数　　　　　　　　　 | 值　　| 文件　　　　　　　　　　　　　| 说明　　　　　　　　 |
| ------------------------| -------| -------------------------------| ----------------------|
| `MAX_MESSAGES`　　　　 | 200　 | `stores/chatStore.ts`　　　　 | 消息列表最大保留条数 |
| `RATE_LIMIT_WINDOW_MS` | 10000 | `stores/chatStore.ts`　　　　 | 客户端频率限制窗口　 |
| `RATE_LIMIT_MAX`　　　 | 10　　| `stores/chatStore.ts`　　　　 | 窗口内最大发送数　　 |
| `TYPING_TIMEOUT_MS`　　| 2000　| `stores/chatStore.ts`　　　　 | 输入状态自动取消时间 |
| `MAX_LENGTH`　　　　　 | 500　 | `components/MessageInput.tsx` | 单条消息最大字符数　 |
| `SHOW_COUNT_THRESHOLD` | 400　 | `components/MessageInput.tsx` | 显示字数统计的阈值　 |
| `BACKOFF_INITIAL_MS`　 | 1000　| `network/websocket.ts`　　　　| 重连初始退避时间　　 |
| `BACKOFF_MAX_MS`　　　 | 30000 | `network/websocket.ts`　　　　| 重连最大退避时间　　 |

---

## Vite 配置

文件：`arthas-client/vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

---

## CLI 客户端配置

### 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--server` | `wss://arthas-chat.onrender.com/ws` | WebSocket 服务器 URL |
| `--name` | 交互式提示 | 显示昵称（1-20 字符） |
| `--version` | — | 显示版本号并退出 |
| `--help` | — | 显示帮助信息并退出 |

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ARTHAS_SERVER` | — | WebSocket 服务器 URL（优先级低于 `--server` flag） |

### 内置常量

| 参数 | 值 | 文件 | 说明 |
|------|-----|------|------|
| `joinTimeout` | 30s | `internal/chat/session.go` | 等待服务器响应的超时 |
| `writeWait` | 10s | `internal/network/websocket.go` | WebSocket 写超时 |
| `pongWait` | 40s | `internal/network/websocket.go` | 读超时（心跳 1.6 倍） |
| `maxMessageSize` | 102400 | `internal/network/websocket.go` | 单条消息最大字节数 |
| `sendChCapacity` | 16 | `internal/network/websocket.go` | 发送队列容量 |
| 昵称长度限制 | 20 runes | `internal/ui/input.go` | 显示名称最大长度 |
| 消息长度限制 | 500 runes | `internal/ui/input.go` | 单条消息最大长度 |

### 配置优先级

```
--server flag  >  ARTHAS_SERVER 环境变量  >  默认值 (wss://arthas-chat.onrender.com/ws)
--name flag    >  交互式提示输入
```

---

## Tailwind 配置

文件：`arthas-client/tailwind.config.js`

默认使用暗色主题，扫描 `src/` 下所有 TSX/TS 文件。

---

## Docker 配置

项目包含两个 Dockerfile，服务不同的部署场景：

### deploy/Dockerfile（自托管部署，推荐）

三阶段构建：前端构建 → Go 编译（嵌入前端）→ 最小化运行环境。

| 参数 | 值 | 说明 |
|------|-----|------|
| 前端构建镜像 | `node:20-alpine` | 构建 React 前端 |
| Go 构建镜像 | `golang:1.23-alpine` | 编译后端 + 嵌入前端 |
| 运行镜像 | `alpine:3.23` | 最小化运行环境 |
| 暴露端口 | 8080 | 自托管默认端口 |
| `PORT` 环境变量 | 8080 | 服务器监听端口 |
| `ALLOWED_ORIGINS` | 空（允许所有） | WebSocket CORS 白名单 |
| `VERSION` build-arg | `latest` | 编译时注入版本号 |
| `TARGETARCH` build-arg | 自动检测 | 目标 CPU 架构（amd64/arm64） |

**构建命令（从项目根目录执行）：**

```bash
# 构建完整镜像（前端 + 后端）
docker build -f deploy/Dockerfile -t arthas-server .

# 指定版本号
docker build -f deploy/Dockerfile --build-arg VERSION=v1.2.3 -t arthas-server:v1.2.3 .

# 运行
docker run -d -p 8080:8080 arthas-server

# 自定义端口和 CORS
docker run -d -p 3000:3000 -e PORT=3000 -e ALLOWED_ORIGINS=https://example.com arthas-server
```

**访问方式：**

| 路径 | 功能 |
|------|------|
| `http://localhost:8080/` | 前端 SPA 页面 |
| `http://localhost:8080/assets/*` | 前端静态资源（JS/CSS，带内容哈希缓存） |
| `ws://localhost:8080/ws` | WebSocket 连接端点 |
| `http://localhost:8080/ping` | 健康检查（返回 `pong`） |

### arthas-server/Dockerfile（HF Spaces 部署）

仅编译后端，不包含前端。用于 Hugging Face Spaces 等纯后端中继场景。

| 参数 | 值 | 说明 |
|------|-----|------|
| 构建镜像 | `golang:1.23-alpine` | 编译后端 |
| 运行镜像 | `alpine:3.23` | 最小化运行环境 |
| 暴露端口 | 7860 | HF Spaces 默认端口 |
| `PORT` 环境变量 | 7860 | 服务器监听端口 |
| `VERSION` build-arg | `1.0.0` | 编译时注入版本号 |

**构建命令（从 arthas-server 目录执行）：**

```bash
cd arthas-server
docker build -t arthas-server .
```

> **注意：** 此镜像不包含前端页面，访问根路径只会返回 placeholder HTML。前端需单独部署到 Vercel 等平台。

---

## 加密参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 算法 | AES-256-GCM | AEAD 认证加密 |
| 密钥长度 | 256 bits (32 bytes) | AES-256 |
| IV 长度 | 96 bits (12 bytes) | GCM 推荐长度 |
| roomId 长度 | 21 chars | NanoID 默认长度 |
| 分享码格式 | `{roomId}:{base64url(key)}` | 总长 65 字符 |
| 分享码长度 | 65 chars | 21 + 1 + 43 |

---

## 错误码

| Code | 名称 | 触发条件 | 客户端提示 |
|------|------|----------|------------|
| E001 | ROOM_NOT_FOUND | JoinRoom 时 roomId 不存在 | "房间不存在或已关闭" |
| E002 | ROOM_FULL | JoinRoom 时房间已满 50 人 | "房间已满，无法加入" |
| E003 | NOT_IN_ROOM | SendMessage/Typing 时未加入房间 | "请先加入房间" |
| E004 | RATE_LIMITED | 消息频率超过 10条/10秒 | "发送过快，请稍后再试" |
| E005 | INVALID_MESSAGE | 消息格式错误（空/超长） | "消息格式无效" |

---

## 下一步

- [协议规范](protocol.md) — 消息格式详细定义
- [自托管部署](self-hosting.md) — 生产环境部署
