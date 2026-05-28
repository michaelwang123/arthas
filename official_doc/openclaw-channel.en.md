[中文](openclaw-channel.md) | English

# OpenClaw Channel Plugin — AI Agent Encrypted Communication Channel

## Quick Start

The fastest way to connect an AI agent to an Arthas encrypted room:

```typescript
import { ArthasChannelAdapter } from '@arthas/openclaw-channel';
const adapter = new ArthasChannelAdapter();
adapter.onMessage(msg => console.log(`${msg.userName}: ${msg.text}`));
await adapter.connect({ serverUrl: 'wss://arthas100-arthas-server.hf.space/ws', shareCode: 'roomId:key' });
await adapter.send({ text: 'Hello!', id: '1', channelId: 'arthas' });
```

> Note: This example uses ESM top-level await (requires `"type": "module"` in package.json).

---

## Introduction

`@arthas/openclaw-channel` (v1.0.0) is an OpenClaw channel plugin that exposes Arthas end-to-end encrypted chat rooms as an AI agent communication channel.

**Why Arthas?** Most AI agent platforms transmit prompts and responses in plaintext — the platform operator can observe every conversation. Arthas is different:

- **End-to-end encryption**: All messages are encrypted with AES-256-GCM before leaving the client. The server is a blind relay that only forwards ciphertext.
- **Zero-knowledge architecture**: The server cannot read, store, or analyze any conversation content.
- **Key stays client-side**: The encryption key is embedded in the share code and never transmitted to the server.

This means your AI agent conversations are private by default — no one except the participants can read them, not even the server operator.

---

## Installation

### From npm (when published)

```bash
npm install @arthas/openclaw-channel
```

### From source (recommended for now)

The package is not yet published to npm. Install from the monorepo:

```bash
# Clone the repository
git clone https://github.com/michaelwang123/arthas.git
cd arthas/packages/openclaw-channel

# Install dependencies and build
npm install
npm run build

# Link for local development
npm link
```

Then in your project:

```bash
npm link @arthas/openclaw-channel
```

### Requirements

- Node.js >= 18.0.0
- ESM project (`"type": "module"` in package.json)

---

## Configuration Reference

The plugin loads configuration from environment variables, `ChannelConfig` objects (passed by the Gateway), or defaults. Priority: environment variables > ChannelConfig > defaults.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ARTHAS_SERVER_URL` | Yes | — | WebSocket server URL (must start with `wss://` or `ws://`) |
| `ARTHAS_SHARE_CODE` | Yes | — | Room share code (format: `roomId:base64Key[:ephemeral:expiresAt]`, minimum 2 segments) |
| `ARTHAS_DISPLAY_NAME` | No | `AI Assistant` | Agent display name shown in the room |
| `ARTHAS_SIGNING_ENABLED` | No | `false` | Enable Ed25519 message signing (`true` or `1` to enable) |
| `ARTHAS_ROOM_PASSWORD` | No | — | Password for password-protected rooms (transmitted as SHA-256 hash) |

### Share Code Format

The share code contains all information needed to join a room and decrypt messages:

```
roomId:base64Key[:ephemeral:expiresAt]
```

- Segment 1: `roomId` — Room unique identifier
- Segment 2: `base64Key` — base64url-encoded AES-256 encryption key
- Segment 3 (optional): `ephemeral` — Ephemeral flag (0 or 1)
- Segment 4 (optional): `expiresAt` — Expiration timestamp (Unix seconds)

Minimum 2 segments required (roomId + key). Obtain the share code from the Arthas client by creating a room and clicking "Share".

### Example `.env` file

```ini
ARTHAS_SERVER_URL=wss://arthas100-arthas-server.hf.space/ws
ARTHAS_SHARE_CODE=X2-KtJ6oRzdxbguxl5DAR:AMVGFZBTFLeed7tVncI1oKoFUdNIv6goGz64x0cuU1M
ARTHAS_DISPLAY_NAME=Code Assistant
ARTHAS_SIGNING_ENABLED=true
```

> 📡 **Public demo server:** `wss://arthas100-arthas-server.hf.space/ws`
> This server is for testing only. For production use, [self-host your own](self-hosting.en.md).

---

## Usage Examples

### Basic Adapter Setup

```typescript
import { ArthasChannelAdapter } from '@arthas/openclaw-channel';

// 📚 学习要点: Why use a callback instead of EventEmitter?
// The OpenClaw Gateway ChannelAdapter interface specifies the callback pattern,
// ensuring sequential message processing (avoiding race conditions from concurrent callbacks).
const adapter = new ArthasChannelAdapter();

adapter.onMessage((message) => {
  console.log(`[${message.timestamp.toISOString()}] ${message.userName}: ${message.text}`);
});

// 📚 学习要点: Why is connect() async?
// connect() internally performs: config validation → key derivation → WebSocket connection → room join.
// Any step failure throws a descriptive error (Fail-Fast principle).
await adapter.connect({
  serverUrl: 'wss://arthas-chat.onrender.com/ws',
  shareCode: 'X2-KtJ6oRzdxbguxl5DAR:AMVGFZBTFLeed7tVncI1oKoFUdNIv6goGz64x0cuU1M',
  displayName: 'Code Assistant',
});
```

### Message Handling Callback

```typescript
import { ArthasChannelAdapter } from '@arthas/openclaw-channel';
import type { IncomingMessage } from '@arthas/openclaw-channel';

const adapter = new ArthasChannelAdapter();

adapter.onMessage(async (message: IncomingMessage) => {
  // message.id        — Unique message ID (UUID v4)
  // message.channelId — Always 'arthas'
  // message.userId    — Sender's client ID
  // message.userName  — Sender's display name
  // message.text      — Decrypted plaintext content
  // message.timestamp — Message timestamp
  // message.attachments — File attachments (if any)

  // Example: forward to an LLM
  const response = await callLLM(message.text);
  await adapter.send({
    id: crypto.randomUUID(),
    channelId: 'arthas',
    text: response,
  });
});

await adapter.connect({
  serverUrl: process.env['ARTHAS_SERVER_URL']!,
  shareCode: process.env['ARTHAS_SHARE_CODE']!,
});
```

### File Transfer Receiving

```typescript
import { ArthasChannelAdapter } from '@arthas/openclaw-channel';

const adapter = new ArthasChannelAdapter();

adapter.onMessage((message) => {
  // 📚 学习要点: File transfers arrive as message attachments.
  // The plugin handles decryption and chunk reassembly internally.
  // You receive the complete decrypted file in message.attachments.
  if (message.attachments && message.attachments.length > 0) {
    for (const file of message.attachments) {
      console.log(`Received file: ${file.fileName} (${file.size} bytes, ${file.mimeType})`);
      // file.data is a Buffer containing the decrypted file content
    }
  }
});

await adapter.connect({
  serverUrl: process.env['ARTHAS_SERVER_URL']!,
  shareCode: process.env['ARTHAS_SHARE_CODE']!,
});
```

### Connection Status Monitoring

```typescript
import { ArthasChannelAdapter } from '@arthas/openclaw-channel';

const adapter = new ArthasChannelAdapter();

// 📚 学习要点: Connection states follow a finite state machine (FSM):
// disconnected → connecting → connected
// connected → disconnected (normal close)
// connected → reconnecting → connected (auto-reconnect success)
// connected → reconnecting → error (reconnect failed)
adapter.onStatusChange((status) => {
  console.log(`Connection status: ${status}`);
  // status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
});

adapter.onMessage((message) => {
  console.log(`${message.userName}: ${message.text}`);
});

await adapter.connect({
  serverUrl: process.env['ARTHAS_SERVER_URL']!,
  shareCode: process.env['ARTHAS_SHARE_CODE']!,
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await adapter.disconnect();
  process.exit(0);
});
```

---

## Security Model

### AES-256-GCM Encryption

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key size**: 256 bits, derived from the share code's base64url-encoded key segment
- **IV (Initialization Vector)**: 12 bytes, randomly generated per message using `crypto.randomBytes(12)`
- **Authentication tag**: 16 bytes, automatically generated by GCM mode — provides integrity verification and tamper detection
- **Encoding**: IV and ciphertext are base64url-encoded for transmission

Each message uses a unique random IV. Reusing an IV with the same key would compromise security — the random generation ensures this never happens in practice.

### Optional Ed25519 Message Signing

When `ARTHAS_SIGNING_ENABLED=true`:

- The plugin generates an Ed25519 key pair on connect
- The public key is broadcast to the room (encrypted, like any other message)
- Every outgoing message includes a digital signature
- Other clients can verify that messages genuinely came from this agent (anti-forgery)

### Key Lifecycle

1. **Derivation**: AES-256 key is derived from the share code at `connect()` time
2. **Memory-only**: Keys exist only in process memory, never written to disk
3. **Zeroed on disconnect**: `disconnect()` calls `buffer.fill(0)` on all key material
4. **Signing keys**: Ed25519 private key is zeroed via `zeroKeyPair()` on disconnect

---

## Troubleshooting

### Missing Required Configuration

```
[Arthas 配置错误] 缺少必填配置: serverUrl（Arthas 服务器地址）
  设置方式:
    环境变量: ARTHAS_SERVER_URL=wss://your-server.com/ws
    或 ChannelConfig: { serverUrl: 'wss://your-server.com/ws' }
```

**Cause**: `ARTHAS_SERVER_URL` environment variable is not set and no `serverUrl` was provided in the ChannelConfig.

**Fix**: Set the environment variable or pass `serverUrl` in the connect config.

### Missing Share Code

```
[Arthas 配置错误] 缺少必填配置: shareCode（房间分享码）
  设置方式:
    环境变量: ARTHAS_SHARE_CODE=roomId:encryptionKey
    或 ChannelConfig: { shareCode: 'roomId:encryptionKey' }
  获取方式: 在 Arthas 客户端中创建房间后，点击"分享"获取分享码
```

**Cause**: `ARTHAS_SHARE_CODE` environment variable is not set.

**Fix**: Create a room in the Arthas client, click "Share", and set the share code as the environment variable.

### Invalid Server URL

```
[Arthas 配置错误] serverUrl 格式无效: "http://example.com"
  期望格式: wss://your-server.com/ws 或 ws://localhost:9000/ws
  设置方式: 环境变量 ARTHAS_SERVER_URL=wss://your-server.com/ws
```

**Cause**: The server URL does not start with `wss://` or `ws://`.

**Fix**: Use a WebSocket URL. For production, always use `wss://` (encrypted). `ws://` is only acceptable for local development.

### Invalid Share Code Format

```
[Arthas 配置错误] shareCode 格式无效: 需要至少 2 个冒号分隔的段（roomId:key），当前只有 1 段
  期望格式: roomId:base64Key 或 roomId:base64Key:ephemeral:expiresAt
  设置方式: 环境变量 ARTHAS_SHARE_CODE=your-room-id:your-encryption-key
```

**Cause**: The share code is missing the colon separator between roomId and key.

**Fix**: Ensure you copied the complete share code from the Arthas client (format: `roomId:base64Key`).

### Empty Share Code Segments

```
[Arthas 配置错误] shareCode 格式无效: roomId 和 key 段不能为空
  当前值的段: [段1="(空)", 段2="..."]
  设置方式: 环境变量 ARTHAS_SHARE_CODE=your-room-id:your-encryption-key
```

**Cause**: The share code has empty segments (e.g., `:key` or `roomId:`).

**Fix**: Both the roomId and key segments must be non-empty strings.

### Send Failed — Not Connected

```
无法发送消息: 适配器未连接
```

**Cause**: Attempting to call `send()` before `connect()` completes, or after `disconnect()`.

**Fix**: Ensure `await adapter.connect(...)` resolves before sending messages.

---

## API Reference

### Exported Class

#### `ArthasChannelAdapter`

Implements the `ChannelAdapter` interface. Main entry point for the plugin.

```typescript
import { ArthasChannelAdapter } from '@arthas/openclaw-channel';
```

| Method | Signature | Description |
|--------|-----------|-------------|
| `connect` | `(config: ChannelConfig) => Promise<void>` | Connect to Arthas server and join room |
| `disconnect` | `() => Promise<void>` | Disconnect and zero all key material |
| `send` | `(message: OutgoingMessage) => Promise<void>` | Encrypt and send a message to the room |
| `onMessage` | `(callback: (msg: IncomingMessage) => void) => void` | Register incoming message callback |
| `onStatusChange` | `(callback: (status: ConnectionStatus) => void) => void` | Register connection status callback |

### Exported Function

#### `definePlugin`

Factory function for registering the plugin with OpenClaw Gateway.

```typescript
import { definePlugin } from '@arthas/openclaw-channel';

export default definePlugin({
  name: '@arthas/openclaw-channel',
  version: '1.0.0',
  channels: [{
    id: 'arthas',
    name: 'Arthas E2EE Chat',
    adapter: ArthasChannelAdapter,
  }],
});
```

### Exported Types

| Type | Description |
|------|-------------|
| `IncomingMessage` | Message received from a user (decrypted) |
| `OutgoingMessage` | Message to send to the room (will be encrypted) |
| `MessageAttachment` | File attachment (fileName, mimeType, size, data) |
| `ChannelAdapter` | Interface that `ArthasChannelAdapter` implements |
| `ChannelConfig` | Generic config object passed to `connect()` |
| `ArthasChannelConfig` | Validated Arthas-specific configuration |
| `ConnectionStatus` | `'disconnected' \| 'connecting' \| 'connected' \| 'reconnecting' \| 'error'` |
| `PluginDefinition` | Plugin registration options for `definePlugin()` |
| `MessageType` | `'text' \| 'typing' \| 'file'` |

### `IncomingMessage` Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique message ID (UUID v4) |
| `channelId` | `string` | Always `'arthas'` |
| `userId` | `string` | Sender's client ID |
| `userName` | `string` | Sender's display name |
| `text` | `string` | Decrypted message content |
| `timestamp` | `Date` | Message timestamp |
| `attachments` | `MessageAttachment[]` | File attachments (optional) |
| `metadata` | `Record<string, unknown>` | Platform-specific data (optional) |

### `OutgoingMessage` Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Message ID (generated by Gateway) |
| `channelId` | `string` | Target channel (`'arthas'`) |
| `text` | `string` | Message text to send |
| `attachments` | `MessageAttachment[]` | Files to send (optional) |
| `replyTo` | `string` | Original message ID for replies (optional) |
| `type` | `MessageType` | Message type: `'text'`, `'typing'`, or `'file'` (optional) |

---

## Data Flow Architecture

```
User (Web/CLI)
    │ encrypted message
    ▼
Arthas Server (blind relay, forwards ciphertext only)
    │ forwards ciphertext
    ▼
@arthas/openclaw-channel (decrypt → plaintext)
    │ IncomingMessage
    ▼
OpenClaw Gateway (routing + context management)
    │ prompt
    ▼
AI Agent (LLM inference)
    │ response
    ▼
OpenClaw Gateway
    │ OutgoingMessage
    ▼
@arthas/openclaw-channel (encrypt → ciphertext)
    │ encrypted message
    ▼
Arthas Server (blind relay)
    │ forwards ciphertext
    ▼
User (decrypt → plaintext)
```

The server only forwards ciphertext throughout the entire flow — it cannot decrypt any message content.

---

## Next Steps

- [Architecture](architecture.en.md) — System design overview
- [Protocol](protocol.en.md) — Message format specification
- [Self-Hosting](self-hosting.en.md) — Deploy your own server
