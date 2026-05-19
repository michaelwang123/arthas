# Implementation Plan: CLI Client (arthas-cli)

## Overview

Implement a standalone Go CLI binary (`arthas-cli`) that provides terminal-based access to Arthas encrypted chat rooms. The implementation follows the design's modular architecture: protocol layer, crypto layer, network layer, UI layer, and session coordination layer. Each task builds incrementally, starting with foundational types and utilities, then core logic, then wiring everything together.

## Tasks

- [x] 1. Set up project structure and core types
  - [x] 1.1 Initialize Go module and directory structure
    - Create `arthas-cli/` directory with `cmd/arthas-cli/`, `internal/protocol/`, `internal/crypto/`, `internal/network/`, `internal/ui/`, `internal/chat/`
    - Initialize `go.mod` with module path and Go 1.22
    - Add dependencies: `github.com/gorilla/websocket v1.5.3`, `github.com/vmihailenco/msgpack/v5 v5.4.1`
    - Add test dependency: `pgregory.net/rapid v1.1.0`
    - Run `go mod tidy` to generate `go.sum`
    - Create `Makefile` with `build`, `build-all`, and `clean` targets for cross-platform compilation (linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64)
    - Makefile must include `-ldflags "-X main.version=$(VERSION)"` for version injection at build time
    - Define `VERSION` variable in Makefile (default from git tag or `dev`)
    - _Requirements: 11.1, 11.2, 11.5_

  - [x] 1.2 Define protocol message types and data structures
    - Create `internal/protocol/protocol.go` with all message type constants (0x01-0x1E)
    - Define `Message` struct with `Type uint8` and `Data interface{}` fields (msgpack tags)
    - Define data structs with explicit fields:
      - `CreateRoomData`: `Name string`, `Password string`, `Ephemeral int64` (msgpack: "name", "password", "ephemeral")
      - `JoinRoomData`: `RoomID string`, `Name string`, `Password string` (msgpack: "roomId", "name", "password")
      - `SendMessageData`: `IV string`, `Ciphertext string` (msgpack: "iv", "ciphertext")
      - `LeaveRoomData`: empty struct
      - `PongData`: `T int64` (msgpack: "t")
    - Define `MemberInfo` struct with `ID string`, `Name string`, `Color string` fields
    - Define error code constants: `ErrRoomNotFound = "E001"`, `ErrRoomFull = "E002"`, `ErrIncorrectPassword = "E006"`
    - Include file-level comment explaining the protocol envelope format and compatibility with web client
    - _Requirements: 10.1, 10.2_

  - [x] 1.3 Implement MessagePack codec with ToInt helper
    - Create `internal/protocol/codec.go` with `Encode()` and `Decode()` functions
    - Implement `ToInt()` helper that handles int8/uint8/int16/uint16/int32/uint32/int64/uint64/int/uint type switch
    - Add `📚 学习要点` comments explaining the msgpack integer type pitfall
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 2. Implement crypto layer
  - [x] 2.1 Implement key generation and base64url encoding
    - Create `internal/crypto/keys.go` with `GenerateRoomKey()` (32 bytes from crypto/rand)
    - Implement `ExportKeyBase64URL()` using `base64.RawURLEncoding`
    - Implement `ImportKeyBase64URL()` with 32-byte length validation
    - Add security comments explaining key size and CSPRNG usage
    - _Requirements: 1.2, 3.3_

  - [x] 2.2 Implement AES-256-GCM encryption
    - Create `internal/crypto/encrypt.go` with `Encrypt(key, plaintext) (iv, ciphertext, error)`
    - Generate 12-byte random IV using `crypto/rand`
    - Use `crypto/aes` + `crypto/cipher` for AES-GCM (Seal appends 16-byte auth tag)
    - Return base64url-encoded IV and ciphertext
    - Add `📚 学习要点` comments explaining AES-GCM AEAD properties and IV uniqueness requirement
    - _Requirements: 4.2, 4.3, 4.6_

  - [x] 2.3 Implement AES-256-GCM decryption
    - Create `internal/crypto/decrypt.go` with `Decrypt(key, ivB64, ciphertextB64) (plaintext, error)`
    - Decode base64url IV and ciphertext, then use GCM Open to decrypt and verify auth tag
    - Return descriptive error on authentication failure
    - _Requirements: 5.1, 5.2_

  - [x] 2.4 Implement share code parsing and building
    - Create `internal/crypto/sharecode.go` with `ShareCode` struct, `ParseShareCode()`, and `BuildShareCode()`
    - Validate room ID length (21 chars), key segment length (43 chars), key decode to 32 bytes
    - Handle optional ephemeral segment (third colon-separated part)
    - _Requirements: 1.4, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 2.5 Write property test: Share Code Round-Trip (Property 1)
    - **Property 1: Share Code Round-Trip**
    - Test that for any valid roomID (21 chars), 32-byte key, and non-negative ephemeral, `BuildShareCode` then `ParseShareCode` produces original values
    - Use `pgregory.net/rapid` generators for room ID (21 NanoID chars) and key (32 random bytes)
    - **Validates: Requirements 1.4, 3.1, 3.2, 3.3, 3.4**

  - [x] 2.6 Write property test: Encryption/Decryption Round-Trip (Property 2)
    - **Property 2: Encryption/Decryption Round-Trip (Message Payload)**
    - Test that for any 32-byte key and any UTF-8 string, wrapping in JSON `{"text": "..."}`, encrypting, then decrypting and extracting `text` produces the original string
    - Use rapid generators for keys and UTF-8 strings (including CJK, emoji)
    - **Validates: Requirements 4.1, 4.3, 5.1, 5.2, 5.3, 7.4**

  - [x] 2.7 Write property test: IV Uniqueness (Property 3)
    - **Property 3: IV Uniqueness**
    - Test that N encryption operations with the same key produce N distinct IVs
    - **Validates: Requirements 4.6**

  - [x] 2.8 Write property test: Invalid Share Code Rejection (Property 6)
    - **Property 6: Invalid Share Code Rejection**
    - Test that strings not conforming to share code format (wrong room ID length, wrong key length, invalid base64url) return an error from `ParseShareCode`
    - **Validates: Requirements 2.2**

  - [x] 2.9 Write property test: Key Generation Size (Property 14)
    - **Property 14: Key Generation Size**
    - Test that every invocation of `GenerateRoomKey()` returns exactly 32 bytes
    - **Validates: Requirements 1.2**

- [x] 3. Implement protocol codec property tests
  - [x] 3.1 Write property test: MessagePack Codec Round-Trip (Property 4)
    - **Property 4: MessagePack Codec Round-Trip**
    - Test that for any valid protocol message (CreateRoom, JoinRoom, SendMessage, LeaveRoom, Pong), encoding then decoding produces equivalent type and data fields
    - Use rapid generators for each message type with valid field values
    - **Validates: Requirements 1.3, 2.4, 4.4, 10.1, 10.2, 10.3, 10.5**

  - [x] 3.2 Write property test: Integer Type Coercion (Property 5)
    - **Property 5: Integer Type Coercion (toInt)**
    - Test that for any integer value across all msgpack encoding widths (int8 through uint64), `ToInt()` correctly converts to the expected int64 value
    - **Validates: Requirements 10.4**

- [x] 4. Checkpoint - Core crypto and protocol tests pass
  - Run `go test ./internal/crypto/... ./internal/protocol/...`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement UI layer
  - [x] 5.1 Implement hex color to ANSI 256-color conversion
    - Create `internal/ui/color.go` with `HexToANSI256()` and `Reset()` functions
    - Implement 6×6×6 RGB cube mapping algorithm (index = 16 + 36*r + 6*g + b)
    - Implement `colorToAnsiComponent()` with nearest-neighbor threshold matching
    - Add `📚 学习要点` comment explaining ANSI 256-color palette structure
    - _Requirements: 6.1_

  - [x] 5.2 Implement terminal display formatting
    - Create `internal/ui/display.go` with `Display` struct and all display methods
    - Implement `NewDisplay()` with terminal color support detection (check `TERM`, `NO_COLOR`, Windows VTP via `GetConsoleMode` + `ENABLE_VIRTUAL_TERMINAL_PROCESSING`)
    - Implement `ShowMessage()` with format `[HH:MM] <colored_name>: text`
    - Implement `ShowOwnMessage()` with distinct styling
    - Implement `ShowSystemMessage()` with `***` prefix and dimmed color
    - Implement `ShowError()` writing to stderr
    - Implement `ShowMembers()` and `ShowShareCode()`
    - Implement `ShowReplyContext()` with `↩ Re:` prefix
    - Implement `FormatTimestamp(unixMs int64) string` — convert Unix milliseconds to `HH:MM` in local timezone
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 5.3 Implement user input handling and validation utilities
    - Create `internal/ui/input.go` with `ReadLine()` and `PromptName()` functions
    - `ReadLine()` uses `bufio.Scanner` to read stdin line by line, returns `io.EOF` on EOF (Ctrl+D on Unix, Ctrl+Z on Windows)
    - `PromptName()` prompts interactively, calls `ValidateDisplayName()`
    - Implement `ValidateDisplayName(name string) error` — rejects empty or >20 runes
    - Implement `ValidateMessageLength(text string) error` — rejects >500 runes
    - These validation functions are exported for reuse by chat session and property tests
    - _Requirements: 7.1, 7.5, 9.6, 9.7_

  - [x] 5.4 Write property test: Hex Color to ANSI Conversion (Property 7)
    - **Property 7: Hex Color to ANSI Conversion**
    - Test that for any valid `#RRGGBB` hex color, conversion produces a string starting with `\033[38;5;` and ending with `m`, with a valid index 0-255
    - **Validates: Requirements 6.1**

  - [x] 5.5 Write property test: Timestamp Formatting (Property 8)
    - **Property 8: Timestamp Formatting**
    - Test that for any Unix millisecond timestamp, formatting as `HH:MM` produces a string matching `[0-2][0-9]:[0-5][0-9]` with valid hour (00-23) and minute (00-59)
    - **Validates: Requirements 6.6**

  - [x] 5.6 Write property test: Message Display Contains Required Elements (Property 9)
    - **Property 9: Message Display Contains Required Elements**
    - Test that for any non-empty sender name, valid hex color, non-empty text, and valid timestamp, the formatted output contains the sender name, message text, and a valid HH:MM timestamp
    - **Validates: Requirements 5.5**

  - [x] 5.7 Write property test: Display Name Validation (Property 12)
    - **Property 12: Display Name Validation**
    - Test that empty strings and strings exceeding 20 runes are rejected by `ValidateDisplayName()`, while 1-20 rune strings are accepted
    - **Validates: Requirements 9.7**

  - [x] 5.8 Write property test: Message Length Validation (Property 13)
    - **Property 13: Message Length Validation**
    - Test that strings exceeding 500 runes are rejected by `ValidateMessageLength()`, while 1-500 rune strings are accepted
    - **Validates: Requirements 7.5**

- [x] 6. Implement network layer
  - [x] 6.1 Implement WebSocket connection management
    - Create `internal/network/websocket.go` with `Conn` struct wrapping `gorilla/websocket`
    - Implement `Dial()` with:
      - HandshakeTimeout: 10s
      - ReadBufferSize: 131072 (128KB, matching server)
      - WriteBufferSize: 131072 (128KB, matching server)
      - Origin header: `"arthas-cli"` (for CORS compatibility with server's ALLOWED_ORIGINS)
      - ReadLimit: 102400 (100KB, matching server's maxMessageSize)
      - PongHandler that resets read deadline to `time.Now().Add(40 * time.Second)`
    - Implement `Send()` (non-blocking enqueue to sendCh with capacity 16; return error if full)
    - Implement `ReadMessage()` (blocking read with deadline reset)
    - Implement `Close()` (graceful close frame + cancel context)
    - Implement `writePump()` goroutine (consume sendCh, write with 10s writeWait timeout)
    - Implement `Done()` returning context Done channel
    - Add `📚 学习要点` comments explaining thread-safety model and writePump pattern
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 7. Checkpoint - Network and UI layers complete
  - Run `go test ./internal/...`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement chat session coordination
  - [x] 8.1 Implement session state machine and RunCreate flow
    - Create `internal/chat/session.go` with `Session` struct, `SessionState` enum, and `MessagePayload`/`ReplyData` types
    - Implement `RunCreate()`: generate key → dial WebSocket → send CreateRoom (type 0x01, data: {name, password:"", ephemeral:0}) → wait for RoomCreated (0x10) + RoomJoined (0x11) → store members/hasPassword/ephemeral → display share code → enter chatLoop
    - Handle server Error (0x17) responses during join phase
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 8.2 Implement RunJoin flow
    - Implement `RunJoin()`: parse share code → dial WebSocket → send JoinRoom (type 0x02, data: {roomId, name, password:""}) → wait for RoomJoined (0x11) → store members map → display member list → enter chatLoop
    - Handle error codes: E001 (room not found), E002 (room full), E006 (incorrect password) — use protocol constants
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [x] 8.3 Implement chatLoop with four-goroutine model
    - Implement `chatLoop()` with stdinPump, readPump, writePump goroutines + main select loop
    - Use `context.WithCancel` for coordinated shutdown
    - Signal handling: use `signal.Notify(sigCh, os.Interrupt)` — this captures Ctrl+C on all platforms (SIGINT on Unix, console event on Windows)
    - EOF handling: `ReadLine()` returns `io.EOF` on Ctrl+D (Unix) or Ctrl+Z+Enter (Windows)
    - Do NOT use `syscall.SIGTERM` — it is not supported on Windows
    - Add `📚 学习要点` comments explaining why stdin needs its own goroutine, the CSP model, and cross-platform signal differences
    - _Requirements: 7.1, 8.3, 8.4_

  - [x] 8.4 Implement message sending (handleUserInput)
    - Implement `handleUserInput()`:
      - Validate non-empty input (skip empty lines)
      - Handle `/quit` and `/exit` commands → send LeaveRoom, close connection
      - Call `ui.ValidateMessageLength(text)` — reject if >500 runes, show error
      - Construct `MessagePayload{Text: input}`, marshal to JSON with `json.Marshal`
      - Encrypt JSON bytes: `crypto.Encrypt(roomKey, jsonBytes)` → iv, ciphertext
      - Encode protocol message: `protocol.Encode(&Message{Type: 0x03, Data: SendMessageData{IV: iv, Ciphertext: ciphertext}})`
      - Send via `conn.Send(encoded)`
      - Display local echo via `display.ShowOwnMessage(text)` (server does not echo back)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 7.2, 7.3, 7.5, 7.6_

  - [x] 8.5 Implement message receiving (handleRelayMessage)
    - Implement `handleRelayMessage(data map[string]interface{})`:
      - Extract fields: `senderId`, `senderName`, `iv`, `ciphertext`, `t` (timestamp via ToInt)
      - Decrypt: `crypto.Decrypt(roomKey, iv, ciphertext)` → plaintext bytes
      - If decryption fails: display `[⚠ decryption failed]` via `display.ShowSystemMessage()`, return (don't crash)
      - Parse JSON payload: `json.Unmarshal(plaintext, &payload)`
      - Backward compatibility: if JSON parse fails or `payload.Text == ""`, use entire plaintext as text
      - **Color lookup**: retrieve sender's color from `s.members[senderId].Color` (RelayMessage does NOT include color field)
      - If `payload.Reply != nil`: display reply context via `display.ShowReplyContext(reply.SenderName, reply.Preview)`
      - Display message via `display.ShowMessage(senderName, color, payload.Text, timestamp)`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 8.6 Implement membership event handlers
    - Implement `handleMemberJoined(data map[string]interface{})`:
      - Extract id, name, color fields
      - Add to `s.members` map: `s.members[id] = MemberInfo{ID: id, Name: name, Color: color}`
      - Display system message: `display.ShowSystemMessage("*** <name> joined")`
    - Implement `handleMemberLeft(data map[string]interface{})`:
      - Extract id field
      - Lookup name from `s.members[id]` (use "unknown" if not found)
      - Display system message: `display.ShowSystemMessage("*** <name> left")`
      - Remove from map: `delete(s.members, id)`
    - _Requirements: 6.2, 6.3_

  - [x] 8.7 Implement ping/pong and unhandled message routing
    - Implement `handlePing(data map[string]interface{})`: extract timestamp `t` via `ToInt()`, encode Pong (0x06) with same timestamp, send
    - Implement `handleServerMessage(msg *Message)` switch:
      - 0x14 → handleRelayMessage
      - 0x12 → handleMemberJoined
      - 0x13 → handleMemberLeft
      - 0x18 → handlePing
      - 0x17 → handleError (display error code and description)
      - 0x16 → display "Room closed", graceful exit (status 0)
      - 0x15, 0x19, 0x1A-0x1E → silent ignore (no log, no error)
      - default (unknown types) → silent ignore
    - Implement `sendLeaveRoom()`: encode LeaveRoom (0x04), send, close connection
    - _Requirements: 8.1, 8.5, 6.4_

  - [x] 8.8 Write property test: Ping/Pong Timestamp Echo (Property 10)
    - **Property 10: Ping/Pong Timestamp Echo**
    - Test that for any Ping message with timestamp T, the generated Pong response contains the exact same timestamp T
    - **Validates: Requirements 8.1**

  - [x] 8.9 Write property test: Unhandled Message Types Ignored (Property 11)
    - **Property 11: Unhandled Message Types Ignored**
    - Test that messages with unhandled type IDs (0x15, 0x19, 0x1A-0x1E, and undefined types) do not produce errors or panics
    - **Validates: Requirements 8.5**

- [x] 9. Implement CLI entry point and argument parsing
  - [x] 9.1 Implement main.go with command routing and flag parsing
    - Create `cmd/arthas-cli/main.go` with subcommand routing (create/join)
    - Define `var version = "dev"` (overridden by ldflags at build time)
    - Parse `--server` flag and `ARTHAS_SERVER` env var (flag takes precedence, default to public instance)
    - Parse `--name` flag; if absent, call `ui.PromptName()` for interactive input
    - Implement `--version` flag (print version string and exit)
    - Implement `--help` flag (print usage and exit)
    - Validate display name via `ui.ValidateDisplayName(name)` before proceeding
    - Route to `chat.RunCreate()` or `chat.RunJoin()` based on subcommand
    - Exit with appropriate status codes on error (0 = normal, 1 = error)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 11.3, 11.4_

- [x] 10. Checkpoint - Full integration
  - Run `go build ./cmd/arthas-cli/` to verify compilation
  - Run `go test ./...` to verify all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Integration tests
  - [x] 11.1 Write integration tests with mock WebSocket server
    - Create `internal/chat/integration_test.go` with test helpers using `httptest` + `gorilla/websocket` to simulate Arthas server
    - Test complete create room flow: connect → CreateRoom → RoomCreated → RoomJoined → share code output
    - Test complete join room flow: connect → JoinRoom → RoomJoined → member list display
    - Test message send/receive cycle: encrypt → send → relay → decrypt → display
    - Test error handling: E001, E002, E006 server errors
    - Test graceful shutdown: RoomClosed, LeaveRoom on signal
    - Test membership events: MemberJoined adds to map, MemberLeft removes from map
    - _Requirements: 1.1-1.8, 2.1-2.9, 4.1-4.7, 5.1-5.6, 8.1-8.5_

- [x] 12. Final checkpoint - All tests pass
  - Run `go test ./... -count=1` (disable test caching)
  - Run `go vet ./...` for static analysis
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property tests — can be skipped for faster MVP but strongly recommended
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation (run tests between major phases)
- Property tests validate universal correctness properties from the design document (14 properties total)
- The implementation language is Go (explicitly specified in the design)
- All code must include `📚 学习要点` comments per the project's code-quality steering rules
- Use `pgregory.net/rapid` for property-based testing (specified in design)
- The CLI is a standalone Go module, independent from arthas-server's go.mod
- **Platform note**: Target is cross-platform (Linux/macOS/Windows). Signal handling uses `os.Interrupt` only (no SIGTERM). EOF detection handles both Ctrl+D (Unix) and Ctrl+Z (Windows).
- **Server compatibility**: CLI sets `Origin: arthas-cli` header. Self-hosted servers must add `arthas-cli` to `ALLOWED_ORIGINS` env var.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "5.1", "5.3"] },
    { "id": 2.5, "tasks": ["2.4"] },
    { "id": 3, "tasks": ["2.5", "2.6", "2.7", "2.8", "2.9", "3.1", "3.2", "5.2", "5.4", "5.7", "5.8"] },
    { "id": 4, "tasks": ["5.5", "5.6", "6.1"] },
    { "id": 5, "tasks": ["8.1", "8.2"] },
    { "id": 6, "tasks": ["8.3"] },
    { "id": 7, "tasks": ["8.4", "8.5", "8.6", "8.7"] },
    { "id": 8, "tasks": ["8.8", "8.9", "9.1"] },
    { "id": 9, "tasks": ["11.1"] }
  ],
  "checkpoints": {
    "4": "after wave 3 (crypto + protocol tests)",
    "7": "after wave 4 (UI + network layers)",
    "10": "after wave 8 (full integration)",
    "12": "after wave 9 (all tests)"
  }
}
```
