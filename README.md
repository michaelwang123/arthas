# Arthas

[中文](README.zh.md) | English

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.23-00ADD8.svg)](https://go.dev)
[![Docker](https://img.shields.io/badge/Docker-<30MB-2496ED.svg)](https://github.com/michaelwang123/arthas/pkgs/container/arthas)

> E2EE ephemeral chat – create a room, share the key, chat securely, everything disappears.

A minimalist end-to-end encrypted chat app. Create a temporary room, generate a unique key to share with your peers, and all messages are encrypted end-to-end. The server only relays ciphertext – it cannot read any chat content. No signup required, open and use.

---

## Features

- 🔒 **End-to-End Encryption** – AES-256-GCM + Ed25519 signatures, server has zero knowledge
- ⚡ **Real-time Communication** – WebSocket full-duplex, instant message delivery
- 📎 **Encrypted File Sharing** – Chunked encryption, image thumbnails, drag & drop upload
- 🎤 **Encrypted Voice Messages** – Push-to-Talk recording, Opus encoding, fully encrypted
- 📱 **QR Code Sharing** – Scan to join, no manual code entry needed
- ⏰ **Room Expiry** – Set validity period (1h/24h/7d), auto-destroy when expired
- 🔑 **Key as Invitation** – One string contains both room address and decryption key
- 🗑️ **Self-Destruct Messages** – Optional auto-disappear (10s/30s/60s/5min), client-side only
- 💬 **Reply & Reactions** – Quote replies + emoji reactions, all encrypted
- 🔐 **Room Password** – Optional password protection against unauthorized access
- ✍️ **Ed25519 Signatures** – Tamper detection, receiver can verify sender identity
- 🖥️ **CLI Client** – Standalone Go binary, create/join encrypted rooms from terminal
- 🌐 **i18n** – English / Chinese / Japanese, auto-detects browser language
- 🚫 **No Signup** – No accounts, open and use immediately
- 🏠 **Self-Hostable** – Single binary zero-dependency, or Docker Compose with auto HTTPS

---

## Quick Start

### Backend

```bash
cd arthas-server
go mod tidy
go run cmd/server/main.go
```

Server starts at `http://localhost:8080`, WebSocket endpoint: `ws://localhost:8080/ws`

### Frontend

```bash
cd arthas-client
npm install
npm run dev
```

Frontend starts at `http://localhost:3000`

### CLI Client

```bash
cd arthas-cli
go build -o arthas-cli ./cmd/arthas-cli/

# Create a room
./arthas-cli create --server ws://localhost:8080/ws --name Alice

# Join a room (using the share code from create output)
./arthas-cli join <share_code> --server ws://localhost:8080/ws --name Bob
```

The CLI is a standalone Go binary implementing the same E2EE protocol as the web client – fully interoperable.

---

## How It Works

```
Create room → Get share code (roomId:encryptionKey)
    → Share via secure channel
    → Friend enters share code to join
    → End-to-end encrypted chat
    → Everyone leaves → Room destroyed, ciphertext gone
```

---

## Architecture

```
Browser A                   Go Server (Relay)              Browser B
   │                            │                            │
   │── Plain → AES Encrypt → ──→│── Forward ciphertext ──→│  │
   │                            │                          │→ Cipher → AES Decrypt → Plain
   │                            │                            │
                                │
CLI Client C                    │
   │── Plain → AES Encrypt → ──→│── Forward ciphertext ──→ Browser/CLI
   │                            │
   Server only ever sees ciphertext, cannot decrypt.
   Web and CLI use the same protocol, fully interoperable.
```

- **E2EE**: Web Crypto API + AES-256-GCM, keys stay in the client
- **Pure Relay**: Server doesn't decrypt, store, or parse messages
- **Binary Protocol**: MessagePack-encoded ciphertext, efficient transport
- **Event-Driven**: Receive and forward, no polling

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Crypto | Web Crypto API | AES-256-GCM E2EE, native hardware acceleration |
| Frontend | React 18 + TypeScript | Component-based UI, type-safe |
| State | Zustand | Minimal state management |
| Styling | Tailwind CSS | Utility-first CSS |
| Build | Vite 5 | ESBuild pre-bundling, sub-second HMR |
| Protocol | WebSocket (WSS/TLS 1.3) | Full-duplex real-time, TLS transport encryption |
| Serialization | MessagePack | Binary encoding, 30-50% smaller than JSON |
| Backend | Go 1.23 + gorilla/websocket | Goroutine concurrency, pure message relay |
| Deploy | Vercel + HF Spaces (Docker) | Frontend/backend split, zero-cost start |
| Self-Host | Go embed + Caddy + Docker | Single binary or Docker Compose, one-click deploy |

---

## Self-Hosting

Arthas supports full self-hosting, giving you complete control over your data and infrastructure.

| Tier | Use Case | Description |
|------|----------|-------------|
| **Tier 1 – Single Binary** | Local/intranet/dev | Zero dependencies, download and run, Go embeds frontend |
| **Tier 2 – Docker Compose** | Public production | Caddy auto-HTTPS + Go backend, one-click deploy |

```bash
# Tier 1: Single binary
./arthas-server --port 8080

# Tier 2: Docker Compose (auto HTTPS)
cd deploy && ./deploy.sh
```

Full guide: [Self-Hosting Documentation](official_doc/self-hosting.md)

---

## Project Structure

```
arthas/
├── arthas-client/          # Web frontend (React + TypeScript)
├── arthas-server/          # Backend - pure relay (Go)
├── arthas-cli/             # CLI client (standalone Go binary)
├── deploy/                 # Self-hosting infrastructure
└── official_doc/           # User documentation
```

---

## Documentation

- [Technical Architecture](docs/technical_architecture.md)
- [Roadmap](docs/roadmap.md)
- [Self-Hosting Guide](official_doc/self-hosting.md)
- [CLI Client Guide](official_doc/cli-guide.md)

---

## Status

**v1.0 – Feature Complete** (2026-05-25)

All planned features implemented: E2EE chat + encrypted file sharing + encrypted voice messages + QR code sharing + room expiry + message reply/reactions + password protection + self-destruct messages + Ed25519 signatures + CLI client + i18n + self-hosted deployment.

See [Roadmap](docs/roadmap.md) for details.

---

## License

[MIT](LICENSE)
