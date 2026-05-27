---
title: "How I built an E2EE chat in Go + React"
published: false
description: "A step-by-step tutorial on building end-to-end encrypted ephemeral chat with AES-256-GCM, WebSocket relay, and zero-knowledge server design."
tags: go, react, encryption, webdev
cover_image: ""
---

## Motivation

I needed to share API keys and credentials with teammates but didn't trust Slack DMs. Existing tools like PrivNote or Yopass are one-shot — you paste a secret, someone reads it, and it's gone. No real-time conversation.

I wanted something different:

- **Ephemeral** — create a room, chat, leave, everything disappears
- **End-to-end encrypted** — the server can't read anything
- **No signup** — open a URL and start chatting
- **Self-hostable** — run it on your own infrastructure with zero dependencies

So I built [Arthas](https://github.com/michaelwang123/arthas): an E2EE ephemeral chat app with a Go relay server and a React frontend. The server only ever sees ciphertext — it cannot decrypt, store, or parse any message content.

In this tutorial, I'll walk through the key technical decisions and show you how the encryption, WebSocket relay, and frontend all fit together.

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

Here's how it works:

1. **Room creator** generates a 256-bit AES key locally (never sent to server)
2. **Share code** = `roomId:base64url(key)` — one string contains both the room address and the decryption key
3. **Joiner** parses the share code, connects to the room, and uses the key to decrypt messages
4. **Server** receives encrypted blobs via WebSocket and broadcasts them to other room members — zero knowledge

The key insight: the encryption key travels through a **side channel** (copy-paste, QR code, in-person) — never through the server. The server only knows the room ID, not the key.

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

The room creator generates a 256-bit AES key. This key is the single shared secret — anyone who has it can read messages, anyone without it sees only ciphertext.

**TypeScript (Web Client — using Web Crypto API):**

```typescript
// Generate a new AES-256-GCM CryptoKey for a chat room.
// extractable: true — needed so we can export it into the share code.
export async function generateRoomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable — needed for export/sharing
    ["encrypt", "decrypt"]
  );
}

// Export the key to a base64url string (43 chars for 32 bytes)
export async function exportRoomKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return toBase64Url(raw);
}
```

**Go (CLI Client — using crypto/rand):**

```go
const keySize = 32 // AES-256 = 32 bytes

// GenerateRoomKey creates a 256-bit AES key using the OS CSPRNG.
// On Linux: getrandom(2), macOS: arc4random, Windows: CryptGenRandom.
func GenerateRoomKey() ([]byte, error) {
    key := make([]byte, keySize)
    if _, err := io.ReadFull(rand.Reader, key); err != nil {
        return nil, fmt.Errorf("failed to generate room key: %w", err)
    }
    return key, nil
}

// ExportKeyBase64URL encodes the key as a URL-safe base64 string (no padding).
// Output is always 43 characters for a 32-byte key.
func ExportKeyBase64URL(key []byte) string {
    return base64.RawURLEncoding.EncodeToString(key)
}
```

Both implementations produce the same 43-character base64url string — the Go CLI and web client are fully interoperable.

### AES-256-GCM Encryption

Every message gets a unique random 12-byte IV (initialization vector). AES-GCM provides both confidentiality and integrity — if anyone tampers with the ciphertext, decryption fails with an authentication error rather than producing garbage.

**TypeScript (Web Client):**

```typescript
export async function encryptMessage(
  key: CryptoKey,
  plaintext: string
): Promise<{ iv: string; ciphertext: string }> {
  // 1. Generate a random 96-bit (12 bytes) IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 2. Encode plaintext to UTF-8 bytes
  const plaintextBytes = new TextEncoder().encode(plaintext);

  // 3. Encrypt using AES-GCM (output includes 16-byte auth tag)
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintextBytes
  );

  // 4. Return base64url-encoded IV and ciphertext
  return {
    iv: toBase64Url(iv.buffer),
    ciphertext: toBase64Url(ciphertextBuffer),
  };
}
```

**Go (CLI Client):**

```go
func Encrypt(key []byte, plaintext []byte) (iv string, ciphertext string, err error) {
    // 1. Create AES cipher block (key must be 32 bytes for AES-256)
    block, err := aes.NewCipher(key)
    if err != nil {
        return "", "", fmt.Errorf("failed to create AES cipher: %w", err)
    }

    // 2. Create GCM mode (12-byte nonce, 16-byte auth tag)
    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", "", fmt.Errorf("failed to create GCM: %w", err)
    }

    // 3. Generate 12-byte random IV
    nonce := make([]byte, gcm.NonceSize()) // NonceSize() = 12
    if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
        return "", "", fmt.Errorf("failed to generate random IV: %w", err)
    }

    // 4. Encrypt: result = ciphertext || 16-byte auth tag
    sealed := gcm.Seal(nil, nonce, plaintext, nil)

    // 5. Base64URL encode (no padding) — matches Web Crypto output
    iv = base64.RawURLEncoding.EncodeToString(nonce)
    ciphertext = base64.RawURLEncoding.EncodeToString(sealed)

    return iv, ciphertext, nil
}
```

**Why AES-GCM?**

- It's an AEAD cipher — encryption + authentication in one operation
- No need for a separate HMAC step (fewer things to get wrong)
- Hardware-accelerated on modern CPUs (AES-NI)
- Natively supported by Web Crypto API (no third-party libraries needed)

**Critical rule:** Never reuse an IV with the same key. With random 12-byte IVs, the collision probability is ~2⁻⁴⁸ after 2³² messages — negligible for a chat app.

---

## WebSocket Relay Design

The server is intentionally simple. It's a Go program that:

1. Accepts WebSocket connections
2. Manages rooms (create/join/leave)
3. Broadcasts encrypted messages to room members
4. Never decrypts, parses, or stores message content

### The Hub Pattern

The server uses a CSP (Communicating Sequential Processes) concurrency model. A central `Hub` goroutine owns all mutable state, and other goroutines communicate through channels:

```go
type Hub struct {
    roomManager *room.RoomManager
    clients     map[*Client]bool
    register    chan *Client
    unregister  chan *Client
    done        chan struct{}
    wg          sync.WaitGroup
}

func (h *Hub) Run() {
    for {
        select {
        case <-h.done:
            return // graceful shutdown
        case client := <-h.register:
            h.clients[client] = true
        case client := <-h.unregister:
            delete(h.clients, client)
            close(client.send)
            h.handleClientDisconnect(client)
        }
    }
}
```

Each client gets two goroutines: `readPump` (reads from WebSocket) and `writePump` (writes to WebSocket). This goroutine-per-connection model is natural in Go and handles thousands of concurrent connections efficiently.

### Zero-Knowledge Message Relay

The message handler for chat messages is remarkably simple — it just forwards the encrypted blob:

```go
func (h *Hub) handleSendMessage(client *Client, data interface{}) {
    // Extract iv and ciphertext (both are opaque strings to the server)
    dataMap, _ := data.(map[string]interface{})
    iv, _ := dataMap["iv"].(string)
    ciphertext, _ := dataMap["ciphertext"].(string)

    // Validate non-empty (basic sanity check, no content inspection)
    if iv == "" || ciphertext == "" {
        h.sendError(client, ErrCodeInvalidMessage, "iv and ciphertext required")
        return
    }

    // Rate limiting (sliding window: max 10 messages per 10 seconds)
    if client.IsRateLimited() {
        h.sendError(client, ErrCodeRateLimited, "rate limited")
        return
    }

    // Build relay message with server timestamp and sender identity
    relayMsg := Message{
        Type: MsgRelayMessage,
        Data: RelayMessageData{
            SenderID:   client.ID,
            SenderName: client.Name,
            IV:         iv,
            Ciphertext: ciphertext,
            T:          time.Now().UnixMilli(),
        },
    }

    // Broadcast to all room members except sender
    broadcastData, _ := msgpack.Marshal(relayMsg)
    room.Broadcast(client.ID, broadcastData)
}
```

The server adds two things the client can't forge: `SenderID` (from the authenticated connection) and `T` (server timestamp). Everything else passes through untouched.

### Binary Protocol with MessagePack

All messages use [MessagePack](https://msgpack.org/) binary encoding instead of JSON. This gives us:

- **30-50% smaller payloads** compared to JSON
- **Efficient binary data** — no base64 overhead for file chunks
- **Single-byte message type IDs** — fast routing without string comparison

The protocol uses a simple envelope: `{ type: uint8, data: any }`. Message types are organized by direction and domain:

```
Client → Server: 0x01-0x07 (chat), 0x08-0x0C (file transfer)
Server → Client: 0x10-0x19 (chat), 0x1A-0x1E (file transfer)
```

---

## Frontend Integration

### State Management with Zustand

The React frontend uses [Zustand](https://github.com/pmndrs/zustand) for state management. The chat store handles the WebSocket message dispatch and crypto operations:

```typescript
// Simplified flow: sending a message
async function sendMessage(text: string) {
  const { roomKey } = get(); // AES-256-GCM CryptoKey from store

  // 1. Encrypt locally
  const { iv, ciphertext } = await encryptMessage(roomKey, text);

  // 2. Send encrypted payload via WebSocket (MessagePack binary)
  send(MSG_SEND_MESSAGE, { iv, ciphertext });

  // 3. Add to local message list (we already know the plaintext)
  addMessage({ text, isMine: true, timestamp: Date.now() });
}

// Receiving a message
function handleRelayMessage(data: RelayMessageData) {
  const { roomKey } = get();

  // Decrypt the ciphertext using the shared room key
  const plaintext = await decryptMessage(roomKey, data.iv, data.ciphertext);

  addMessage({
    text: plaintext,
    senderId: data.senderId,
    senderName: data.senderName,
    timestamp: data.t,
    isMine: false,
  });
}
```

### The Share Code

The share code is the key distribution mechanism. It encodes everything needed to join a room into a single copy-pasteable string:

```
Format: {roomId}:{base64url(key)}
Example: V1StGXR8_Z5jdHi6B-myT:dGhpcyBpcyBhIDMyIGJ5dGUga2V5ISEhISEh
         ├── 21 chars (NanoID) ──┤├── 43 chars (base64url of 32 bytes) ──┤
```

The share code never touches the server. Users share it through whatever side channel they trust — copy-paste, QR code, in-person, carrier pigeon.

```typescript
export async function encodeShareKey(
  roomId: string,
  key: CryptoKey
): Promise<string> {
  const keyEncoded = await exportRoomKey(key); // 43-char base64url
  return `${roomId}:${keyEncoded}`;
}

export function decodeShareKey(code: string): ShareCodeComponents | null {
  const parts = code.split(":");
  if (parts.length < 2) return null;

  const roomId = parts[0];
  const keyEncoded = parts[1];

  // Validate lengths (NanoID = 21, base64url of 32 bytes = 43)
  if (roomId.length !== 21 || keyEncoded.length !== 43) return null;

  return { roomId, keyEncoded };
}
```

### WebSocket Connection with Auto-Reconnect

The WebSocket layer handles connection management with exponential backoff reconnection:

```typescript
export function connect(url?: string): void {
  ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer"; // binary mode for MessagePack

  ws.onmessage = (event: MessageEvent) => {
    // Decode MessagePack binary → { type, data } envelope
    const msg = decode(new Uint8Array(event.data)) as Message;

    // Auto-reply to server pings (connection liveness)
    if (msg.type === MSG_PING) {
      send(MSG_PONG, { t: (msg.data as PingData).t });
      return;
    }

    // Dispatch to registered handler (chatStore)
    messageHandler?.(msg);
  };

  ws.onclose = () => {
    // Exponential backoff: 1s → 2s → 4s → 8s → ... → 30s max
    scheduleReconnect(wsUrl);
  };
}
```

---

## Deployment

Arthas supports two deployment tiers:

### Tier 1: Single Binary (Zero Dependencies)

The Go server embeds the compiled frontend using `go:embed`. Download one binary, run it, done:

```bash
./arthas-server --port 8080
```

This serves both the API (WebSocket at `/ws`) and the frontend (static files at `/`) from a single process. Perfect for local use or intranet deployment.

### Tier 2: Docker Compose (Production)

For public deployment with automatic HTTPS via Caddy:

```dockerfile
# Multi-stage build: ~30MB final image
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-s -w" \
    -o server ./cmd/server

FROM alpine:3.23
RUN adduser -D -u 1000 appuser
COPY --from=builder /app/server .
USER appuser
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -qO- http://localhost:7860/ping || exit 1
CMD ["./server"]
```

The final Docker image is under 30MB. Combined with Caddy for automatic TLS certificate management, you get a production-ready deployment with one `docker compose up`.

---

## What I Learned

Building this project taught me several things:

1. **Web Crypto API is powerful** — you don't need third-party crypto libraries for AES-GCM in the browser. The native API is well-designed and hardware-accelerated.

2. **Go's concurrency model fits WebSocket servers perfectly** — goroutine-per-connection with channel-based coordination is both simple and efficient.

3. **MessagePack > JSON for binary protocols** — the size savings are real, and the encoding/decoding is faster. Worth the slight debugging inconvenience.

4. **The hardest part of E2EE is key distribution** — the crypto itself is straightforward (use standard algorithms, don't roll your own). The challenge is getting the key to the right people through a trusted channel.

5. **Zero-knowledge design simplifies the server** — when the server can't read messages, you don't need to worry about data retention policies, GDPR compliance for message content, or database encryption at rest. The server is just a relay.

---

## Try It Out

- **Live Demo**: [arthas-chat.vercel.app](https://arthas-chat.vercel.app)
- **GitHub**: [github.com/michaelwang123/arthas](https://github.com/michaelwang123/arthas)
- **Self-Hosting Guide**: [official_doc/self-hosting.md](https://github.com/michaelwang123/arthas/blob/main/official_doc/self-hosting.md)

The codebase is heavily commented with learning notes (marked with 📚) explaining design decisions. If you're interested in the crypto implementation details, the comments are a good starting point.

Feedback, issues, and PRs are welcome!
