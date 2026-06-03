# CLI Client Guide (arthas-cli)

A single-binary terminal client for Arthas E2EE chat. No dependencies, no signup.

## Download

| Platform | Command |
|----------|---------|
| **Windows** | `curl.exe -L -o arthas-cli.exe https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli-windows-amd64.exe` |
| **Linux (x86_64)** | `curl -L -o arthas-cli https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli && chmod +x arthas-cli` |
| **Linux (ARM64)** | `curl -L -o arthas-cli https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli-linux-arm64 && chmod +x arthas-cli` |
| **macOS (Intel)** | `curl -L -o arthas-cli https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli-darwin-amd64 && chmod +x arthas-cli` |
| **macOS (Apple Silicon)** | `curl -L -o arthas-cli https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli-darwin-arm64 && chmod +x arthas-cli` |

Or download manually from [GitHub Releases](https://github.com/michaelwang123/arthas/releases/latest).

> A free public server is available at `wss://arthas100-arthas-server.hf.space/ws` — no setup needed.

---

## Quick Start

### 1. Create a room

```bash
# Linux/macOS
./arthas-cli create --server wss://arthas100-arthas-server.hf.space/ws --name "Alice"

# Windows
.\arthas-cli.exe create --server wss://arthas100-arthas-server.hf.space/ws --name "Alice"
```

Output:

```
✓ Room created! Share code:
QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM

Share this code with others to join.
```

**Keep this terminal open** — the room exists only while at least one participant is connected.

### 2. Join a room (in another terminal)

```bash
# Linux/macOS
./arthas-cli join QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM \
  --server wss://arthas100-arthas-server.hf.space/ws --name "Bob"

# Windows
.\arthas-cli.exe join QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM --server wss://arthas100-arthas-server.hf.space/ws --name "Bob"
```

Now type messages — they are encrypted end-to-end. The server only sees ciphertext.

### 3. Send a message

Just type and press Enter. Messages are encrypted with AES-256-GCM before being sent.

### 4. Exit

Press `Ctrl+C` to leave the room. If you're the last participant, the room is destroyed.

---

## Command Reference

### create

Create a new encrypted room and stay connected.

```
arthas-cli create --server <URL> --name <DISPLAY_NAME>
```

| Flag | Required | Description |
|------|----------|-------------|
| `--server` | Yes | WebSocket URL of the Arthas server |
| `--name` | Yes | Your display name in the room |

### join

Join an existing room using a share code.

```
arthas-cli join <SHARE_CODE> --server <URL> --name <DISPLAY_NAME>
```

| Argument/Flag | Required | Description |
|---------------|----------|-------------|
| `<SHARE_CODE>` | Yes | The share code from the room creator |
| `--server` | Yes | WebSocket URL (same server as creator) |
| `--name` | Yes | Your display name |

---

## Share Code Format

```
roomId:base64Key[:ephemeralFlag[:expiresAt]]
```

| Segment | Length | Description |
|---------|--------|-------------|
| `roomId` | 21 chars | Room unique identifier (NanoID) |
| `base64Key` | 43 chars | AES-256 encryption key (base64url, no padding) |
| `ephemeralFlag` | 1 char | Optional. `0` = persistent, `1` = ephemeral |
| `expiresAt` | variable | Optional. Unix timestamp (0 = no expiry) |

The encryption key **never** leaves your device. It's embedded in the share code and transmitted only through your chosen side channel (copy-paste, QR code, in-person).

---

## Important Notes

- **Rooms are ephemeral** — when all participants disconnect, the room is immediately destroyed. There is no persistent chat history.
- **Share code = full access** — anyone with the share code can read all messages. Treat it like a password.
- **Creator must stay online** — if the room creator disconnects before anyone else joins, the room is gone. Join from another terminal while the creator is still connected.
- **`room not found` error** — the room was already destroyed (all participants left). Create a new room.
- **Cross-platform** — the CLI client (Go) and web client (React) are fully interoperable. You can create a room in the web UI and join it from the CLI, or vice versa.

---

## Using with Self-Hosted Server

If you're running your own Arthas server:

```bash
# Local development
./arthas-cli create --server ws://localhost:8080/ws --name "Alice"

# Production (with TLS)
./arthas-cli create --server wss://arthas.yourdomain.com/ws --name "Alice"
```

See the [Self-Hosting Guide](self-hosting.en.md) for server deployment instructions.

---

## Build from Source

Requires Go 1.23+:

```bash
cd arthas-cli
go build -o arthas-cli ./cmd/arthas-cli

# Or cross-compile for other platforms
GOOS=linux GOARCH=amd64 go build -o arthas-cli-linux ./cmd/arthas-cli
GOOS=windows GOARCH=amd64 go build -o arthas-cli.exe ./cmd/arthas-cli
```
