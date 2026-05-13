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

| ID     | 名称　　　　| 说明　　　　 |
| --------| -------------| --------------|
| `0x01` | CreateRoom　| 创建房间　　 |
| `0x02` | JoinRoom　　| 加入房间　　 |
| `0x03` | SendMessage | 发送加密消息 |
| `0x04` | LeaveRoom　 | 离开房间　　 |
| `0x05` | Typing　　　| 输入状态　　 |
| `0x06` | Pong　　　　| 心跳回复　　 |

### Server → Client

| ID     | 名称　　　　 | 说明　　　　 |
| --------| --------------| --------------|
| `0x10` | RoomCreated　| 房间创建成功 |
| `0x11` | RoomJoined　 | 加入房间成功 |
| `0x12` | MemberJoined | 新成员加入　 |
| `0x13` | MemberLeft　 | 成员离开　　 |
| `0x14` | RelayMessage | 转发加密消息 |
| `0x15` | MemberTyping | 成员输入状态 |
| `0x16` | RoomClosed　 | 房间关闭　　 |
| `0x17` | Error　　　　| 错误响应　　 |
| `0x18` | Ping　　　　 | 心跳请求　　 |

---

## 消息详细定义

### CreateRoom (0x01)

创建一个新的聊天房间。

**请求：**
```json
{
  "type": 1,
  "data": {
    "name": "Alice"        // 创建者昵称 (1-20 字符)
  }
}
```

**响应：** RoomCreated (0x10) + RoomJoined (0x11)

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
