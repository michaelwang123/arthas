# @arthas-chat/openclaw-channel

📖 [Documentation](https://michaelwang123.github.io/arthas/openclaw-channel/) | [中文文档](https://michaelwang123.github.io/arthas/zh/openclaw-channel/)

Arthas Node.js client SDK for server-side AI agents — connect any LLM to an [Arthas](https://github.com/michaelwang123/arthas) encrypted chat room in 10 lines of code. The server never sees your prompts or the AI's responses.

> **About the name:** "openclaw-channel" in the package name is a legacy label. Functionally this is Arthas's Node.js SDK, designed specifically for server-side (AI agent) use cases. It handles WebSocket connection, Arthas binary protocol, AES-256-GCM encryption, file transfer, and auto-reconnection — so you only write the LLM logic.

## Quick Start (3 steps, 2 minutes)

A free public server is running — no signup, no setup needed.

### 1. Install

```bash
npm install @arthas-chat/openclaw-channel
```

Requires Node.js >= 18.

### 2. Get a share code (create an encrypted room)

The share code contains both the room address and the AES-256 encryption key. Create one using the CLI:

```bash
# Linux/macOS
curl -L -o arthas-cli https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli && chmod +x arthas-cli

# Windows (PowerShell)
# curl.exe -L -o arthas-cli.exe https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli-windows-amd64.exe

# Create room → outputs share code (key generated locally, never sent to server)
./arthas-cli create --server wss://arthas100-arthas-server.hf.space/ws --name "My AI Room"
# Windows: .\arthas-cli.exe create --server ... --name "My AI Room"

# ✓ Room created! Share code:
# QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM
```

Or create a room from the [web UI](https://michaelwang123.github.io/arthas/) and copy the share code from the share dialog.

### 3. Connect your AI agent

```typescript
import { ArthasChannelAdapter } from '@arthas-chat/openclaw-channel';

const adapter = new ArthasChannelAdapter();

adapter.onMessage(async (message) => {
  // message.text is already decrypted — E2EE handled by the SDK
  const response = await yourLLM.generate(message.text);
  await adapter.send({ id: crypto.randomUUID(), channelId: 'arthas', text: response });
});

await adapter.connect({
  serverUrl: 'wss://arthas100-arthas-server.hf.space/ws',
  shareCode: 'QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM',
  displayName: 'AI Assistant',
});
```

Now chat with your AI from the CLI or web — everything is encrypted end-to-end:

```bash
./arthas-cli join QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM \
  --server wss://arthas100-arthas-server.hf.space/ws --name "Michael"

> What's the capital of France?
AI Assistant: The capital of France is Paris.
```

---

## Real-World Example: OpenAI GPT Agent

A complete, runnable example connecting GPT-4o-mini to an encrypted room:

```typescript
// agent.ts
import { ArthasChannelAdapter } from '@arthas-chat/openclaw-channel';
import OpenAI from 'openai';

const openai = new OpenAI(); // uses OPENAI_API_KEY env var
const adapter = new ArthasChannelAdapter();

const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

adapter.onMessage(async (message) => {
  history.push({ role: 'user', content: message.text });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      ...history,
    ],
  });

  const reply = completion.choices[0].message.content ?? '';
  history.push({ role: 'assistant', content: reply });

  await adapter.send({ id: crypto.randomUUID(), channelId: 'arthas', text: reply });
});

adapter.onStatusChange((status) => {
  console.log(`[Agent] Connection: ${status}`);
});

await adapter.connect({
  serverUrl: process.env.ARTHAS_SERVER_URL!,
  shareCode: process.env.ARTHAS_SHARE_CODE!,
  displayName: 'GPT Assistant',
});

console.log('[Agent] Running. Ctrl+C to stop.');
```

Run it:

```bash
export ARTHAS_SERVER_URL=wss://arthas100-arthas-server.hf.space/ws
export ARTHAS_SHARE_CODE=your-share-code-here
export OPENAI_API_KEY=sk-...

npx tsx agent.ts
```

---

## How It Works

This SDK is a standalone Node.js client for Arthas encrypted rooms. Under the hood it:

1. **Connects** to the Arthas server via WebSocket (binary MessagePack protocol)
2. **Joins** the room using the roomId from the share code
3. **Decrypts** incoming messages with the AES-256-GCM key from the share code
4. **Encrypts** outgoing messages before sending
5. **Reconnects** automatically with exponential backoff (1s → 30s max)

```
You (CLI/Web)              Arthas Server (blind relay)         AI Agent (this SDK)
     │                            │                                  │
     │── AES-256-GCM encrypt ──→  │── forward ciphertext ──→         │
     │                            │                                  │→ decrypt → LLM → encrypt
     │                            │  ←── forward ciphertext ──       │
     │← AES-256-GCM decrypt ──   │                                  │
```

The server only sees encrypted binary blobs. It cannot read, store, or parse message content. It cannot distinguish human traffic from AI traffic.

---

## Configuration

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ARTHAS_SERVER_URL` | Yes | WebSocket URL | `wss://arthas100-arthas-server.hf.space/ws` |
| `ARTHAS_SHARE_CODE` | Yes | Room share code (roomId + key) | `abc123:dGhpcyBpcyBhIGtleQ` |
| `ARTHAS_DISPLAY_NAME` | No | Agent's name in room (default: `AI Assistant`) | `Code Bot` |
| `ARTHAS_SIGNING_ENABLED` | No | Ed25519 message signing (default: `false`) | `true` |
| `ARTHAS_ROOM_PASSWORD` | No | For password-protected rooms | `secret` |

### Programmatic Config

```typescript
await adapter.connect({
  serverUrl: 'wss://arthas100-arthas-server.hf.space/ws',
  shareCode: 'roomId:base64Key',
  displayName: 'My Agent',
  signingEnabled: false,
});
```

### Share Code Format

```
roomId:base64Key[:ephemeralFlag[:expiresAt]]
  │       │          │              │
  │       │          │              └─ Unix timestamp (0 = no expiry)
  │       │          └─ 0 or 1 (ephemeral room)
  │       └─ Base64url AES-256 key (43 chars)
  └─ Room ID (21 chars, NanoID)
```

Minimum required: `roomId:base64Key`. The ephemeral and expiry segments are optional.

---

## API Reference

### ArthasChannelAdapter

```typescript
import { ArthasChannelAdapter } from '@arthas-chat/openclaw-channel';

const adapter = new ArthasChannelAdapter();

// Connect to an encrypted room
await adapter.connect(config);

// Listen for decrypted messages from other room participants
adapter.onMessage((msg) => {
  msg.text;         // decrypted message text
  msg.userName;     // sender's display name
  msg.attachments;  // file attachments (if any)
});

// Send an encrypted response
await adapter.send({
  id: crypto.randomUUID(),
  channelId: 'arthas',
  text: 'Hello!',
});

// Monitor connection status
adapter.onStatusChange((status) => {
  // 'connected' | 'disconnected' | 'reconnecting' | 'error'
});

// Disconnect (zeroes encryption keys from memory)
await adapter.disconnect();
```

### File Transfer

Supports encrypted file exchange (up to 5MB):

```typescript
// Receiving files
adapter.onMessage((msg) => {
  if (msg.attachments?.length) {
    for (const file of msg.attachments) {
      console.log(`${file.fileName} (${file.size} bytes)`);
      // file.data is a Buffer with decrypted content
    }
  }
});

// Sending files
await adapter.send({
  id: crypto.randomUUID(),
  channelId: 'arthas',
  text: 'Here is the analysis:',
  attachments: [{
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    size: buffer.length,
    data: buffer,
  }],
});
```

---

## Security

| Server CAN see | Server CANNOT see |
|----------------|-------------------|
| Message timestamps | Message content |
| Ciphertext sizes | File contents |
| Connection status | Sender names (encrypted) |
| Room membership events | Encryption keys |

- **AES-256-GCM** with unique random 12-byte IV per message
- **Authenticated encryption** — tampering detected via 16-byte auth tag
- **Keys in memory only** — never written to disk, zeroed on `disconnect()`
- **Optional Ed25519 signing** — verify messages came from your agent (TOFU model)
- **WSS (TLS 1.2+)** enforced in production — double encryption layer

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `缺少必填配置: serverUrl` | Set `ARTHAS_SERVER_URL` env var |
| `缺少必填配置: shareCode` | Set `ARTHAS_SHARE_CODE` — create a room first (see Quick Start step 2) |
| `serverUrl 格式无效` | URL must start with `wss://` (production) or `ws://` (local dev only) |
| `消息解密失败` | Share code is from a different room or was regenerated — get a fresh one |
| Keeps reconnecting | Check: server URL reachable? Firewall allows 443? Room password set if needed? |

Reconnection uses exponential backoff: 1s → 2s → 4s → ... → 30s max.

---

## Development

```bash
cd packages/openclaw-channel
npm install
npm run build    # TypeScript → dist/
npm test         # Vitest
```

### Project Structure

```
src/
├── index.ts         # Package entry point + exports
├── adapter.ts       # ArthasChannelAdapter (main class)
├── client.ts        # WebSocket client (connect, join, send)
├── crypto.ts        # AES-256-GCM encrypt/decrypt
├── signing.ts       # Ed25519 message signing (optional)
├── protocol.ts      # MessagePack encode/decode
├── config.ts        # Config loading + validation
├── reconnect.ts     # Exponential backoff reconnection
├── file-transfer.ts # Chunked encrypted file send/receive
└── types.ts         # TypeScript type definitions
```

---

## Links

- **Public Server**: `wss://arthas100-arthas-server.hf.space/ws` (free, no signup)
- **GitHub**: [github.com/michaelwang123/arthas](https://github.com/michaelwang123/arthas)
- **Docs**: [michaelwang123.github.io/arthas](https://michaelwang123.github.io/arthas/)

## License

MIT
