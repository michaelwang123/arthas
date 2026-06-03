# Implementation Plan: Arthas Chrome Extension

## Overview

Build a Manifest V3 Chrome Extension (`arthas-extension/`) providing E2EE chat in a popup window. The implementation follows a bottom-up approach: project scaffolding → build verification → core utilities → crypto layer → network layer → state management → service worker → UI components → pages → integration testing. TypeScript strict mode throughout, with property-based tests (fast-check) validating correctness properties from the design.

## Tasks

- [x] 1. Set up project structure and build tooling
  - [x] 1.1 Initialize `arthas-extension/` package with dependencies
    - Create `arthas-extension/package.json` with React 18, Zustand, `@msgpack/msgpack`, Vite, `@crxjs/vite-plugin`, Tailwind CSS, Vitest, fast-check, TypeScript
    - Include `@types/chrome` in devDependencies for TypeScript strict mode compatibility
    - Create `tsconfig.json` with strict mode enabled, no `any`, ES2022 target
    - Create `vite.config.ts` with `@crxjs/vite-plugin` pointing to `manifest.json`
    - Create `tailwind.config.ts` with dark theme (gray-900 background, gray-100 text, blue/purple accents)
    - Create `postcss.config.js` for Tailwind
    - **Risk mitigation:** If `@crxjs/vite-plugin` fails with Vite 5+, fall back to `vite-plugin-web-extension` or pin Vite to 4.x
    - _Requirements: 1.1, 1.2, 1.5_

  - [x] 1.2 Create Manifest V3 configuration
    - Create `manifest.json` with permissions: `storage`, host_permissions: `ws://*/*`, `wss://*/*`
    - Declare service worker background script (module type)
    - Set `content_security_policy` restricting script-src to `'self'` only
    - Set popup action pointing to `src/popup/index.html`
    - _Requirements: 1.3, 1.4, 1.7_

  - [x] 1.3 Create popup HTML shell and React entry point
    - Create `src/popup/index.html` (minimal HTML shell, 400×600 viewport)
    - Create `src/popup/main.tsx` (React 18 createRoot mount)
    - Create `src/popup/App.tsx` (root component placeholder with routing logic)
    - Create `public/icons/` directory with actual PNG icon files (16×16, 48×48, 128×128) — use a simple colored shield/lock icon generated via canvas script or placeholder tool. Chrome requires valid PNG files to load the extension.
    - _Requirements: 8.1_

  - [x] 1.4 Configure test environment
    - Configure Vitest with `environment: 'happy-dom'` for Web Crypto API (`crypto.subtle`) support
    - Create `tests/setup.ts` with chrome.* API mocks (`chrome.storage.session`, `chrome.storage.local`, `chrome.runtime`, `chrome.action`)
    - Add `setupFiles` reference in `vite.config.ts` test section
    - Verify `crypto.subtle.generateKey` works in test environment
    - _Requirements: NFR-1 (testability prerequisite)_

  - [x] 1.5 Verify build, dev workflow, and extension loading
    - Run `npm install` and verify no dependency conflicts
    - Run `npm run build` and verify `dist/` directory is produced with valid extension structure
    - Run `npm run dev` and verify Vite dev server starts with HMR enabled — confirm the extension loads in Chrome dev mode and hot-reloads on source changes
    - Verify the built extension can be loaded in Chrome via `chrome://extensions` (developer mode)
    - If `@crxjs/vite-plugin` fails, switch to `vite-plugin-web-extension` and re-verify
    - _Requirements: 1.5, NFR-3_

  - [x] 1.6 Update .gitignore
    - Add `arthas-extension/node_modules/` and `arthas-extension/dist/` to repository `.gitignore`
    - _Requirements: NFR-6 (zero impact on existing packages)_

- [x] 2. Implement core utilities
  - [x] 2.1 Implement base64url utilities (`src/crypto/utils.ts`)
    - Implement `toBase64Url(buffer: ArrayBuffer): string`
    - Implement `fromBase64Url(encoded: string): ArrayBuffer`
    - Use standard base64 with URL-safe character substitution (no padding)
    - Reference: `arthas-client/src/crypto/utils.ts`
    - _Requirements: 5.1, 5.3, 6.2_

  - [x] 2.2 Implement storage wrappers (`src/utils/storage.ts`)
    - Implement `saveSession`, `loadSession`, `clearSession`, `hasSession` for `chrome.storage.session`
    - Implement `saveSettings`, `loadSettings` for `chrome.storage.local`
    - Implement `validateServerUrl(url: string): boolean` — must start with `ws://` or `wss://` and end with `/ws`
    - Type all interfaces: `SessionState`, `LocalSettings`
    - _Requirements: 11.2, 11.4, 13.1_

  - [x] 2.3 Write property test for server URL validation
    - **Property 12: Server URL Validation**
    - Test that validator returns true iff url starts with `ws://` or `wss://` AND ends with `/ws`
    - Use fast-check string generators with valid/invalid URL patterns
    - **Validates: Requirements 11.4**

  - [x] 2.4 Implement rate limiter (`src/utils/rateLimit.ts`)
    - Implement sliding window rate limiter: 10 messages per 10-second window
    - Expose `canSend(): boolean` and `recordSend(): void` functions
    - Evict timestamps older than 10 seconds from the window
    - _Requirements: 5.5_

  - [x] 2.5 Write property test for rate limiter
    - **Property 6: Rate Limiter Invariant**
    - Test that exactly the first 10 attempts within a 10-second window are allowed, subsequent rejected
    - Use fast-check to generate sequences of timestamps
    - **Validates: Requirements 5.5**

  - [x] 2.6 Implement payload utilities (`src/utils/payload.ts`)
    - Implement `buildPayload(text: string, reply?: ReplyData | null): string` — wraps text in JSON format `{text, reply?, sig?, type?, pubkey?}`
    - Implement `parsePayload(plaintext: string): { text: string; reply?: ReplyData }` — extracts text from JSON, falls back to raw string for non-JSON
    - Reference: `arthas-client/src/utils/payload.ts`
    - _Requirements: 5.3, 6.2_

  - [x] 2.7 Write property test for payload round-trip
    - **Property 14: Payload Format Round-Trip**
    - Test that `parsePayload(buildPayload(text)).text === text` for any valid UTF-8 string (1–500 chars)
    - Reference: `arthas-client/src/utils/payload.property.test.ts`
    - **Validates: Requirements 5.3, 6.2**

  - [x] 2.8 Implement message ID utilities (`src/utils/messageId.ts`)
    - Implement `generateMessageId(): string` — locally-unique ID for React keys
    - Implement `makeStableId(senderId: string, timestamp: number): string` — format `{senderId}:{timestamp}`
    - _Requirements: 6.3_

- [x] 3. Checkpoint - Verify utilities
  - Run `npm run test` — ensure all utility tests pass
  - Run `npm run build` — ensure no TypeScript errors
  - Ask the user if questions arise.

- [x] 4. Implement crypto layer
  - [x] 4.1 Implement key management (`src/crypto/keys.ts`)
    - Implement `generateRoomKey(): Promise<CryptoKey>` — AES-256-GCM via Web Crypto API
    - Implement `exportRoomKey(key: CryptoKey): Promise<string>` — export to base64url
    - Implement `importRoomKey(encoded: string): Promise<CryptoKey>` — import from base64url
    - Reference: `arthas-client/src/crypto/keys.ts`
    - _Requirements: 3.1, 4.3_

  - [x] 4.2 Write property test for key export/import round-trip
    - **Property 3: Key Export/Import Round-Trip**
    - Test that exporting then importing a generated key produces a functionally equivalent key (encrypt/decrypt test)
    - **Validates: Requirements 4.3**

  - [x] 4.3 Implement message encryption (`src/crypto/encrypt.ts`)
    - Implement `encryptMessage(key: CryptoKey, plaintext: string): Promise<{iv: string, ciphertext: string}>`
    - Generate random 96-bit IV via `crypto.getRandomValues`
    - Encrypt UTF-8 encoded plaintext with AES-256-GCM
    - Return base64url-encoded IV and ciphertext
    - Reference: `arthas-client/src/crypto/encrypt.ts`
    - _Requirements: 5.1, 5.2_

  - [x] 4.4 Implement message decryption (`src/crypto/decrypt.ts`)
    - Implement `decryptMessage(key: CryptoKey, iv: string, ciphertext: string): Promise<string>`
    - Decode base64url IV and ciphertext, decrypt with AES-256-GCM, return UTF-8 plaintext
    - Reference: `arthas-client/src/crypto/decrypt.ts`
    - _Requirements: 6.2_

  - [x] 4.5 Write property test for encryption round-trip
    - **Property 2: Encryption Round-Trip**
    - Test that encrypting then decrypting any UTF-8 string (1–500 chars) with the same key produces the original
    - **Validates: Requirements 5.2, 6.2**

  - [x] 4.6 Implement share code encoding/decoding (`src/crypto/shareKey.ts`)
    - Implement `encodeShareKey(roomId, key, ephemeral?, expiresAt?): Promise<string>` — colon-separated format
    - Implement `decodeShareKey(code: string): ShareCodeComponents | null` — supports 2–4 segment formats
    - Validate: segments count 2–4, roomId length 21, keyEncoded length 43, ephemeral/expiresAt are valid non-negative integers
    - Return null for malformed input
    - Reference: `arthas-client/src/crypto/shareKey.ts`
    - _Requirements: 3.4, 4.1, 4.2_

  - [x] 4.7 Write property test for share code round-trip
    - **Property 4: Share Code Round-Trip**
    - Test that encoding then decoding produces matching roomId, keyEncoded length 43, matching ephemeral and expiresAt
    - Reference: `arthas-client/src/crypto/shareKey.property.test.ts`
    - **Validates: Requirements 3.4, 4.1**

  - [x] 4.8 Write property test for share code validation
    - **Property 5: Share Code Validation Rejects Malformed Input**
    - Test that malformed strings (wrong segment count, wrong lengths, invalid integers) return null
    - **Validates: Requirements 4.2**

  - [x] 4.9 Implement typing encryption (`src/crypto/typingEncrypt.ts`)
    - Implement `encryptTypingStatus(key: CryptoKey, typing: boolean): Promise<{iv: string, ciphertext: string}>`
    - Implement `decryptTypingStatus(key: CryptoKey, iv: string, ciphertext: string): Promise<boolean>`
    - Encrypt/decrypt JSON-encoded boolean for web client interop
    - Reference: `arthas-client/src/crypto/typingEncrypt.ts`
    - _Requirements: 10.1, 10.3_

  - [x] 4.10 Write property test for typing encryption round-trip
    - **Property 13: Typing Encryption Round-Trip**
    - Test that encrypting then decrypting any boolean with the same key produces the original boolean
    - Reference: `arthas-client/src/crypto/typingEncrypt.property.test.ts`
    - **Validates: Requirements 10.1, 10.3**

- [x] 5. Checkpoint - Verify crypto layer
  - Run `npm run test` — ensure all crypto tests pass
  - Run `npm run build` — ensure no TypeScript errors
  - Ask the user if questions arise.

- [x] 6. Implement network layer
  - [x] 6.1 Implement protocol types and constants (`src/network/protocol.ts`)
    - Define all message type constants (0x01–0x18)
    - Define `Message` interface `{type: number, data: unknown}`
    - Define typed data interfaces for each message type (CreateRoom, JoinRoom, SendMessage, etc.)
    - Reference: `arthas-client/src/network/protocol.ts`
    - _Requirements: 15.1, 15.2_

  - [x] 6.2 Implement WebSocket client (`src/network/websocket.ts`)
    - Implement `connect(url: string)`, `disconnect()`, `send(type, data)`, `onMessage(handler)`
    - Implement MessagePack encode/decode for binary frames using `@msgpack/msgpack`
    - Implement exponential backoff reconnection: `min(2^(n-1) × 1000, 30000)` ms
    - Implement `shouldReconnect` flag to distinguish dropped connections from explicit disconnect
    - Track `ConnectionState` with status and consecutiveFailures count
    - Reset backoff on successful reconnection
    - Stop retrying after 5 consecutive failures (status → 'failed')
    - Reference: `arthas-client/src/network/websocket.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 6.3 Write property test for MessagePack codec round-trip
    - **Property 1: MessagePack Codec Round-Trip**
    - Test that encoding then decoding any valid `{type: uint8, data: object}` produces a deeply equal object
    - Use fast-check with random nested structures
    - **Validates: Requirements 2.2, 2.3, 15.1, 15.2, 15.3**

  - [x] 6.4 Write property test for exponential backoff
    - **Property 8: Exponential Backoff Calculation**
    - Test that for any failure count n ≥ 1, delay equals `min(2^(n-1) × 1000, 30000)` ms
    - **Validates: Requirements 2.5**

- [x] 7. Implement i18n system
  - [x] 7.1 Create locale files and i18n hook (`src/i18n/`)
    - Create `src/i18n/locales/en.json`, `zh.json`, `ja.json` with all UI strings
    - Implement `src/i18n/index.ts` with `useTranslation` hook, `detectLanguage()` function, and language state
    - Detect language from `navigator.language` prefix, default to 'en' if no match
    - Persist language choice to `chrome.storage.local`
    - Reference: `arthas-client/src/i18n/index.ts` and `arthas-client/src/i18n/store.ts`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 7.2 Write property test for language detection
    - **Property 11: Language Detection**
    - Test that for any `navigator.language` string, detection returns exactly one of 'en', 'zh', 'ja'
    - **Validates: Requirements 12.3, 12.4, 12.5**

- [x] 8. Implement service worker
  - [x] 8.1 Implement service worker (`src/background/service-worker.ts`)
    - Set `chrome.storage.session.setAccessLevel` to `TRUSTED_AND_UNTRUSTED_CONTEXTS`
    - Implement `chrome.runtime.onMessage` listener for SET_BADGE / CLEAR_BADGE messages
    - Implement `chrome.runtime.onInstalled` listener to set access level and check badge state
    - Implement `chrome.runtime.onStartup` listener to restore badge if session exists
    - Implement port-based popup detection: `chrome.runtime.onConnect` for 'popup' port, clear badge on connect, set badge on disconnect if session active
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 9. Checkpoint - Verify network, i18n, and service worker
  - Run `npm run test` — ensure all tests pass
  - Run `npm run build` — ensure no TypeScript errors
  - Ask the user if questions arise.

- [x] 10. Implement chat store (state management)
  - [x] 10.1 Implement store skeleton and connection management (`src/stores/chatStore.ts`)
    - Implement full `ChatState` interface with connection, room, messages, and typing state
    - Implement `initialize()` — load session from storage, set up WebSocket message handler
    - Implement connection lifecycle: connect, handle Ping→Pong, track connection status (green/yellow/red)
    - Implement `retryConnection()` — manual reconnect after 5 failures
    - Implement `leaveRoom()` — send LeaveRoom, close WebSocket, clear session, clear badge
    - Handle unknown message types silently (no crash, no state change)
    - Reference: `arthas-client/src/stores/chatStore.ts`
    - _Requirements: 2.1, 2.4, 2.8, 14.1–14.4_

  - [x] 10.2 Implement room creation and joining flows
    - Implement `createRoom(name)` — generate key, send CreateRoom, handle RoomCreated/RoomJoined, save session, generate share code
    - Implement `joinRoom(shareCode, name)` — decode share code, validate, import key, send JoinRoom, handle RoomJoined, save session
    - Handle server errors: E001 (room not found), E002 (room full)
    - Implement input validation: nickname 1–20 chars (trimmed)
    - _Requirements: 3.1–3.6, 4.1–4.7_

  - [x] 10.3 Implement message send/receive with encryption
    - Implement `sendMessage(text)` — validate (1–500 chars), rate limit check, wrap with `buildPayload`, encrypt with room key, send SendMessage, add to local messages
    - Implement RelayMessage handler — extract fields, decrypt, parse payload, detect and skip pubkey messages (`parsed.type === "pubkey"`), display in chat
    - Handle decryption failure — show "[Cannot decrypt this message]" placeholder
    - Cap messages array at 200, removing oldest when exceeded
    - _Requirements: 5.1–5.6, 6.1–6.5_

  - [x] 10.4 Implement typing indicators
    - Implement `setTyping(typing)` — encrypt typing status with room key, send Typing message
    - Implement typing version counter for last-write-wins concurrency control (prevents out-of-order sends when rapid typing events overlap with async crypto)
    - Implement 2-second debounce timer for auto-cancel
    - Implement `isCurrentlyTyping` dedup flag to avoid redundant sends
    - Implement MemberTyping handler — decrypt typing status, show/hide indicator, 5-second timeout auto-remove
    - Handle typing decryption failure silently (backward compat with old clients)
    - _Requirements: 10.1–10.4_

  - [x] 10.5 Implement session persistence and auto-rejoin
    - Implement auto-rejoin on popup open: load session → connect → JoinRoom → handle RoomJoined (show "Reconnected" system message)
    - Handle auto-rejoin failure (E001): clear session, show home, display "Room session expired"
    - Implement MemberJoined/MemberLeft handlers — update member list, save to session
    - Implement RoomClosed handler — display notice, clear state, return to home
    - Implement "Session active" indicator logic for home screen
    - _Requirements: 9.1–9.4, 13.1–13.7_

  - [x] 10.6 Write property test for message list bounded at 200
    - **Property 9: Message List Bounded at 200**
    - Test that regardless of how many messages are added, array length never exceeds 200 and contains the most recent messages
    - **Validates: Requirements 6.5**

  - [x] 10.7 Write property test for member list consistency
    - **Property 10: Member List Consistency**
    - Test that MemberJoined increases list by 1 (member present), MemberLeft decreases by 1 (member absent)
    - **Validates: Requirements 9.1, 9.2**

  - [x] 10.8 Write property test for input validation bounds
    - **Property 7: Input Validation Bounds**
    - Test nickname validation: true iff `s.trim().length` is 1–20; message validation: true iff `s.length` is 1–500
    - **Validates: Requirements 3.6, 5.6**

  - [x] 10.9 Write property test for unknown message resilience
    - **Property 15: Unknown Message Type Resilience**
    - Test that messages with type IDs outside 0x10–0x18 do not throw and do not modify chat state
    - **Validates: Graceful degradation for future protocol extensions**

- [x] 11. Checkpoint - Verify chat store
  - Run `npm run test` — ensure all store tests pass
  - Run `npm run build` — ensure no TypeScript errors
  - Ask the user if questions arise.

- [x] 12. Implement UI components
  - [x] 12.1 Implement ConnectionStatus component (`src/components/ConnectionStatus.tsx`)
    - Green dot for connected (healthy), yellow dot + "Reconnecting..." for reconnecting, red dot + "Disconnected" + Retry button for failed
    - Subscribe to chatStore connection status
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 12.2 Implement MessageList component (`src/components/MessageList.tsx`)
    - Scrollable message display with auto-scroll to bottom on new messages
    - Render sender name with assigned color, formatted timestamp, message text
    - Distinguish own messages (right-aligned) from others (left-aligned)
    - Display system messages (join/leave/reconnect) centered
    - Show "[Cannot decrypt this message]" placeholder for failed decryptions
    - _Requirements: 5.4, 6.3, 6.4, 8.4_

  - [x] 12.3 Implement MessageInput component (`src/components/MessageInput.tsx`)
    - Text input with max 500 character counter and send button
    - Disable send when message is empty or exceeds 500 chars
    - Trigger typing indicator on input change (2s debounce for stop)
    - Show rate limit warning when limit reached
    - _Requirements: 5.5, 5.6, 8.5, 10.1, 10.2_

  - [x] 12.4 Implement MemberList component (`src/components/MemberList.tsx`)
    - Expandable compact member list with colored dots and names
    - Show member count in collapsed state
    - _Requirements: 9.4, 9.5_

  - [x] 12.5 Implement ShareCode component (`src/components/ShareCode.tsx`)
    - Display share code with one-click copy button
    - Show copy success feedback
    - _Requirements: 3.5_

  - [x] 12.6 Implement TypingIndicator component (`src/components/TypingIndicator.tsx`)
    - Display typing member names below message list
    - Auto-remove after 5-second timeout
    - _Requirements: 10.3, 10.4_

- [x] 13. Implement pages
  - [x] 13.1 Implement Home page (`src/pages/Home.tsx`)
    - Nickname input (1–20 chars validation)
    - "Create Room" button
    - Share code input + "Join Room" button
    - Settings gear icon link
    - "Session active" indicator with resume/discard options when session exists
    - Prompt to configure server URL if not set
    - _Requirements: 8.2, 11.5, 13.7_

  - [x] 13.2 Implement ChatRoom page (`src/pages/ChatRoom.tsx`)
    - Header with member count, ConnectionStatus, and Leave button
    - MessageList in scrollable area
    - TypingIndicator below messages
    - MessageInput at bottom
    - ShareCode display (collapsible)
    - MemberList (expandable) below header
    - _Requirements: 8.3, 8.4, 8.5_

  - [x] 13.3 Implement Settings page (`src/pages/Settings.tsx`)
    - Server URL input with `wss://your-server.com/ws` placeholder
    - Validate ws:// or wss:// protocol and /ws suffix on save
    - "Test Connection" button that attempts WebSocket handshake and reports success/failure
    - Language switcher (English, 中文, 日本語) with immediate apply
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.6_

- [x] 14. Wire components, finalize, and integration test
  - [x] 14.1 Implement App routing and initialization (`src/popup/App.tsx`)
    - Implement page routing: Home ↔ ChatRoom ↔ Settings based on store state
    - Call `chatStore.initialize()` on mount (load session, auto-rejoin)
    - Connect popup port to service worker for badge lifecycle
    - Apply Tailwind dark theme globally (gray-900 bg, gray-100 text)
    - Set popup dimensions to 400×600px via CSS
    - _Requirements: 2.1, 2.9, 8.1, 8.6, 13.2, 13.3_

  - [x] 14.2 Add global styles and Tailwind setup
    - Create `src/popup/index.css` with Tailwind directives and dark theme base styles
    - Ensure no inline scripts or eval usage (CSP compliance)
    - _Requirements: 8.6, NFR-8_

  - [x] 14.3 Write integration test for full chat flow
    - Test complete flow: create room → generate share code → join room (second user mock) → send message → receive and decrypt → verify display
    - Test session persistence: simulate popup close → reopen → auto-rejoin
    - Test error paths: invalid share code, room not found, decryption failure
    - Reference: `arthas-client/src/stores/chatStore.test.ts` for patterns
    - _Requirements: 3.1–3.5, 4.1–4.5, 5.1–5.4, 6.1–6.4, 13.2–13.4_

- [x] 15. Final checkpoint - Full verification
  - Run `npm run test` — ensure ALL tests pass (unit + property + integration)
  - Run `npm run build` — ensure clean build with no warnings
  - Verify bundle size < 2MB (NFR-3)
  - Load extension in Chrome and verify popup opens within 300ms (NFR-7)
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are property-based tests — they validate correctness properties but do NOT block subsequent implementation tasks in the dependency graph
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation — run tests and build at each checkpoint
- **Reference pattern:** Crypto and network code is adapted from `arthas-client/src/` — reference files are noted in each task. Copy and adapt, do not import directly (NFR-6)
- `@crxjs/vite-plugin` has known Vite 5+ issues — task 1.5 verifies this early. If it fails, switch to `vite-plugin-web-extension`
- All code must pass TypeScript strict mode with no `any` types
- The extension introduces zero changes to existing packages (NFR-6)
- Test environment requires `happy-dom` for Web Crypto API and chrome.* mocks (configured in task 1.4)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"], "description": "Project scaffolding" },
    { "id": 1, "tasks": ["1.4", "1.5", "1.6"], "description": "Build verification, test setup & dev workflow" },
    { "id": 2, "tasks": ["2.1", "2.2", "2.4", "2.6", "2.8", "6.1", "7.1", "8.1"], "description": "Core utilities + protocol types + i18n + service worker (parallel)" },
    { "id": 3, "tasks": ["2.3", "2.5", "2.7", "7.2", "4.1", "4.3", "4.4", "4.6", "4.9"], "description": "Utility property tests (non-blocking) + crypto implementations (parallel)" },
    { "id": 4, "tasks": ["5"], "gate": true, "description": "CHECKPOINT: verify utilities & crypto (npm run test && npm run build)" },
    { "id": 5, "tasks": ["4.2", "4.5", "4.7", "4.8", "4.10", "6.2"], "description": "Crypto property tests + WebSocket client (parallel)" },
    { "id": 6, "tasks": ["9"], "gate": true, "description": "CHECKPOINT: verify network, i18n & service worker (npm run test && npm run build)" },
    { "id": 7, "tasks": ["6.3", "6.4", "10.1", "10.2"], "description": "Network property tests + chat store skeleton & room flows (parallel)" },
    { "id": 8, "tasks": ["10.3", "10.4", "10.5"], "description": "Chat store: messages + typing + session" },
    { "id": 9, "tasks": ["11"], "gate": true, "description": "CHECKPOINT: verify full chat store (npm run test && npm run build)" },
    { "id": 10, "tasks": ["10.6", "10.7", "10.8", "10.9", "12.1", "12.2", "12.3", "12.4", "12.5", "12.6"], "description": "Store property tests (non-blocking) + UI components (parallel)" },
    { "id": 11, "tasks": ["13.1", "13.2", "13.3"], "description": "Pages" },
    { "id": 12, "tasks": ["14.1", "14.2"], "description": "Final wiring" },
    { "id": 13, "tasks": ["14.3"], "description": "Integration test (requires full app wired)" },
    { "id": 14, "tasks": ["15"], "gate": true, "description": "FINAL CHECKPOINT: all tests pass, build clean, bundle < 2MB, popup < 300ms" }
  ]
}
```
