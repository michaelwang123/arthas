# 设计：端到端加密实时聊天室

## 架构设计

```
┌─────────────────────────────────────────────────────┐
│                  浏览器 (Client)                      │
│                                                     │
│  ┌────────┐  ┌────────┐  ┌───────────────────────┐ │
│  │ React  │  │Zustand │  │   Crypto Layer        │ │
│  │ Pages  │  │ Store  │  │   AES-GCM + Keys      │ │
│  └───┬────┘  └───┬────┘  └──────────┬────────────┘ │
│      └───────────┼───────────────────┘              │
│                  │                                  │
│        ┌─────────┴──────────┐                       │
│        │  WebSocket Client   │                       │
│        │  MessagePack codec  │                       │
│        └─────────┬──────────┘                       │
└──────────────────┼──────────────────────────────────┘
                   │ WSS (binary)
┌──────────────────┼──────────────────────────────────┐
│                  │       Go Server (Relay)           │
│        ┌─────────┴──────────┐                       │
│        │   Hub (连接管理)    │                       │
│        └─────────┬──────────┘                       │
│                  │                                  │
│        ┌─────────┴──────────┐                       │
│        │  RoomManager       │                       │
│        │  (房间路由+转发)    │                       │
│        └────────────────────┘                       │
└─────────────────────────────────────────────────────┘
```

## 后端设计

### 模块划分

1. **cmd/server/main.go** — HTTP 服务启动，路由注册
2. **internal/network/hub.go** — WebSocket 连接池管理
3. **internal/network/client.go** — 单连接 goroutine (读/写)
4. **internal/network/protocol.go** — MessagePack 消息类型定义
5. **internal/room/manager.go** — 房间创建/查找/销毁
6. **internal/room/room.go** — 单房间成员管理 + 消息转发

### 协议设计

消息信封：
```go
type Message struct {
    Type uint8       `msgpack:"type"`
    Data interface{} `msgpack:"data"`
}
```

Client → Server:
- 0x01 CreateRoom {name}
- 0x02 JoinRoom {roomId, name}
- 0x03 SendMessage {iv, ciphertext}
- 0x04 LeaveRoom {}
- 0x05 Typing {typing}
- 0x06 Pong {t}

Server → Client:
- 0x10 RoomCreated {roomId}
- 0x11 RoomJoined {roomId, members[]}
- 0x12 MemberJoined {id, name, color}
- 0x13 MemberLeft {id}
- 0x14 RelayMessage {senderId, senderName, iv, ciphertext, t}
- 0x15 MemberTyping {id, typing}
- 0x16 RoomClosed {}
- 0x17 Error {code, msg}
- 0x18 Ping {t}

### 房间生命周期

```
CreateRoom → Room 创建 (内存) → 创建者自动加入
JoinRoom → 验证 roomId → 加入 → 广播 MemberJoined
SendMessage → 原样转发给房间内其他人
LeaveRoom / 断线 → 移除成员 → 广播 MemberLeft
最后一人离开 → Room 从内存删除
```

## 前端设计

### 页面结构

1. **Home.tsx** — 首页：创建房间 / 加入房间表单
2. **ChatRoom.tsx** — 聊天室：消息列表 + 输入 + 成员

### 加密层 (src/crypto/)

- **keys.ts** — generateRoomKey, exportRoomKey, importRoomKey
- **encrypt.ts** — encryptMessage(key, plaintext) → {iv, ciphertext}
- **decrypt.ts** — decryptMessage(key, iv, ciphertext) → plaintext
- **shareKey.ts** — encodeShareKey(roomId, key), decodeShareKey(code)

### 状态管理 (Zustand)

```typescript
interface ChatStore {
  // 连接
  connected: boolean
  ws: WebSocket | null
  
  // 身份
  myId: string | null
  myName: string
  
  // 房间
  roomId: string | null
  roomKey: CryptoKey | null
  shareCode: string | null
  members: Member[]
  
  // 消息
  messages: ChatMessage[]
  typingMembers: Set<string>
  
  // Actions
  connect: () => void
  createRoom: (name: string) => void
  joinRoom: (shareCode: string, name: string) => void
  sendMessage: (text: string) => void
  setTyping: (typing: boolean) => void
  leaveRoom: () => void
}
```

### 网络层 (src/network/)

- **protocol.ts** — 消息类型常量 + 类型定义
- **websocket.ts** — 连接管理、自动重连、MessagePack 编解码、消息分发

## 数据流

### 发送消息
```
用户输入 → chatStore.sendMessage(text)
  → encryptMessage(roomKey, text) → {iv, ciphertext}
  → ws.send(msgpack({type: 0x03, data: {iv, ciphertext}}))
  → 服务器 relay → 其他客户端
```

### 接收消息
```
ws.onmessage → msgpack.decode → {type: 0x14, data: {senderId, iv, ciphertext}}
  → decryptMessage(roomKey, iv, ciphertext) → plaintext
  → chatStore.addMessage({sender, text, time})
  → React 渲染
```

## 需要删除的旧代码

### 后端
- `internal/game/` 整个目录（game.go, player.go, projectile.go, coreshard.go, combat.go, constants.go）
- Hub 中的游戏相关逻辑（HandlePlayerInput, HandleSkillUse, BroadcastGameState）

### 前端
- `src/game/systems/` (InputSystem, PredictionSystem, InterpolationSystem)
- `src/game/Game.ts` 中的游戏循环逻辑
- `src/ui/HUD.tsx`, `src/ui/Scoreboard.tsx` (替换为聊天 UI)
- `src/stores/gameStore.ts` (替换为 chatStore)
