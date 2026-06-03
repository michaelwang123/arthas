# Requirements: Arthas Chrome Extension

## Introduction

A Chrome browser extension (Manifest V3) that provides the Arthas E2EE chat experience in a popup window. The extension is an independent package (`arthas-extension/`) with zero changes to existing code. It connects to the same WebSocket relay server and uses the same AES-256-GCM encryption protocol as the web client, providing a convenient always-accessible chat interface directly from the browser toolbar.

## Constraints & Assumptions

1. **Manifest V3 Service Worker Lifecycle:** Chrome terminates idle Service Workers after ~30 seconds of inactivity. The extension CANNOT maintain a persistent WebSocket connection in the background. The WebSocket connection is active only while the popup is open. When the popup closes, the connection drops silently (no LeaveRoom sent). The server cleans up via pongWait timeout (~40 seconds). If the user reopens within that window, they can seamlessly rejoin.
2. **No Persistent Key Storage:** `chrome.storage.local` and `chrome.storage.sync` persist to disk. Room keys must use `chrome.storage.session` (memory-only, cleared on browser close) to avoid key material touching disk.
3. **Chrome Extension CSP:** Manifest V3 prohibits `eval()`, inline scripts, and remote code loading. All code must be bundled at build time.
4. **Notification Privacy:** Chrome desktop notifications are logged in the OS notification center. Decrypted message content MUST NOT appear in notifications. The extension uses badge-only indication for active sessions.
5. **Protocol Sync:** The extension copies crypto/protocol logic from `arthas-client/`. If the web client protocol changes, the extension must be manually updated. No shared package or import relationship exists.
6. **Build Tool:** Use Vite with `@crxjs/vite-plugin` for Chrome extension bundling (handles manifest, HMR in dev, content script injection).
7. **Message Limits:** Consistent with web client — max 500 characters per message, 10 messages per 10 seconds client-side rate limit.
8. **Popup Close Behavior (Strategy B):** Closing the popup does NOT send LeaveRoom. The server's pongWait (40s) handles cleanup. This allows seamless reconnection if the user reopens quickly. Messages sent by others during the gap are lost (server doesn't buffer).

## Glossary

- **Extension**: The Arthas Chrome browser extension built with Manifest V3
- **Popup_UI**: The 400×600 pixel popup window opened by clicking the browser action icon
- **Service_Worker**: The Manifest V3 background script (short-lived, event-driven)
- **Room_Key**: A 256-bit AES-GCM symmetric key shared among room participants for message encryption
- **Share_Code**: A colon-separated string encoding roomId and base64url-encoded Room_Key for room invitation
- **MessagePack_Codec**: The binary serialization layer encoding/decoding message envelopes over WebSocket
- **Relay_Server**: The Go WebSocket server that relays encrypted messages between clients without decryption
- **Session_Storage**: `chrome.storage.session` — memory-only storage that persists across popup open/close but clears on browser restart

## Requirements

### Requirement 1: Extension Package Structure

**User Story:** As a developer, I want the extension to be a self-contained independent package, so that it does not modify or depend on the existing arthas-client build pipeline.

#### Acceptance Criteria

1. THE Extension SHALL reside in an `arthas-extension/` directory at the repository root
2. THE Extension SHALL use its own `package.json` with independent dependencies
3. THE Extension SHALL use a Manifest V3 `manifest.json` declaring permissions: `storage`
4. THE Extension SHALL declare `host_permissions: ["ws://*/*", "wss://*/*"]` for WebSocket connectivity to any server
5. THE Extension SHALL include a Vite build configuration using `@crxjs/vite-plugin` that produces a loadable Chrome extension in a `dist/` directory
6. THE Extension SHALL copy and adapt encryption and protocol logic from `arthas-client/src/crypto/` and `arthas-client/src/network/` as local source files without importing from the web client package
7. THE Extension SHALL include a `content_security_policy` in manifest restricting script sources to `'self'` only

### Requirement 2: WebSocket Connection Management

**User Story:** As a user, I want the extension to connect to the chat server when I open the popup, so that I can send and receive messages in real time.

#### Acceptance Criteria

1. WHEN the Popup_UI is opened and the user has session state (was previously in a room), THE Extension SHALL establish a WebSocket connection to the configured Relay_Server and attempt to rejoin the room
2. THE Extension SHALL encode outgoing messages using MessagePack binary format and send them as WebSocket binary frames
3. THE Extension SHALL decode incoming WebSocket binary frames using MessagePack and dispatch them to the appropriate handler
4. WHEN the Extension receives a Ping message (type 0x18), THE Extension SHALL reply with a Pong message (type 0x06) containing the original timestamp
5. WHEN the WebSocket connection drops while the popup is open, THE Extension SHALL attempt reconnection using exponential backoff starting at 1 second and capping at 30 seconds
6. WHEN reconnection succeeds, THE Extension SHALL reset the backoff interval to 1 second
7. WHEN the user closes the popup, THE Extension SHALL NOT send a LeaveRoom message — the connection is simply dropped, and the server will clean up via pongWait timeout (~40 seconds)
8. WHEN the user explicitly clicks "Leave Room", THE Extension SHALL send a LeaveRoom message (type 0x04), close the WebSocket connection, and clear all session state
9. WHEN the popup is reopened within the server's pongWait window (~40 seconds), THE Extension SHALL seamlessly reconnect and rejoin the same room without user interaction

### Requirement 3: Room Creation

**User Story:** As a user, I want to create a new encrypted chat room from the extension popup, so that I can start a private conversation quickly.

#### Acceptance Criteria

1. WHEN the user submits a nickname (1-20 characters) and selects "Create Room", THE Extension SHALL generate a new AES-256-GCM Room_Key using the Web Crypto API
2. WHEN the Room_Key is generated, THE Extension SHALL send a CreateRoom message (type 0x01) with the user's nickname to the Relay_Server
3. WHEN the Relay_Server responds with RoomCreated (type 0x10) and RoomJoined (type 0x11), THE Extension SHALL store the roomId and member list in Session_Storage, and the Room_Key (exported as base64url) in Session_Storage
4. WHEN the room is created, THE Extension SHALL generate a Share_Code by encoding the roomId and base64url-exported Room_Key separated by a colon
5. THE Extension SHALL display the Share_Code with a one-click copy button for sharing with other participants
6. THE Extension SHALL validate the nickname is 1-20 characters and non-empty before enabling the create button

### Requirement 4: Room Joining

**User Story:** As a user, I want to join an existing room by pasting a share code, so that I can participate in an encrypted conversation.

#### Acceptance Criteria

1. WHEN the user pastes a Share_Code and submits a nickname, THE Extension SHALL decode the Share_Code to extract the roomId and keyEncoded components
2. IF the Share_Code has fewer than 2 colon-separated segments, or the roomId length is not 21 characters, or the keyEncoded length is not 43 characters, THEN THE Extension SHALL display a validation error message
3. WHEN the Share_Code is valid, THE Extension SHALL import the base64url-encoded key as an AES-256-GCM CryptoKey
4. WHEN the CryptoKey is imported, THE Extension SHALL send a JoinRoom message (type 0x02) with the roomId and nickname to the Relay_Server
5. WHEN the Relay_Server responds with RoomJoined (type 0x11), THE Extension SHALL store the roomId, Room_Key, and member list in Session_Storage
6. IF the Relay_Server responds with Error code E001, THEN THE Extension SHALL display "Room not found or closed"
7. IF the Relay_Server responds with Error code E002, THEN THE Extension SHALL display "Room is full (max 50 members)"

### Requirement 5: Message Encryption and Sending

**User Story:** As a user, I want my messages to be end-to-end encrypted before leaving my device, so that the relay server cannot read my conversations.

#### Acceptance Criteria

1. WHEN the user submits a message (1-500 characters), THE Extension SHALL generate a random 96-bit IV using `crypto.getRandomValues`
2. WHEN the IV is generated, THE Extension SHALL encrypt the UTF-8 encoded message plaintext using AES-256-GCM with the Room_Key and IV
3. WHEN encryption completes, THE Extension SHALL send a SendMessage (type 0x03) containing the base64url-encoded IV and base64url-encoded ciphertext to the Relay_Server
4. THE Extension SHALL display the sent message in the chat view with the sender's own nickname and a timestamp
5. THE Extension SHALL enforce a client-side rate limit of 10 messages per 10-second sliding window, displaying a warning when the limit is reached
6. THE Extension SHALL validate message length (1-500 characters) before enabling the send button

### Requirement 6: Message Decryption and Display

**User Story:** As a user, I want to receive and read encrypted messages from other room participants in real time.

#### Acceptance Criteria

1. WHEN the Extension receives a RelayMessage (type 0x14), THE Extension SHALL extract the senderId, senderName, iv, ciphertext, and timestamp fields
2. WHEN a RelayMessage is received, THE Extension SHALL decode the base64url IV and ciphertext, then decrypt using AES-256-GCM with the Room_Key
3. WHEN decryption succeeds, THE Extension SHALL display the decrypted plaintext in the chat view with the sender's name, assigned color, and formatted timestamp
4. IF decryption fails, THEN THE Extension SHALL display a "[Cannot decrypt this message]" placeholder in the chat view
5. THE Extension SHALL maintain a maximum of 200 messages in the chat view, removing the oldest when the limit is exceeded (consistent with web client)

### Requirement 7: Desktop Notifications

**User Story:** As a user, I want to see a badge indicator when I might have missed messages, so that I know to reopen the chat.

#### Acceptance Criteria

1. WHEN the popup is closed and the user has active session state, THE Extension SHALL display a "●" badge on the browser action icon as a reminder that a room session is active
2. WHEN the popup is reopened and the user rejoins the room, THE Extension SHALL clear the badge
3. WHEN the user explicitly leaves a room, THE Extension SHALL clear the badge immediately
4. THE Extension SHALL NOT attempt background WebSocket connections or message polling while the popup is closed (MV3 Service Worker lifecycle makes this unreliable)

> **Design Decision:** Background notifications are intentionally omitted from MVP. The MV3 Service Worker terminates after ~30 seconds of inactivity, making reliable background message delivery impossible without complex workarounds (offscreen documents, keep-alive hacks). The badge serves as a simple "you have an active session" reminder. Real-time notifications require the popup to be open.

### Requirement 8: Popup UI Layout

**User Story:** As a user, I want a compact and usable chat interface in the browser popup, so that I can chat without opening a full browser tab.

#### Acceptance Criteria

1. THE Popup_UI SHALL render at a fixed size of 400 pixels wide by 600 pixels tall
2. THE Popup_UI SHALL display a home screen with nickname input, create room button, join room input (share code), and a settings gear icon
3. WHILE the user is in a room, THE Popup_UI SHALL display a header with member count, connection status indicator, and a leave button
4. WHILE the user is in a room, THE Popup_UI SHALL display a scrollable message list occupying the available vertical space between the header and input area
5. WHILE the user is in a room, THE Popup_UI SHALL display a message input area at the bottom with a text field (max 500 chars counter) and send button
6. THE Popup_UI SHALL use a dark color theme consistent with the Arthas web client aesthetic (gray-900 background, gray-100 text, blue/purple accent colors)
7. THE Popup_UI SHALL set a "●" badge on the browser action icon (via `chrome.action.setBadgeText`) when session state exists and the popup is closed, indicating an active room session. The badge is cleared when the popup is opened or the user leaves the room.

### Requirement 9: Member Presence

**User Story:** As a user, I want to see who is currently in the room, so that I know who can read my messages.

#### Acceptance Criteria

1. WHEN the Extension receives a MemberJoined message (type 0x12), THE Extension SHALL add the new member to the displayed member list with their name and assigned color
2. WHEN the Extension receives a MemberLeft message (type 0x13), THE Extension SHALL remove the member from the displayed member list
3. WHEN the Extension receives a RoomClosed message (type 0x16), THE Extension SHALL display a "Room closed" notice and return the user to the home screen, clearing all room state
4. THE Popup_UI SHALL display the current member count in the room header
5. THE Popup_UI SHALL show a compact member list (expandable) below the header showing colored dots and names

### Requirement 10: Typing Indicators

**User Story:** As a user, I want to see when other participants are typing, so that I know a response is coming.

#### Acceptance Criteria

1. WHEN the user begins typing in the message input, THE Extension SHALL send a Typing message (type 0x05) with `typing: true` to the Relay_Server
2. WHEN the user stops typing for 2 seconds or sends a message, THE Extension SHALL send a Typing message (type 0x05) with `typing: false` to the Relay_Server
3. WHEN the Extension receives a MemberTyping message (type 0x15) with `typing: true`, THE Popup_UI SHALL display a typing indicator showing the member's name below the message list
4. WHEN the Extension receives a MemberTyping message (type 0x15) with `typing: false` or after 5 seconds timeout, THE Popup_UI SHALL remove the typing indicator for that member

### Requirement 11: Configurable Server URL

**User Story:** As a self-hosted user, I want to configure the WebSocket server URL, so that I can use the extension with my own Arthas server instance.

#### Acceptance Criteria

1. THE Extension SHALL provide a settings page accessible from the home screen gear icon
2. THE Extension SHALL store the configured server URL in `chrome.storage.local`
3. THE Extension SHALL default the server URL to empty (requiring user configuration on first use), with a placeholder showing `wss://your-server.com/ws`
4. WHEN the user saves a server URL, THE Extension SHALL validate that it uses `ws://` or `wss://` protocol and ends with `/ws`
5. WHEN no server URL is configured, THE Extension SHALL display a prompt directing the user to settings before allowing room creation/joining
6. THE settings page SHALL include a "Test Connection" button that attempts a WebSocket handshake and reports success/failure

### Requirement 12: Internationalization (i18n)

**User Story:** As a non-English-speaking user, I want the extension UI to be available in my language, so that I can use it comfortably.

#### Acceptance Criteria

1. THE Extension SHALL support three languages: English (en), Chinese Simplified (zh), and Japanese (ja)
2. THE Extension SHALL use a custom JSON-based i18n system (locale JSON files + React state) consistent with the web client's i18n pattern
3. THE Extension SHALL detect the user's preferred language from `navigator.language` on first launch
4. WHEN the detected language prefix matches a supported locale (en, zh, ja), THE Extension SHALL display the UI in that language
5. WHEN the detected language does not match any supported locale, THE Extension SHALL default to English
6. THE Extension SHALL provide a language switcher in the settings page allowing immediate language change without extension reload
7. WHEN the user selects a language manually, THE Extension SHALL persist the choice in `chrome.storage.local` and apply it immediately

### Requirement 13: Session State Management

**User Story:** As a user, I want my room context to persist when I close and reopen the popup within the same browser session, so that I can quickly resume chatting.

#### Acceptance Criteria

1. WHEN the user joins or creates a room, THE Extension SHALL store the roomId, nickname, Room_Key (base64url), and server URL in `chrome.storage.session`
2. WHEN the Popup_UI is opened and session state exists, THE Extension SHALL automatically attempt to rejoin the room (no confirmation prompt — seamless reconnect)
3. WHEN the automatic rejoin succeeds (server responds with RoomJoined), THE Extension SHALL restore the chat view with a "Reconnected" system message and begin receiving new messages
4. IF the automatic rejoin fails (E001 room not found — server cleaned up after pongWait timeout), THE Extension SHALL clear session state, show the home screen, and display "Room session expired" informational message
5. WHEN the browser is closed or restarted, `chrome.storage.session` is automatically cleared — the Room_Key is lost and the user must rejoin with a new share code
6. WHEN the user explicitly clicks "Leave Room", THE Extension SHALL clear all session state immediately
7. THE Extension SHALL display a "Session active" indicator on the home screen if session state exists, allowing the user to either resume or discard the session

### Requirement 14: Connection Status Indicator

**User Story:** As a user, I want to see the current connection status, so that I know whether my messages will be delivered.

#### Acceptance Criteria

1. WHILE the WebSocket connection is established and healthy (received Ping within last 40 seconds), THE Popup_UI SHALL display a green dot indicator in the header
2. WHILE the WebSocket connection is disconnected and reconnection is in progress, THE Popup_UI SHALL display a yellow dot with "Reconnecting..." text
3. WHILE the WebSocket connection has failed after 5 consecutive reconnection attempts, THE Popup_UI SHALL display a red dot with "Disconnected" text and a manual "Retry" button
4. WHEN the connection status changes, THE Popup_UI SHALL update the indicator immediately

### Requirement 15: MessagePack Codec

**User Story:** As a developer, I want the extension to use the same MessagePack binary protocol as the web client, so that it is fully interoperable with all Arthas clients.

#### Acceptance Criteria

1. THE MessagePack_Codec SHALL encode outgoing messages as `{type: uint8, data: object}` envelopes using MessagePack binary serialization
2. THE MessagePack_Codec SHALL decode incoming binary WebSocket frames into `{type: uint8, data: object}` message envelopes
3. FOR ALL valid Message objects, encoding then decoding SHALL produce an equivalent object (round-trip correctness property)
4. THE MessagePack_Codec SHALL use the `@msgpack/msgpack` library (same version as web client)

## Non-Functional Requirements

- **NFR-1** Performance: Message encryption and decryption latency SHALL be under 50ms for messages up to 10KB
- **NFR-2** Memory: The Extension SHALL maintain no more than 200 messages in the chat view to prevent unbounded memory growth
- **NFR-3** Bundle Size: The extension package (unpacked) SHALL be under 2MB total
- **NFR-4** Compatibility: The Extension SHALL support Chrome version 116+ (Manifest V3 + `chrome.storage.session` baseline)
- **NFR-5** Security: The Room_Key SHALL be stored only in `chrome.storage.session` (memory-only, never persisted to disk, cleared on browser close)
- **NFR-6** Zero Impact: The Extension SHALL introduce zero changes to existing `arthas-client/`, `arthas-server/`, or `arthas-cli/` packages
- **NFR-7** Startup: The Popup_UI SHALL render the home screen within 300ms of being opened
- **NFR-8** CSP: The Extension SHALL not use `eval()`, `new Function()`, inline scripts, or remote script loading

## Known Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| MV3 Service Worker terminates after ~30s idle | Cannot maintain background WebSocket | Connection active only while popup is open; auto-rejoin on reopen |
| Messages sent while popup is closed are lost | User misses messages during gap | Badge indicates active session; rejoin is seamless if within 40s |
| Popup closed > 40 seconds = server removes user | Other members see "user left" | Auto-rejoin on reopen (appears as re-join to others) |
| `chrome.storage.session` cleared on browser restart | Room key lost | User must rejoin with share code after browser restart |
| No message history sync | Reopening popup shows empty chat until new messages arrive | Display "Reconnected — previous messages not available" system message |

## Out of Scope (MVP)

- File transfer
- Voice messages
- QR code sharing
- Room password / expiry configuration
- Ed25519 message signing (add in v2)
- Reply & reactions
- Opening chat in a full browser tab
- Firefox / Safari / Edge extension ports
- Chrome Web Store publishing automation
- Offscreen document for persistent WebSocket (complex, defer to v2)
