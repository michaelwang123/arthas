# Reddit r/privacy 帖子（终稿）

## 标题

```
I built an E2EE ephemeral chat – no signup, no message history, server sees only ciphertext
```

## 正文

```
I built Arthas, a web-based end-to-end encrypted chat app designed around the principle of minimal data retention.

**Privacy properties:**

- AES-256-GCM encryption – keys generated client-side, never sent to server
- Ed25519 message signatures – tamper detection, verify sender identity
- Server is a pure relay – it forwards encrypted blobs without decryption
- No accounts, no registration, no email
- No message persistence – everything lives in memory, gone when room closes
- Self-destruct messages (optional: 10s/30s/60s/5min countdown)
- Room passwords for access control
- Fully self-hostable (single binary or Docker)
- Open source (MIT): https://github.com/michaelwang123/arthas

**What it's NOT:**

- Not a Signal replacement (no long-term identity, no contact list)
- Not audited by a third party (yet) – uses standard algorithms, code is open for review
- Not designed for nation-state adversaries

**Use case:** "I need to securely exchange some information with someone right now, and I don't want any trace left behind." Think sharing credentials, discussing sensitive business matters, or coordinating something you don't want in Slack/Teams history.

**How it works:**

1. Create a room → get a share code (contains room ID + encryption key)
2. Share the code via a secure channel
3. Chat with E2EE – server only sees ciphertext
4. Everyone leaves → room destroyed, ciphertext gone

Live demo: https://arthas-chat.vercel.app
GitHub: https://github.com/michaelwang123/arthas

I'd appreciate feedback on the threat model and any privacy concerns I might have missed.
```
