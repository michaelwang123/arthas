# 配置参考 (Configuration Reference)

本文档列出 Arthas 所有可配置参数。

---

## 后端配置

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `8080` | HTTP/WebSocket 服务器监听端口 |

### 内置常量

以下参数在代码中定义，修改需重新编译：

| 参数 | 值 | 文件 | 说明 |
|------|-----|------|------|
| `MaxMembers` | 50 | `internal/room/room.go` | 单房间最大成员数 |
| `writeWait` | 10s | `internal/network/client.go` | WebSocket 写超时 |
| `pongWait` | 40s | `internal/network/client.go` | 读超时（心跳 1.5 倍） |
| `sendBufferSize` | 256 | `internal/network/client.go` | 发送缓冲区大小 |
| `maxMessageSize` | 4096 bytes | `internal/network/client.go` | 单条消息最大字节数 |
| `rateLimitWindow` | 10s | `internal/network/client.go` | 频率限制滑动窗口 |
| `rateLimitMaxCount` | 10 | `internal/network/client.go` | 窗口内最大消息数 |
| Ping 间隔 | 25s | `internal/network/client.go` | 心跳发送间隔 |
| NanoID 长度 | 21 chars | `internal/network/hub.go` | 房间 ID 长度 |

---

## 前端配置

### 环境变量

| 变量名 | 默认值 | 文件 | 说明 |
|--------|--------|------|------|
| `VITE_WS_URL` | `ws://localhost:8080/ws` | `.env.development` | WebSocket 服务器地址 |

### 环境文件

- `.env.development` — 开发环境配置
- `.env.production` — 生产环境配置（需创建）

生产环境示例 `.env.production`：

```env
VITE_WS_URL=wss://your-backend-domain.com/ws
```

### 内置常量

| 参数 | 值 | 文件 | 说明 |
|------|-----|------|------|
| `MAX_MESSAGES` | 200 | `stores/chatStore.ts` | 消息列表最大保留条数 |
| `RATE_LIMIT_WINDOW_MS` | 10000 | `stores/chatStore.ts` | 客户端频率限制窗口 |
| `RATE_LIMIT_MAX` | 10 | `stores/chatStore.ts` | 窗口内最大发送数 |
| `TYPING_TIMEOUT_MS` | 2000 | `stores/chatStore.ts` | 输入状态自动取消时间 |
| `MAX_LENGTH` | 500 | `components/MessageInput.tsx` | 单条消息最大字符数 |
| `SHOW_COUNT_THRESHOLD` | 400 | `components/MessageInput.tsx` | 显示字数统计的阈值 |
| `BACKOFF_INITIAL_MS` | 1000 | `network/websocket.ts` | 重连初始退避时间 |
| `BACKOFF_MAX_MS` | 30000 | `network/websocket.ts` | 重连最大退避时间 |

---

## Vite 配置

文件：`arthas-client/vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,        // 开发服务器端口
  },
})
```

---

## Tailwind 配置

文件：`arthas-client/tailwind.config.js`

默认使用暗色主题，扫描 `src/` 下所有 TSX/TS 文件。

---

## Docker 配置

文件：`arthas-server/Dockerfile`

| 参数 | 值 | 说明 |
|------|-----|------|
| 基础镜像 | `golang:1.22-alpine` | 构建阶段 |
| 运行镜像 | `alpine:latest` | 最小化运行环境 |
| 暴露端口 | 7860 | Docker 默认端口 |
| `PORT` 环境变量 | 7860 | 服务器监听端口 |

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
- [部署指南](deployment.md) — 生产环境部署
