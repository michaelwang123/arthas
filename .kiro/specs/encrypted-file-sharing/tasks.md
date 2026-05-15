# Implementation Plan: Encrypted File Sharing

## Overview

本实现计划将加密文件分享功能分解为增量式编码任务。采用「协议优先 → 服务器中转 → 客户端核心 → UI 集成」的顺序，确保每一步都可验证。客户端使用 TypeScript（React + Zustand），服务器使用 Go。所有代码遵循学习项目规范，包含详细中文注释和 📚 学习要点。

## Tasks

---

### Phase 1: Protocol & Infrastructure Foundation

- [ ] 1. Define protocol message types and core data structures
  - [ ] 1.1 Add file transfer message type constants and data interfaces to client protocol
    - Add 10 new message type constants (0x08-0x0C, 0x1A-0x1E) to `src/network/protocol.ts`
    - Define all Send* and Relay* TypeScript interfaces for file transfer messages
    - Define `ChatFileMessage` interface extending existing chat message type
    - Include JSDoc comments with 📚 学习要点 explaining protocol numbering scheme
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

  - [ ] 1.2 Add file transfer message type constants and data structures to server protocol
    - Add message type constants (MsgSendFileMeta=0x08, etc.) to `internal/network/protocol.go`
    - Define Go structs: SendFileMetaData, SendFileChunkData, SendFileCompleteData, SendFileCancelData, SendFileAckData
    - Define Go structs: RelayFileMetaData, RelayFileChunkData, RelayFileCompleteData, RelayFileCancelData, RelayFileAckData
    - Include GoDoc comments explaining each struct's role in the zero-knowledge relay
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

  - [ ] 1.3 Update protocol documentation
    - Update `official_doc/protocol.md` with file transfer message types (0x08-0x0C, 0x1A-0x1E)
    - Document message flow diagrams, field descriptions, and binary format details
    - _Requirements: 9.1-9.10_

---

### Phase 2: Server-Side Implementation

- [ ] 2. Implement server-side file transfer infrastructure
  - [ ] 2.1 Adjust WebSocket parameters, add SendFileData, and extend Room Member struct
    - Increase `maxMessageSize` from 4096 to 102400 (100KB) in `internal/network/client.go`
    - Increase `ReadBufferSize` and `WriteBufferSize` to 131072 (128KB) in upgrader config
    - Implement `SendFileData(data []byte) bool` method on Client with 5-second timeout blocking send
    - Add `activeTransferID string` and `transferStartAt time.Time` fields to Client struct
    - Add `SendFileFunc func([]byte) bool` field to `internal/room/room.go` Member struct
    - Set `SendFileFunc` in `handleJoinRoom` and `handleCreateRoom` when creating Member (delegates to `client.SendFileData`)
    - Add detailed 📚 学习要点 comments explaining backpressure design and why file transfer needs blocking send
    - _Requirements: 4.6, 4.7, 4.2, 4.9_

  - [ ] 2.2 Implement BroadcastFileData on Room with concurrent sending
    - Add `BroadcastFileData(excludeID string, data []byte)` method to `internal/room/room.go`
    - Use `sync.WaitGroup` + goroutines for concurrent delivery to all members via `SendFileFunc`
    - Log warnings for timed-out receivers without blocking others
    - Include 📚 学习要点 explaining concurrent broadcast vs serial broadcast tradeoffs
    - _Requirements: 4.1, 4.2, 4.4_

  - [ ] 2.3 Implement file transfer lifecycle handlers
    - Add `handleFileMeta` to `hub.go`: validate room membership, check no active transfer (`activeTransferID == ""`), set activeTransferID/transferStartAt, broadcast metadata via `BroadcastFileData`
    - Add `handleFileComplete` to `hub.go`: validate transferId matches activeTransferID, clear activeTransferID, broadcast complete signal
    - Add `handleFileCancel` to `hub.go`: validate transferId, clear activeTransferID, broadcast cancel signal
    - Use `toInt()` helper for all numeric field parsing from msgpack-decoded `map[string]interface{}`
    - _Requirements: 4.1, 4.3, 4.5, 4.8, 4.9_

  - [ ] 2.4 Implement file transfer data relay handlers
    - Add `handleFileChunk` to `hub.go`: validate transferId matches client's activeTransferID, parse index via `toInt()`, broadcast chunk via `BroadcastFileData`
    - Add `handleFileAck` to `hub.go`: validate transferId, find original sender by iterating room members, send ACK only to sender (targeted relay, not broadcast)
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.8_

  - [ ] 2.5 Register file transfer handlers and configure rate limiter exemption
    - Add cases for MsgSendFileMeta (0x08), MsgSendFileChunk (0x09), MsgSendFileComplete (0x0A), MsgSendFileCancel (0x0B), MsgSendFileAck (0x0C) to `Hub.HandleMessage()` switch statement
    - Exempt file transfer message types from the existing `IsRateLimited()` check (file transfer has its own "1 active transfer per client" limit instead)
    - _Requirements: 4.5, 4.9_

  - [ ] 2.6 Implement stale transfer cleanup and disconnect handling
    - In `handleClientDisconnect` (hub.go): if client has activeTransferID, broadcast MSG_RELAY_FILE_CANCEL to room members, then clear activeTransferID
    - Add `cleanupStaleTransfers()` method to Hub: scan all clients, clear transfers older than 90s (serverTransferTimeout)
    - Add 30-second ticker in `Hub.Run()` loop to call `cleanupStaleTransfers()` periodically
    - _Requirements: 6.5, 4.9_

  - [ ] 2.7 Write unit tests for server-side file transfer handlers
    - Test handleFileMeta: valid request broadcasts, non-room-member rejected, active transfer conflict rejected
    - Test handleFileChunk: valid chunk relayed via BroadcastFileData, mismatched transferId rejected, toInt() correctly parses index
    - Test handleFileComplete/Cancel: activeTransferID cleared, broadcast sent to room
    - Test handleFileAck: relayed only to original sender (not broadcast)
    - Test SendFileData: success within timeout returns true, timeout returns false
    - Test BroadcastFileData: slow receiver timeout doesn't block fast receiver delivery
    - Test handleClientDisconnect: active transfer triggers CANCEL broadcast and state cleanup
    - Test cleanupStaleTransfers: transfers older than 90s are cleared
    - _Requirements: 4.1-4.9_

---

### Phase 3: Client Core Modules

- [ ] 3. Implement client-side core modules (file-transfer directory)
  - [ ] 3.0 Setup client test environment
    - Install `vitest` and `@vitest/ui` as devDependencies
    - Install `fast-check` as devDependency for property-based testing
    - Install `@testing-library/react`, `@testing-library/jest-dom`, and `happy-dom` as devDependencies (for UI component tests in Phase 5)
    - Create `vitest.config.ts` with TypeScript support and happy-dom environment
    - Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts to `package.json`
    - Verify setup with a trivial passing test
    - _Requirements: (infrastructure prerequisite for all test tasks)_

  - [ ] 3.1 Create file-transfer module structure, types, ID generator, and chunker
    - Create `src/file-transfer/` directory structure per design document
    - Implement `types.ts` with `FileMetadata`, `TransferState`, `TransferDirection`, `TransferStatus`, `FileTransferState` type definitions (each field with JSDoc comment)
    - Implement `generateTransferId()` in `types.ts`: 21-char NanoID using `crypto.getRandomValues()` with alphabet `A-Za-z0-9_-` (no external dependency, per NFR-8)
    - Implement `chunker.ts` with `streamChunks()` async generator using `File.slice()` for zero-copy streaming
    - Implement `reassembleChunks()` for receiver-side file reconstruction from `(Uint8Array | null)[]` buffer
    - Include 📚 学习要点 explaining File.slice() zero-copy, streaming memory benefits, and NanoID entropy analysis
    - _Requirements: 2.1, 2.2, 5.3, 1.5_

  - [ ]* 3.2 Write property test for chunk split/reassemble round-trip
    - **Property 1: Chunk split/reassemble round-trip**
    - For any ArrayBuffer (1 to 5,242,880 bytes), split into chunks then reassemble produces byte-identical copy
    - Verify all chunks except last are exactly 65,536 bytes
    - Verify total chunks equals `Math.ceil(size / 65536)`
    - **Validates: Requirements 2.1, 2.2, 5.3**

  - [ ] 3.3 Implement chunk-level encryption and decryption
    - Implement `encryptChunk.ts`: AES-256-GCM encryption with random 96-bit IV per chunk, returns `{ iv: Uint8Array, ciphertext: Uint8Array }`
    - Implement `decryptChunk.ts`: AES-256-GCM decryption using provided IV and Room_Key, returns `ArrayBuffer`
    - Reuse patterns from existing `src/crypto/encrypt.ts` and `decrypt.ts` (but operate on ArrayBuffer, not string)
    - Include 📚 学习要点 explaining per-chunk IV strategy, GCM auth tag, and why IV is Uint8Array (not base64url) for chunk performance
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 5.2_

  - [ ]* 3.4 Write property test for chunk encryption round-trip
    - **Property 2: Chunk encryption round-trip**
    - For any ArrayBuffer (1 to 65,536 bytes) and valid AES-256-GCM key, `encryptChunk` then `decryptChunk` produces byte-identical copy
    - **Validates: Requirements 2.5, 2.3, 2.4, 5.2**

  - [ ]* 3.5 Write property test for encrypted chunk structure invariant
    - **Property 3: Encrypted chunk structure invariant**
    - For any plaintext of N bytes, encrypted output has IV of exactly 12 bytes and ciphertext of exactly N + 16 bytes (GCM tag)
    - **Validates: Requirements 2.6, 2.3**

  - [ ] 3.6 Implement file name sanitization
    - Implement `sanitize.ts` with `sanitizeFileName(name: string): string` function
    - Remove path separators (`/` and `\`), null bytes (`\0`), limit length to 255 characters
    - Implement `getFileTypeIcon(mimeType: string): string` returning appropriate emoji (🖼️/📄/📦/📁)
    - Include 📚 学习要点 explaining path traversal attack prevention
    - _Requirements: 5.10, 1.4, 12.6_

  - [ ]* 3.7 Write property test for file name sanitization
    - **Property 5: File name sanitization**
    - For any string input: output contains no `/`, no `\`, no null byte, length ≤ 255, and function is idempotent
    - **Validates: Requirements 5.10**

  - [ ]* 3.8 Write property test for file size validation
    - **Property 9: File size validation**
    - Accept files where `size > 0 && size <= 5,242,880`; reject otherwise
    - Boundary value 5,242,880 accepted, 5,242,881 rejected
    - **Validates: Requirements 1.1**

---

### Phase 4: Client State Management & Transfer Engines

- [ ] 4. Implement client-side state management and transfer engines
  - [ ] 4.1 Implement fileTransferStore with Zustand
    - Create `src/file-transfer/fileTransferStore.ts`
    - Implement `FileTransferState` with transfers Map, sendQueue, activeSendId, activeReceiveCount
    - Implement `handleFileMessage(msg: Message)` dispatcher: route MSG_RELAY_FILE_META/CHUNK/COMPLETE/CANCEL/ACK to appropriate handler
    - Implement `initiateTransfer(file: File)`, `cancelTransfer(transferId: string)`, `cleanupTransfer(transferId: string)` actions
    - Implement transfer queue logic: max 3 pending, FIFO processing, sequential sending (1 active at a time)
    - Implement concurrent receive limit (MAX_CONCURRENT_RECEIVES = 5)
    - Include 📚 学习要点 explaining state machine design and why transfers are independent from messages array
    - _Requirements: 3.7, 5.8, 11.3, 11.4, 5.6, 5.11_

  - [ ]* 4.2 Write property test for transfer queue invariant
    - **Property 7: Transfer queue invariant**
    - At most 1 transfer in 'sending' status at any time
    - At most 3 transfers in 'pending' status; excess rejected with error
    - Queue processes in FIFO order
    - **Validates: Requirements 3.7, 4.9, 11.3, 11.4**

  - [ ] 4.3 Implement sender engine — core send flow
    - Create `src/file-transfer/sender.ts`
    - Implement `sendFile(file: File, roomKey: CryptoKey)`: validate size (≤5MB) → generate transferId → encrypt metadata (with optional thumbnail placeholder) → send MSG_SEND_FILE_META → sequentially send encrypted chunks via MSG_SEND_FILE_CHUNK → send MSG_SEND_FILE_COMPLETE
    - Insert `ChatFileMessage` placeholder into chatStore messages array at transfer start (optimistic render)
    - Implement 10ms base inter-chunk delay using `await delay()`
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1-2.6, 3.1-3.6_

  - [ ] 4.4 Implement sender engine — flow control and network awareness
    - Implement adaptive delay based on `WebSocket.bufferedAmount` (access via `getWs()` from websocket.ts)
    - Implement RTT-aware congestion detection: record RTT from ping/pong in sliding window (5 samples), increase delay multiplier when RTT > avg × 1.5, decrease when RTT < avg × 0.8
    - Implement offline detection: listen to `window.offline`/`online` events, pause sending on offline, resume on online if WebSocket still connected, fail after 60s offline
    - Include 📚 学习要点 explaining cooperative flow control, bufferedAmount semantics, and simplified congestion control vs TCP AIMD
    - _Requirements: 3.5, 3.6, 11.1, 11.6, NFR-1, NFR-2_

  - [ ] 4.5 Implement sender engine — cancel, queue management, and large room warning
    - Implement `cancelTransfer(transferId: string)`: stop chunk sending loop, send MSG_SEND_FILE_CANCEL, update transfer status to 'cancelled'
    - Implement queue processing: when active transfer completes/fails/cancels, dequeue next pending transfer and start sending
    - Implement large room warning: if `members.length > 10`, show confirmation dialog "当前房间有 N 位成员，文件将发送给所有人，可能较慢" before initiating transfer
    - _Requirements: 6.1, 6.2, 7.6, 11.3, 11.4, 3.7_

  - [ ] 4.6 Implement receiver engine
    - Create `src/file-transfer/receiver.ts`
    - Implement `handleFileMeta(data, roomKey)`: decrypt metadata, validate fields, prepare `(Uint8Array | null)[]` chunk buffer, insert ChatFileMessage placeholder into chatStore, start 60s timeout timer
    - Implement `handleFileChunk(data, roomKey)`: validate transferId exists (discard unknown), validate index bounds (0 ≤ index < totalChunks), check duplicate (skip if already received), decrypt chunk, store in buffer, update progress, reset timeout timer
    - Implement `handleFileComplete(data)`: verify all chunks received, reassemble file via `reassembleChunks()`, sanitize file name, create Blob URL, send MSG_SEND_FILE_ACK, update status to 'complete'
    - Implement `handleFileCancel(data)`: discard buffer, display "发送方已取消传输", release memory
    - Implement 60-second timeout: if no new chunk received within 60s, mark transfer failed with "传输超时", release buffer
    - Implement buffer size limit: abort if accumulated data exceeds 5MB
    - Implement `handleSenderLeft(senderId: string)` method: find all active receiving transfers from this sender, mark as failed with "发送方已离开，传输中断", release buffers (called by chatStore integration in Task 6.1)
    - _Requirements: 5.1-5.11, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.5, 7.7, 11.1, 11.5, 11.7_

  - [ ]* 4.7 Write property tests for receiver correctness
    - **Property 10: Concurrent transfers independence** — receiving chunk for transfer A does not modify transfer B's state
    - **Property 11: Unknown Transfer_ID discard** — chunk with unknown transferId is silently discarded, no state change
    - **Property 12: Chunk index bounds validation** — index < 0 or index >= totalChunks is silently discarded
    - **Property 14: Duplicate chunk idempotency** — receiving same chunk index twice does not increment receivedChunks
    - **Validates: Requirements 5.8, 11.7, 5.6**

  - [ ]* 4.8 Write property test for progress calculation
    - **Property 8: Progress calculation correctness**
    - Progress = `Math.floor(receivedChunks / totalChunks * 100)`, always in [0, 100]
    - Speed = `bytesTransferred / elapsedSeconds` (KB/s), non-negative
    - ETA = `remainingBytes / speed` (seconds), non-negative or Infinity when speed=0
    - **Validates: Requirements 7.1, 7.4, 7.5**

---

### Phase 5: UI Components

- [ ] 5. Implement client-side UI components
  - [ ] 5.1 Implement FileMessage bubble component
    - Create `src/file-transfer/components/FileMessage.tsx`
    - Display file type icon (via `getFileTypeIcon()`), file name (truncated), file size (human-readable), transfer status
    - Subscribe to `fileTransferStore` for real-time progress updates via transferId (use Zustand selector for performance)
    - Show cancel button during active send transfer (sender side)
    - Show download button (⬇️) when transfer complete (receiver side)
    - Implement download via `URL.createObjectURL()` + `<a download>` with sanitized original file name
    - Revoke Blob URL via `URL.revokeObjectURL()` after download completes or when component unmounts
    - Show delivery status "已送达 (N/M)" for sender when ACKs arrive
    - Include `aria-live="polite"` region for status change announcements
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 6.1, 7.3, 7.7, NFR-7_

  - [ ] 5.2 Implement ProgressBar component
    - Create `src/file-transfer/components/ProgressBar.tsx`
    - Display progress percentage bar, transfer speed (KB/s), and estimated remaining time
    - Implement chunk arrival pulse micro-animation (CSS `animate-pulse-once` class, single pulse per chunk)
    - Respect `prefers-reduced-motion` media query (disable animation when reduced motion preferred)
    - Include proper ARIA attributes: `role="progressbar"`, `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-label`
    - Use Tailwind CSS dark theme classes consistent with existing design
    - _Requirements: 7.1, 7.2, 7.4, 7.5, NFR-11, NFR-12, NFR-13_

  - [ ] 5.3 Implement FileAttachButton and DropZone components
    - Create `src/file-transfer/components/FileAttachButton.tsx`: 📎 icon button positioned left of send button, triggers hidden `<input type="file">`, keyboard accessible (Enter/Space), touch target ≥ 44px
    - Create `src/file-transfer/components/DropZone.tsx`: full-screen overlay on dragenter/dragover with "拖放文件到此处" text, detect touch devices via `'ontouchstart' in window` and disable drag-drop on mobile
    - Implement clipboard paste handler: listen for `paste` event on chat area, detect `clipboardData.files` with image MIME type, create File named `clipboard-{timestamp}.png`
    - _Requirements: 1.6, 1.7, 12.1, 12.7, 12.8, NFR-12_

  - [ ]* 5.4 Write unit tests for UI components
    - Test FileMessage renders correct icons for different MIME types (image/png → 🖼️, application/pdf → 📄, application/zip → 📦)
    - Test ProgressBar aria-valuenow updates when progress changes
    - Test DropZone overlay not rendered on touch devices
    - Test FileAttachButton triggers file input on click and keyboard Enter
    - Test download button creates and revokes Blob URL
    - Test cancel button calls `cancelTransfer(transferId)`
    - _Requirements: 12.1-12.8_

---

### Phase 6: Integration & Wiring

- [ ] 6. Wire everything together — integration and message routing
  - [ ] 6.1 Integrate file transfer message routing in chatStore
    - Add file transfer message cases (MSG_RELAY_FILE_META through MSG_RELAY_FILE_ACK, 0x1A-0x1E) to `chatStore.ts` `handleServerMessage` switch
    - Import `useFileTransferStore` and delegate: `useFileTransferStore.getState().handleFileMessage(msg)`
    - In MSG_MEMBER_LEFT handler: also call `useFileTransferStore.getState().handleSenderLeft(data.id)` to fail related transfers
    - In MSG_ROOM_CLOSED handler: also call `useFileTransferStore.getState().abortAllTransfers()` to clean up
    - _Requirements: 5.1, 6.5, 6.6, 5.11_

  - [ ] 6.2 Modify MessageInput to include file attachment button and paste handler
    - Import and render `FileAttachButton` to the left of the send button in `src/components/MessageInput.tsx`
    - Add `onPaste` event handler to the input/textarea: detect image clipboard data, call `useFileTransferStore.getState().initiateTransfer(file)`
    - Ensure file transfer initiation does not block text message sending (non-blocking, async)
    - _Requirements: 1.6, 3.5, 12.1, 12.8_

  - [ ] 6.3 Modify MessageList to render FileMessage for file-type messages
    - In `src/components/MessageList.tsx` (or MessageBubble): detect messages with `type === 'file'` field
    - Render `FileMessage` component with `transferId` prop instead of normal text bubble
    - Wrap chat area with `DropZone` component (renders overlay on drag events)
    - _Requirements: 12.2, 12.4, 12.7_

  - [ ]* 6.4 Write integration tests for end-to-end file transfer flow
    - Test complete flow: initiate → send meta → send chunks → complete → ACK
    - Test cancel during transfer: sender cancels → receiver gets cancel → buffer released
    - Test timeout: no chunks for 60s → transfer marked failed
    - Test WebSocket disconnect: both sender and receiver transfers marked failed
    - Test message routing: relay messages correctly dispatched to fileTransferStore
    - _Requirements: 3.1-3.7, 5.1-5.9, 6.1-6.6, 11.1_

---

### Phase 7: Advanced Features

- [ ] 7. Implement thumbnail generation, ephemeral mode, and state persistence
  - [ ] 7.1 Implement thumbnail generator
    - Create `src/file-transfer/thumbnail.ts`
    - Implement `generateThumbnail(file: File): Promise<Uint8Array | null>`: use Canvas API, scale to max 300px dimension, output JPEG with quality iteratively reduced to keep ≤ 50KB
    - Handle animated GIF: draw only first frame to canvas (static thumbnail)
    - Return null for non-image files (check MIME type: image/png, image/jpeg, image/gif, image/webp)
    - Include 📚 学习要点 explaining Canvas API image processing and quality/size tradeoff
    - _Requirements: 8.1, 8.2, 8.5, NFR-3_

  - [ ] 7.2 Implement inline thumbnail preview in FileMessage
    - In sender flow (task 4.3): call `generateThumbnail()` before sending metadata, encrypt thumbnail with Room_Key, include in FileMetadata
    - In FileMessage component: if transfer has thumbnail data, decrypt and display as `<img>` immediately (before full transfer completes)
    - On thumbnail click: if transfer complete → trigger full file download; if in progress → show progress overlay
    - _Requirements: 8.3, 8.4_

  - [ ]* 7.3 Write property test for thumbnail constraints
    - **Property 6: Thumbnail dimension and size constraints**
    - For any image file up to 5MB: output max dimension ≤ 300px, output size ≤ 51200 bytes (50KB), output is valid JPEG
    - **Validates: Requirements 8.1**

  - [ ] 7.4 Integrate with ephemeral mode
    - Start ephemeral countdown timer from transfer completion (not from message appearance)
    - If transfer still in progress when ephemeral timeout fires: abort transfer, release buffer memory, then remove message bubble
    - Already-downloaded files on user's device are not affected by ephemeral removal
    - Revoke Blob URL when message bubble is removed by ephemeral timer
    - _Requirements: 10.1, 10.2, 10.3, 10.4, NFR-7_

  - [ ] 7.5 Implement transfer state persistence with sessionStorage
    - Create `src/file-transfer/persistence.ts`
    - Persist active transfer metadata (transferId, fileName, fileSize, status, direction — NOT chunk buffers) to sessionStorage on state changes (debounced 500ms via `setTimeout`)
    - On page load: read sessionStorage, restore transfers as 'failed' status with error "页面刷新，传输已中断"
    - Clear sessionStorage entry after restoration
    - Include 📚 学习要点 explaining why chunks are not persisted (memory + no resume support) and debounce strategy
    - _Requirements: 5.11, 11.6_

  - [ ]* 7.6 Write unit tests for ephemeral and persistence
    - Test ephemeral timer starts only after transfer status becomes 'complete'
    - Test in-progress transfer aborted and buffer released on ephemeral expiry
    - Test sessionStorage persist/restore cycle preserves metadata correctly
    - Test restored transfers are marked as 'failed' with appropriate error message
    - _Requirements: 10.1-10.4_

## Notes

- Tasks marked with `*` are property/unit test tasks that validate correctness but can be deferred for faster MVP iteration
- Task 2.7 (server tests) is NOT optional — server handlers are security-critical (room membership validation, transfer state management)
- Each task references specific requirements from requirements.md for traceability
- Property tests use `fast-check` library for random input generation
- Client code: TypeScript (React + Zustand + Tailwind CSS dark theme)
- Server code: Go (standard testing + testing/quick for property tests, existing gorilla/websocket + vmihailenco/msgpack/v5)
- All code must include detailed Chinese comments and 📚 学习要点 per project conventions (see `.kiro/steering/code-quality.md`)
- No new runtime dependencies (vitest + fast-check + @testing-library as devDependencies only, per NFR-8)
- Use `toInt()` helper for all server-side numeric field parsing from msgpack data (prevents int8/uint8 type assertion bug)
- Client NanoID implementation uses `crypto.getRandomValues()` — no external nanoid package needed

### Manual Verification (after Phase 6)

Phase 6 完成后建议进行手动 E2E 验证：
1. 打开两个浏览器标签页，分别加入同一房间
2. 标签页 A 发送一个 <1MB 的图片文件
3. 验证标签页 B 能看到进度条、缩略图预览（Phase 7 后）、下载按钮
4. 验证下载的文件与原始文件字节一致
5. 测试取消：发送一个 5MB 文件，中途点击取消，验证接收方显示"发送方已取消传输"

### Memory Management Notes

- Blob URL 清理依赖 React 组件卸载生命周期（`useEffect` cleanup return）
- `leaveRoom()` 清空 messages 数组 → FileMessage 组件 unmount → `useEffect` cleanup 调用 `URL.revokeObjectURL()` → Blob URL 释放
- 如果用户在不离开房间的情况下消息被 MAX_MESSAGES=200 溢出淘汰，同样触发 unmount → Blob URL 释放
- Ephemeral 模式下消息消失也触发相同的清理路径

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "3.0"] },
    { "id": 1, "tasks": ["2.1", "3.3", "3.6"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["2.3", "2.4", "3.2", "3.4", "3.5", "3.7", "3.8"] },
    { "id": 4, "tasks": ["2.5", "2.6", "4.1"] },
    { "id": 5, "tasks": ["2.7", "4.2", "4.3"] },
    { "id": 6, "tasks": ["4.4", "4.5", "4.6"] },
    { "id": 7, "tasks": ["4.7", "4.8", "5.1", "5.2", "5.3"] },
    { "id": 8, "tasks": ["5.4", "6.1", "6.2", "6.3"] },
    { "id": 9, "tasks": ["6.4", "7.1"] },
    { "id": 10, "tasks": ["7.2", "7.3", "7.4", "7.5"] },
    { "id": 11, "tasks": ["7.6"] }
  ]
}
```
