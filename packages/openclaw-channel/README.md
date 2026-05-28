# @arthas/openclaw-channel

OpenClaw Channel Plugin for [Arthas](https://github.com/nicepkg/arthas) — enables AI agents to communicate with users through end-to-end encrypted chat rooms.

This plugin bridges the Arthas E2EE messaging protocol with the OpenClaw AI Agent framework, allowing agents to receive and respond to user messages without any server being able to observe the conversation content. The server acts as a blind relay — it forwards encrypted binary frames but cannot decrypt them.

## Why This Exists

Every other AI agent channel (Telegram, Slack, Discord) transmits messages in plaintext. Arthas is the only option that provides true end-to-end encryption for AI interactions. With this plugin:

- **Zero-knowledge AI conversations** — the server cannot see your prompts or the AI's responses
- **Self-hostable** — run both Arthas server and OpenClaw Gateway on your own infrastructure
- **No server modifications needed** — the AI agent joins as a regular room participant

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                              │
│                                                                   │
│  ┌──────────────┐    ┌──────────────────────────────────────┐   │
│  │  AI Agent    │    │  @arthas/openclaw-channel             │   │
│  │  (LLM)       │◄──►│                                      │   │
│  │              │    │  ┌────────────┐  ┌────────────────┐  │   │
│  └──────────────┘    │  │ Adapter    │  │ Crypto Engine  │  │   │
│                      │  │ (msg flow) │  │ (AES-256-GCM)  │  │   │
│                      │  └─────┬──────┘  └───────┬────────┘  │   │
│                      │        │                  │            │   │
│                      │  ┌─────┴──────────────────┴────────┐  │   │
│                      │  │  WebSocket Client + msgpack      │  │   │
│                      │  └─────────────────┬───────────────┘  │   │
│                      └────────────────────┼──────────────────┘   │
└───────────────────────────────┼───────────────────────────────────┘
                                │ WSS (encrypted binary frames)
                                ▼
                    ┌───────────────────────┐
                    │   Arthas Server       │
                    │   (blind relay)       │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   User (Web/CLI)      │
                    │   (end-to-end encrypted)│
                    └───────────────────────┘
```

**Data flow:** User encrypts message → Arthas server relays ciphertext → Plugin decrypts → OpenClaw Gateway processes → Agent responds → Plugin encrypts → Arthas server relays → User decrypts.

## Installation

```bash
npm install @arthas/openclaw-channel
```

Requires Node.js >= 18.0.0 (uses built-in `crypto` module for AES-256-GCM).

## Configuration

The plugin loads configuration from two sources (environment variables take precedence):

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ARTHAS_SERVER_URL` | Yes | Arthas server WebSocket URL | `wss://arthas.example.com/ws` |
| `ARTHAS_SHARE_CODE` | Yes | Room share code (contains room ID + encryption key) | `abc123:dGhpcyBpcyBhIGtleQ:0:0` |
| `ARTHAS_DISPLAY_NAME` | No | Agent's display name in the room (default: `AI Assistant`) | `My AI Bot` |
| `ARTHAS_SIGNING_ENABLED` | No | Enable Ed25519 message signing (default: `false`) | `true` |
| `ARTHAS_ROOM_PASSWORD` | No | Password for password-protected rooms | `my-secret` |

### package.json Configuration

Alternatively, configure via the `openclaw` field in your Gateway's `package.json`:

```json
{
  "openclaw": {
    "channels": {
      "arthas": {
        "serverUrl": "wss://arthas.example.com/ws",
        "shareCode": "roomId:base64Key:0:0",
        "displayName": "AI Assistant",
        "signingEnabled": false
      }
    }
  }
}
```

### Configuration Priority

1. **Environment variables** (highest) — best for production, CI/CD
2. **ChannelConfig object** (Gateway passes this to `connect()`) — best for programmatic use
3. **Default values** (lowest) — `displayName: 'AI Assistant'`, `signingEnabled: false`

### Share Code Format

The share code is obtained from an Arthas client (Web or CLI) when sharing a room:

```
roomId:base64Key:ephemeralFlag:expiresAt
  │       │          │            │
  │       │          │            └─ Unix timestamp (0 = no expiry)
  │       │          └─ 0 or 1 (ephemeral room flag)
  │       └─ Base64url-encoded AES-256 encryption key
  └─ Room unique identifier
```

Minimum required: `roomId:base64Key` (2 segments). The ephemeral and expiry segments are optional.

## Usage with OpenClaw Gateway

### Basic Setup

1. Create an Arthas room using the Web or CLI client
2. Copy the share code from the room's "Share" dialog
3. Configure the plugin and start your Gateway:

```bash
export ARTHAS_SERVER_URL=wss://your-arthas-server.com/ws
export ARTHAS_SHARE_CODE=your-room-id:your-encryption-key:0:0
export ARTHAS_DISPLAY_NAME="Code Assistant"

# Start OpenClaw Gateway with the Arthas channel
openclaw start
```

### Programmatic Integration

```typescript
import arthasPlugin from '@arthas/openclaw-channel';
import { ArthasChannelAdapter } from '@arthas/openclaw-channel';

// The plugin registers itself with OpenClaw Gateway via definePlugin()
// Gateway loads it automatically when listed in the plugins config.

// For custom integrations, you can use the adapter directly:
const adapter = new ArthasChannelAdapter();

adapter.onMessage((message) => {
  console.log(`${message.userName}: ${message.text}`);
  // Forward to your AI agent...
});

adapter.onStatusChange((status) => {
  console.log(`Connection status: ${status}`);
  // 'connected' | 'disconnected' | 'reconnecting' | 'error'
});

await adapter.connect({
  serverUrl: 'wss://arthas.example.com/ws',
  shareCode: 'roomId:base64Key:0:0',
  displayName: 'My Agent',
});

// Send a response
await adapter.send({
  id: 'msg-001',
  channelId: 'arthas',
  text: 'Hello! I am your AI assistant.',
});

// Clean up
await adapter.disconnect();
```

### File Transfer

The plugin supports encrypted file transfers (up to 5MB):

```typescript
// Receiving files — they arrive as IncomingMessage with attachments
adapter.onMessage((message) => {
  if (message.attachments?.length) {
    for (const file of message.attachments) {
      console.log(`Received file: ${file.fileName} (${file.size} bytes)`);
      // file.data is a Buffer containing the decrypted file content
    }
  }
});

// Sending files
await adapter.send({
  id: 'msg-002',
  channelId: 'arthas',
  text: 'Here is the analysis result:',
  attachments: [{
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    size: reportBuffer.length,
    data: reportBuffer,
  }],
});
```

## Security Model

### End-to-End Encryption (E2EE)

All messages are encrypted with **AES-256-GCM** before leaving the plugin process:

| What the server CAN see | What the server CANNOT see |
|--------------------------|----------------------------|
| Message timestamps | Message content (text) |
| Message sizes (ciphertext length) | File contents |
| Participant connection status | Who said what (sender names are encrypted) |
| Room membership events | Encryption keys |

### How It Works

1. **Key derivation** — The AES-256 key is extracted from the share code (base64url-decoded). The key never leaves the plugin process memory.
2. **Encryption** — Each outgoing message gets a unique random 12-byte IV. The plaintext is encrypted with AES-256-GCM, producing ciphertext + 16-byte authentication tag.
3. **Integrity** — GCM mode provides authenticated encryption. Any tampering with the ciphertext is detected via the authentication tag.
4. **Transport** — Encrypted messages are encoded with MessagePack and sent over WSS (TLS 1.2+). Double encryption: E2EE content inside a TLS tunnel.

### Optional Message Signing (Ed25519)

When `ARTHAS_SIGNING_ENABLED=true`:

- The plugin generates an Ed25519 keypair on first connection
- The public key is broadcast to the room (encrypted, like any other message)
- Other participants can verify that messages truly came from this agent (TOFU trust model)

### Security Practices

- Encryption keys exist only in memory — never written to disk or logs
- Decrypted message content is never logged (only metadata: timestamp, message length)
- Key material is zeroed on disconnect (`Buffer.fill(0)`)
- WebSocket connections enforce WSS (TLS 1.2+) in production
- Share codes should be passed via environment variables, not hardcoded

## Troubleshooting

### Common Errors

#### `[Arthas 配置错误] 缺少必填配置: serverUrl`

The plugin cannot find the Arthas server URL. Set the environment variable:

```bash
export ARTHAS_SERVER_URL=wss://your-server.com/ws
```

#### `[Arthas 配置错误] 缺少必填配置: shareCode`

No share code configured. Create a room in Arthas, click "Share", and set:

```bash
export ARTHAS_SHARE_CODE=roomId:encryptionKey:0:0
```

#### `[Arthas 配置错误] serverUrl 格式无效`

The URL must start with `wss://` (production) or `ws://` (local development only):

```bash
# Correct
export ARTHAS_SERVER_URL=wss://arthas.example.com/ws

# Wrong
export ARTHAS_SERVER_URL=https://arthas.example.com/ws
export ARTHAS_SERVER_URL=arthas.example.com/ws
```

#### `[Arthas] 消息解密失败`

The encryption key doesn't match. This happens when:
- The share code is from a different room
- The share code has been regenerated (old key is invalid)
- The room was recreated with a new key

**Fix:** Get a fresh share code from the room and update `ARTHAS_SHARE_CODE`.

#### WebSocket connection keeps reconnecting

Check:
1. The server URL is reachable: `curl -I https://your-server.com`
2. The WebSocket path is correct (usually `/ws`)
3. Firewall allows outbound WSS connections (port 443)
4. If using a password-protected room, set `ARTHAS_ROOM_PASSWORD`

The plugin uses exponential backoff for reconnection: 1s → 2s → 4s → 8s → 16s → 30s (max).

#### `房间已关闭` (Room closed)

The room has expired or was closed by an admin. Create a new room and update the share code.

## Development

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

### Setup

```bash
# From the repository root
cd packages/openclaw-channel

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Project Structure

```
packages/openclaw-channel/
├── package.json          # npm package config + openclaw plugin metadata
├── tsconfig.json         # TypeScript config (strict, ESM output)
├── vitest.config.ts      # Test framework configuration
├── src/
│   ├── index.ts          # Plugin entry — registers channel with OpenClaw
│   ├── adapter.ts        # ChannelAdapter implementation (core integration)
│   ├── client.ts         # Arthas WebSocket client (connect, join, send)
│   ├── crypto.ts         # AES-256-GCM encrypt/decrypt (Node.js crypto)
│   ├── signing.ts        # Ed25519 message signing (optional)
│   ├── protocol.ts       # msgpack encode/decode + message type constants
│   ├── config.ts         # Configuration loading and validation
│   ├── reconnect.ts      # Exponential backoff reconnection manager
│   ├── file-transfer.ts  # Chunked file transfer (receive + send)
│   └── types.ts          # TypeScript type definitions (OpenClaw SDK types)
├── tests/
│   ├── crypto.test.ts    # Encryption compatibility tests
│   ├── protocol.test.ts  # Protocol encode/decode tests
│   └── adapter.test.ts   # Adapter integration tests
└── README.md             # This file
```

### Running Tests

```bash
# Unit tests
npm test

# With coverage
npx vitest run --coverage

# Single test file
npx vitest run tests/crypto.test.ts
```

### Building for Production

```bash
npm run build
# Output: dist/ directory with compiled JS + type declarations
```

### Contributing

1. Fork the [Arthas repository](https://github.com/nicepkg/arthas)
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes in `packages/openclaw-channel/`
4. Run tests: `npm test`
5. Submit a pull request

## API Reference

### Exported Types

```typescript
import type {
  ChannelAdapter,      // Interface to implement custom adapters
  ChannelConfig,       // Generic config passed by Gateway
  ArthasChannelConfig, // Arthas-specific strongly-typed config
  IncomingMessage,     // User message (decrypted)
  OutgoingMessage,     // Agent response (before encryption)
  MessageAttachment,   // File attachment
  ConnectionStatus,    // 'connected' | 'disconnected' | 'reconnecting' | 'error'
  MessageType,         // 'text' | 'typing'
  Plugin,              // Plugin instance type
  PluginDefinition,    // Plugin metadata
} from '@arthas/openclaw-channel';
```

### ArthasChannelAdapter Methods

| Method | Description |
|--------|-------------|
| `connect(config)` | Connect to Arthas server and join room |
| `disconnect()` | Disconnect, zero keys, release resources |
| `send(message)` | Encrypt and send agent response |
| `onMessage(callback)` | Register callback for incoming user messages |
| `onStatusChange(callback)` | Register callback for connection status changes |

## License

MIT — see [LICENSE](../../LICENSE) for details.
