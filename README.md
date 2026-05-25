# Arthas

[涓枃](README.zh.md) | English

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.23-00ADD8.svg)](https://go.dev)
[![Docker](https://img.shields.io/badge/Docker-<30MB-2496ED.svg)](https://github.com/michaelwang123/arthas/pkgs/container/arthas)

> E2EE ephemeral chat 鈥?create a room, share the key, chat securely, everything disappears.

A minimalist end-to-end encrypted chat app. Create a temporary room, generate a unique key to share with your peers, and all messages are encrypted end-to-end. The server only relays ciphertext 鈥?it cannot read any chat content. No signup required, open and use.

---

## Features

- 馃敀 **End-to-End Encryption** 鈥?AES-256-GCM + Ed25519 signatures, server has zero knowledge
- 鈿?**Real-time Communication** 鈥?WebSocket full-duplex, instant message delivery
- 馃搸 **Encrypted File Sharing** 鈥?Chunked encryption, image thumbnails, drag & drop upload
- 馃帳 **Encrypted Voice Messages** 鈥?Push-to-Talk recording, Opus encoding, fully encrypted
- 馃摫 **QR Code Sharing** 鈥?Scan to join, no manual code entry needed
- 鈴?**Room Expiry** 鈥?Set validity period (1h/24h/7d), auto-destroy when expired
- 馃攽 **Key as Invitation** 鈥?One string contains both room address and decryption key
- 馃棏锔?**Self-Destruct Messages** 鈥?Optional auto-disappear (10s/30s/60s/5min), client-side only
- 馃挰 **Reply & Reactions** 鈥?Quote replies + emoji reactions, all encrypted
- 馃攼 **Room Password** 鈥?Optional password protection against unauthorized access
- 鉁嶏笍 **Ed25519 Signatures** 鈥?Tamper detection, receiver can verify sender identity
- 馃枼锔?**CLI Client** 鈥?Standalone Go binary, create/join encrypted rooms from terminal
- 馃寪 **i18n** 鈥?English / Chinese / Japanese, auto-detects browser language
- 馃毇 **No Signup** 鈥?No accounts, open and use immediately
- 馃彔 **Self-Hostable** 鈥?Single binary zero-dependency, or Docker Compose with auto HTTPS

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

The CLI is a standalone Go binary implementing the same E2EE protocol as the web client 鈥?fully interoperable.

---

## How It Works

```
Create room 鈫?Get share code (roomId:encryptionKey)
    鈫?Share via secure channel
    鈫?Friend enters share code to join
    鈫?End-to-end encrypted chat
    鈫?Everyone leaves 鈫?Room destroyed, ciphertext gone
```

---

## Architecture

```
Browser A                   Go Server (Relay)              Browser B
   鈹?                           鈹?                           鈹?
   鈹傗攢鈹€ Plain 鈫?AES Encrypt 鈫?鈹€鈹€鈫掆攤鈹€鈹€ Forward ciphertext 鈹€鈹€鈫掆攤  鈹?
   鈹?                           鈹?                         鈹傗啋 Cipher 鈫?AES Decrypt 鈫?Plain
   鈹?                           鈹?                           鈹?
                                鈹?
CLI Client C                    鈹?
   鈹傗攢鈹€ Plain 鈫?AES Encrypt 鈫?鈹€鈹€鈫掆攤鈹€鈹€ Forward ciphertext 鈹€鈹€鈫?Browser/CLI
   鈹?                           鈹?
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
| **Tier 1 鈥?Single Binary** | Local/intranet/dev | Zero dependencies, download and run, Go embeds frontend |
| **Tier 2 鈥?Docker Compose** | Public production | Caddy auto-HTTPS + Go backend, one-click deploy |

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
鈹溾攢鈹€ arthas-client/          # Web frontend (React + TypeScript)
鈹溾攢鈹€ arthas-server/          # Backend - pure relay (Go)
鈹溾攢鈹€ arthas-cli/             # CLI client (standalone Go binary)
鈹溾攢鈹€ deploy/                 # Self-hosting infrastructure
鈹斺攢鈹€ official_doc/           # User documentation
```

---

## Documentation

- [Technical Architecture](docs/technical_architecture.md)
- [Roadmap](docs/roadmap.md)
- [Self-Hosting Guide](official_doc/self-hosting.md)
- [CLI Client Guide](official_doc/cli-guide.md)

---

## Status

**v1.0 鈥?Feature Complete** (2026-05-25)

All planned features implemented: E2EE chat + encrypted file sharing + encrypted voice messages + QR code sharing + room expiry + message reply/reactions + password protection + self-destruct messages + Ed25519 signatures + CLI client + i18n + self-hosted deployment.

See [Roadmap](docs/roadmap.md) for details.

---

## License

[MIT](LICENSE)
