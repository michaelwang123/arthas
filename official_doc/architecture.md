# 系统架构 (Architecture)

本文档描述 Arthas 的整体系统架构、模块划分和数据流。

---

## 架构概览

Arthas 采用经典的前后端分离架构，核心设计原则是 **服务器零知识 (Zero-Knowledge)**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   🌐 Web Client          ⚡ Go Server (Blind Relay)     🖥️ CLI Client   │
│   ┌─────────────┐        ┌─────────────────────┐       ┌───────────┐  │
│   │ React 18    │        │ Hub (Connection Pool)│       │ Terminal  │  │
│   │ Zustand     │──WSS──▶│ RoomManager (Route)  │◀─WSS──│ CSP Model │  │
│   │ AES-256-GCM │        │ Static (Go Embed)    │       │ AES-256   │  │
│   │ Ed25519     │        │ ❌ Cannot decrypt    │       │ Ed25519   │  │
│   └─────────────┘        └─────────────────────┘       └───────────┘  │
│                                    ▲                                    │
│                                    │ WSS                                │
│                           ┌────────┴────────┐                          │
│                           │ 🤖 AI Agent     │                          │
│                           │ OpenClaw Channel │                          │
│                           │ AES-256-GCM     │                          │
│                           └─────────────────┘                          │
│                                                                         │
│   All clients use identical E2EE protocol — fully interoperable         │
└─────────────────────────────────────────────────────────────────────────┘
```

Web 客户端和 CLI 客户端使用完全相同的协议（MessagePack + AES-256-GCM），可以在同一房间内互操作。

---

## 设计原则

### 1. 服务器零知识

```
服务器做的事：
  ✅ 管理 WebSocket 连接
  ✅ 管理房间（创建/加入/离开/销毁）
  ✅ 按 roomId 路由消息
  ✅ 原样转发密文给房间成员
  ✅ 心跳保活 + 断线清理

服务器不做的事：
  ❌ 不生成/持有加密密钥
  ❌ 不解密消息内容
  ❌ 不存储消息历史
  ❌ 不验证消息内容合法性
```

### 2. 纯内存状态

- 无数据库依赖
- 房间和连接状态仅存在于内存
- 服务器重启 = 所有房间销毁
- 适合临时聊天场景

### 3. 事件驱动

- 收到消息即转发，无轮询
- goroutine-per-connection 模型
- 非阻塞消息广播

---

## 模块划分

### 后端模块

```
arthas-server/
├── cmd/server/main.go          # 入口：HTTP 服务 + WebSocket 升级 + 信号处理
├── internal/
│   ├── network/
│   │   ├── hub.go              # Hub：连接池管理 + 消息路由 + 优雅关闭
│   │   ├── client.go           # Client：单连接读写 goroutine + 频率限制
│   │   ├── origin.go           # Origin：WebSocket CORS 来源验证
│   │   └── protocol.go         # Protocol：MessagePack 消息定义
│   ├── room/
│   │   ├── manager.go          # RoomManager：房间 CRUD
│   │   └── room.go             # Room：成员管理 + 消息广播
│   ├── static/
│   │   ├── static_prod.go      # 生产模式：Go embed 嵌入 dist/ + SPA fallback
│   │   ├── static_dev.go       # 开发模式：返回 501，引导使用 Vite dev server
│   │   └── static_test.go      # 属性测试：文件服务正确性 + SPA fallback
│   └── logger/
│       └── logger.go           # 结构化日志：[时间] [级别] [模块] 格式
```

| 模块　　　　　　| 职责　　　　　　　　　　　　　　　　　　　　　　　　　　　 |
| -----------------| ------------------------------------------------------------|
| **Hub**　　　　 | 管理所有 WebSocket 连接，处理注册/注销，路由消息到 handler |
| **Client**　　　| 代表单个 WebSocket 连接，包含读写 goroutine + 频率限制　　 |
| **Protocol**　　| 定义所有消息类型和数据结构　　　　　　　　　　　　　　　　 |
| **RoomManager** | 管理房间生命周期（创建/查找/销毁）　　　　　　　　　　　　 |
| **Room**　　　　| 管理单个房间的成员列表和消息广播　　　　　　　　　　　　　 |
| **Static**　　　| 嵌入式前端静态文件服务（Go embed + SPA fallback + 缓存策略）|
| **Logger**　　　| 结构化日志输出，统一格式和级别控制　　　　　　　　　　　　 |

### CLI 客户端模块

```
arthas-cli/
├── cmd/arthas-cli/main.go          # 入口：子命令路由 + 参数解析
├── internal/
│   ├── protocol/
│   │   ├── protocol.go             # 消息类型常量 + 数据结构
│   │   └── codec.go                # MessagePack 编解码 + ToInt 辅助
│   ├── crypto/
│   │   ├── keys.go                 # 密钥生成 (crypto/rand) + base64url
│   │   ├── encrypt.go              # AES-256-GCM 加密
│   │   ├── decrypt.go              # AES-256-GCM 解密
│   │   └── sharecode.go            # 分享码解析/构建
│   ├── network/
│   │   └── websocket.go            # WebSocket 连接管理 (writePump 模式)
│   ├── ui/
│   │   ├── display.go              # 终端输出格式化 + ANSI 颜色
│   │   ├── input.go                # stdin 读取 + 输入验证
│   │   └── color.go                # Hex → ANSI 256-color 转换
│   └── chat/
│       └── session.go              # 会话状态机 + 4-goroutine 事件循环
├── go.mod
└── Makefile                        # 跨平台编译
```

| 模块 | 职责 |
|------|------|
| **protocol** | 定义消息类型常量和 MessagePack 编解码，与服务器协议完全对齐 |
| **crypto** | AES-256-GCM 加密/解密 + 密钥管理 + 分享码，使用 Go 标准库 |
| **network** | WebSocket 连接封装，writePump 模式确保线程安全 |
| **ui** | 终端输出（ANSI 颜色、时间戳）和输入（行读取、验证） |
| **chat** | 会话协调层，CSP 并发模型（4 goroutine + channel 通信） |

### 前端模块

```
arthas-client/src/
├── crypto/                     # E2EE 加密层
│   ├── keys.ts                 # 密钥生成/导入/导出
│   ├── encrypt.ts              # AES-GCM 加密
│   ├── decrypt.ts              # AES-GCM 解密
│   ├── shareKey.ts             # 分享码编解码
│   └── utils.ts                # base64url 工具
├── network/                    # 网络层
│   ├── protocol.ts             # 消息类型定义
│   └── websocket.ts            # WebSocket 连接管理
├── stores/                     # 状态层
│   └── chatStore.ts            # Zustand 全局状态
├── pages/                      # 页面
│   ├── Home.tsx                # 首页（创建/加入）
│   └── ChatRoom.tsx            # 聊天室
└── components/                 # 组件
    ├── MessageList.tsx         # 消息列表
    ├── MessageInput.tsx        # 消息输入
    ├── MemberList.tsx          # 成员列表
    ├── ShareKey.tsx            # 分享码展示
    └── TypingIndicator.tsx     # 输入状态
```

---

## 静态文件服务与单二进制部署

### Go Embed 机制

Arthas 使用 Go 1.16+ 的 `//go:embed` 指令将前端构建产物（`dist/` 目录）编译进二进制文件：

```
┌─────────────────────────────────────────────────────┐
│              Go 二进制文件 (~10MB)                    │
│                                                     │
│  ┌──────────────────┐  ┌────────────────────────┐  │
│  │  Go 服务器代码    │  │  嵌入的 dist/ 文件      │  │
│  │  (WebSocket Hub)  │  │  ├── index.html        │  │
│  │  (HTTP 路由)      │  │  └── assets/           │  │
│  │  (SPA fallback)   │  │      ├── app-abc.js    │  │
│  └──────────────────┘  │      └── style-xyz.css  │  │
│                         └────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Build Tags 条件编译

通过 Go build tags 区分开发和生产模式：

| 模式 | 编译命令 | 行为 |
|------|----------|------|
| 生产 | `go build ./cmd/server` | 嵌入 `dist/`，服务前端静态文件 |
| 开发 | `go build -tags dev ./cmd/server` | 不嵌入，返回 501 提示使用 Vite |

### SPA Fallback 与缓存策略

| 请求路径 | 匹配规则 | 响应 | Cache-Control |
|----------|----------|------|---------------|
| `/assets/app-abc.js` | 文件存在于 dist/ | 返回文件内容 | `public, immutable, max-age=31536000` |
| `/room/abc123` | 文件不存在 | 返回 index.html | `no-cache` |
| `/` | index.html | 返回 index.html | `no-cache` |

### 两个 Dockerfile 的架构差异

```
deploy/Dockerfile (自托管，三阶段构建):
  Node.js → dist/ → Go embed → 单二进制 → Alpine
  结果: 前端 + 后端一体，访问 / 返回完整 UI

arthas-server/Dockerfile (HF Spaces，两阶段构建):
  Go → 单二进制 → Alpine
  结果: 仅后端中继，前端需单独部署到 Vercel
```

---

## 数据流

### 发送消息

```
用户输入明文
    → chatStore.sendMessage(text)
    → encryptMessage(roomKey, text) → {iv, ciphertext}
    → ws.send(msgpack({type: 0x03, data: {iv, ciphertext}}))
    → 服务器 Hub.HandleMessage()
    → handleSendMessage() → room.Broadcast(senderId, data)
    → 其他客户端 WebSocket 接收
```

### 接收消息

```
WebSocket 收到二进制数据
    → msgpack.decode → {type: 0x14, data: {senderId, senderName, iv, ciphertext, t}}
    → chatStore.handleServerMessage()
    → decryptMessage(roomKey, iv, ciphertext) → plaintext
    → 更新 messages 状态
    → React 渲染消息气泡
```

### 创建房间

```
用户点击"创建房间"
    → generateRoomKey() → AES-256 CryptoKey
    → ws.send(CreateRoom{name})
    → 服务器生成 NanoID roomId
    → 服务器创建 Room，加入创建者
    → 返回 RoomCreated{roomId}
    → 客户端 encodeShareKey(roomId, key) → 分享码
```

### 加入房间

```
用户输入分享码
    → decodeShareKey(code) → {roomId, keyEncoded}
    → importRoomKey(keyEncoded) → CryptoKey
    → ws.send(JoinRoom{roomId, name})
    → 服务器验证 roomId 存在
    → 加入成员，广播 MemberJoined
    → 返回 RoomJoined{roomId, members[]}
```

---

## 并发模型

### 后端 goroutine 模型

```
main goroutine
    └── Hub.Run() goroutine (事件循环)
            ├── 处理 register (新连接)
            ├── 处理 unregister (断线)
            └── 消息路由

每个 WebSocket 连接：
    ├── readPump goroutine (读取消息)
    └── writePump goroutine (发送消息 + 心跳)
```

### 线程安全

- `RoomManager.rooms` — `sync.RWMutex` 保护
- `Room.members` — `sync.RWMutex` 保护
- `Client.send` — buffered channel (256)
- `Hub.clients` — `sync.RWMutex` 保护

---

## 房间生命周期

```
CreateRoom → Room 创建 (内存) → 创建者自动加入
    ↓
JoinRoom → 验证 roomId → 加入 → 广播 MemberJoined
    ↓
SendMessage → 原样转发给房间内其他人
    ↓
LeaveRoom / 断线 → 移除成员 → 广播 MemberLeft
    ↓
最后一人离开 → Room 从内存删除 → roomId 失效
```

---

## 服务器可见性

| 信息 | 服务器可见 | 说明 |
|------|-----------|------|
| roomId | ✅ | 用于路由 |
| 成员 ID/昵称 | ✅ | 用于广播 |
| 消息时间戳 | ✅ | 服务器附加 |
| typing 状态 | ✅ | 未加密元数据 |
| 消息明文 | ❌ | 端到端加密 |
| roomKey | ❌ | 仅客户端持有 |

---

## 下一步

- [协议规范](protocol.md) — 详细的消息格式定义
- [安全模型](security.md) — 加密方案与威胁分析
- [自托管部署](self-hosting.md) — 生产环境部署
