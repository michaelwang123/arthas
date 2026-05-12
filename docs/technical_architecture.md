# Arthas 技术架构

> 实时聊天室：创建临时 Group，分享密钥，邀请伙伴，即时沟通  
> 端到端加密：服务器只做消息中转，无法读取聊天内容  
> 技术栈：Go · WebSocket · MessagePack · Web Crypto API · React · Vite

---

## 技术栈选型

| 层级　　　　　| 技术　　　　　　　　　　　　　　| 选择理由　　　　　　　　　　　　　|
| ---------------| ---------------------------------| -----------------------------------|
| **前端框架**　| React 18 + TypeScript　　　　　 | 组件化 UI，类型安全　　　　　　　 |
| **状态管理**　| Zustand　　　　　　　　　　　　 | 极简，无 Provider 嵌套　　　　　　|
| **构建**　　　| Vite 5　　　　　　　　　　　　　| 亚秒级 HMR，ESBuild 预构建　　　　|
| **可视化**　　| PixiJS 8 (WebGL2)　　　　　　　 | GPU 渲染在线状态动画（可选）　　　|
| **样式**　　　| Tailwind CSS　　　　　　　　　　| 原子化 CSS，快速迭代　　　　　　　|
| **加密**　　　| Web Crypto API (AES-GCM + ECDH) | 浏览器原生，零依赖，硬件加速　　　|
| **网络协议**　| WebSocket (WSS)　　　　　　　　 | 全双工低延迟 + TLS 传输加密　　　 |
| **序列化**　　| MessagePack　　　　　　　　　　 | 比 JSON 小 30-50%，二进制编解码快 |
| **后端**　　　| Go 1.22　　　　　　　　　　　　 | goroutine 高并发，纯中转不解密　　|
| **WebSocket** | gorilla/websocket　　　　　　　 | 生产级 Go WebSocket　　　　　　　 |
| **密钥生成**　| NanoID　　　　　　　　　　　　　| URL-safe 房间密钥　　　　　　　　 |
| **部署**　　　| Docker + Vercel + HF Spaces　　 | 前后端分离，零成本　　　　　　　　|

---

## 安全架构：端到端加密 (E2EE)

### 设计原则

```
服务器 = 纯中转站（Relay）
  - 不持有解密密钥
  - 不解析消息内容
  - 只负责：连接管理 + 房间路由 + 密文转发
```

### 加密方案

| 层级 | 方案 | 作用 |
|------|------|------|
| **传输层** | WSS (TLS 1.3) | 防中间人窃听，保护元数据 |
| **应用层** | AES-256-GCM | 消息内容端到端加密 |
| **密钥交换** | ECDH (P-256) | 房间成员间协商共享密钥 |

### 加密流程

```
┌─────────────────────────────────────────────────────────────┐
│                      端到端加密流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  创建房间时：                                                │
│  1. 创建者生成 ECDH 密钥对 (publicKey + privateKey)          │
│  2. 生成房间对称密钥 roomKey (AES-256, 随机)                 │
│  3. roomKey 编码到房间密钥中分享给伙伴                        │
│                                                             │
│  加入房间时：                                                │
│  4. 加入者从分享密钥中解码出 roomKey                          │
│  5. 双方持有相同的 roomKey                                   │
│                                                             │
│  发送消息时：                                                │
│  6. 明文 → AES-256-GCM 加密 (roomKey + random IV)           │
│  7. 密文 → MessagePack 编码 → WSS 发送                      │
│                                                             │
│  服务器中转：                                                │
│  8. 服务器收到密文 → 原样转发给房间内其他成员                  │
│  9. 服务器无法解密（没有 roomKey）                            │
│                                                             │
│  接收消息时：                                                │
│  10. 密文 → AES-256-GCM 解密 (roomKey + IV) → 明文          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 密钥编码方案

房间密钥 = NanoID 房间标识 + Base64URL 编码的 AES roomKey

```
分享格式：{roomId}:{base64url(roomKey)}
示例：    V1StGXR8_Z5jdHi6B:k7_9xPqR2mNvLwE3hJfKdA...

分享链接：https://domain.com/join/{roomId}:{base64url(roomKey)}
```

> 服务器只看到 roomId 部分用于路由，roomKey 部分只在客户端解析。

### Web Crypto API 实现

```typescript
// 生成房间对称密钥
async function generateRoomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,  // extractable，用于导出分享
    ['encrypt', 'decrypt']
  )
}

// 导出密钥为可分享格式
async function exportRoomKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return base64url.encode(new Uint8Array(raw))
}

// 从分享密钥导入
async function importRoomKey(encoded: string): Promise<CryptoKey> {
  const raw = base64url.decode(encoded)
  return crypto.subtle.importKey(
    'raw', raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// 加密消息
async function encryptMessage(key: CryptoKey, plaintext: string): Promise<{iv: Uint8Array, ciphertext: ArrayBuffer}> {
  const iv = crypto.getRandomValues(new Uint8Array(12))  // 96-bit IV
  const encoded = new TextEncoder().encode(plaintext)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  )
  return { iv, ciphertext }
}

// 解密消息
async function decryptMessage(key: CryptoKey, iv: Uint8Array, ciphertext: ArrayBuffer): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  )
  return new TextDecoder().decode(decrypted)
}
```

---

## 系统架构

```
┌──────────────────────────────────────────────────────────┐
│                    浏览器 (Client)                         │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐ │
│  │  React   │  │ Zustand  │  │   Crypto Layer         │ │
│  │  聊天 UI │  │ Store    │  │   AES-GCM 加密/解密    │ │
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
│            │   Connection Hub    │                        │
│            │   goroutine/conn    │                        │
│            └─────────┬──────────┘                        │
│                      │                                   │
│            ┌─────────┴──────────┐                        │
│            │   Room Router       │                        │
│            │   按 roomId 路由    │                        │
│            └─────────┬──────────┘                        │
│                      │                                   │
│            ┌─────────┴──────────┐                        │
│            │   Relay (转发)      │                        │
│            │   密文原样广播      │                        │
│            └─────────────────────┘                        │
└──────────────────────────────────────────────────────────┘

服务器能看到：roomId、谁在哪个房间、消息时间戳
服务器看不到：消息内容（密文）、roomKey
```

---

## 网络协议

### 消息信封

```typescript
{
  type: uint8       // 消息类型
  data: object      // 消息体（聊天内容为密文）
}
```

### 消息类型

#### Client → Server

| ID | 名称 | Payload | 说明 |
|----|------|---------|------|
| `0x01` | CreateRoom | `{name}` | 创建房间 |
| `0x02` | JoinRoom | `{roomId, name}` | 加入房间（只传 roomId，不传 roomKey） |
| `0x03` | SendMessage | `{iv, ciphertext}` | 发送加密消息（密文 + IV） |
| `0x04` | LeaveRoom | `{}` | 离开房间 |
| `0x05` | Typing | `{typing}` | 正在输入 |
| `0x06` | Pong | `{t}` | 心跳 |

#### Server → Client

| ID | 名称 | Payload | 说明 |
|----|------|---------|------|
| `0x10` | RoomCreated | `{roomId}` | 房间创建成功（密钥在客户端生成） |
| `0x11` | RoomJoined | `{roomId, members[]}` | 加入成功 |
| `0x12` | MemberJoined | `{id, name, color}` | 新成员 |
| `0x13` | MemberLeft | `{id}` | 成员离开 |
| `0x14` | RelayMessage | `{senderId, senderName, iv, ciphertext, t}` | 转发密文 |
| `0x15` | MemberTyping | `{id, typing}` | 输入状态 |
| `0x16` | RoomClosed | `{}` | 房间关闭 |
| `0x17` | Error | `{code, msg}` | 错误 |
| `0x18` | Ping | `{t}` | 心跳 |

> 注意：`RelayMessage` 中的 `ciphertext` 是原样转发的密文，服务器不做任何解析。

---

## 服务器设计：纯中转

### 职责边界

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

### 事件处理

```
收到 CreateRoom   → 生成 roomId → 创建 Room → 返回 RoomCreated
收到 JoinRoom     → 查找 Room → 加入 → 广播 MemberJoined
收到 SendMessage  → 原样转发 RelayMessage 给房间内其他人
收到 LeaveRoom    → 移除成员 → 广播 MemberLeft → 空房间销毁
连接断开          → 等同 LeaveRoom
```

### 内存模型

```go
type RoomManager struct {
    mu    sync.RWMutex
    rooms map[string]*Room  // roomId -> Room
}

type Room struct {
    ID        string
    Members   map[string]*Client
    CreatedAt time.Time
}

// 转发消息：服务器只看到密文字节，不做任何解析
func (r *Room) Relay(sender *Client, msg []byte) {
    for id, member := range r.Members {
        if id != sender.ID {
            member.Send(msg)
        }
    }
}
```

---

## 客户端加密流程

### 创建房间

```
1. generateRoomKey() → AES-256 对称密钥
2. 发送 CreateRoom{name} → 服务器返回 roomId
3. 组合分享密钥：roomId + ":" + base64url(roomKey)
4. 显示分享密钥/链接给用户
```

### 加入房间

```
1. 解析分享密钥 → 提取 roomId 和 roomKey
2. importRoomKey(roomKey) → 导入 CryptoKey
3. 发送 JoinRoom{roomId, name} → 加入房间
4. 后续消息用 roomKey 加解密
```

### 发送消息

```
1. 用户输入明文
2. encryptMessage(roomKey, plaintext) → {iv, ciphertext}
3. 发送 SendMessage{iv, ciphertext}
4. 服务器原样转发给其他人
```

### 接收消息

```
1. 收到 RelayMessage{senderId, iv, ciphertext}
2. decryptMessage(roomKey, iv, ciphertext) → plaintext
3. 渲染到消息列表
```

---

## 安全分析

| 威胁 | 防护 |
|------|------|
| 网络窃听 | WSS (TLS 1.3) 传输加密 |
| 服务器窥探消息 | E2EE，服务器只见密文 |
| 密钥泄露 | 密钥只在客户端内存，不发送给服务器 |
| 重放攻击 | AES-GCM 每条消息随机 IV |
| 篡改消息 | AES-GCM 自带认证标签 (AEAD) |
| 暴力破解 | AES-256，2^256 密钥空间 |
| 房间密钥分享安全 | 依赖用户通过安全渠道分享（同 Signal 群邀请链接） |

### 信任模型

```
信任：浏览器环境 + Web Crypto API 实现
不信任：服务器（零知识设计）
假设：用户通过安全渠道分享房间密钥
```

---

## 参数配置

| 参数 | 值 | 说明 |
|------|-----|------|
| 加密算法 | AES-256-GCM | AEAD，加密 + 认证 |
| IV 长度 | 96 bits (12 bytes) | GCM 推荐长度 |
| roomId 长度 | 21 chars | NanoID |
| roomKey 长度 | 256 bits (32 bytes) | AES-256 |
| 房间最大人数 | 50 | 可配置 |
| 心跳间隔 | 25s | 保活 |
| 断线超时 | 60s | 踢出 |
| 空房间存活 | 0s | 即时销毁 |

---

## 项目结构

### 前端 (arthas-client/)

```
arthas-client/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── crypto/
    │   ├── keys.ts                # roomKey 生成/导入/导出
    │   ├── encrypt.ts             # AES-GCM 加密
    │   ├── decrypt.ts             # AES-GCM 解密
    │   └── shareKey.ts            # 密钥编码/解码（roomId:key）
    ├── pages/
    │   ├── Home.tsx               # 创建/加入房间
    │   └── ChatRoom.tsx           # 聊天室
    ├── components/
    │   ├── MessageList.tsx        # 消息列表
    │   ├── MessageInput.tsx       # 输入框
    │   ├── MemberList.tsx         # 在线成员
    │   ├── ShareKey.tsx           # 分享密钥
    │   └── TypingIndicator.tsx    # 输入提示
    ├── network/
    │   ├── protocol.ts            # 消息类型 & 编解码
    │   └── websocket.ts           # WS 连接 + 重连
    ├── stores/
    │   └── chatStore.ts           # Zustand 状态
    └── styles/
        └── index.css
```

### 后端 (arthas-server/)

```
arthas-server/
├── go.mod
├── go.sum
├── Dockerfile
├── cmd/
│   └── server/
│       └── main.go                # 启动入口
└── internal/
    ├── room/
    │   ├── manager.go            # RoomManager
    │   └── room.go               # Room + Relay 逻辑
    └── network/
        ├── hub.go                # 连接管理
        ├── client.go             # 单连接 goroutine
        └── protocol.go           # MessagePack 消息定义
```

---

## 部署

```
[浏览器] ──HTTPS──→ [Vercel CDN] (静态前端)
    │
    └──WSS (TLS 1.3)──→ [HF Spaces / Docker] (Go Relay)
                              │
                        [内存: 房间 + 连接]
                        [不存储任何消息]
```

| 环境 | 配置 |
|------|------|
| 前端 | Vercel, `npm run build`, 输出 `dist/` |
| 后端 | Docker, Go binary, 端口 7860 |
| TLS | Vercel/HF Spaces 自动提供 HTTPS/WSS |
| 健康检查 | `GET /ping` → 200 |

---

## 里程碑

| # | 目标 | 验收 |
|---|------|------|
| M1 | WebSocket 连接 | 连接成功 + 心跳 |
| M2 | 房间系统 | 创建房间 → 获得密钥 → 加入房间 |
| M3 | E2EE 加密 | 消息加密发送，服务器只见密文 |
| M4 | 实时聊天 | 多人加密聊天，解密后正常显示 |
| M5 | 分享机制 | 复制密钥/链接，伙伴一键加入 |
| M6 | 公网部署 | WSS 可用，端到端加密验证通过 |

---

## 技术亮点

- **端到端加密 (E2EE)**：Web Crypto API + AES-256-GCM，服务器零知识
- **服务器纯中转**：不解密、不存储、不解析消息内容
- **AEAD 认证加密**：AES-GCM 同时保证机密性和完整性
- **二进制协议**：MessagePack 编码密文，传输高效
- **goroutine 并发**：每连接独立协程，轻松千级连接
- **零持久化**：无数据库，房间和消息只存在于内存和客户端
- **密钥即邀请**：一个字符串同时包含房间地址和解密密钥
