# Show HN 帖子（终稿，直接复制粘贴）

## 标题

```
Show HN: Arthas – E2EE ephemeral chat, no signup, self-hostable
```

## 正文（URL 部分）

提交时填写 URL：`https://github.com/michaelwang123/arthas`

## 正文（Text 部分）

```
Hi HN,

I built Arthas, an end-to-end encrypted ephemeral chat app. The idea is simple: create a room, share the key, chat securely, and everything disappears when everyone leaves.

Live demo: https://arthas-blush.vercel.app/
GitHub: https://github.com/michaelwang123/arthas
Project website: https://michaelwang123.github.io/arthas/

Why I built this:

- I needed to share API keys and credentials with teammates but didn't trust Slack DMs
- Existing tools (PrivNote, Yopass) are one-shot – no real-time conversation
- I wanted something I could self-host with zero dependencies

Technical highlights:

- AES-256-GCM encryption (Web Crypto API), keys never leave the browser
- Ed25519 message signatures for tamper detection
- Go relay server (~30MB Docker image), zero knowledge of message content
- CLI client in Go (same E2EE protocol, interoperates with web client)
- One-command self-hosting: single binary or Docker Compose + auto HTTPS via Caddy

Also includes: encrypted file sharing (chunked, 64KB per chunk), encrypted voice messages (Push-to-Talk, Opus), reply & emoji reactions, QR code room sharing, self-destruct messages, room passwords, and room expiry timers.

New: AI Agent Channel plugin (`@arthas-chat/openclaw-channel` on npm) – the first dedicated E2EE channel for AI agent communication. Your AI agents can talk through Arthas with the same encryption guarantees as human users. Public demo server: wss://arthas100-arthas-server.hf.space/ws

What it's NOT:

- Not a Signal replacement (Signal is for long-term communication)
- No accounts, no message history, no social features
- Not audited by a third party (yet) – I welcome security review

Licensed under AGPL-3.0. The AI agent SDK is MIT-licensed separately for easy integration.

Built as a learning project over ~2 weeks. The codebase is heavily commented explaining design decisions if you're interested in the crypto implementation.

Stack: Go 1.23 + React 18 + TypeScript + WebSocket + MessagePack

I'd love feedback on the crypto design and UX. Happy to answer questions!
```

---

## 发布前检查清单

- [ ] 确认 demo 可访问（发布前 30 分钟 ping）
- [ ] 确认 HF Spaces 公共服务器已唤醒（访问 wss://arthas100-arthas-server.hf.space/ws 触发冷启动）
- [ ] 确认 GitHub 仓库已 Public
- [ ] 发布时间：美西周二-周四 8:00-10:00 AM
- [ ] 发布后 2-3 小时内持续回复评论

---

## FAQ 回复模板

### Q: Is this related to Alibaba's Arthas?

```
No relation at all. Same name, completely different domain – this is an E2EE chat app, theirs is a Java diagnostic tool. I chose the name before discovering the conflict and decided to keep it since the domains don't overlap.
```

### Q: Why not just use Signal?

```
Different use cases. Signal is for long-term communication with persistent contacts. Arthas is for "I need to securely exchange some info right now, then forget about it." No signup, no contacts, no history. Think encrypted AirDrop + temporary chat room.
```

### Q: Has this been audited?

```
Not yet. The code is open source and uses standard, well-vetted algorithms (AES-256-GCM, Ed25519, Web Crypto API). I'd welcome a security review – the crypto implementation is heavily commented explaining each design decision. That said, I wouldn't recommend this for nation-state threat models without a formal audit.
```

### Q: Why not use Matrix/Element?

```
Matrix is a federated protocol – powerful but complex. Arthas is intentionally minimal: no federation, no accounts, no persistence. The server is a lightweight Go relay that just forwards encrypted blobs. Different design philosophy for a different use case.
```

### Q: Why not use a password manager to share secrets?

```
Password managers are great for static secrets. Arthas is for when you need a real-time back-and-forth discussion about something sensitive – like walking a teammate through a deployment issue that involves credentials, or discussing contract terms you don't want in Slack history.
```

### Q: How does it scale?

```
Designed for small temporary rooms (2-10 people). The server is a stateless relay – it holds rooms in memory, no database. Horizontal scaling would be straightforward (sticky sessions or shared state), but for the "ephemeral chat" use case, a single instance handles thousands of concurrent rooms easily.
```

### Q: Why AGPL-3.0?

```
I want anyone running a modified version of Arthas as a network service to share their changes back. The core app is AGPL-3.0 so the community benefits from all improvements. The AI agent SDK (@arthas-chat/openclaw-channel) is MIT-licensed separately, so you can integrate it into proprietary code without restriction.
```
