# Requirements Document

## Introduction

加密文件分享功能允许 Arthas 用户在端到端加密的临时聊天房间内安全地分享文件。文件通过 WebSocket 实时中转给房间内在线成员，服务器不存储任何文件内容（零知识架构）。发送方在客户端对文件进行 AES-256-GCM 加密并分片传输，接收方实时接收分片并解密还原。支持图片内联预览（加密缩略图）、下载进度显示、拖拽上传和剪贴板粘贴。

> **📚 学习项目说明：** Arthas 是一个学习项目，代码实现应遵循最佳工程实践，同时所有代码必须带有详细的中文注释，解释设计决策、算法原理和架构模式，使代码本身成为学习材料。

## Glossary

- **File_Sender**: 选择并发送文件的客户端用户
- **File_Receiver**: 接收文件分片并解密还原的客户端用户
- **File_Transfer_Engine**: 客户端负责文件分片、加密、发送和接收、解密、重组的模块
- **Chunk**: 文件被分割后的固定大小数据片段（64KB）
- **File_Metadata**: 文件的描述信息，包括文件名、大小、MIME 类型、分片总数、传输 ID 和可选缩略图
- **Transfer_ID**: 唯一标识一次文件传输会话的标识符（NanoID 格式）
- **Relay_Server**: 服务器端 WebSocket 中转模块，负责将文件分片转发给房间内其他在线成员
- **Thumbnail**: 图片文件的压缩预览版本（≤50KB, 最大 300px），用于内联显示
- **Room_Key**: 房间的 AES-256-GCM 对称密钥，用于加密所有文件数据
- **Transfer_Timeout**: 传输超时时间（60秒无新分片则标记失败）
- **Max_File_Size**: 单文件大小上限（5MB）

## Requirements

### Requirement 1: File Selection and Validation

**User Story:** As a File_Sender, I want to select a file to share with room members, so that I can securely transfer files within the encrypted chat.

#### Acceptance Criteria

1. WHEN the File_Sender selects a file, THE File_Transfer_Engine SHALL validate that the file size does not exceed 5MB (Max_File_Size)
2. IF the selected file exceeds 5MB, THEN THE File_Transfer_Engine SHALL display an error message "文件大小不能超过 5MB"
3. WHEN the File_Sender selects a valid file, THE File_Transfer_Engine SHALL extract the file name, file size, and MIME type as File_Metadata
4. THE File_Transfer_Engine SHALL support all common file types including images (PNG, JPEG, GIF, WebP), documents (PDF, TXT), and archives (ZIP)
5. WHEN the File_Sender selects a file, THE File_Transfer_Engine SHALL generate a unique Transfer_ID (NanoID 21 chars) for the file transfer session
6. THE File_Transfer_Engine SHALL support file selection via: (a) file picker button, (b) drag-and-drop onto the chat area, (c) Ctrl+V / Cmd+V paste from clipboard (images only)
7. WHEN a file is dragged over the chat area, THE File_Transfer_Engine SHALL display a visual drop zone indicator

### Requirement 2: Client-Side File Encryption

**User Story:** As a File_Sender, I want my file to be encrypted before transmission, so that the server cannot access the file content.

#### Acceptance Criteria

1. WHEN a valid file is selected, THE File_Transfer_Engine SHALL split the file into Chunks of 64KB (65536 bytes) each
2. WHEN the file size is not evenly divisible by 64KB, THE File_Transfer_Engine SHALL create a final Chunk containing the remaining bytes
3. WHEN a Chunk is ready for transmission, THE File_Transfer_Engine SHALL encrypt the Chunk using AES-256-GCM with the Room_Key and a unique random 96-bit IV per Chunk
4. THE File_Transfer_Engine SHALL encrypt the File_Metadata (including optional Thumbnail) using AES-256-GCM with the Room_Key before sending it to the Relay_Server
5. FOR ALL Chunks, encrypting then decrypting with the same Room_Key SHALL produce the original Chunk data (round-trip correctness property)
6. EACH encrypted Chunk SHALL consist of: 12 bytes IV + ciphertext + 16 bytes GCM auth tag (total overhead: 28 bytes per Chunk)

### Requirement 3: Chunked WebSocket Transmission

**User Story:** As a File_Sender, I want my file to be sent in chunks over WebSocket, so that large files can be transmitted without blocking the chat connection.

#### Acceptance Criteria

1. WHEN a file transfer begins, THE File_Transfer_Engine SHALL send an encrypted File_Metadata message to the Relay_Server containing the Transfer_ID, file name, file size, MIME type, total chunk count, and optional encrypted Thumbnail
2. WHEN the File_Metadata is sent, THE File_Transfer_Engine SHALL sequentially send each encrypted Chunk with its chunk index and Transfer_ID to the Relay_Server
3. WHEN all Chunks are sent, THE File_Transfer_Engine SHALL send a transfer-complete signal with the Transfer_ID to the Relay_Server
4. THE File_Transfer_Engine SHALL use MessagePack binary serialization for all file transfer protocol messages, encoding encrypted data as msgpack bin format (not base64)
5. WHILE a file transfer is in progress, THE File_Transfer_Engine SHALL allow the File_Sender to continue sending text messages (file chunks do not block chat)
6. THE File_Transfer_Engine SHALL insert a 10ms delay between consecutive Chunk transmissions to avoid overwhelming the WebSocket connection and allow text messages to interleave
7. THE File_Transfer_Engine SHALL process file transfers sequentially — only one active transfer at a time per sender; new transfers are queued

### Requirement 4: Server Relay (Zero-Knowledge)

**User Story:** As a system operator, I want the server to relay file data without storing or inspecting it, so that the zero-knowledge architecture is maintained.

#### Acceptance Criteria

1. WHEN the Relay_Server receives a file transfer message from a client, THE Relay_Server SHALL forward the message to all other online members in the same room
2. THE Relay_Server SHALL NOT store any file Chunk data to disk or memory beyond the time needed for forwarding (immediate relay, no buffering)
3. THE Relay_Server SHALL NOT inspect, decrypt, or modify the encrypted Chunk content
4. IF the File_Receiver is offline when a Chunk is sent, THEN THE Relay_Server SHALL discard the Chunk (no queuing, no persistence)
5. THE Relay_Server SHALL validate that the sending client is a member of the room before relaying file transfer messages
6. THE Relay_Server SHALL set a maximum WebSocket message size of 100KB (maxMessageSize) to accommodate encrypted Chunks (64KB plaintext + 28 bytes GCM overhead + msgpack envelope)
7. THE Relay_Server SHALL increase WebSocket ReadBufferSize and WriteBufferSize to 128KB to handle file transfer messages efficiently
8. THE Relay_Server SHALL use the existing `toInt()` helper function for all numeric field parsing from msgpack-decoded data (preventing the int8/uint8 type assertion bug)
9. File transfer messages (MSG_SEND_FILE_META, MSG_SEND_FILE_CHUNK, MSG_SEND_FILE_COMPLETE, MSG_SEND_FILE_CANCEL) SHALL be exempt from the existing text message rate limiter (E004); instead, THE Relay_Server SHALL limit file transfer initiation to a maximum of 1 active transfer per client at a time

### Requirement 5: Client-Side File Reception and Decryption

**User Story:** As a File_Receiver, I want to receive and decrypt file chunks in real-time, so that I can access the shared file.

#### Acceptance Criteria

1. WHEN the File_Receiver receives an encrypted File_Metadata message, THE File_Transfer_Engine SHALL decrypt it and prepare a buffer for the incoming Chunks
2. WHEN the File_Receiver receives an encrypted Chunk, THE File_Transfer_Engine SHALL decrypt the Chunk using AES-256-GCM with the Room_Key and the provided IV
3. WHEN all Chunks for a Transfer_ID are received and decrypted, THE File_Transfer_Engine SHALL reassemble the Chunks in order to reconstruct the original file
4. IF a Chunk decryption fails (wrong key or corrupted data), THEN THE File_Transfer_Engine SHALL display an error message "文件解密失败" for that file transfer and discard the incomplete buffer
5. WHEN the file is fully reassembled, THE File_Transfer_Engine SHALL make the file available for download by the File_Receiver
6. THE File_Transfer_Engine SHALL limit the receive buffer to Max_File_Size (5MB) per transfer to prevent memory exhaustion
7. IF no new Chunk is received for a Transfer_ID within Transfer_Timeout (60 seconds), THEN THE File_Transfer_Engine SHALL mark the transfer as failed, display "传输超时" error, and release the buffer memory
8. THE File_Transfer_Engine SHALL handle concurrent incoming transfers from multiple senders simultaneously (each sender's transfer tracked independently by Transfer_ID)
9. THE File_Transfer_Engine SHALL rely on WebSocket's TCP-guaranteed message ordering — Chunks are assumed to arrive in the order they were sent (no out-of-order handling required)
10. WHEN the file is reassembled, THE File_Transfer_Engine SHALL sanitize the file name by removing path separators (/ and \), null bytes, and limiting length to 255 characters to prevent path traversal or injection
11. THE File_Transfer_Engine SHALL manage active transfer state (buffers, progress, Transfer_IDs) independently from the chat messages array, so that transfers survive message array overflow (MAX_MESSAGES limit)

### Requirement 6: Transfer Cancel and Abort

**User Story:** As a File_Sender, I want to cancel an ongoing file transfer, so that I can stop sending if I made a mistake.

#### Acceptance Criteria

1. WHILE a file transfer is in progress, THE File_Transfer_Engine SHALL display a cancel button to the File_Sender
2. WHEN the File_Sender clicks the cancel button, THE File_Transfer_Engine SHALL stop sending Chunks and send a MSG_SEND_FILE_CANCEL message with the Transfer_ID to the Relay_Server
3. WHEN the Relay_Server receives a MSG_SEND_FILE_CANCEL, THE Relay_Server SHALL relay it to all room members as MSG_RELAY_FILE_CANCEL
4. WHEN the File_Receiver receives a MSG_RELAY_FILE_CANCEL, THE File_Transfer_Engine SHALL discard the incomplete buffer and display "发送方已取消传输"
5. IF the File_Sender leaves the room during a file transfer, THEN THE File_Transfer_Engine on the File_Receiver side SHALL mark the transfer as failed and display "发送方已离开，传输中断"
6. IF the room is closed during a file transfer, THEN THE File_Transfer_Engine SHALL abort all active transfers and release all buffer memory

### Requirement 7: Download Progress Display

**User Story:** As a File_Receiver, I want to see the download progress, so that I know how much of the file has been received.

#### Acceptance Criteria

1. WHILE a file transfer is in progress, THE File_Transfer_Engine SHALL display a progress bar showing the percentage of Chunks received relative to the total chunk count
2. WHILE a file transfer is in progress, THE File_Transfer_Engine SHALL update the progress bar each time a new Chunk is received and decrypted
3. WHEN a file transfer completes, THE File_Transfer_Engine SHALL replace the progress bar with a download-ready state (download button)
4. WHILE a file is being sent, THE File_Transfer_Engine SHALL display a send progress bar to the File_Sender showing the percentage of Chunks sent
5. WHILE a file transfer is in progress, THE File_Transfer_Engine SHALL display the transfer speed (KB/s) and estimated remaining time
6. WHEN the room has more than 10 online members, THE File_Transfer_Engine SHALL display a warning to the File_Sender before initiating the transfer: "当前房间有 N 位成员，文件将发送给所有人，可能较慢"（用户可选择继续或取消）
7. WHEN a File_Receiver successfully receives and reassembles the complete file, THE File_Transfer_Engine SHALL send a lightweight delivery confirmation (ACK) back through the Relay_Server, and THE File_Sender's UI SHALL update the file message status to "已送达 (N/M)" showing how many receivers have confirmed receipt

### Requirement 8: Image Inline Preview

**User Story:** As a File_Receiver, I want to see a preview of image files directly in the chat, so that I can quickly view images without downloading the full file.

#### Acceptance Criteria

1. WHEN the File_Sender selects an image file (MIME type image/png, image/jpeg, image/gif, or image/webp), THE File_Transfer_Engine SHALL generate a Thumbnail using Canvas API with a maximum dimension of 300px and JPEG quality reduced to keep the Thumbnail under 50KB
2. WHEN a Thumbnail is generated, THE File_Transfer_Engine SHALL encrypt the Thumbnail using AES-256-GCM with the Room_Key and include it in the File_Metadata message
3. WHEN the File_Receiver receives File_Metadata containing an encrypted Thumbnail, THE File_Transfer_Engine SHALL decrypt and display the Thumbnail inline in the chat message bubble immediately (before full file transfer completes)
4. WHEN the File_Receiver clicks on the inline Thumbnail, THE File_Transfer_Engine SHALL trigger download of the full-resolution file (if fully received) or display the current transfer progress
5. FOR animated GIF files, THE Thumbnail SHALL be a static frame (first frame) to reduce size

### Requirement 9: File Transfer Protocol Messages

**User Story:** As a developer, I want well-defined protocol messages for file transfer, so that the client and server can communicate file transfer state reliably.

#### Acceptance Criteria

1. THE protocol SHALL define MSG_SEND_FILE_META (0x08, Client → Server) containing encrypted File_Metadata with Transfer_ID, sender ID, and sender name
2. THE protocol SHALL define MSG_SEND_FILE_CHUNK (0x09, Client → Server) containing the Transfer_ID, chunk index (uint16), and encrypted chunk data (bin format)
3. THE protocol SHALL define MSG_SEND_FILE_COMPLETE (0x0A, Client → Server) signaling that all Chunks have been sent for a Transfer_ID
4. THE protocol SHALL define MSG_SEND_FILE_CANCEL (0x0B, Client → Server) signaling that the sender is canceling the transfer
5. THE protocol SHALL define MSG_SEND_FILE_ACK (0x0C, Client → Server) signaling that the receiver has successfully received and reassembled the complete file for a Transfer_ID
6. THE protocol SHALL define MSG_RELAY_FILE_META (0x1A, Server → Client) for relaying File_Metadata to room members, including sender ID and sender name
7. THE protocol SHALL define MSG_RELAY_FILE_CHUNK (0x1B, Server → Client) for relaying file Chunks to room members
8. THE protocol SHALL define MSG_RELAY_FILE_COMPLETE (0x1C, Server → Client) for relaying the transfer-complete signal
9. THE protocol SHALL define MSG_RELAY_FILE_CANCEL (0x1D, Server → Client) for relaying the cancel signal
10. THE protocol SHALL define MSG_RELAY_FILE_ACK (0x1E, Server → Client) for relaying the delivery confirmation back to the sender (contains receiver ID)

### Requirement 10: Ephemeral Mode Interaction

**User Story:** As a user in an ephemeral room, I want file messages to follow the same disappearance rules as text messages, so that the ephemeral behavior is consistent.

#### Acceptance Criteria

1. WHEN the room has ephemeral mode enabled (ephemeral > 0), THE File_Transfer_Engine SHALL schedule file message bubble removal after the ephemeral timeout, same as text messages
2. IF a file transfer is still in progress when the ephemeral timeout fires, THEN THE File_Transfer_Engine SHALL abort the transfer and release buffer memory before removing the message bubble
3. WHEN a file message bubble disappears due to ephemeral timeout, files already downloaded to the user's device SHALL NOT be affected (download is permanent)
4. THE File_Transfer_Engine SHALL NOT start the ephemeral countdown timer for a file message until the transfer is complete (countdown starts from transfer completion, not from message appearance)

### Requirement 11: Error Handling and Edge Cases

**User Story:** As a user, I want file transfers to handle errors gracefully, so that failures do not disrupt the chat experience.

#### Acceptance Criteria

1. IF the WebSocket connection drops during a file transfer, THEN THE File_Transfer_Engine SHALL mark the transfer as failed and display "连接断开，传输失败" to both File_Sender and File_Receiver
2. IF the File_Receiver joins the room after a file transfer has started, THEN THE File_Receiver SHALL NOT receive partial file data (transfer is only for currently online members at the time of sending)
3. WHILE a file transfer is in progress, IF the File_Sender initiates another file transfer, THE File_Transfer_Engine SHALL queue the new transfer and display "等待上一个文件传输完成..."
4. THE File_Transfer_Engine SHALL limit the transfer queue to a maximum of 3 pending transfers; additional attempts SHALL be rejected with "队列已满，请稍后再试"
5. IF the File_Receiver's buffer exceeds Max_File_Size during reception, THEN THE File_Transfer_Engine SHALL abort the transfer and display an error
6. IF the WebSocket connection is restored after a transfer failure, THE File_Transfer_Engine SHALL NOT attempt to resume the failed transfer (no resume/retry mechanism; user must re-send the file manually)
7. IF a file transfer message references an unknown Transfer_ID (e.g., receiver missed the metadata), THE File_Transfer_Engine SHALL silently discard the chunk

### Requirement 12: UI Integration

**User Story:** As a user, I want file sharing to be integrated into the chat interface, so that I can share files as naturally as sending messages.

#### Acceptance Criteria

1. THE File_Transfer_Engine SHALL provide a file attachment button (📎 icon) in the message input area, to the left of the send button
2. WHEN a file transfer is initiated, THE File_Transfer_Engine SHALL display a file message bubble in the chat showing: file type icon, file name, file size, and transfer status
3. WHEN a file transfer completes, THE File_Transfer_Engine SHALL display a download button (⬇️) within the file message bubble
4. THE File_Transfer_Engine SHALL display file message bubbles consistently for both File_Sender (right-aligned) and File_Receiver (left-aligned) with appropriate status indicators
5. WHEN the File_Receiver clicks the download button, THE File_Transfer_Engine SHALL trigger a browser file download with the original file name using a Blob URL
6. THE File_Transfer_Engine SHALL display different file type icons: 🖼️ (images), 📄 (documents/text), 📦 (archives), 📁 (other)
7. THE File_Transfer_Engine SHALL support drag-and-drop: when files are dragged over the chat area, display a full-screen drop zone overlay with "拖放文件到此处" text
8. THE File_Transfer_Engine SHALL support clipboard paste: Ctrl+V / Cmd+V with image data SHALL trigger file selection with the pasted image (named "clipboard-{timestamp}.png")

## Non-Functional Requirements

### Performance

- NFR-1: File encryption/decryption SHALL use Web Crypto API (hardware-accelerated where available) and SHALL NOT block the main thread for more than 50ms per Chunk
- NFR-2: The 10ms inter-chunk delay SHALL ensure text messages can interleave with file transfer without noticeable lag
- NFR-3: Thumbnail generation SHALL complete within 500ms for images up to 5MB

### Memory

- NFR-4: The File_Transfer_Engine SHALL not hold more than Max_File_Size (5MB) of buffer memory per active transfer on the receiver side
- NFR-5: The Relay_Server SHALL not buffer file data — each chunk is forwarded immediately upon receipt (memory usage per chunk: O(chunk_size) for the duration of the write operation only)
- NFR-6: Completed or failed transfers SHALL release all buffer memory immediately
- NFR-7: WHEN a file download Blob URL is created, THE File_Transfer_Engine SHALL revoke the Blob URL after the download completes or when the file message bubble is removed (whichever comes first) to prevent memory leaks

### Compatibility

- NFR-8: File transfer SHALL NOT introduce any new npm or Go dependencies (use existing Web Crypto API, Canvas API, MessagePack)
- NFR-9: All new server-side numeric field parsing SHALL use the `toInt()` helper function to handle vmihailenco/msgpack/v5's variable integer type decoding (int8, uint8, int16, uint16, int32, uint32, int64, uint64)
- NFR-10: File transfer messages SHALL use msgpack bin format for binary data (not base64 string encoding) to minimize overhead

### UI/UX

- NFR-11: All new UI elements SHALL use Tailwind CSS dark theme classes consistent with existing design
- NFR-12: File transfer UI SHALL be responsive and work on mobile devices (touch-friendly buttons, appropriate sizing)
- NFR-13: Progress animations SHALL respect prefers-reduced-motion media query

## Code Quality Requirements (学习项目)

本项目是学习项目，代码本身应作为学习材料。在遵循最佳工程实践的同时，所有代码必须带有详细的描述性注释。

### 注释规范

- CQ-1: 每个新文件顶部 SHALL 包含文件级注释，说明该文件在整体架构中的角色、职责边界和与其他模块的关系
- CQ-2: 每个导出函数/方法 SHALL 包含 JSDoc (TypeScript) 或 GoDoc (Go) 注释，说明：功能描述、参数含义、返回值、可能的错误、使用示例
- CQ-3: 关键算法和设计决策处 SHALL 使用 `📚 学习要点:` 前缀的注释块，解释为什么选择这种方案（而非仅描述做了什么）
- CQ-4: 涉及加密、安全、并发的代码段 SHALL 包含详细注释，解释安全属性和潜在风险
- CQ-5: 复杂的类型定义和接口 SHALL 包含每个字段的用途说明

### 工程实践

- CQ-6: Go 代码 SHALL 遵循 Effective Go 和 Go Code Review Comments 规范（命名、错误处理、包组织）
- CQ-7: TypeScript 代码 SHALL 使用严格类型（no any），优先使用 discriminated unions 和 exhaustive checks
- CQ-8: 错误处理 SHALL 遵循 fail-fast 原则，所有错误路径都有明确的用户反馈
- CQ-9: 状态管理 SHALL 遵循单一数据源原则，避免状态不一致
- CQ-10: 新增模块 SHALL 遵循单一职责原则（SRP），每个文件/模块只做一件事

### 代码组织

- CQ-11: 文件传输相关代码 SHALL 组织在独立的目录/模块中（如 `src/file-transfer/`），与现有聊天逻辑分离
- CQ-12: 协议相关的类型定义 SHALL 集中在 protocol 文件中，与实现逻辑分离
- CQ-13: 加密操作 SHALL 复用现有 `src/crypto/` 模块的模式，保持一致的代码风格

## Constraints

- 服务器不存储任何文件数据（零知识，纯中转）
- 接收方必须在线才能接收文件
- 不引入新的外部依赖
- 单文件大小上限 5MB
- 同一时间只能有一个活跃传输（队列最多 3 个待发送）
- 服务器 WebSocket 消息大小限制需从 4KB 提升到 100KB
- 分片大小固定 64KB（最后一片可能更小）
- 传输超时 60 秒（无新分片则失败）
- 不支持断点续传（断线后需重新发送）
- 带宽放大效应：N 个房间成员时，服务器出口流量 = 文件大小 × (N-1)；MaxMembers=50 时最大 5MB × 49 ≈ 245MB/次传输（5MB 限制 + 大房间警告是主要缓解措施）
- 传输状态（缓冲区、进度）独立于消息数组管理，不受 MAX_MESSAGES=200 限制影响
- 本项目为学习项目，所有代码必须带有详细的中文注释和学习要点说明
