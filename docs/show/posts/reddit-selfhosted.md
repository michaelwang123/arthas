# Reddit r/selfhosted 帖子（终稿）

## 标题

```
I built a self-hosted E2EE ephemeral chat – single binary, zero config, auto HTTPS
```

## 正文

注意：Reddit 用 4 空格缩进表示代码块，不用三反引号。

```
Hey r/selfhosted,

I've been working on Arthas, an end-to-end encrypted ephemeral chat app that you can self-host with a single command.

**Quick start:**

    # Option 1: Single binary (zero dependencies, ~15MB)
    ./arthas-server --port 8080

    # Option 2: Docker Compose (auto HTTPS via Caddy)
    git clone https://github.com/michaelwang123/arthas
    cd arthas/deploy && ./deploy.sh

**What it does:**

- End-to-end encrypted chat (AES-256-GCM + Ed25519 signatures)
- No registration needed – open and use
- Encrypted file sharing (chunked, drag & drop)
- Encrypted voice messages (Push-to-Talk)
- Self-destruct messages (10s/30s/60s/5min)
- Room passwords + QR code sharing + room expiry
- CLI client (Go binary, same protocol as web)
- AI Agent Channel plugin (`@arthas-chat/openclaw-channel`) – E2EE for AI agent communication
- i18n (EN/ZH/JA)

**Self-hosting details:**

- Single Go binary (~15MB), embeds the frontend via Go embed
- Docker image < 30MB (Alpine-based, multi-arch: amd64 + arm64)
- Docker Compose with Caddy = automatic Let's Encrypt HTTPS
- CLI flags: `--port`, `--allowed-origins`, `--version`
- No database – rooms live in memory, destroyed when empty

**How it works:**

The server is a pure relay (~500 lines of Go). It receives encrypted blobs via WebSocket and forwards them to other room members. It never sees plaintext – encryption keys only exist in clients' browsers.

**Links:**

- GitHub: https://github.com/michaelwang123/arthas
- Live demo: https://arthas-blush.vercel.app/
- Project website: https://michaelwang123.github.io/arthas/
- Self-hosting docs: https://github.com/michaelwang123/arthas/blob/main/official_doc/self-hosting.md
- AI Agent plugin: `npm install @arthas-chat/openclaw-channel`
- Public demo server: wss://arthas100-arthas-server.hf.space/ws

Built with Go + React + WebSocket + MessagePack. The OpenClaw Channel plugin makes Arthas the only E2EE channel for AI agent communication – your agents get the same encryption guarantees as human users. Happy to answer questions about the architecture or deployment!
```
