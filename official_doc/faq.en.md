[中文](faq.md) | English

# Frequently Asked Questions (FAQ)

---

## General

### What is Arthas?

Arthas is an open-source end-to-end encrypted real-time chat application. Users can create temporary chat rooms and invite peers by sharing a key. All messages are encrypted on the client before transmission — the server only relays ciphertext.

### Why the name "Arthas"?

The project name comes from the World of Warcraft character Arthas, symbolizing powerful protective force — guarding your communication privacy.

### How is Arthas different from Signal/Telegram?

| Feature | Arthas | Signal | Telegram |
|---------|--------|--------|----------|
| Signup required | ❌ | ✅ | ✅ |
| Message persistence | ❌ | ✅ | ✅ |
| End-to-end encryption | ✅ | ✅ | Optional |
| Forward secrecy | ❌ | ✅ | ✅ |
| Open source | ✅ | ✅ | Partial |
| Self-hostable | ✅ | Difficult | ❌ |

Arthas is designed for temporary, anonymous, one-time encrypted communication scenarios.

---

## Security

### Can the server read my messages?

**No.** Messages are encrypted with AES-256-GCM in your browser before being sent. The server only sees ciphertext (garbled data) and cannot decrypt without the key.

### Where is the key stored?

The key only exists in the browser tab's memory (Zustand store). Closing the tab or refreshing the page destroys the key. The server never touches the key.

### What if the share code is leaked?

The share code contains the room ID and encryption key. If leaked, anyone can join the room and decrypt messages. Recommendations:
1. Share via secure channels (in person, encrypted IM)
2. Have everyone leave the room after sensitive conversations (room is destroyed)
3. Never post share codes publicly

### Are messages saved?

**No.** The server stores no messages. Messages only exist in:
- Sender's browser memory (max 200 messages)
- Receiver's browser memory (max 200 messages)
- All disappear when the page is closed

### Can messages be recovered after disconnection?

**No.** Due to the no-persistence design, messages during disconnection are unrecoverable. After reconnecting, a notification is shown: "You may have missed messages while disconnected."

---

## Usage

### How do I create a room?

1. Open the Arthas web app
2. Enter a nickname (1-20 characters)
3. Click "Create Room"
4. Copy the generated share code

### How do I join a room?

1. Get the share code from a friend
2. Open the Arthas web app
3. Enter a nickname and the share code
4. Click "Join"

### What format is the share code?

Format: `{roomId}:{base64url(roomKey)}`, total 65 characters. Example:
```
V1StGXR8_Z5jdHi6B-myT:k7_9xPqR2mNvLwE3hJfKdA1234567890abcdefghijk
```

### What is the maximum room size?

Default maximum is 50 people. Beyond that, new joiners receive a "Room is full" message.

### Is there a message length limit?

The web client limits messages to 500 characters. The AI Agent channel (OpenClaw) supports up to 4000 characters per message (auto-split). Full UTF-8 character set is supported (including emoji).

### Is there a message rate limit?

Yes, a maximum of 10 messages per 10 seconds. Exceeding this shows "Sending too fast, please try again later."

### Can I continue chatting after refreshing the page?

**No.** Refreshing the page is equivalent to leaving the room (key is lost). You need to rejoin using the share code.

---

## Technical

### Which browsers are supported?

- Chrome 90+
- Firefox 90+
- Safari 15+
- Edge 90+

Requires a modern browser with Web Crypto API support. IE is not supported.

### Why use MessagePack instead of JSON?

MessagePack is a binary serialization format that saves 30-50% bandwidth compared to JSON and encodes/decodes faster. For real-time communication, this means lower latency and less bandwidth consumption.

### Why not use Signal Protocol / Double Ratchet?

Arthas is designed for ephemeral chat and doesn't need message persistence or forward secrecy. AES-256-GCM symmetric encryption is sufficiently secure and simpler to implement. A future upgrade to Double Ratchet is possible.

### Why Go for the backend?

- Goroutines are naturally suited for high-concurrency WebSocket connections
- Compiles to a single binary, simple deployment
- Low memory footprint
- Powerful standard library

### Why not use Next.js for the frontend?

Arthas is a pure client-side application that doesn't need SSR. Vite + React is lighter and builds faster.

---

## Deployment

### How do I self-host?

Refer to the [Self-Hosting Guide](self-hosting.en.md), which supports three options:
- Single binary (zero dependencies, recommended for dev/intranet)
- Docker single container (one command to deploy)
- Docker Compose + Caddy (public internet with auto HTTPS)

### Does deployment require a database?

**No.** Arthas is a pure in-memory application with no database dependency.

### Are rooms preserved after server restart?

**No.** A server restart destroys all rooms. This is a design decision, not a bug.

### What server resources are needed?

- Memory: ~50MB base + 10KB/connection
- CPU: Minimal (only message forwarding)
- Disk: ~20MB (Go binary)

100 concurrent connections require approximately 51MB of memory.

---

## Next Steps

- [Getting Started](getting-started.en.md) — Run locally
- [Security Model](security.en.md) — Deep dive into encryption design
- [Self-Hosting](self-hosting.en.md) — Production deployment
