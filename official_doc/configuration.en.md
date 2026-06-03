[中文](configuration.md) | English

# Configuration Reference

This document lists all configurable parameters for Arthas.

---

## Backend Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP/WebSocket server listening port |

### Built-in Constants

The following parameters are defined in code and require recompilation to modify:

| Parameter | Value | File | Description |
|-----------|-------|------|-------------|
| `MaxMembers` | 50 | `internal/room/room.go` | Maximum members per room |
| `writeWait` | 10s | `internal/network/client.go` | WebSocket write timeout |
| `pongWait` | 40s | `internal/network/client.go` | Read timeout (1.5× heartbeat) |
| `sendBufferSize` | 256 | `internal/network/client.go` | Send buffer size |
| `maxMessageSize` | 102400 bytes | `internal/network/client.go` | Maximum bytes per message (includes file chunks) |
| `rateLimitWindow` | 10s | `internal/network/client.go` | Rate limit sliding window |
| `rateLimitMaxCount` | 10 | `internal/network/client.go` | Maximum messages per window |
| Ping interval | 25s | `internal/network/client.go` | Heartbeat send interval |
| NanoID length | 21 chars | `internal/network/hub.go` | Room ID length |

---

## Frontend Configuration

### Environment Variables

| Variable | Default | File | Description |
|----------|---------|------|-------------|
| `VITE_WS_URL` | `ws://localhost:8080/ws` | `.env.development` | WebSocket server address |

### Environment Files

- `.env.development` — Development environment configuration
- `.env.production` — Production environment configuration (must be created)

Production example `.env.production`:

```env
VITE_WS_URL=wss://your-backend-domain.com/ws
```

### Built-in Constants

| Parameter | Value | File | Description |
|-----------|-------|------|-------------|
| `MAX_MESSAGES` | 200 | `stores/chatStore.ts` | Maximum messages retained in list |
| `RATE_LIMIT_WINDOW_MS` | 10000 | `stores/chatStore.ts` | Client-side rate limit window |
| `RATE_LIMIT_MAX` | 10 | `stores/chatStore.ts` | Maximum sends per window |
| `TYPING_TIMEOUT_MS` | 2000 | `stores/chatStore.ts` | Typing status auto-cancel time |
| `MAX_LENGTH` | 500 | `components/MessageInput.tsx` | Maximum characters per message |
| `SHOW_COUNT_THRESHOLD` | 400 | `components/MessageInput.tsx` | Threshold to show character count |
| `BACKOFF_INITIAL_MS` | 1000 | `network/websocket.ts` | Reconnection initial backoff time |
| `BACKOFF_MAX_MS` | 30000 | `network/websocket.ts` | Reconnection maximum backoff time |

---

## Vite Configuration

File: `arthas-client/vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

---

## CLI Client Configuration

### Command-Line Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--server` | `wss://arthas-chat.onrender.com/ws` | WebSocket server URL |
| `--name` | Interactive prompt | Display nickname (1-20 characters) |
| `--version` | — | Show version and exit |
| `--help` | — | Show help information and exit |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ARTHAS_SERVER` | — | WebSocket server URL (lower priority than `--server` flag) |

### Built-in Constants

| Parameter | Value | File | Description |
|-----------|-------|------|-------------|
| `joinTimeout` | 30s | `internal/chat/session.go` | Timeout waiting for server response |
| `writeWait` | 10s | `internal/network/websocket.go` | WebSocket write timeout |
| `pongWait` | 40s | `internal/network/websocket.go` | Read timeout (1.6× heartbeat) |
| `maxMessageSize` | 102400 | `internal/network/websocket.go` | Maximum bytes per message |
| `sendChCapacity` | 16 | `internal/network/websocket.go` | Send queue capacity |
| Nickname length limit | 20 runes | `internal/ui/input.go` | Maximum display name length |
| Message length limit | 500 runes | `internal/ui/input.go` | Maximum message length |

### Configuration Priority

```
--server flag  >  ARTHAS_SERVER environment variable  >  default (wss://arthas-chat.onrender.com/ws)
--name flag    >  interactive prompt input
```

---

## Tailwind Configuration

File: `arthas-client/tailwind.config.js`

Uses dark theme by default, scans all TSX/TS files under `src/`.

---

## Docker Configuration

File: `arthas-server/Dockerfile`

| Parameter | Value | Description |
|-----------|-------|-------------|
| Base image | `golang:1.23-alpine` | Build stage |
| Runtime image | `alpine:3.23` | Minimal runtime environment |
| Exposed port | 7860 | Docker default port |
| `PORT` environment variable | 7860 | Server listening port |

---

## Encryption Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Algorithm | AES-256-GCM | AEAD authenticated encryption |
| Key length | 256 bits (32 bytes) | AES-256 |
| IV length | 96 bits (12 bytes) | GCM recommended length |
| roomId length | 21 chars | NanoID default length |
| Share code format | `{roomId}:{base64url(key)}` | Total 65 characters |
| Share code length | 65 chars | 21 + 1 + 43 |

---

## Error Codes

| Code | Name | Trigger Condition | Client Message |
|------|------|-------------------|----------------|
| E001 | ROOM_NOT_FOUND | roomId does not exist during JoinRoom | "Room does not exist or has been closed" |
| E002 | ROOM_FULL | Room is full (50 members) during JoinRoom | "Room is full, cannot join" |
| E003 | NOT_IN_ROOM | SendMessage/Typing without joining a room | "Please join a room first" |
| E004 | RATE_LIMITED | Message rate exceeds 10 messages/10 seconds | "Sending too fast, please try again later" |
| E005 | INVALID_MESSAGE | Invalid message format (empty/too long) | "Invalid message format" |

---

## Next Steps

- [Protocol Specification](protocol.md) — Detailed message format definitions
- [Self-Hosting Guide](self-hosting.en.md) — Production environment deployment
