# 系统架构 (Architecture)

本文档描述 Arthas 的整体系统架构、模块划分和数据流。

---

## 架构概览

Arthas 采用经典的前后端分离架构，核心设计原则是 **服务器零知识 (Zero-Knowledge)**：

```
┌──────────────────────────────────────────────────────────┐
│                    浏览器 (Client)                         │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐ │
│  │  React   │  │ Zustand  │  │   Crypto Layer         │ │
│  │  Pages   │  │  Store   │  │   AES-256-GCM          │ │
│  └────┬─────┘  └────┬─────┘  └───────────┬────────────┘ │
│       └──────────────┼────────────────────┘              │
│                      │                                   │
│            ┌─────────┴──────────┐                        │
│            │  WebSocket Client   │                        │
│            │  MessagePack codec  │                        │
│            └─────────┬──────────┘                        │
└──────────────────────┼───────────────────────────────────┘
                       │ WSS / TLS 1.3 (密文传输)
┌──────────────────────┼───────────────────────────────────┐
│                      │       Go Server (纯中转)           │
│            ┌─────────┴──────────┐                        │
│            │   Hub (连接管理)    │                        │
│            └─────────┬──────────┘                        │
│                      │                                   │
│            ┌─────────┴──────────┐                        │
│            │   RoomManager      │                        │
│            │   (房间路由+转发)   │                        │
│            └────────────────────┘                        │
└──────────────────────────────────────────────────────────┘
```

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
├── cmd/server/main.go          # 入口：HTTP 服务 + WebSocket 升级
├── internal/
│   ├── network/
│   │   ├── hub.go              # Hub：连接池管理 + 消息路由
│   │   ├── client.go           # Client：单连接读写 goroutine
│   │   └── protocol.go         # Protocol：MessagePack 消息定义
│   └── room/
│       ├── manager.go          # RoomManager：房间 CRUD
│       └── room.go             # Room：成员管理 + 消息广播
```

| 模块　　　　　　| 职责　　　　　　　　　　　　　　　　　　　　　　　　　　　 |
| -----------------| ------------------------------------------------------------|
| **Hub**　　　　 | 管理所有 WebSocket 连接，处理注册/注销，路由消息到 handler |
| **Client**　　　| 代表单个 WebSocket 连接，包含读写 goroutine　　　　　　　　|
| **Protocol**　　| 定义所有消息类型和数据结构　　　　　　　　　　　　　　　　 |
| **RoomManager** | 管理房间生命周期（创建/查找/销毁）　　　　　　　　　　　　 |
| **Room**　　　　| 管理单个房间的成员列表和消息广播　　　　　　　　　　　　　 |

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
- [部署指南](deployment.md) — 生产环境部署
