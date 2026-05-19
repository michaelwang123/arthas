# Requirements Document: CLI Client (arthas-cli)

## Introduction

The CLI Client (`arthas-cli`) is a standalone Go binary that provides terminal-based access to Arthas encrypted chat rooms. It implements the same WebSocket + MessagePack + AES-256-GCM protocol as the web client, enabling developers and server administrators to create and join encrypted rooms directly from the command line. The CLI connects to any Arthas server instance (public or self-hosted) and provides colored terminal output for an intuitive chat experience.

## Glossary

- **CLI**: Command-Line Interface — the terminal-based Arthas client binary
- **Share_Code**: A string in the format `{roomId}:{base64url(roomKey)}[:{ephemeral}]` used to distribute room access credentials
- **Room_Key**: A 256-bit AES key used for end-to-end encryption of messages within a room
- **Room_ID**: A 21-character NanoID uniquely identifying a chat room on the server
- **Server**: The Arthas WebSocket relay server that routes encrypted messages between clients
- **MessagePack**: A binary serialization format used for all WebSocket communication
- **AES-256-GCM**: The authenticated encryption algorithm used for message confidentiality and integrity
- **IV**: Initialization Vector — a 12-byte random value used once per encryption operation
- **Ciphertext**: The encrypted output of AES-256-GCM, including the 16-byte authentication tag
- **Display_Name**: A 1-20 character nickname chosen by the user when creating or joining a room
- **Server_URL**: The WebSocket endpoint URL of an Arthas server (e.g., `wss://example.com/ws`)
- **Message_Payload**: The JSON structure `{"text": "<content>"}` that is encrypted as the message plaintext, compatible with the web client's payload format

## Requirements

### Requirement 1: Room Creation

**User Story:** As a developer, I want to create an encrypted chat room from the terminal, so that I can initiate secure conversations without opening a browser.

#### Acceptance Criteria

1. WHEN the user runs `arthas create`, THE CLI SHALL connect to the configured Server_URL via WebSocket
2. WHEN the connection is established, THE CLI SHALL generate a 256-bit Room_Key using Go's `crypto/rand` (cryptographically secure random number generator)
3. WHEN the Room_Key is generated, THE CLI SHALL send a CreateRoom message (type 0x01) with the fields: `name` (Display_Name), `password` (empty string `""`), `ephemeral` (integer `0`)
4. WHEN the server responds with RoomCreated (type 0x10), THE CLI SHALL construct a Share_Code in the format `{roomId}:{base64url(roomKey)}`
5. WHEN the Share_Code is constructed, THE CLI SHALL print the Share_Code to stdout so the user can distribute it to others
6. WHEN the Share_Code is printed, THE CLI SHALL enter chat mode (waiting for messages and user input)
7. IF the WebSocket connection fails, THEN THE CLI SHALL print a descriptive error message to stderr and exit with a non-zero status code
8. IF the server responds with an Error message (type 0x17), THEN THE CLI SHALL print the error description to stderr

### Requirement 2: Room Joining

**User Story:** As a developer, I want to join an existing encrypted room using a share code, so that I can participate in secure conversations initiated by others.

#### Acceptance Criteria

1. WHEN the user runs `arthas join <share_code>`, THE CLI SHALL parse the Share_Code to extract Room_ID, Room_Key, and optional ephemeral value
2. IF the Share_Code format is invalid (Room_ID not 21 characters or key not 43 base64url characters), THEN THE CLI SHALL print a validation error to stderr and exit with a non-zero status code
3. WHEN the Share_Code is valid, THE CLI SHALL connect to the configured Server_URL via WebSocket
4. WHEN the connection is established, THE CLI SHALL send a JoinRoom message (type 0x02) with the fields: `roomId` (Room_ID), `name` (Display_Name), `password` (empty string `""`)
5. WHEN the server responds with RoomJoined (type 0x11), THE CLI SHALL display the list of current room members with their names and colors
6. WHEN the member list is displayed, THE CLI SHALL enter chat mode (waiting for messages and user input)
7. IF the server responds with error code E001 (room not found), THEN THE CLI SHALL print "Room not found" to stderr and exit
8. IF the server responds with error code E002 (room full), THEN THE CLI SHALL print "Room is full" to stderr and exit
9. IF the server responds with error code E006 (incorrect password), THEN THE CLI SHALL print "Incorrect room password" to stderr and exit

### Requirement 3: Share Code Parsing

**User Story:** As a developer, I want the CLI to correctly parse share codes from the web client, so that I can seamlessly join rooms created by either client.

#### Acceptance Criteria

1. THE CLI SHALL parse share codes in the format `{roomId}:{base64url(roomKey)}` (two-segment, non-ephemeral)
2. THE CLI SHALL parse share codes in the format `{roomId}:{base64url(roomKey)}:{ephemeral}` (three-segment, ephemeral mode)
3. WHEN parsing a share code, THE CLI SHALL decode the base64url-encoded key segment into a 32-byte raw key (no padding variant)
4. FOR ALL valid share codes produced by the web client, parsing then re-encoding the share code SHALL produce an equivalent string (round-trip property)

### Requirement 4: Message Encryption & Sending

**User Story:** As a developer, I want my messages encrypted with AES-256-GCM before transmission, so that the server cannot read message content.

#### Acceptance Criteria

1. WHEN the user submits a message, THE CLI SHALL wrap the text in JSON format `{"text": "<content>"}` (Message_Payload format, compatible with web client)
2. WHEN the payload is constructed, THE CLI SHALL generate a random 12-byte IV using `crypto/rand`
3. WHEN the IV is generated, THE CLI SHALL encrypt the JSON payload using AES-256-GCM with the Room_Key and IV
4. WHEN encryption succeeds, THE CLI SHALL send a SendMessage (type 0x03) containing the base64url-encoded IV and base64url-encoded ciphertext
5. WHEN the message is sent successfully, THE CLI SHALL immediately display the message locally with the user's own Display_Name and a timestamp (server does not echo back)
6. THE CLI SHALL use a unique IV for every encryption operation to prevent IV reuse under the same key
7. IF encryption fails due to an internal error, THEN THE CLI SHALL print an error message to stderr without sending any data to the server

### Requirement 5: Message Decryption & Display

**User Story:** As a developer, I want to receive and decrypt messages from other room members, so that I can read the conversation in real time.

#### Acceptance Criteria

1. WHEN the CLI receives a RelayMessage (type 0x14), THE CLI SHALL decode the base64url IV and ciphertext from the message data
2. WHEN the IV and ciphertext are decoded, THE CLI SHALL decrypt the ciphertext using AES-256-GCM with the Room_Key and IV
3. WHEN decryption succeeds, THE CLI SHALL parse the plaintext as JSON and extract the `text` field from the Message_Payload
4. IF JSON parsing fails or the `text` field is missing, THE CLI SHALL treat the entire plaintext as the message text (backward compatibility with older clients)
5. WHEN the message text is extracted, THE CLI SHALL display it with the sender's name, color, and the server-provided timestamp
6. IF decryption fails (authentication tag mismatch), THEN THE CLI SHALL display a warning indicator `[⚠ decryption failed]` instead of the message content without crashing

### Requirement 6: Terminal Display

**User Story:** As a developer, I want colored and formatted terminal output, so that I can easily distinguish between different senders and system events.

#### Acceptance Criteria

1. WHEN displaying a received message, THE CLI SHALL render the sender's name using the color assigned by the server (hex color → nearest ANSI 256-color)
2. WHEN a member joins the room (MemberJoined, type 0x12), THE CLI SHALL display a system message indicating the new member's name
3. WHEN a member leaves the room (MemberLeft, type 0x13), THE CLI SHALL display a system message indicating the departed member's name
4. WHEN the room is closed (RoomClosed, type 0x16), THE CLI SHALL display a system message "Room closed" and exit gracefully with status code 0
5. THE CLI SHALL visually distinguish system messages from user messages (e.g., dimmed color or `***` prefix)
6. THE CLI SHALL display a timestamp in `HH:MM` format alongside each message
7. THE CLI SHALL detect terminal color support and fall back to plain text formatting when ANSI escape codes are not supported (e.g., Windows cmd.exe without virtual terminal processing)

### Requirement 7: Message Input

**User Story:** As a developer, I want to type and send messages from the terminal, so that I can participate in the conversation.

#### Acceptance Criteria

1. WHILE the user is in chat mode, THE CLI SHALL read text input from stdin line by line
2. WHEN the user presses Enter with non-empty input, THE CLI SHALL encrypt and send the message to the room
3. WHEN the user presses Enter with empty input, THE CLI SHALL ignore the input without sending a message
4. THE CLI SHALL support multi-byte UTF-8 characters in message input and display
5. THE CLI SHALL enforce a maximum message length of 500 characters (matching web client limit)
6. WHEN the user types `/quit` or `/exit`, THE CLI SHALL leave the room and exit (alternative to Ctrl+C)

### Requirement 8: WebSocket Connection Management

**User Story:** As a developer, I want the CLI to maintain a stable WebSocket connection, so that I can have uninterrupted conversations.

#### Acceptance Criteria

1. WHEN the CLI receives a Ping message (type 0x18) from the server, THE CLI SHALL respond with a Pong message (type 0x06) containing the same timestamp
2. WHILE connected, THE CLI SHALL respond to WebSocket-level ping frames to maintain the connection (gorilla/websocket handles this automatically with SetPingHandler)
3. IF the WebSocket connection drops unexpectedly, THEN THE CLI SHALL display a disconnection message to stderr and exit with a non-zero status code
4. WHEN the user presses Ctrl+C (SIGINT) or Ctrl+D (EOF), THE CLI SHALL send a LeaveRoom message (type 0x04), close the WebSocket connection, and exit with status code 0
5. THE CLI SHALL silently ignore message types that are not handled: MemberTyping (0x15), RelayFileMeta (0x1A), RelayFileChunk (0x1B), RelayFileComplete (0x1C), RelayFileCancel (0x1D), RelayFileAck (0x1E)

### Requirement 9: Server Configuration

**User Story:** As a developer, I want to configure which Arthas server the CLI connects to, so that I can use it with self-hosted instances.

#### Acceptance Criteria

1. THE CLI SHALL accept a `--server` flag to specify the Server_URL (e.g., `--server wss://chat.example.com/ws`)
2. THE CLI SHALL accept the `ARTHAS_SERVER` environment variable as an alternative to the `--server` flag
3. WHEN both `--server` flag and `ARTHAS_SERVER` env var are set, the flag SHALL take precedence
4. WHEN neither is provided, THE CLI SHALL use a default Server_URL value (the public Arthas instance)
5. THE CLI SHALL accept a `--name` flag to specify the Display_Name
6. WHEN no `--name` flag is provided, THE CLI SHALL prompt the user to enter a Display_Name interactively before connecting
7. IF the Display_Name exceeds 20 characters or is empty, THEN THE CLI SHALL print a validation error and exit

### Requirement 10: MessagePack Protocol Compatibility

**User Story:** As a developer, I want the CLI to use the same binary protocol as the web client, so that it is fully compatible with existing Arthas servers.

#### Acceptance Criteria

1. THE CLI SHALL serialize all outgoing messages using MessagePack with the envelope format `{type: uint8, data: object}`
2. THE CLI SHALL deserialize all incoming messages from MessagePack binary format
3. WHEN encoding a SendMessage, THE CLI SHALL encode IV and ciphertext as MessagePack string type (base64url encoded, matching web client behavior)
4. WHEN decoding numeric fields from MessagePack, THE CLI SHALL handle variable integer widths (int8/uint8/int16/uint16/int64) using a `toInt()` helper (known msgpack pitfall documented in project steering)
5. FOR ALL message types defined in the protocol specification, encoding then decoding a message SHALL produce an equivalent structure (round-trip property)

### Requirement 11: Binary Distribution

**User Story:** As a developer, I want the CLI to be a single self-contained binary, so that I can install it without managing dependencies.

#### Acceptance Criteria

1. THE CLI SHALL compile to a single static binary with no external runtime dependencies
2. THE CLI SHALL be buildable for Linux (amd64, arm64), macOS (amd64, arm64), and Windows (amd64) targets
3. THE CLI SHALL display version information when run with `--version` flag
4. THE CLI SHALL display usage help when run with `--help` flag or with invalid arguments
5. THE CLI binary SHALL be named `arthas-cli` (or `arthas-cli.exe` on Windows)

## Out of Scope (MVP)

The following features are explicitly excluded from the initial implementation:

- **File transfer** — Complex chunked encryption, not practical in terminal
- **Reactions/replies** — Terminal UX doesn't benefit from these
- **Typing indicators** — Not useful in line-based terminal input
- **Password-protected rooms** — Can be added later; CLI sends empty password for now
- **Ephemeral mode display** — Messages disappear when terminal closes anyway
- **Automatic reconnection** — CLI exits on disconnect (user can re-run the command)
- **Message history** — Arthas is ephemeral by design; no persistence
- **SendReaction (0x07)** — Not implemented; RelayReaction messages are silently ignored
