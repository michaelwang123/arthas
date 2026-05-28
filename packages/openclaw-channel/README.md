# @arthas/openclaw-channel

📖 Full documentation: [中文](../../official_doc/openclaw-channel.md) | [English](../../official_doc/openclaw-channel.en.md)

---

OpenClaw Channel Plugin for [Arthas](https://github.com/michaelwang123/arthas) — enables AI agents to communicate with users through end-to-end encrypted chat rooms.

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
└───────────────────────────────────────────┼───────────────────────┘
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

## Quick Start

```typescript
import { ArthasChannelAdapter } from '@arthas/openclaw-channel';
const adapter = new ArthasChannelAdapter();
adapter.onMessage(msg => console.log(`${msg.userName}: ${msg.text}`));
await adapter.connect({ serverUrl: 'wss://your-server.com/ws', shareCode: 'roomId:key' });
await adapter.send({ text: 'Hello!', id: '1', channelId: 'arthas' });
```

## Installation

```bash
npm install @arthas/openclaw-channel
```

Requires Node.js >= 18.0.0 (uses built-in `crypto` module for AES-256-GCM).

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ARTHAS_SERVER_URL` | Yes | — | Arthas server WebSocket URL (`wss://` or `ws://`) |
| `ARTHAS_SHARE_CODE` | Yes | — | Room share code (roomId + encryption key) |
| `ARTHAS_DISPLAY_NAME` | No | `AI Assistant` | Agent's display name in the room |
| `ARTHAS_SIGNING_ENABLED` | No | `false` | Enable Ed25519 message signing |
| `ARTHAS_ROOM_PASSWORD` | No | — | Password for password-protected rooms |

> For detailed configuration options (share code format, package.json config, priority rules), see the [full documentation](../../official_doc/openclaw-channel.en.md).

## API Reference

### ArthasChannelAdapter Methods

| Method | Description |
|--------|-------------|
| `connect(config)` | Connect to Arthas server and join room |
| `disconnect()` | Disconnect, zero keys, release resources |
| `send(message)` | Encrypt and send agent response |
| `onMessage(callback)` | Register callback for incoming user messages |
| `onStatusChange(callback)` | Register callback for connection status changes |

### Exported Types

```typescript
import type {
  ChannelAdapter,      // Interface to implement custom adapters
  ChannelConfig,       // Generic config passed by Gateway
  ArthasChannelConfig, // Arthas-specific strongly-typed config
  IncomingMessage,     // User message (decrypted)
  OutgoingMessage,     // Agent response (before encryption)
  MessageAttachment,   // File attachment
  ConnectionStatus,    // 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
  MessageType,         // 'text' | 'typing' | 'file'
  Plugin,              // Plugin instance type
  PluginDefinition,    // Plugin metadata
} from '@arthas/openclaw-channel';
```

> For programmatic integration examples, file transfer usage, security model details, troubleshooting, and share code format, see the [full documentation](../../official_doc/openclaw-channel.en.md).

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

### Contributing

1. Fork the [Arthas repository](https://github.com/michaelwang123/arthas)
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes in `packages/openclaw-channel/`
4. Run tests: `npm test`
5. Submit a pull request

## License

AGPL-3.0 — see [LICENSE](../../LICENSE) for details.
