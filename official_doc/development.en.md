[中文](development.md) | English

# Development Guide

This document helps developers understand the code structure and participate in development.

---

## Project Structure

```
arthas/
├── arthas-client/              # Frontend (React + TypeScript)
│   ├── index.html              # HTML entry point
│   ├── package.json            # Dependency management
│   ├── vite.config.ts          # Vite build configuration
│   ├── tsconfig.json           # TypeScript configuration
│   ├── tailwind.config.js      # Tailwind CSS configuration
│   ├── postcss.config.js       # PostCSS configuration
│   ├── .env.development        # Development environment variables
│   └── src/
│       ├── main.tsx            # React entry point
│       ├── App.tsx             # Root component + ErrorBoundary
│       ├── crypto/             # E2EE encryption layer
│       ├── network/            # WebSocket network layer
│       ├── stores/             # Zustand state management
│       ├── pages/              # Page components
│       ├── components/         # UI components
│       └── styles/             # Global styles
├── arthas-server/              # Backend (Go)
│   ├── go.mod                  # Go module definition
│   ├── go.sum                  # Dependency lock file
│   ├── Dockerfile              # Docker build
│   ├── cmd/server/main.go      # Server entry point
│   └── internal/
│       ├── room/               # Room management
│       └── network/            # Network layer
├── docs/                       # Project documentation
└── official_doc/               # Official documentation
```

---

## Development Environment Setup

### Prerequisites

```bash
# Go 1.22+
go version

# Node.js 18+
node --version

# npm 9+
npm --version
```

### Backend Development

```bash
cd arthas-server

# Download dependencies
go mod tidy

# Run with hot reload (requires air)
# go install github.com/cosmtrek/air@latest
# air

# Or run directly
go run cmd/server/main.go

# Run tests
go test ./...

# Build
go build -o server ./cmd/server

# Lint
go vet ./...
```

### Frontend Development

```bash
cd arthas-client

# Install dependencies
npm install

# Start development server (HMR)
npm run dev

# Type checking
npx tsc --noEmit

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## Production Build (Single Binary Deployment)

Arthas uses Go's `//go:embed` to embed frontend build artifacts into the server binary, enabling single-file deployment. This means after modifying frontend code, you must rebuild the frontend and sync it to Go's embed directory.

### Why is manual sync needed?

In development, the frontend runs independently via Vite dev server (port 5173), and the backend uses `-tags dev` to skip embedding. But in production, users download a single Go binary that includes the frontend. Before release:

1. Build frontend → generates `arthas-client/dist/`
2. Sync to embed directory → copy to `arthas-server/internal/static/dist/`
3. Compile Go → `go:embed dist` packages files into the binary

### Using the build script (recommended)

```bash
# Linux / macOS
./scripts/build-server-all.sh

# Windows (PowerShell)
.\scripts\build-server-all.ps1
```

Script options:

| Option | Description |
|--------|-------------|
| (no args) | Full pipeline: npm build → sync → go build |
| `--sync-only` / `-SyncOnly` | Skip npm build, only sync existing dist/ |
| `--no-go` / `-NoGo` | Build frontend + sync, skip Go compilation |

### Manual steps

```bash
# 1. Build frontend
cd arthas-client && npm run build && cd ..

# 2. Sync to Go embed directory
rm -rf arthas-server/internal/static/dist
cp -r arthas-client/dist arthas-server/internal/static/dist

# 3. Compile (with embedded frontend)
cd arthas-server && go build -ldflags "-s -w" -o server ./cmd/server
```

> **Note:** If only backend code changed, no need to rebuild frontend. Just `go build` (uses existing dist/).

---

## Code Architecture Details

### Backend Core Modules

#### Hub (`internal/network/hub.go`)

The connection management center, responsible for:
- Registering/unregistering WebSocket connections
- Message routing (dispatching to handlers based on message type)
- Disconnect handling (automatically leaving rooms)

```go
type Hub struct {
    roomManager *room.RoomManager
    clients     map[*Client]bool
    register    chan *Client
    unregister  chan *Client
    mu          sync.RWMutex
}
```

#### Client (`internal/network/client.go`)

Abstraction for a single WebSocket connection:
- `readPump()` — goroutine for reading messages
- `writePump()` — goroutine for sending messages + heartbeat
- `Send(data []byte)` — non-blocking send
- `IsRateLimited()` — sliding window rate limiting

#### RoomManager (`internal/room/manager.go`)

Room lifecycle management:
- `CreateRoom(roomId)` — create a room
- `GetRoom(roomId)` — find a room
- `RemoveRoom(roomId)` — destroy a room

#### Room (`internal/room/room.go`)

Member management for a single room:
- `AddMember(member)` — add a member
- `RemoveMember(id)` — remove a member
- `Broadcast(senderId, data)` — broadcast message (excluding sender)

### Frontend Core Modules

#### Encryption Layer (`src/crypto/`)

| File | Responsibility |
|------|----------------|
| `keys.ts` | Key generation, import, export |
| `encrypt.ts` | AES-GCM encryption |
| `decrypt.ts` | AES-GCM decryption |
| `shareKey.ts` | Share code encoding/decoding |
| `utils.ts` | base64url utility functions |

#### Network Layer (`src/network/`)

| File | Responsibility |
|------|----------------|
| `protocol.ts` | Message type constants and TypeScript interfaces |
| `websocket.ts` | WebSocket connection management, reconnection, MessagePack encoding/decoding |

#### State Management (`src/stores/chatStore.ts`)

Zustand store integrating the encryption and network layers:
- Connection state management
- Room operations (create/join/leave)
- Message sending (encryption) and receiving (decryption)
- Typing indicator management
- Rate limiting

---

## Adding New Features

### Adding a New Message Type

1. **Backend** — Add constants and data structures in `internal/network/protocol.go`
2. **Backend** — Add handler in `internal/network/hub.go`
3. **Frontend** — Add constants and interfaces in `src/network/protocol.ts`
4. **Frontend** — Add case in `handleServerMessage` in `src/stores/chatStore.ts`

### Adding a New UI Component

1. Create `src/components/YourComponent.tsx`
2. Import it in `ChatRoom.tsx` or `Home.tsx`
3. Get required state from `chatStore`

---

## Testing

### Backend Tests

```bash
cd arthas-server

# Run all tests
go test ./...

# With verbose output
go test -v ./...

# Run tests for a specific package
go test -v ./internal/room/...

# Race condition detection
go test -race ./...
```

### Frontend Type Checking

```bash
cd arthas-client

# TypeScript type checking
npx tsc --noEmit
```

### Manual Integration Testing

1. Start the backend and frontend
2. Open two browser windows
3. Window A creates a room, copy the share code
4. Window B joins using the share code
5. Send messages in both directions, verify encryption/decryption works
6. Check server logs for no plaintext

---

## Code Style

### Go

- Follow standard Go formatting (`gofmt`)
- Use `go vet` for linting
- Comments in Chinese (consistent with the project)
- Error handling without panic

### TypeScript

- Strict mode (`strict: true`)
- Use function components + Hooks
- State management via Zustand
- Styling with Tailwind CSS classes

---

## Dependencies

### Backend Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `gorilla/websocket` | v1.5.3 | WebSocket server |
| `vmihailenco/msgpack/v5` | v5.4.1 | MessagePack serialization |
| `matoous/go-nanoid/v2` | v2.1.0 | Room ID generation |
| `google/uuid` | v1.6.0 | Client ID generation |

### Frontend Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^18.3.1 | UI framework |
| `react-dom` | ^18.3.1 | DOM rendering |
| `zustand` | ^5.0.3 | State management |
| `@msgpack/msgpack` | ^3.0.0 | MessagePack encoding/decoding |

---

## Production Deployment

### Backend Deployment (HF Spaces)

The backend is deployed as a Docker container to Hugging Face Spaces.

#### Prerequisites

1. Register a [Hugging Face](https://huggingface.co) account
2. Create an Access Token (Settings → Tokens, select Write permission)
3. Create a Space: https://huggingface.co/new-space
   - SDK: **Docker**
   - Hardware: **CPU Basic** (free)
   - Visibility: **Public** (Private URLs require authentication, frontend cannot connect)

#### One-Click Deploy Script

```powershell
# Execute from project root
.\official_doc\scripts\deploy-hf-space.ps1

# Customize username and Space name
.\official_doc\scripts\deploy-hf-space.ps1 -HfUsername "your-username" -SpaceName "arthas-server"
```

The script will prompt for your HF username and Token for authentication.

#### Manual Deployment Steps

```powershell
# 1. Copy arthas-server to a temporary directory
$tmp = "$env:TEMP\hf-deploy"
Copy-Item -Recurse arthas-server $tmp
cd $tmp

# 2. Clean build artifacts
Remove-Item -Force *.exe, *.test -ErrorAction SilentlyContinue

# 3. Initialize git and commit
git init
git add -A
git commit -m "deploy: arthas production server"

# 4. Push to HF Space
git remote add space https://huggingface.co/spaces/your-username/arthas-server
git push space master:main --force

# 5. Clean up
cd ..
Remove-Item -Recurse -Force $tmp
```

#### Important Files

- `arthas-server/Dockerfile` — Multi-stage build, final image < 30MB
- `arthas-server/README.md` — Contains HF Space required YAML front matter (`sdk: docker`)
- `arthas-server/.dockerignore` — Excludes unnecessary files to speed up builds

#### Verification

After the build completes (approximately 2-3 minutes), visit:
```
https://your-username-arthas-server.hf.space/ping
```
A `pong` response indicates successful deployment.

#### Environment Variable Configuration

Set in Space Settings → Repository secrets:

| Variable | Value | Description |
|----------|-------|-------------|
| `ALLOWED_ORIGINS` | `https://your-frontend.vercel.app` | Allowed frontend domains (comma-separated for multiple) |

Restart the Space after setting for changes to take effect.

---

### Frontend Deployment (Vercel)

The frontend is deployed to Vercel, selecting the `arthas-client` subdirectory from the GitHub monorepo.

#### Steps

1. Push the entire arthas project to GitHub
2. Visit [vercel.com/new](https://vercel.com/new), import the GitHub repository
3. Configure:
   - **Root Directory**: `arthas-client`
   - **Framework Preset**: Vite
   - **Environment Variables**: `VITE_WS_URL` = `wss://your-username-arthas-server.hf.space/ws`
4. Click Deploy

#### Verification

After deployment, open the domain assigned by Vercel and check the browser Network panel to confirm the WebSocket connection uses `wss://`.

---

### Keep-Alive Configuration (cron-job.org)

HF Spaces free tier goes to sleep when there is no traffic. Configure scheduled health checks to keep it active:

1. Register at [cron-job.org](https://cron-job.org)
2. Create a job:
   - URL: `https://your-username-arthas-server.hf.space/ping`
   - Interval: Every 10 minutes
   - Timeout: 30 seconds
   - Failure retry: 1 time

---

### Post-Deployment Verification Checklist

| # | Verification Item | Method | Expected Result |
|---|-------------------|--------|-----------------|
| 1 | Health check | Visit `/ping` | 200 + "pong" |
| 2 | WSS connection | Browser Network panel | WebSocket uses wss:// |
| 3 | Cross-network chat | Two devices create/join room | Messages encrypt/decrypt normally |
| 4 | No plaintext in logs | Check HF Space logs | No message content |
| 5 | CORS blocking | Connect from unauthorized domain | Returns 403 |

---

## Next Steps

- [Contributing Guide](contributing.md) — How to submit code
- [Architecture Document](architecture.md) — In-depth design understanding
