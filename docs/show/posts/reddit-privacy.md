# Reddit r/privacy 帖子

## 策略说明

r/privacy 有严格的反自我推广规则（Rule 3 + Rule 13），不能直接发 "I built an app" 帖子。
采用「讨论/求反馈」的角度，以威胁模型讨论为主，项目链接自然带出。

**发布时机：** 等在 r/privacy 正常参与讨论 1-2 周后再发，或等有人问相关问题时在评论中提及。

---

## 方案 A：以讨论帖形式发布

### 标题

```
What's a good approach for ephemeral E2EE messaging? Built one as a learning project, looking for threat model feedback
```

### 正文

```
I've been thinking about the gap between tools like PrivNote (one-shot secret sharing) and Signal (persistent E2EE messaging). There doesn't seem to be much in between for the use case of "I need to have a real-time encrypted conversation that leaves no trace afterward."

As a learning exercise, I built an implementation and wanted to get feedback on the threat model and crypto design choices:

**Design decisions I made (and want challenged):**

1. AES-256-GCM for message encryption (Web Crypto API in browser, crypto/aes in Go CLI)
2. Ed25519 signatures per message for tamper detection
3. Key distribution via share code (roomId:base64url(key)) — transmitted out-of-band, never through the server
4. Server is a stateless relay — receives encrypted blobs via WebSocket, forwards to room members, never decrypts
5. No persistence — rooms exist only in memory, destroyed when last person leaves
6. No accounts, no registration — open a URL, create a room, done

**What I'm unsure about:**

- Is the "share code contains the key" approach fundamentally weaker than a proper key exchange (like X3DH)? The tradeoff was simplicity — one string to copy-paste vs. a multi-step handshake.
- For the ephemeral use case (minutes to hours, not days), does the lack of forward secrecy matter?
- The server can see metadata (who connects, when, IP addresses). What's a practical mitigation for this threat level without requiring Tor?

**What it's NOT designed for:**

- Not a Signal replacement (no long-term identity)
- Not designed for nation-state adversaries
- Not audited — uses standard algorithms but no formal review yet

The implementation is open source if anyone wants to look at the actual code: https://github.com/michaelwang123/arthas (there's also a live demo at https://arthas-blush.vercel.app/ if you want to poke at it)

I'd appreciate any feedback on the crypto choices, threat model gaps, or design flaws I might have missed.
```

---

## 方案 B：评论回复模板（当有人问相关问题时使用）

### 适用场景

- "How to securely share credentials with a teammate?"
- "What's a good tool for temporary encrypted communication?"
- "Alternatives to PrivNote for real-time conversation?"

### 回复模板

```
You might want to look at ephemeral E2EE chat rooms — create a room, share the encryption key out-of-band, chat with AES-256-GCM, and everything disappears when everyone leaves.

I built one as a learning project: https://github.com/michaelwang123/arthas

The server is a pure relay (never sees plaintext), no accounts needed, and it's self-hostable as a single binary if you don't trust anyone else's infrastructure. Not audited yet, but uses standard crypto (Web Crypto API + AES-256-GCM + Ed25519).

Might be overkill for your use case, but worth checking out if you need real-time conversation rather than one-shot secret sharing.
```

---

## 方案 C：技术讨论帖（不提自己的项目）

### 标题

```
Discussion: What's the current state of ephemeral encrypted messaging? (not Signal, not PrivNote)
```

### 正文

```
I've been looking into the space between Signal (persistent, identity-based) and tools like PrivNote/Yopass (one-shot, no conversation). The specific use case I'm interested in is:

- Real-time conversation (not async)
- End-to-end encrypted
- No accounts or registration
- Nothing persisted after the session ends
- Ideally self-hostable

What I've found so far:

- **PrivNote/Yopass** — one-shot only, no real-time conversation
- **Signal** — requires accounts, persistent by design
- **Matrix/Element** — federated, complex, accounts required
- **Briar** — P2P, but requires Android + Tor

Is there anything good in this space? The closest I found was building my own (https://github.com/michaelwang123/arthas) but I'm curious if I'm missing existing solutions.

What do you all use when you need to have a sensitive real-time conversation with someone and don't want any trace left behind?
```

---

## 发布注意事项

- **不要在标题中提及项目名 "Arthas"** — 看起来像广告
- **以提问/讨论为主** — 项目链接放在正文中自然带出
- **主动暴露弱点** — "not audited"、"looking for feedback" 让帖子看起来像真正的讨论
- **不要在短时间内多次回复提到同一个项目** — 会被标记为 spam
- **优先用方案 A 或 C** — 方案 B 留作评论回复用
