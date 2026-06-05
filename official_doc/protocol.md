# 协议规范 (Protocol Specification)

本文档定义 Arthas 的 WebSocket 通信协议。

---

## 概述

Arthas 使用 WebSocket 进行实时通信，消息使用 MessagePack 二进制序列化。

- **传输层**: WebSocket (WSS/TLS 1.3)
- **序列化**: MessagePack
- **消息模式**: 请求-响应 + 服务器推送

---

## 消息信封 (Message Envelope)

所有消息使用统一的信封格式：

```
{
  type: uint8       // 消息类型 ID
  data: object      // 消息体
}
```

MessagePack 编码后以 WebSocket Binary Frame 发送。

---

## 消息类型

### Client → Server

| ID     | 名称　　　　　　　| 说明　　　　　　　　 |
| --------| --------------------| ----------------------|
| `0x01` | CreateRoom　　　　| 创建房间　　　　　　 |
| `0x02` | JoinRoom　　　　　| 加入房间　　　　　　 |
| `0x03` | SendMessage　　　 | 发送加密消息　　　　 |
| `0x04` | LeaveRoom　　　　 | 离开房间　　　　　　 |
| `0x05` | Typing　　　　　　| 输入状态　　　　　　 |
| `0x06` | Pong　　　　　　　| 心跳回复　　　　　　 |
| `0x08` | SendFileMeta　　　| 发送加密文件元数据　 |
| `0x09` | SendFileChunk　　 | 发送加密文件分片　　 |
| `0x0A` | SendFileComplete　| 文件传输完成信号　　 |
| `0x0B` | SendFileCancel　　| 取消文件传输　　　　 |
| `0x0C` | SendFileAck　　　 | 文件接收确认　　　　 |

### Server → Client

| ID     | 名称　　　　　　　| 说明　　　　　　　　 |
| --------| --------------------| ----------------------|
| `0x10` | RoomCreated　　　 | 房间创建成功　　　　 |
| `0x11` | RoomJoined　　　　| 加入房间成功　　　　 |
| `0x12` | MemberJoined　　　| 新成员加入　　　　　 |
| `0x13` | MemberLeft　　　　| 成员离开　　　　　　 |
| `0x14` | RelayMessage　　　| 转发加密消息　　　　 |
| `0x15` | MemberTyping　　　| 成员输入状态　　　　 |
| `0x16` | RoomClosed　　　　| 房间关闭　　　　　　 |
| `0x17` | Error　　　　　　 | 错误响应　　　　　　 |
| `0x18` | Ping　　　　　　　| 心跳请求　　　　　　 |
| `0x1A` | RelayFileMeta　　 | 中转文件元数据　　　 |
| `0x1B` | RelayFileChunk　　| 中转文件分片　　　　 |
| `0x1C` | RelayFileComplete | 中转传输完成信号　　 |
| `0x1D` | RelayFileCancel　 | 中转取消信号　　　　 |
| `0x1E` | RelayFileAck　　　| 中转接收确认　　　　 |

---

## 消息详细定义

### CreateRoom (0x01)

创建一个新的聊天房间。

**请求：**
```json
{
  "type": 1,
  "data": {
    "name": "Alice",           // 创建者昵称 (1-20 字符)
    "password": "",            // 房间密码哈希 (SHA-256 hex, 可选)
    "ephemeral": 0,            // 阅后即焚秒数 (0=关闭)
    "expiry": 0,               // 有效期秒数 (0=永不过期)
    "public": true,            // [Hub] 是否公开展示 (可选, 默认 false)
    "title": "Golang AMA",     // [Hub] 房间标题 (1-50 字符, public=true 时必填)
    "description": "Ask me...",// [Hub] 房间描述 (0-200 字符, 可选)
    "tags": ["golang", "ama"], // [Hub] 标签 (0-5 个, 每个 1-20 字符, 可选)
    "keyEncoded": "base64url"  // [Hub] AES-256 密钥 base64url 编码 (public=true 时必填)
  }
}
```

> **Hub 字段说明：** 当 `public=true` 时，服务器会将房间注册到 Hub 目录。`keyEncoded` 是客户端生成的 AES-256 密钥，服务器用它与 roomId 组合构建完整的 shareCode 供 Hub 访客使用。服务器不解密任何消息 — 它只是把密钥作为不透明字符串传递给 Hub API。

**响应：** RoomCreated (0x10) + RoomJoined (0x11)

---

## Hub REST API

Arthas Hub 通过独立的 HTTP REST 端点提供公开房间目录查询，与 WebSocket 协议互补。

### GET /api/hub — 查询公开房间目录

**查询参数：**

| 参数 | 类型 | 默认值 | 约束 |
|------|------|--------|------|
| `tag` | string | (无) | 按标签筛选（大小写不敏感） |
| `q` | string | (无) | 搜索标题+描述（大小写不敏感 contains） |
| `limit` | int | 50 | 1-100，超过 100 返回 400 |
| `offset` | int | 0 | ≥ 0，负数返回 400 |

**成功响应 (200)：**
```json
{
  "rooms": [
    {
      "roomId": "VzlX4rliTuhBhboXaTzHt",
      "shareCode": "VzlX4rliTuhBhboXaTzHt:base64key:0:0",
      "title": "Golang AMA",
      "description": "Ask me anything about Go",
      "tags": ["golang", "ama"],
      "memberCount": 5,
      "hasPassword": false,
      "createdAt": 1700000000,
      "expiresAt": 0
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

**排序规则：** `memberCount` 降序，相同时按 `createdAt` 降序。

**错误响应：**

| 状态码 | 条件 | 响应体 |
|--------|------|--------|
| 400 | limit > 100 或 offset < 0 | `{"error": "descriptive message"}` |
| 429 | 频率限制（30 req/min/IP） | `{"error": "rate limited, try again later"}` + `Retry-After` 头 |

**CORS：** 根据服务器 `ALLOWED_ORIGINS` 配置设置 `Access-Control-Allow-Origin`，支持 OPTIONS 预检请求。

---

### JoinRoom (0x02)

加入已存在的房间。

**请求：**
```json
{
  "type": 2,
  "data": {
    "roomId": "V1StGXR8_Z5jdHi6B-myT",   // 21 字符 NanoID
    "name": "Bob"                           // 加入者昵称
  }
}
```

**响应：** RoomJoined (0x11)  
**错误：** E001 (房间不存在), E002 (房间已满)

> 注意：roomKey 不发送给服务器，仅在客户端从分享码中解析。

---

### SendMessage (0x03)

发送加密消息。

**请求：**
```json
{
  "type": 3,
  "data": {
    "iv": "base64url_encoded_12_bytes",           // 96-bit IV
    "ciphertext": "base64url_encoded_ciphertext"  // AES-GCM 密文
  }
}
```

**服务器行为：** 原样转发给房间内其他成员（不解析内容）  
**错误：** E003 (未加入房间), E004 (频率限制), E005 (格式错误)

---

### LeaveRoom (0x04)

离开当前房间。

**请求：**
```json
{
  "type": 4,
  "data": {}
}
```

**服务器行为：** 移除成员，广播 MemberLeft，空房间销毁

---

### Typing (0x05)

通知输入状态。

**请求：**
```json
{
  "type": 5,
  "data": {
    "typing": true    // true=正在输入, false=停止输入
  }
}
```

**服务器行为：** 广播 MemberTyping 给房间内其他成员

> 注意：typing 状态是未加密的元数据，服务器可见。

---

### Pong (0x06)

心跳回复。

**请求：**
```json
{
  "type": 6,
  "data": {
    "t": 1704067200000    // 原样返回 Ping 中的时间戳
  }
}
```

---

### RoomCreated (0x10)

房间创建成功通知。

**响应：**
```json
{
  "type": 16,
  "data": {
    "roomId": "V1StGXR8_Z5jdHi6B-myT"    // 服务器生成的房间 ID
  }
}
```

---

### RoomJoined (0x11)

加入房间成功，返回当前成员列表。

**响应：**
```json
{
  "type": 17,
  "data": {
    "roomId": "V1StGXR8_Z5jdHi6B-myT",
    "members": [
      {"id": "a1b2c3d4", "name": "Alice", "color": "#4a7fbf"},
      {"id": "e5f6g7h8", "name": "Bob", "color": "#bf4a7f"}
    ]
  }
}
```

---

### MemberJoined (0x12)

新成员加入通知（广播给房间内已有成员）。

**响应：**
```json
{
  "type": 18,
  "data": {
    "id": "e5f6g7h8",
    "name": "Bob",
    "color": "#bf4a7f"
  }
}
```

---

### MemberLeft (0x13)

成员离开通知。

**响应：**
```json
{
  "type": 19,
  "data": {
    "id": "e5f6g7h8"
  }
}
```

---

### RelayMessage (0x14)

服务器转发的加密消息。

**响应：**
```json
{
  "type": 20,
  "data": {
    "senderId": "a1b2c3d4",
    "senderName": "Alice",
    "iv": "base64url_encoded_12_bytes",
    "ciphertext": "base64url_encoded_ciphertext",
    "t": 1704067200000    // 服务器接收时间戳 (Unix ms)
  }
}
```

> 服务器不解析 iv 和 ciphertext，原样转发。

---

### MemberTyping (0x15)

成员输入状态通知。

**响应：**
```json
{
  "type": 21,
  "data": {
    "id": "a1b2c3d4",
    "typing": true
  }
}
```

---

### RoomClosed (0x16)

房间关闭通知（最后一人离开时触发）。

**响应：**
```json
{
  "type": 22,
  "data": {}
}
```

---

### Error (0x17)

错误响应。

**响应：**
```json
{
  "type": 23,
  "data": {
    "code": "E001",
    "msg": "room not found"
  }
}
```

---

### Ping (0x18)

服务器心跳请求（每 25 秒发送一次）。

**响应：**
```json
{
  "type": 24,
  "data": {
    "t": 1704067200000    // 服务器当前时间戳 (Unix ms)
  }
}
```

客户端收到后应回复 Pong (0x06)。

---

## 文件传输协议 (File Transfer Protocol)

> 📚 学习要点: 协议编号方案
> 文件传输消息使用两个编号段：
> - `0x08-0x0C`: Client → Server（紧接现有 0x01-0x06 之后，0x07 预留）
> - `0x1A-0x1E`: Server → Client（紧接现有 0x10-0x18 之后，0x19 预留）
>
> 这种编号方案保持了「发送方向」的分组一致性：
> - 0x0_ 段 = 客户端发起的消息
> - 0x1_ 段 = 服务器发起/中转的消息

### 设计原则

- **零知识中转**: 服务器不解密、不存储、不检查任何文件内容，仅做即时转发
- **二进制传输**: 加密数据使用 msgpack `bin` 格式直接传输原始字节，避免 base64 编码的 33% 膨胀
- **分片加密**: 64KB 固定分片，每片独立 AES-256-GCM 加密（独立 IV），允许流式处理
- **顺序传输**: 依赖 TCP 保序，无需乱序处理逻辑
- **背压感知**: 文件传输使用带超时的阻塞发送，避免 send buffer 满时静默丢包

### 消息流程图

```
文件传输完整生命周期:

  Sender                    Server                   Receiver
    |                         |                         |
    |--- SendFileMeta ------->|                         |
    |                         |--- RelayFileMeta ------>|
    |                         |                         |
    |--- SendFileChunk[0] --->|                         |
    |                         |--- RelayFileChunk[0] -->|
    |--- SendFileChunk[1] --->|                         |
    |                         |--- RelayFileChunk[1] -->|
    |        ...              |        ...              |
    |--- SendFileChunk[N-1]-->|                         |
    |                         |--- RelayFileChunk[N-1]->|
    |                         |                         |
    |--- SendFileComplete --->|                         |
    |                         |--- RelayFileComplete -->|
    |                         |                         |
    |                         |<-- SendFileAck ---------|
    |<-- RelayFileAck --------|                         |
    |                         |                         |

取消传输流程:

  Sender                    Server                   Receiver
    |                         |                         |
    |--- SendFileCancel ----->|                         |
    |                         |--- RelayFileCancel ---->|
    |                         |                         |

发送方断线流程:

  Sender                    Server                   Receiver
    |                         |                         |
    | [WebSocket 断开]        |                         |
    X                         |--- RelayFileCancel ---->|
                              |    (服务器自动生成)      |
```

### 二进制格式说明

> 📚 学习要点: msgpack bin 格式 vs base64 字符串
> 文件传输中的加密数据（IV、ciphertext）使用 msgpack 的 `bin` 格式传输：
> - `bin` 格式: 直接存储原始字节，开销仅为 1-5 字节长度前缀
> - `base64` 字符串: 将二进制编码为 ASCII，膨胀 33%（3 字节 → 4 字符）
>
> 对于 64KB 的加密分片：
> - bin 格式: 65,552 bytes (数据) + 3 bytes (bin32 头) = 65,555 bytes
> - base64 字符串: 87,404 bytes (编码后) + 5 bytes (str32 头) = 87,409 bytes
> - 节省: ~21,854 bytes/chunk (25% 减少)
>
> 注意: File_Metadata 中的 IV 使用 base64url 字符串（仅发送一次，方便调试），
> 而 Chunk 中的 IV 使用 bin 格式（高频发送，优化性能）。

单个 SendFileChunk 消息的 msgpack 编码大小:

```
- type 字段: 1 byte (fixint 0x09)
- data map header: 1 byte (fixmap, 4 fields)
- "transferId" key + 21 char value: ~25 bytes
- "index" key + uint16 value: ~8 bytes
- "iv" key + 12 bytes bin: ~16 bytes
- "data" key + (65536 + 16) bytes bin: ~65,558 bytes
- msgpack envelope overhead: ~10 bytes
─────────────────────────────────────────────
总计: ~65,620 bytes ≈ 64KB

maxMessageSize = 100KB (102,400 bytes) — 提供充足余量
ReadBufferSize = WriteBufferSize = 128KB (131,072 bytes)
```

---

### SendFileMeta (0x08)

发送加密文件元数据。传输开始前发送，包含加密后的文件信息（文件名、大小、MIME 类型、分片总数等）。

**方向：** Client → Server

**请求：**
```json
{
  "type": 8,
  "data": {
    "transferId": "V1StGXR8_Z5jdHi6B-myT",   // 21 字符 NanoID，唯一标识本次传输
    "iv": "base64url_encoded_12_bytes",        // 96-bit IV (base64url 编码，用于 metadata 加密)
    "ciphertext": <bin>                        // msgpack bin: AES-256-GCM 加密后的 FileMetadata JSON
  }
}
```

**ciphertext 解密后的明文结构 (FileMetadata)：**
```json
{
  "transferId": "V1StGXR8_Z5jdHi6B-myT",
  "fileName": "photo.png",
  "fileSize": 327680,
  "mimeType": "image/png",
  "totalChunks": 5,
  "thumbnail": <Uint8Array | null>,    // 可选: 加密前的缩略图 (≤50KB, JPEG)
  "chunkHashes": ["a1b2c3...", ...]    // 可选: 每个 chunk 明文的 SHA-256 hash
}
```

**服务器行为：**
1. 验证客户端已加入房间（否则返回 E003）
2. 验证客户端无其他活跃传输（`activeTransferID == ""`，否则返回 E005）
3. 设置 `client.activeTransferID = transferId`
4. 通过 `BroadcastFileData` 转发给房间内其他在线成员（附加 senderId、senderName、时间戳）

**错误：** E003 (未加入房间), E005 (已有活跃传输)

> 注意: 文件传输消息不受文本消息频率限制 (E004) 约束，改为「每客户端最多 1 个活跃传输」限制。

---

### SendFileChunk (0x09)

发送加密文件分片。每个分片独立加密，包含唯一 IV。

**方向：** Client → Server

**请求：**
```json
{
  "type": 9,
  "data": {
    "transferId": "V1StGXR8_Z5jdHi6B-myT",   // 传输 ID
    "index": 0,                                // 分片索引 (uint16, 0-based)
    "iv": <bin 12 bytes>,                      // msgpack bin: 96-bit IV (原始字节，非 base64)
    "data": <bin ~65552 bytes>                 // msgpack bin: AES-256-GCM 加密后的分片数据
  }
}
```

**字段说明：**

| 字段 | 类型 | 大小 | 说明 |
|------|------|------|------|
| transferId | string | 21 chars | 传输会话标识符 |
| index | uint16 | 0-65535 | 分片索引，从 0 开始，最大 `ceil(5MB/64KB)-1 = 79` |
| iv | bin | 12 bytes | AES-256-GCM 初始化向量（每片唯一，随机生成） |
| data | bin | ≤65552 bytes | 加密后的分片 = 明文(≤64KB) + GCM tag(16B) |

**服务器行为：**
1. 验证 `transferId` 匹配客户端的 `activeTransferID`
2. 通过 `BroadcastFileData` 转发给房间内其他在线成员（附加 senderId）

> 📚 学习要点: IV 格式选择
> Chunk 的 IV 使用 msgpack bin 格式（原始 12 字节），而非 base64url 字符串。
> 原因：Chunk 高频发送（最多 80 次/文件），避免每次 base64 编码/解码的开销。
> msgpack 对 Uint8Array 使用 bin 格式，比 string 更紧凑（12 bytes vs 16 chars）。

---

### SendFileComplete (0x0A)

文件传输完成信号。发送方在所有分片发送完毕后发送此消息。

**方向：** Client → Server

**请求：**
```json
{
  "type": 10,
  "data": {
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**服务器行为：**
1. 验证 `transferId` 匹配客户端的 `activeTransferID`
2. 清除 `client.activeTransferID`（释放传输槽位）
3. 通过 `BroadcastFileData` 转发给房间内其他在线成员

---

### SendFileCancel (0x0B)

取消文件传输。发送方主动取消正在进行的传输。

**方向：** Client → Server

**请求：**
```json
{
  "type": 11,
  "data": {
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**服务器行为：**
1. 验证 `transferId` 匹配客户端的 `activeTransferID`
2. 清除 `client.activeTransferID`（释放传输槽位）
3. 通过 `BroadcastFileData` 转发给房间内其他在线成员

> 注意: 发送方断线时，服务器也会自动生成 RelayFileCancel 广播给房间成员。

---

### SendFileAck (0x0C)

文件接收确认。接收方在成功接收并重组完整文件后发送此消息。

**方向：** Client → Server

**请求：**
```json
{
  "type": 12,
  "data": {
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**服务器行为：**
1. 验证 `transferId` 非空
2. 在房间成员中查找原始发送方（`activeTransferID` 匹配或最近完成该传输的客户端）
3. 仅将 ACK 发送给原始发送方（定向中转，非广播）

> 📚 学习要点: ACK 的定向中转
> 与其他文件传输消息（广播给所有成员）不同，ACK 仅发送给原始发送方。
> 这避免了 N 个接收方的 ACK 被广播给所有人（N² 消息放大）。
> 发送方通过 ACK 计数更新 UI："已送达 (2/5)"。

---

### RelayFileMeta (0x1A)

服务器中转的文件元数据。接收方通过此消息获知有新文件传输开始。

**方向：** Server → Client

**响应：**
```json
{
  "type": 26,
  "data": {
    "senderId": "a1b2c3d4",                    // 发送方 Client ID
    "senderName": "Alice",                     // 发送方昵称
    "transferId": "V1StGXR8_Z5jdHi6B-myT",    // 传输 ID
    "iv": "base64url_encoded_12_bytes",        // metadata 加密 IV
    "ciphertext": <bin>,                       // msgpack bin: 加密后的 FileMetadata
    "t": 1704067200000                         // 服务器接收时间戳 (Unix ms)
  }
}
```

**接收方行为：**
1. 使用 Room_Key + IV 解密 ciphertext 获取 FileMetadata
2. 准备 `chunks[]` 缓冲区（大小 = totalChunks）
3. 在聊天列表中插入文件消息占位符
4. 启动 60 秒超时定时器

---

### RelayFileChunk (0x1B)

服务器中转的文件分片。接收方逐片解密并存入缓冲区。

**方向：** Server → Client

**响应：**
```json
{
  "type": 27,
  "data": {
    "senderId": "a1b2c3d4",                    // 发送方 Client ID
    "transferId": "V1StGXR8_Z5jdHi6B-myT",    // 传输 ID
    "index": 0,                                // 分片索引
    "iv": <bin 12 bytes>,                      // msgpack bin: 分片加密 IV
    "data": <bin ~65552 bytes>                 // msgpack bin: 加密后的分片数据
  }
}
```

**接收方行为：**
1. 验证 `transferId` 存在于活跃传输中（未知 ID 静默丢弃）
2. 验证 `index` 在有效范围内（`0 ≤ index < totalChunks`）
3. 检查是否为重复分片（已收到则静默忽略）
4. 使用 Room_Key + IV 解密分片数据
5. 存入 `chunks[index]`，更新进度
6. 重置 60 秒超时定时器

---

### RelayFileComplete (0x1C)

服务器中转的传输完成信号。接收方收到后进行文件重组。

**方向：** Server → Client

**响应：**
```json
{
  "type": 28,
  "data": {
    "senderId": "a1b2c3d4",
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**接收方行为：**
1. 验证所有分片已接收（`receivedChunks === totalChunks`）
2. 按索引顺序重组分片为完整文件
3. 清理文件名（移除路径分隔符、null 字节，限制 255 字符）
4. 创建 Blob URL 供用户下载
5. 发送 SendFileAck (0x0C) 确认接收
6. 更新传输状态为 complete

---

### RelayFileCancel (0x1D)

服务器中转的取消信号。发送方主动取消或断线时触发。

**方向：** Server → Client

**响应：**
```json
{
  "type": 29,
  "data": {
    "senderId": "a1b2c3d4",
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**接收方行为：**
1. 丢弃该传输的所有已接收分片缓冲区
2. 清除超时定时器
3. 显示 "发送方已取消传输" 或 "发送方已离开，传输中断"
4. 更新传输状态为 cancelled

> 注意: 此消息可能由发送方主动触发（SendFileCancel），也可能由服务器在发送方断线时自动生成。

---

### RelayFileAck (0x1E)

服务器中转的接收确认。仅发送给原始文件发送方。

**方向：** Server → Client（仅发送方）

**响应：**
```json
{
  "type": 30,
  "data": {
    "receiverId": "e5f6g7h8",                  // 确认接收的成员 ID
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**发送方行为：**
1. 递增该传输的 ACK 计数
2. 更新 UI 显示 "已送达 (N/M)"（N = 已确认数，M = 房间总人数 - 1）

---

## 文件传输约束

| 参数 | 值 | 说明 |
|------|------|------|
| Max_File_Size | 5MB (5,242,880 bytes) | 单文件大小上限 |
| Chunk_Size | 64KB (65,536 bytes) | 固定分片大小（最后一片可能更小） |
| Max_Chunks | 80 | `ceil(5MB / 64KB)` |
| Transfer_Timeout | 60s | 无新分片则标记传输失败 |
| Server_Transfer_Timeout | 90s | 服务器端兜底超时清理 |
| Max_Active_Transfers | 1/client | 每客户端同时只能有 1 个活跃传输 |
| Max_Queue_Size | 3 | 发送队列最大待发送数 |
| Max_Concurrent_Receives | 5 | 最大并发接收传输数 |
| Inter_Chunk_Delay | 10ms (base) | 分片间基础延迟（自适应调整） |
| SendFileData_Timeout | 5s | 服务器端单接收方发送超时 |
| maxMessageSize | 100KB (102,400 bytes) | WebSocket 单消息大小上限 |
| ReadBufferSize | 128KB (131,072 bytes) | WebSocket 读缓冲区 |
| WriteBufferSize | 128KB (131,072 bytes) | WebSocket 写缓冲区 |

---

## 连接生命周期

```
1. 客户端发起 WebSocket 连接 → ws://host/ws
2. 服务器分配 Client ID (UUID 前 8 位)
3. 服务器开始 25s 间隔 Ping
4. 客户端发送 CreateRoom/JoinRoom 加入房间
5. 正常消息交换
6. 客户端发送 LeaveRoom 或断线
7. 服务器清理连接和房间状态
```

---

## 重连策略

客户端断线后自动重连：

| 重试次数 | 等待时间 |
|----------|----------|
| 1 | 1s |
| 2 | 2s |
| 3 | 4s |
| 4 | 8s |
| 5 | 16s |
| 6+ | 30s (最大) |

重连成功后退避时间重置为 1s。

---

## 下一步

- [安全模型](security.md) — 加密方案详解
- [配置参考](configuration.md) — 参数调优
