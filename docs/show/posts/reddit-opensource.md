# Reddit r/opensource 帖子（终稿）

## 标题

```
Arthas – E2EE ephemeral chat built with Go + React, heavily commented codebase for learning
```

## 正文

```
I've been building Arthas as a learning project – an end-to-end encrypted ephemeral chat app. The entire codebase is heavily commented explaining design decisions, crypto choices, and architecture patterns.

**Why I'm sharing:**

I built this to learn Go concurrency (CSP model with channels), Web Crypto API, WebSocket protocol design, and self-hosted deployment. Every file has comments explaining *why* things are done a certain way, not just *what* they do. If you're interested in any of these topics, the code might be useful as a reference.

**Technical highlights:**

- Go backend (~500 lines core logic): goroutine-per-client, channel-based hub, zero shared mutable state
- Web Crypto API: AES-256-GCM encryption, Ed25519 signatures, all in the browser
- Binary protocol: MessagePack over WebSocket (30-50% smaller than JSON)
- CLI client in Go: same E2EE protocol, interoperates with web client
- Self-hosting: single binary with Go embed, or Docker Compose + Caddy auto-HTTPS
- Property-based testing: fast-check (frontend) + rapid (Go) for crypto invariants
- AI Agent Channel plugin (`@arthas-chat/openclaw-channel` on npm): E2EE for AI agent communication – the only encrypted channel for agent-to-agent or agent-to-human chat

**What it does:**

Create temporary encrypted chat rooms. Share a code with someone. Chat with E2EE. Leave and everything disappears. No signup, no accounts, no history.

Also: encrypted file sharing, voice messages, QR codes, self-destruct messages, room passwords, i18n (EN/ZH/JA).

**Stack:** Go 1.23 · React 18 · TypeScript · Zustand · Tailwind · Vite · WebSocket · MessagePack

**Links:**

- GitHub: https://github.com/michaelwang123/arthas
- Live demo: https://arthas-chat.vercel.app
- Project website: https://michaelwang123.github.io/arthas/
- AI Agent plugin: `npm install @arthas-chat/openclaw-channel`
- Public demo server: wss://arthas100-arthas-server.hf.space/ws

MIT licensed. PRs welcome – there's a CONTRIBUTING.md with setup instructions.

I'd love feedback on code quality, architecture decisions, or anything that could be improved!
```
