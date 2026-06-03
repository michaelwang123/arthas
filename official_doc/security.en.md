[中文](security.md) | English

# Security Model

This document describes Arthas's end-to-end encryption design, trust model, and security analysis.

---

## Encryption Scheme

### Layered Encryption

| Layer | Scheme | Purpose |
|-------|--------|---------|
| **Transport** | WSS (TLS 1.3) | Prevent eavesdropping, protect metadata |
| **Application** | AES-256-GCM | End-to-end message content encryption |

### Encryption Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Algorithm | AES-256-GCM | AEAD authenticated encryption |
| Key length | 256 bits (32 bytes) | 2^256 key space |
| IV length | 96 bits (12 bytes) | GCM recommended length |
| Auth tag | 128 bits | GCM default |
| Key generation | `crypto.subtle.generateKey()` | Browser CSPRNG |
| IV generation | `crypto.getRandomValues()` | Random per message |

---

## Trust Model

```
┌─────────────────────────────────────────────┐
│               Trust Boundary                 │
├─────────────────────────────────────────────┤
│                                             │
│  Trusted:                                   │
│    ✅ Browser environment (Web Crypto API)  │
│    ✅ User shares key via secure channel    │
│    ✅ User device is not compromised        │
│                                             │
│  Not Trusted:                               │
│    ❌ Server (zero-knowledge design)        │
│    ❌ Network transport (TLS protected)     │
│    ❌ Third-party observers                 │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Encryption Flow

### Key Generation and Distribution

```
Creator:
  1. crypto.subtle.generateKey(AES-256-GCM) → roomKey
  2. crypto.subtle.exportKey('raw', roomKey) → 32 bytes
  3. base64url(rawKey) → 43 character encoding
  4. Construct share code: {roomId}:{base64url(roomKey)}
  5. Share with peers via secure channel

Joiner:
  1. Parse share code → extract roomId and keyEncoded
  2. base64url.decode(keyEncoded) → 32 bytes
  3. crypto.subtle.importKey('raw', ...) → roomKey
  4. Send JoinRoom{roomId} to server (roomKey NOT included)
```

### Message Encryption

```
Sending:
  1. plaintext → TextEncoder.encode() → UTF-8 bytes
  2. iv = crypto.getRandomValues(12 bytes)
  3. crypto.subtle.encrypt({AES-GCM, iv}, roomKey, bytes) → ciphertext
  4. Send {iv: base64url(iv), ciphertext: base64url(ciphertext)}

Receiving:
  1. base64url.decode(iv) → iv bytes
  2. base64url.decode(ciphertext) → ciphertext bytes
  3. crypto.subtle.decrypt({AES-GCM, iv}, roomKey, ciphertext) → plaintext bytes
  4. TextDecoder.decode(plaintext) → plaintext string
```

---

## Threat Analysis

| Threat | Risk | Mitigation |
|--------|------|------------|
| Network eavesdropping | Low | WSS (TLS 1.3) transport encryption |
| Server reading messages | None | E2EE, server only sees ciphertext |
| Key leak (in transit) | None | Key never passes through server |
| Replay attack | Low | Random 96-bit IV per message |
| Message tampering | None | AES-GCM authentication tag (AEAD) |
| Brute force key | Extremely low | AES-256, 2^256 key space |
| Share code leak | Medium | Depends on user sharing securely |
| Server impersonating members | Low | Cannot decrypt messages, but can inject |
| Metadata analysis | Medium | Server can see who/when/typing |

---

## Known Security Limitations

| Limitation | Description | Risk Level | Mitigation |
|------------|-------------|------------|------------|
| Share code non-revocable | Anyone with the code can join | Medium | All members leaving destroys room |
| No Perfect Forward Secrecy | roomKey leak decrypts all messages | Low | Messages are not persisted |
| Typing status unencrypted | Server can see who is typing | Low | Does not contain message content |
| No message persistence | Messages lost during disconnection | Medium | Users are clearly informed |
| No identity verification | Anyone can use any nickname | Low | Acceptable for ephemeral chat |
| NanoID collision | 21-char collision probability ~10^-36 | Extremely low | Negligible |

---

## Server-Visible Metadata

Even with encrypted message content, the server can observe:

| Metadata | Visible | Notes |
|----------|---------|-------|
| Room ID | ✅ | Required for routing |
| Member ID | ✅ | Connection identifier |
| Member nickname | ✅ | Provided at join time |
| Message timestamp | ✅ | Appended by server |
| Message size | ✅ | Ciphertext length visible |
| Typing status | ✅ | Unencrypted |
| Online status | ✅ | Connection state |
| Message plaintext | ❌ | End-to-end encrypted |
| Room key | ❌ | Only held by clients |

---

## Comparison with Other Solutions

| Feature | Arthas | Signal | Telegram (Secret) |
|---------|--------|--------|-------------------|
| E2EE | ✅ AES-256-GCM | ✅ Double Ratchet | ✅ MTProto |
| Forward Secrecy | ❌ | ✅ | ✅ |
| Server Zero-Knowledge | ✅ | ✅ | Partial |
| Message Persistence | ❌ | ✅ (local) | ✅ |
| Identity Verification | ❌ | ✅ (phone number) | ✅ (phone number) |
| Open Source | ✅ | ✅ | Partial |
| No Signup Required | ✅ | ❌ | ❌ |

---

## Security Best Practices

### For Users

1. **Share keys via secure channels** — In person, encrypted IM (e.g., Signal)
2. **Do not post share codes publicly** — Anyone can join
3. **Leave the room after sensitive conversations** — Room destruction removes ciphertext
4. **Use a modern browser** — Ensures correct Web Crypto API implementation

### For Deployers

1. **Enable WSS (TLS)** — Protect the transport layer
2. **Do not log message content** — Code ensures this, but verify log configuration
3. **Restrict CORS** — Only allow your frontend domain
4. **Update dependencies regularly** — Fix known vulnerabilities

---

## Implemented Security Enhancements

- [x] Ed25519 message signatures (implemented in v1.1.0)
- [x] Member authentication (password-protected rooms, implemented in v1.0.0)

## Future Security Enhancements (Roadmap)

- [ ] Double Ratchet protocol (forward secrecy)
- [ ] Encrypted typing status
- [ ] Kick member functionality (key rotation)

---

## Next Steps

- [Architecture](architecture.en.md) — System design
- [Protocol Specification](protocol.en.md) — Message format
