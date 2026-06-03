[中文](getting-started.md) | English

# Getting Started

This guide helps you run the Arthas project locally in 5 minutes.

---

## Prerequisites

| Tool | Minimum Version | Description |
|------|-----------------|-------------|
| Go | 1.22+ | Backend compilation and runtime |
| Node.js | 18+ | Frontend build and runtime |
| npm | 9+ | Package manager |
| Git | 2.x | Code cloning |

### Browser Support

| Browser | Minimum Version |
|---------|-----------------|
| Chrome | 90+ |
| Firefox | 90+ |
| Safari | 15+ |
| Edge | 90+ |

> Web Crypto API requires modern browser support. IE is not supported.

---

## Step 1: Clone the Project

```bash
git clone https://github.com/michaelwang123/arthas.git
cd arthas
```

---

## Step 2: Start the Backend

```bash
cd arthas-server

# Download dependencies
go mod tidy

# Start the server
go run cmd/server/main.go
```

On successful startup you will see:

```
2024/01/01 12:00:00 Server starting on :8080
```

The server listens on port `8080` by default, with the WebSocket endpoint at `ws://localhost:8080/ws`.

### Verify the Backend

```bash
# Check if the server is running
curl http://localhost:8080/ws
# Should return "Bad Request" (because it's not a WebSocket upgrade request)
```

---

## Step 3: Start the Frontend

Open a new terminal window:

```bash
cd arthas-client

# Install dependencies
npm install

# Start the development server
npm run dev
```

On successful startup you will see:

```
  VITE v6.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
```

---

## Step 4: Start Using

### Option 1: Web Client

1. Open your browser and navigate to `http://localhost:5173`
2. Enter a nickname and click **"Create Room"**
3. Copy the generated share code
4. Open another browser window (or incognito mode)
5. Enter a nickname and the share code, then click **"Join"**
6. Start chatting with end-to-end encryption!

### Option 2: CLI Client

```bash
cd arthas-cli

# Build
go build -o arthas-cli ./cmd/arthas-cli/

# Create a room
./arthas-cli create --server ws://localhost:8080/ws --name Alice
# Outputs a share code, copy it

# Join from another terminal
./arthas-cli join <share_code> --server ws://localhost:8080/ws --name Bob
```

The CLI and Web clients are interoperable — rooms created with the Web client can be joined via CLI, and vice versa.

---

## Verifying Encryption

You can verify that messages are truly encrypted in the following ways:

1. **Check server logs** — Server logs only contain connection/room events, with no message content
2. **Browser developer tools** — WebSocket messages in the Network panel appear as binary data (MessagePack-encoded ciphertext)
3. **Wrong key** — Join with an incorrect share code, and received messages will display "Unable to decrypt this message"

---

## FAQ

### Frontend can't connect to the backend?

Check the WebSocket URL in the `.env.development` file:

```env
VITE_WS_URL=ws://localhost:8080/ws
```

Make sure the backend is running and the port matches.

### Port already in use?

The backend port can be changed via an environment variable:

```bash
PORT=9090 go run cmd/server/main.go
```

The frontend port is configured in `vite.config.ts`:

```typescript
server: {
  port: 4000,
}
```

### Go dependency download fails?

Set a Go proxy (for users in mainland China):

```bash
go env -w GOPROXY=https://goproxy.cn,direct
```

---

## Next Steps

- [System Architecture](architecture.en.md) — Understand the overall design
- [CLI Client Guide](cli-guide.en.md) — Detailed terminal client usage
- [Development Guide](development.en.md) — Dive into the code structure
- [Self-Hosting Guide](self-hosting.en.md) — Deploy to production
