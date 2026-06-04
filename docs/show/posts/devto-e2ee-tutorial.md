---
title: "How I built an E2EE chat in Go + React (with AI agent support)"
published: true
description: "End-to-end encrypted ephemeral chat with AES-256-GCM. Try it in 2 minutes — create a room from the CLI, connect an AI agent via npm, and chat privately."
tags: go, encryption, security, opensource
cover_image: ""
---

> 🚀 **Try it now:** [Open the Arthas web app](https://arthas-blush.vercel.app/) — create a room, share the code, chat with E2EE. No signup needed.

## TL;DR — Try It in 2 Minutes

No signup required. A free public server is running at `wss://arthas100-arthas-server.hf.space/ws`.

### 1. Create an encrypted room (CLI)

```bash
# Linux/macOS — download and make executable
curl -L -o arthas-cli https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli
chmod +x arthas-cli

# Windows (PowerShell) — download the .exe
# curl.exe -L -o arthas-cli.exe https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli-windows-amd64.exe

# Create a room — generates AES-256 key locally, outputs share code
./arthas-cli create --server wss://arthas100-arthas-server.hf.space/ws --name "Alice"
# Windows: .\arthas-cli.exe create --server wss://arthas100-arthas-server.hf.space/ws --name "Alice"

# Output:
# ✓ Room created! Share code:
# QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM
#
# The encryption key never leaves your device.
```

> ⚠️ **Keep this terminal open** — the room exists only while at least one participant is connected.

### 2. Join from another terminal (or send the code to a friend)

```bash
# Linux/macOS
./arthas-cli join QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM \
  --server wss://arthas100-arthas-server.hf.space/ws \
  --name "Bob"

# Windows
# .\arthas-cli.exe join QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM --server wss://arthas100-arthas-server.hf.space/ws --name "Bob"
```

That's it — you're chatting end-to-end encrypted. The server only sees ciphertext blobs; it cannot read, store, or parse anything.

> 💡 Prefer a web UI? Open the [Arthas web app](https://arthas-blush.vercel.app/), create a room, and share the code.

---

## Bonus: Connect an AI Agent to the Same Room

Every AI agent channel today (Telegram bots, Slack apps, Discord) transmits prompts in plaintext. With Arthas, your AI joins the encrypted room as a regular participant — the server can't tell human from bot (both are encrypted binary blobs).

```bash
npm install @arthas-chat/openclaw-channel
```

```typescript
import { ArthasChannelAdapter } from '@arthas-chat/openclaw-channel';

const adapter = new ArthasChannelAdapter();

adapter.onMessage(async (message) => {
  // message.text is already decrypted — E2EE handled internally
  const response = await yourLLM.generate(message.text);
  await adapter.send({ id: crypto.randomUUID(), channelId: 'arthas', text: response });
});

await adapter.connect({
  serverUrl: 'wss://arthas100-arthas-server.hf.space/ws',
  shareCode: 'QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM', // from step 1
  displayName: 'AI Assistant',
});
```

Now talk to the AI from the CLI:

```bash
./arthas-cli join QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM \
  --server wss://arthas100-arthas-server.hf.space/ws --name "Michael"

> Summarize GDPR Article 17
AI Assistant: Article 17 establishes the "right to erasure"...
```

**What the server sees vs. reality:**

| Server's view | Reality |
|---------------|---------|
| Binary blob from User A | "Summarize this contract for me" |
| Binary blob from User B | "Here's a summary of the key clauses..." |
| Binary blob with file attachment | Confidential PDF being analyzed |

The plugin ([`@arthas-chat/openclaw-channel`](https://www.npmjs.com/package/@arthas-chat/openclaw-channel)) handles WebSocket, MessagePack, AES-256-GCM, and exponential-backoff reconnection internally.

---

## Motivation

I needed to share API keys and credentials with teammates but didn't trust Slack DMs. Existing tools like PrivNote or Yopass are one-shot — you paste a secret, someone reads it, gone. No real-time conversation.

I wanted:

- **Ephemeral** — create a room, chat, leave, everything disappears
- **End-to-end encrypted** — the server can't read anything
- **No signup** — open a URL and start chatting
- **Self-hostable** — run it on your own infrastructure

So I built [Arthas](https://github.com/michaelwang123/arthas). Here's how the crypto, relay server, and frontend fit together.

---

## Architecture Overview

The architecture follows a simple principle: **the server is a dumb pipe**.

```
Browser A                   Go Server (Relay)              Browser B
   │                            │                            │
   │── Plain → AES Encrypt ──→  │── Forward ciphertext ──→   │
   │                            │                            │→ AES Decrypt → Plain
   │                            │                            │
   Server only ever sees ciphertext. Cannot decrypt.
```

1. **Room creator** generates a 256-bit AES key locally (never sent to server)
2. **Share code** = `roomId:base64url(key)` — one string, both address and key
3. **Joiner** parses the share code, connects, decrypts
4. **Server** broadcasts encrypted blobs — zero knowledge

The encryption key travels through a **side channel** (copy-paste, QR code) — never through the server.

**Tech stack:**

| Layer | Technology |
|-------|-----------|
| Crypto | Web Crypto API (browser) / `crypto/aes` (Go CLI) |
| Frontend | React 18 + TypeScript + Zustand |
| Protocol | WebSocket + MessagePack (binary) |
| Backend | Go 1.23 + gorilla/websocket |
| Deploy | Single binary or Docker Compose + Caddy |

---

## E2EE Implementation

### Key Generation

**TypeScript (Web Client):**

```typescript
export async function generateRoomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportRoomKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return toBase64Url(raw); // 43-char string for 32 bytes
}
```

**Go (CLI Client):**

```go
func GenerateRoomKey() ([]byte, error) {
    key := make([]byte, 32) // AES-256
    if _, err := io.ReadFull(rand.Reader, key); err != nil {
        return nil, fmt.Errorf("generate key: %w", err)
    }
    return key, nil
}

func ExportKeyBase64URL(key []byte) string {
    return base64.RawURLEncoding.EncodeToString(key) // 43 chars
}
```

Both produce the same 43-character base64url string — Go CLI and web client are fully interoperable.

### AES-256-GCM Encryption

Every message gets a unique random 12-byte IV. AES-GCM provides confidentiality + integrity in one operation.

**TypeScript:**

```typescript
export async function encryptMessage(
  key: CryptoKey,
  plaintext: string
): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintextBytes
  );
  return {
    iv: toBase64Url(iv.buffer),
    ciphertext: toBase64Url(ciphertextBuffer),
  };
}
```

**Go:**

```go
func Encrypt(key []byte, plaintext []byte) (iv, ciphertext string, err error) {
    block, _ := aes.NewCipher(key)
    gcm, _ := cipher.NewGCM(block)
    nonce := make([]byte, gcm.NonceSize()) // 12 bytes
    io.ReadFull(rand.Reader, nonce)
    sealed := gcm.Seal(nil, nonce, plaintext, nil)
    return base64.RawURLEncoding.EncodeToString(nonce),
           base64.RawURLEncoding.EncodeToString(sealed), nil
}
```

**Why AES-GCM?** AEAD (no separate HMAC), hardware-accelerated (AES-NI), natively in Web Crypto API. Never reuse an IV with the same key — with random 12-byte IVs, collision probability is ~2⁻⁴⁸ after 2³² messages.

---

## WebSocket Relay Design

The server is a Go program that accepts connections, manages rooms, and broadcasts ciphertext. It never decrypts.

### Hub Pattern (CSP concurrency)

```go
type Hub struct {
    roomManager *room.RoomManager
    clients     map[*Client]bool
    register    chan *Client
    unregister  chan *Client
}

func (h *Hub) Run() {
    for {
        select {
        case client := <-h.register:
            h.clients[client] = true
        case client := <-h.unregister:
            delete(h.clients, client)
            close(client.send)
        }
    }
}
```

### Zero-Knowledge Relay

```go
func (h *Hub) handleSendMessage(client *Client, data interface{}) {
    dataMap, _ := data.(map[string]interface{})
    iv, _ := dataMap["iv"].(string)
    ciphertext, _ := dataMap["ciphertext"].(string)

    if iv == "" || ciphertext == "" {
        h.sendError(client, ErrCodeInvalidMessage, "iv and ciphertext required")
        return
    }
    if client.IsRateLimited() {
        h.sendError(client, ErrCodeRateLimited, "rate limited")
        return
    }

    // Forward — server never decrypts
    relayMsg := Message{
        Type: MsgRelayMessage,
        Data: RelayMessageData{
            SenderID: client.ID, SenderName: client.Name,
            IV: iv, Ciphertext: ciphertext, T: time.Now().UnixMilli(),
        },
    }
    broadcastData, _ := msgpack.Marshal(relayMsg)
    room.Broadcast(client.ID, broadcastData)
}
```

### MessagePack over JSON

30-50% smaller payloads, efficient binary, single-byte message type routing. Protocol envelope: `{ type: uint8, data: any }`.

---

## Deployment

### Single Binary (dev/intranet)

```bash
./arthas-server --port 8080
# Serves WebSocket at /ws + frontend at / — one process, zero deps
```

### Docker (production)

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o server ./cmd/server

FROM alpine:3.23
COPY --from=builder /app/server .
USER 1000
EXPOSE 7860
CMD ["./server"]
```

Under 30MB final image. Add Caddy for automatic HTTPS.

---

## What I Learned

1. **Web Crypto API is powerful** — no third-party crypto libs needed in the browser
2. **Go's goroutine-per-connection model** fits WebSocket servers perfectly
3. **MessagePack > JSON** for binary protocols (size + speed)
4. **Key distribution is the hard part** — the crypto is straightforward, getting the key to the right people securely is the challenge
5. **Zero-knowledge simplifies everything** — no GDPR concerns for message content, no database encryption needed

---

## Links

- **Live Demo**: [arthas-blush.vercel.app](https://arthas-blush.vercel.app/) (no signup, try it now)
- **Public Server**: `wss://arthas100-arthas-server.hf.space/ws` (free, no signup)
- **GitHub**: [github.com/michaelwang123/arthas](https://github.com/michaelwang123/arthas)
- **AI Agent Plugin**: [`@arthas-chat/openclaw-channel` on npm](https://www.npmjs.com/package/@arthas-chat/openclaw-channel)
- **Docs**: [michaelwang123.github.io/arthas](https://michaelwang123.github.io/arthas/)

⭐ Star the repo if you find it useful. Feedback and PRs welcome!
