# Arthas

[中文](README.zh.md) | English

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.23+-00ADD8.svg?logo=go)](https://go.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-<30MB-2496ED.svg?logo=docker)](https://github.com/michaelwang123/arthas/pkgs/container/arthas)
[![Release](https://img.shields.io/github/v/release/michaelwang123/arthas?color=ffd700&label=Release)](https://github.com/michaelwang123/arthas/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/michaelwang123/arthas/release.yml?label=CI&logo=github)](https://github.com/michaelwang123/arthas/actions)

> E2EE ephemeral chat – create a room, share the key, chat securely, everything disappears.

A minimalist end-to-end encrypted chat application. Create a temporary room, generate a unique key to share with your peers, and all messages are encrypted end-to-end. The server only relays ciphertext – it cannot read any chat content. No signup required, open and use.

---

## Demo

> Create a room, share the key, chat securely — everything disappears.

- 🌐 **Live Demo:** [arthas-blush.vercel.app](https://arthas-blush.vercel.app/)
- 📖 **Project Website:** [michaelwang123.github.io/arthas](https://michaelwang123.github.io/arthas/)

---

## How It Works

<p align="center">
  <img src="docs/diagrams/how-it-works.svg" alt="How Arthas Works" width="800"/>
</p>

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
- 🤖 **AI Agent Channel** – OpenClaw plugin for E2EE AI conversations, server sees nothing
- 🖥️ **CLI Client** – Standalone Go binary, create/join encrypted rooms from terminal
- 🌐 **i18n** – English / Chinese / Japanese, auto-detects browser language
- 🚫 **No Signup** – No accounts, open and use immediately
- 🏠 **Self-Hostable** – Single binary zero-dependency, or Docker Compose with auto HTTPS

---

## Architecture

<p align="center">
  <img src="docs/diagrams/architecture.svg" alt="Arthas Architecture" width="900"/>
</p>

**Key design principles:**
- **Zero Knowledge** — Server is a blind relay, never sees plaintext
- **Same Protocol** — Web, CLI, and AI Agent use identical E2EE (fully interoperable)
- **Binary Protocol** — MessagePack ciphertext transport, efficient and compact

---

## Encryption

<p align="center">
  <img src="docs/diagrams/encryption-flow.svg" alt="Encryption Flow" width="900"/>
</p>

| Layer | Scheme | Purpose |
|-------|--------|---------|
| Transport | WSS (TLS 1.3) | Protect metadata in transit |
| Application | AES-256-GCM | End-to-end message encryption |
| Authentication | Ed25519 | Message signature verification |

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Crypto | Web Crypto API | AES-256-GCM E2EE, native hardware acceleration |
| Frontend | React 18 + TypeScript | Component-based UI, type-safe |
| State | Zustand | Minimal state management |
| Styling | Tailwind CSS | Utility-first CSS |
| Build | Vite 6 | ESBuild pre-bundling, sub-second HMR |
| Protocol | WebSocket (WSS/TLS 1.3) | Full-duplex real-time, TLS transport encryption |
| Serialization | MessagePack | Binary encoding, 30-50% smaller than JSON |
| Backend | Go 1.23 + gorilla/websocket | Goroutine concurrency, pure message relay |
| Deploy | Vercel + HF Spaces (Docker) | Frontend/backend split, zero-cost start |
| Self-Host | Go embed + Caddy + Docker | Single binary or Docker Compose, one-click deploy |

---

## Self-Hosting

<p align="center">
  <img src="docs/diagrams/self-hosting-tiers.svg" alt="Self-Hosting Tiers" width="850"/>
</p>

```bash
# Tier 1: Single binary (all-in-one, recommended)
./arthas-server-all-linux-amd64 --port 8080

# Tier 2: Docker (pre-built image from GHCR)
docker run -d -p 8080:8080 ghcr.io/michaelwang123/arthas:latest

# Tier 3: Docker Compose (auto HTTPS for production)
cd deploy && ./deploy.sh
```

> **Important:** The project has two Dockerfiles for different purposes:
> - `deploy/Dockerfile` — Full build (frontend + backend embedded), for self-hosting
> - `arthas-server/Dockerfile` — Backend only (no frontend), for HF Spaces relay deployment

Full guide: [Self-Hosting Documentation](official_doc/self-hosting.en.md)

---

## Quick Start

### Backend

```bash
cd arthas-server
go mod tidy
go run -tags dev cmd/server/main.go
```

Server starts at `http://localhost:8080`, WebSocket endpoint: `ws://localhost:8080/ws`

### Frontend

```bash
cd arthas-client
npm install
npm run dev
```

Frontend starts at `http://localhost:5173`

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

## Project Structure

```
arthas/
├── arthas-client/              # Web frontend (React + TypeScript)
├── arthas-server/              # Backend relay server (Go)
├── arthas-cli/                 # CLI client (standalone Go binary)
├── packages/openclaw-channel/  # OpenClaw AI agent channel plugin (TypeScript)
├── deploy/                     # Self-hosting infrastructure (Docker + Caddy)
├── website/                    # Project website (Astro + Starlight)
└── official_doc/               # User documentation
```

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](official_doc/architecture.en.md) | System design, modules, data flow |
| [Self-Hosting](official_doc/self-hosting.en.md) | Tier 1/2/3 deployment guides |
| [Protocol](official_doc/protocol.en.md) | WebSocket message format specification |
| [Security](official_doc/security.en.md) | E2EE design, trust model, threat analysis |
| [CLI Guide](official_doc/cli-guide.en.md) | Terminal client usage |
| [OpenClaw Channel](official_doc/openclaw-channel.en.md) | AI Agent E2EE plugin |
| [Development](official_doc/development.en.md) | Local dev setup, code structure |
| [Configuration](official_doc/configuration.en.md) | All configurable parameters |

---

## Status

**v1.2.2** — Feature Complete + Production Ready (2026-06-02)

All planned features implemented: E2EE chat • encrypted file sharing • encrypted voice messages • QR code sharing • room expiry • reply & reactions • password protection • self-destruct messages • Ed25519 signatures • CLI client • AI Agent channel • i18n • self-hosted deployment (3 tiers).

See [Roadmap](docs/roadmap.md) for future plans.

---

## Contributing

Contributions are welcome! Please read the [Contributing Guide](official_doc/contributing.en.md) for details on the development workflow, coding standards, and how to submit pull requests.

---

## Contributors

<a href="https://github.com/michaelwang123/arthas/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=michaelwang123/arthas" />
</a>

---

## License

[AGPL-3.0](LICENSE)
