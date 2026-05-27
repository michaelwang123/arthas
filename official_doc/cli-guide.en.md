[中文](cli-guide.md) | English

# CLI Client User Guide (arthas-cli)

arthas-cli is the terminal client for Arthas, allowing you to create and join encrypted chat rooms without a browser. It implements the exact same E2EE protocol as the Web client, making both ends fully interoperable.

---

## Installation

### Build from Source

```bash
cd arthas-cli
go build -o arthas-cli ./cmd/arthas-cli/
```

### Cross-Platform Compilation

```bash
# Build for all platforms using Makefile
make build-all

# Output in build/ directory:
# arthas-cli-linux-amd64
# arthas-cli-linux-arm64
# arthas-cli-darwin-amd64
# arthas-cli-darwin-arm64
# arthas-cli-windows-amd64.exe
```

### Verify Installation

```bash
arthas-cli --version
# Output: arthas-cli v1.0.0
```

---

## Basic Usage

### Create a Room

```bash
arthas-cli create --name Alice
```

On success, a share code is printed:
```
Share this code to invite others:
  X2-KtJ6oRzdxbguxl5DAR:AMVGFZBTFLeed7tVncI1oKoFUdNIv6goGz64x0cuU1M
```

Send this share code to your partner through a secure channel.

### Join a Room

```bash
arthas-cli join <share_code> --name Bob
```

On success, the member list is displayed and chat mode begins:
```
Members in room:
  • Alice
  • Bob
```

### Send Messages

Type text and press Enter:
```
Hello, Alice!
[16:08] Bob: Hello, Alice!
```

### Exit

- Type `/quit` or `/exit`
- Press `Ctrl+C`
- Press `Ctrl+D` (Unix) or `Ctrl+Z+Enter` (Windows)

---

## Command Reference

```
arthas-cli create [--server URL] [--name NAME]
arthas-cli join <share_code> [--server URL] [--name NAME]
arthas-cli --version
arthas-cli --help
```

### Global Options

| Option | Description | Default |
|--------|-------------|---------|
| `--server` | WebSocket server URL | `wss://arthas-chat.onrender.com/ws` |
| `--name` | Display nickname (1-20 characters) | Interactive prompt |
| `--version` | Show version number | — |
| `--help` | Show help information | — |

### Environment Variables

| Variable | Description | Priority |
|----------|-------------|----------|
| `ARTHAS_SERVER` | WebSocket server URL | Lower than `--server` flag |

Configuration priority: `--server` flag > `ARTHAS_SERVER` environment variable > default value

---

## Connecting to a Self-Hosted Server

```bash
# Method 1: Use the --server flag
arthas-cli create --server wss://chat.example.com/ws --name Alice

# Method 2: Use an environment variable (persistent configuration)
export ARTHAS_SERVER=wss://chat.example.com/ws
arthas-cli create --name Alice
```

**Note**: Self-hosted servers must add `arthas-cli` to the `ALLOWED_ORIGINS` environment variable:

```bash
# Server-side configuration
ALLOWED_ORIGINS=https://your-domain.com,arthas-cli
```

---

## Interoperability with the Web Client

arthas-cli and the Web client use the exact same protocol:
- Same MessagePack binary envelope format
- Same AES-256-GCM encryption parameters
- Same base64url encoding rules
- Same share code format

You can:
- Create a room on Web → join from CLI
- Create a room on CLI → join from Web
- CLI and Web users chat in the same room

---

## Message Format

Messages are displayed in the terminal as follows:

```
[HH:MM] <colored nickname>: message content    # Messages from others
[HH:MM] <bold nickname>: message content       # Your own messages
*** Alice joined                               # System message (member joined)
*** Bob left                                   # System message (member left)
  ↩ Re: Alice: quoted message...               # Reply context
```

---

## Limitations

The current MVP version does not support the following features (which the Web client supports):

| Feature | Reason |
|---------|--------|
| File transfer | Terminal environment is not suited for file operations |
| Emoji reactions | Terminal UX is not suited for this |
| Typing indicator | Line-input mode cannot detect "is typing" |
| Password-protected rooms | To be added in a future version |
| Auto-reconnect | Simply re-run the CLI after disconnection |

---

## Troubleshooting

### Connection Failed

```
Error: failed to connect to server: ...
```

Check:
1. Whether the server is running
2. Whether the URL is correct (must start with `ws://` or `wss://`)
3. Whether the network is reachable

### Origin Rejected

```
Error: failed to connect to server: websocket: bad handshake
```

Self-hosted servers must add `arthas-cli` to `ALLOWED_ORIGINS`.

### Invalid Share Code

```
Error: invalid share code: expected format {roomId}:{key}[:{ephemeral}]
```

Make sure you copied the full share code (21-character roomId + colon + 43-character key).

---

## Technical Details

- **Language**: Go 1.22
- **Dependencies**: gorilla/websocket, vmihailenco/msgpack/v5
- **Encryption**: Go standard library crypto/aes + crypto/cipher (AES-256-GCM)
- **Concurrency model**: 4-goroutine CSP model (main + stdinPump + readPump + writePump)
- **Cross-platform**: Linux/macOS/Windows, single static binary
- **Tests**: 14 property tests + 17 integration tests + unit tests (77 total)

---

## Next Steps

- [System Architecture](architecture.en.md) — Understand the overall design
- [Protocol Specification](protocol.en.md) — Message format details
- [Self-Hosted Deployment](self-hosting.en.md) — Deploy your own server
