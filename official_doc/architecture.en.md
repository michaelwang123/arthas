[中文](architecture.md) | English

# System Architecture

This document describes the overall system architecture, module organization, and data flow of Arthas.

---

## Architecture Overview

Arthas uses a classic frontend-backend separation architecture. The core design principle is **Server Zero-Knowledge**:

```
┌──────────────────────────────────────────────────────────┐
│                    Browser (Web Client)                    │
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
                       │ WSS / TLS 1.3 (ciphertext transport)
┌──────────────────────┼───────────────────────────────────┐
│                      │       Go Server (relay only)       │
│            ┌─────────┴──────────┐                        │
│            │   Hub (connection   │                        │
│            │       management)   │                        │
│            └─────────┬──────────┘                        │
│                      │                                   │
│            ┌─────────┴──────────┐                        │
│            │   RoomManager      │                        │
│            │   (room routing +  │                        │
│            │    forwarding)      │                        │
│            └─────────┬──────────┘                        │
└──────────────────────┼───────────────────────────────────┘
                       │ WSS / TLS 1.3 (ciphertext transport)
┌──────────────────────┼───────────────────────────────────┐
│                      │       CLI Client (arthas-cli)      │
│            ┌─────────┴──────────┐                        │
│            │  WebSocket + msgpack│                        │
│            └─────────┬──────────┘                        │
│                      │                                   │
│  ┌──────────┐  ┌─────┴────┐  ┌────────────────────────┐ │
│  │ Terminal │  │  Session  │  │   Crypto Layer         │ │
│  │   UI    │  │  (CSP)   │  │   AES-256-GCM (stdlib) │ │
│  └──────────┘  └──────────┘  └────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

The Web client and CLI client use the exact same protocol (MessagePack + AES-256-GCM) and can interoperate within the same room.

---

## Design Principles

### 1. Server Zero-Knowledge

```
What the server does:
  ✅ Manage WebSocket connections
  ✅ Manage rooms (create/join/leave/destroy)
  ✅ Route messages by roomId
  ✅ Forward ciphertext as-is to room members
  ✅ Heartbeat keep-alive + disconnection cleanup

What the server does NOT do:
  ❌ Does not generate/hold encryption keys
  ❌ Does not decrypt message content
  ❌ Does not store message history
  ❌ Does not validate message content
```

### 2. Pure In-Memory State

- No database dependency
- Room and connection state exists only in memory
- Server restart = all rooms destroyed
- Suitable for ephemeral chat scenarios

### 3. Event-Driven

- Messages are forwarded immediately upon receipt, no polling
- Goroutine-per-connection model
- Non-blocking message broadcast

---

## Module Organization

### Backend Modules

```
arthas-server/
├── cmd/server/main.go          # Entry: HTTP server + WebSocket upgrade
├── internal/
│   ├── network/
│   │   ├── hub.go              # Hub: connection pool management + message routing
│   │   ├── client.go           # Client: per-connection read/write goroutines
│   │   └── protocol.go         # Protocol: MessagePack message definitions
│   └── room/
│       ├── manager.go          # RoomManager: room CRUD
│       └── room.go             # Room: member management + message broadcast
```

| Module | Responsibility |
| -----------------| ------------------------------------------------------------|
| **Hub** | Manages all WebSocket connections, handles register/unregister, routes messages to handlers |
| **Client** | Represents a single WebSocket connection, contains read/write goroutines |
| **Protocol** | Defines all message types and data structures |
| **RoomManager** | Manages room lifecycle (create/find/destroy) |
| **Room** | Manages a single room's member list and message broadcast |

### CLI Client Modules

```
arthas-cli/
├── cmd/arthas-cli/main.go          # Entry: subcommand routing + argument parsing
├── internal/
│   ├── protocol/
│   │   ├── protocol.go             # Message type constants + data structures
│   │   └── codec.go                # MessagePack encode/decode + ToInt helper
│   ├── crypto/
│   │   ├── keys.go                 # Key generation (crypto/rand) + base64url
│   │   ├── encrypt.go              # AES-256-GCM encryption
│   │   ├── decrypt.go              # AES-256-GCM decryption
│   │   └── sharecode.go            # Share code parsing/construction
│   ├── network/
│   │   └── websocket.go            # WebSocket connection management (writePump pattern)
│   ├── ui/
│   │   ├── display.go              # Terminal output formatting + ANSI colors
│   │   ├── input.go                # stdin reading + input validation
│   │   └── color.go                # Hex → ANSI 256-color conversion
│   └── chat/
│       └── session.go              # Session state machine + 4-goroutine event loop
├── go.mod
└── Makefile                        # Cross-platform compilation
```

| Module | Responsibility |
|------|------|
| **protocol** | Defines message type constants and MessagePack codec, fully aligned with server protocol |
| **crypto** | AES-256-GCM encryption/decryption + key management + share codes, using Go standard library |
| **network** | WebSocket connection wrapper, writePump pattern ensures thread safety |
| **ui** | Terminal output (ANSI colors, timestamps) and input (line reading, validation) |
| **chat** | Session coordination layer, CSP concurrency model (4 goroutines + channel communication) |

### Frontend Modules

```
arthas-client/src/
├── crypto/                     # E2EE encryption layer
│   ├── keys.ts                 # Key generation/import/export
│   ├── encrypt.ts              # AES-GCM encryption
│   ├── decrypt.ts              # AES-GCM decryption
│   ├── shareKey.ts             # Share code encode/decode
│   └── utils.ts                # base64url utilities
├── network/                    # Network layer
│   ├── protocol.ts             # Message type definitions
│   └── websocket.ts            # WebSocket connection management
├── stores/                     # State layer
│   └── chatStore.ts            # Zustand global state
├── pages/                      # Pages
│   ├── Home.tsx                # Home page (create/join)
│   └── ChatRoom.tsx            # Chat room
└── components/                 # Components
    ├── MessageList.tsx         # Message list
    ├── MessageInput.tsx        # Message input
    ├── MemberList.tsx          # Member list
    ├── ShareKey.tsx            # Share code display
    └── TypingIndicator.tsx     # Typing indicator
```

---

## Data Flow

### Sending a Message

```
User inputs plaintext
    → chatStore.sendMessage(text)
    → encryptMessage(roomKey, text) → {iv, ciphertext}
    → ws.send(msgpack({type: 0x03, data: {iv, ciphertext}}))
    → Server Hub.HandleMessage()
    → handleSendMessage() → room.Broadcast(senderId, data)
    → Other clients receive via WebSocket
```

### Receiving a Message

```
WebSocket receives binary data
    → msgpack.decode → {type: 0x14, data: {senderId, senderName, iv, ciphertext, t}}
    → chatStore.handleServerMessage()
    → decryptMessage(roomKey, iv, ciphertext) → plaintext
    → Update messages state
    → React renders message bubble
```

### Creating a Room

```
User clicks "Create Room"
    → generateRoomKey() → AES-256 CryptoKey
    → ws.send(CreateRoom{name})
    → Server generates NanoID roomId
    → Server creates Room, adds creator
    → Returns RoomCreated{roomId}
    → Client encodeShareKey(roomId, key) → share code
```

### Joining a Room

```
User enters share code
    → decodeShareKey(code) → {roomId, keyEncoded}
    → importRoomKey(keyEncoded) → CryptoKey
    → ws.send(JoinRoom{roomId, name})
    → Server verifies roomId exists
    → Adds member, broadcasts MemberJoined
    → Returns RoomJoined{roomId, members[]}
```

---

## Concurrency Model

### Backend Goroutine Model

```
main goroutine
    └── Hub.Run() goroutine (event loop)
            ├── Handle register (new connections)
            ├── Handle unregister (disconnections)
            └── Message routing

Per WebSocket connection:
    ├── readPump goroutine (read messages)
    └── writePump goroutine (send messages + heartbeat)
```

### Thread Safety

- `RoomManager.rooms` — protected by `sync.RWMutex`
- `Room.members` — protected by `sync.RWMutex`
- `Client.send` — buffered channel (256)
- `Hub.clients` — protected by `sync.RWMutex`

---

## Room Lifecycle

```
CreateRoom → Room created (in memory) → Creator auto-joins
    ↓
JoinRoom → Verify roomId → Join → Broadcast MemberJoined
    ↓
SendMessage → Forward as-is to other room members
    ↓
LeaveRoom / Disconnect → Remove member → Broadcast MemberLeft
    ↓
Last member leaves → Room deleted from memory → roomId invalidated
```

---

## Server Visibility

| Information | Visible to Server | Notes |
|------|-----------|------|
| roomId | ✅ | Used for routing |
| Member ID/nickname | ✅ | Used for broadcast |
| Message timestamp | ✅ | Appended by server |
| Typing status | ✅ | Unencrypted metadata |
| Message plaintext | ❌ | End-to-end encrypted |
| roomKey | ❌ | Held only by clients |

---

## Next Steps

- [Protocol Specification](protocol.md) — Detailed message format definitions
- [Security Model](security.md) — Encryption scheme and threat analysis
- [Deployment Guide](deployment.md) — Production environment deployment
