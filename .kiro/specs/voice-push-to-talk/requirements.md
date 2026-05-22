# Requirements Document: 加密语音消息 (Phase 9A)

## Introduction

为 Arthas 加密聊天应用添加加密语音消息功能。用户按住按钮录音，松开后完整音频经 AES-256-GCM 加密，通过 WebSocket 发送给房间内在线成员。接收方解密后播放。体验类似微信语音消息。

核心设计理念：
- **语音消息模式**：按住录音，松开后整条发送（非实时流式对讲）
- **整体加密**：录音完成后将完整音频 Blob 加密发送（复用文件传输的分片加密模式）
- **复用架构**：复用现有 WebSocket + Broadcast + 分片加密机制，与文件传输模式一致
- **零改动现有代码**：仅新增模块和消息类型，不修改现有功能

> **与文件传输的关系：** 语音消息本质上是"自动录制的小音频文件"。加密和传输流程复用文件传输的分片加密模式（64KB 分片 + 独立 IV），区别在于：自动录制（非手动选择文件）、专用 UI（语音气泡而非文件卡片）、自动播放（接收后可直接播放）。

## Glossary

- **Voice_Sender**: 按住按钮录制并发送语音消息的客户端用户
- **Voice_Receiver**: 接收加密语音消息并播放的客户端用户
- **Voice_Message**: 一条完整的加密语音消息（录制完成后整体发送）
- **Audio_Blob**: MediaRecorder 录制产生的完整音频数据（WebM/Opus 或 MP4/Opus 容器格式）
- **PTT_Button**: Push-to-Talk 按钮，用户按住录音、松开发送的交互控件
- **Room_Key**: 房间的 AES-256-GCM 对称密钥，用于加密语音消息数据
- **Voice_Transfer**: 语音消息的加密传输过程，复用文件传输的分片加密机制

## Requirements

### Requirement 1: Push-to-Talk 录音

**User Story:** As a Voice_Sender, I want to press and hold a button to record voice, so that I can send encrypted voice messages easily.

#### Acceptance Criteria

1. WHEN the Voice_Sender presses and holds the PTT_Button, THE client SHALL start capturing audio from the device microphone using MediaRecorder API.
2. WHEN the Voice_Sender releases the PTT_Button, THE client SHALL stop audio capture and trigger the send flow.
3. THE client SHALL request microphone permission via `navigator.mediaDevices.getUserMedia()` on the first PTT_Button press.
4. IF the browser denies microphone permission, THEN THE client SHALL display an error message "麦克风权限被拒绝".
5. THE PTT_Button SHALL support both mouse interaction (mousedown/mouseup) and touch interaction (touchstart/touchend) for mobile compatibility.
6. WHILE the Voice_Sender is recording, THE client SHALL display a visual recording indicator (pulsing red dot + elapsed time).
7. IF the Voice_Sender holds the PTT_Button for less than 500ms, THEN THE client SHALL discard the recording and display "录音时间太短".
8. THE client SHALL limit a single recording to a maximum duration of 60 seconds; WHEN 60 seconds is reached, THE client SHALL automatically stop recording and send.
9. THE PTT_Button SHALL have a minimum touch area of 44px for mobile accessibility.
10. WHILE recording, THE client SHALL NOT clear or modify the text input field content (recording is independent of text editing).

### Requirement 2: 音频录制格式

**User Story:** As a Voice_Sender, I want my voice to be recorded in a compact format, so that it transmits quickly with low bandwidth.

#### Acceptance Criteria

1. THE client SHALL record audio using MediaRecorder API with preferred MIME type `audio/webm;codecs=opus`.
2. IF the browser does not support `audio/webm;codecs=opus`, THEN THE client SHALL try `audio/mp4;codecs=opus` (Safari).
3. IF neither Opus MIME type is supported, THEN THE client SHALL use the browser's default audio format and display a warning "当前浏览器不支持 Opus 编码，文件可能较大".
4. THE client SHALL configure audio capture with mono channel (1 channel) to minimize file size.
5. THE client SHALL record the complete audio as a single Blob (using `MediaRecorder.start()` without timeslice parameter).
6. A 60-second voice message at Opus encoding SHALL produce approximately 60-240KB of audio data (depending on bitrate 8-32kbps).

### Requirement 3: 语音消息加密与传输

**User Story:** As a Voice_Sender, I want my voice message to be encrypted before transmission, so that the server cannot access any voice content.

#### Acceptance Criteria

1. WHEN recording is complete, THE client SHALL encrypt the Audio_Blob using the existing file transfer encryption mechanism (64KB chunk splitting + per-chunk AES-256-GCM with independent IV).
2. THE client SHALL reuse the existing MSG_SEND_FILE_META / MSG_SEND_FILE_CHUNK / MSG_SEND_FILE_COMPLETE protocol messages for voice message transmission.
3. THE MSG_SEND_FILE_META message SHALL include a metadata field indicating this is a voice message (e.g., `isVoice: true`, `duration: <seconds>`).
4. THE server SHALL relay voice messages using the same Broadcast mechanism as file transfers (zero-knowledge, no special handling needed).
5. THE client SHALL generate a unique transferId (NanoID) for each voice message transfer, same as file transfers.
6. THE client SHALL display a sending progress indicator while the voice message is being transmitted.
7. IF the transmission fails (connection lost, timeout), THEN THE client SHALL display "语音发送失败" and allow retry.

### Requirement 4: 语音消息接收与播放

**User Story:** As a Voice_Receiver, I want to receive and play voice messages, so that I can hear what the sender said.

#### Acceptance Criteria

1. WHEN all chunks of a voice message are received and decrypted, THE client SHALL reassemble the Audio_Blob from the decrypted chunks.
2. THE client SHALL create a Blob URL from the reassembled audio data for playback.
3. THE client SHALL use an HTML5 `<audio>` element (or `new Audio()`) for playback, NOT Web Audio API AudioBufferSourceNode.
4. WHEN the Voice_Receiver clicks the play button on a voice message bubble, THE client SHALL start audio playback from the beginning.
5. WHILE audio is playing, THE client SHALL display a playback progress indicator (elapsed time / total duration).
6. THE client SHALL allow the user to stop playback by clicking the play/pause button again.
7. IF audio decryption fails (wrong key or corrupted data), THEN THE client SHALL display "语音解密失败" in the message bubble.
8. THE client SHALL store the decrypted Audio_Blob in memory for replay (until the user leaves the room or the message expires in ephemeral mode).

### Requirement 5: 语音消息 UI

**User Story:** As a user, I want voice messages to be displayed as distinct bubbles in the chat, so that I can easily identify and interact with them.

#### Acceptance Criteria

1. THE client SHALL display a PTT_Button (🎤 microphone icon) in the message input area, positioned to the left of the send button.
2. Voice message bubbles SHALL display: sender name, duration (e.g., "0:05"), and a play/pause button (▶️/⏸️).
3. Voice message bubbles SHALL be visually distinct from text messages (e.g., different background color or icon).
4. THE Voice_Sender's own voice messages SHALL appear right-aligned (same as own text messages).
5. Received voice messages SHALL appear left-aligned with sender name and color (same as received text messages).
6. WHILE a voice message is being received (chunks arriving), THE client SHALL display a "receiving..." state with a progress indicator.
7. THE recording indicator SHALL show elapsed time in "0:XX" format, updating every second.

### Requirement 6: 向后兼容

**User Story:** As a user with an older client version, I want the application to continue working normally when other users send voice messages.

#### Acceptance Criteria

1. Voice messages SHALL use the existing file transfer protocol (MSG_SEND_FILE_META/CHUNK/COMPLETE), so older clients that support file transfer will receive them as audio files.
2. Older clients that support file transfer SHALL display voice messages as downloadable audio files (graceful degradation).
3. THE CLI client SHALL silently ignore voice messages (same behavior as file transfer — CLI's `handleServerMessage` already ignores `MsgRelayFileMeta/Chunk/Complete` message types).
4. THE client SHALL NOT modify any existing protocol message types or their data structures.
5. THE client SHALL NOT modify any existing server-side message handling logic (zero server changes).
6. THE client SHALL NOT introduce any new npm or Go dependencies.

### Requirement 7: 错误处理

**User Story:** As a user, I want voice messaging to handle errors gracefully, so that failures do not disrupt the chat experience.

#### Acceptance Criteria

1. IF the WebSocket connection drops during voice message transmission, THEN THE client SHALL display "连接断开，语音发送失败".
2. IF the device microphone becomes unavailable during recording, THEN THE client SHALL stop recording and display "麦克风断开".
3. WHEN the Voice_Sender initiates a new recording while another voice message is being sent, THE client SHALL reject the new recording (one outgoing voice transfer at a time).
4. WHEN the Voice_Sender attempts to send a voice message while a file transfer is in progress (or vice versa), THE client SHALL reject with "请等待当前传输完成" (server enforces one active transfer per client via `activeTransferID`).
5. IF AudioContext/Audio element creation fails (browser autoplay policy), THEN THE client SHALL display "请点击页面以启用音频播放" on first playback attempt.
6. IF the voice message exceeds 5MB (extremely long recording with high bitrate), THEN THE client SHALL reject it with "语音文件过大" (reuse existing file size limit).

### Requirement 8: 阅后即焚交互

**User Story:** As a user in an ephemeral room, I want voice message bubbles to follow the same disappearance rules as text messages.

#### Acceptance Criteria

1. WHEN the room has ephemeral mode enabled, voice message bubbles SHALL be scheduled for removal after the ephemeral timeout, same as text messages.
2. THE ephemeral countdown SHALL start after the voice message transfer is complete (not during transfer).
3. WHEN a voice message bubble disappears due to ephemeral timeout, THE client SHALL release the associated Audio_Blob and revoke the Blob URL.

## Non-Functional Requirements

### Performance
- NFR-1: Voice message encryption SHALL complete within 500ms for a 60-second recording (~240KB).
- NFR-2: Voice message decryption and Blob assembly SHALL complete within 500ms.
- NFR-3: Audio playback SHALL start within 100ms of clicking the play button (Blob URL is pre-created).

### Bandwidth
- NFR-4: A 60-second voice message at Opus encoding SHALL be approximately 60-240KB total.
- NFR-5: Per-chunk encryption overhead is 28 bytes (12B IV + 16B GCM tag) per 64KB chunk — negligible for voice messages (typically 1-4 chunks).

### Memory
- NFR-6: THE client SHALL store at most 10 decrypted voice message Blobs in memory per room (LRU eviction for older ones).
- NFR-7: Total voice message memory usage SHALL not exceed 2.5MB per room (10 × 240KB max).

### Compatibility
- NFR-8: No new npm or Go dependencies.
- NFR-9: Voice messaging is Web client only; CLI client is out of scope.
- NFR-10: Supported browsers: Chrome 49+, Firefox 29+, Edge 79+, Safari 14.1+ (with mp4 container fallback).

### UI/UX
- NFR-11: All new UI elements SHALL use Tailwind CSS dark theme classes consistent with existing design.
- NFR-12: Voice UI SHALL be responsive and work on mobile devices.
- NFR-13: Recording animation SHALL respect `prefers-reduced-motion` media query.

## Out of Scope

- **实时流式对讲**（边录边听）— 需要 MediaSource Extensions + Jitter Buffer，复杂度高，留待 Phase 9B
- **波形可视化** — 需要 AudioContext 分析音频数据，MVP 只显示时长
- **语音转文字** — 需要 ASR 服务，偏离零知识架构
- **CLI 客户端语音** — 终端无法录音/播放
- **视频消息** — 带宽要求太高
- **并发语音混音** — 多人同时发语音时的混音播放，MVP 顺序播放
- **新增服务器协议** — 复用现有文件传输协议，零服务器改动
- **Ed25519 签名覆盖语音消息** — 与文件传输一致，签名机制仅覆盖文本消息（Phase 8 Out of Scope 已说明）
- **上滑取消录音手势** — 微信/Telegram 风格的取消手势，MVP 不实现（录音 < 500ms 自动丢弃作为替代）

## Constraints

- 服务器不存储任何音频数据（零知识，纯中转）
- 接收方必须在线才能接收语音消息（无离线语音）
- 不引入新的外部依赖（使用浏览器原生 API）
- 单条语音最长 60 秒，最大 5MB
- 语音传输与文件传输共享 `activeTransferID` 互斥锁 — 同一时间只能有一个活跃传输（语音或文件）
- 语音消息不带 Ed25519 签名（与文件传输一致）
- 仅 Web 客户端支持语音（CLI 静默忽略）
- 不支持断点续传（断线后需重新录制发送）
- 本项目为学习项目，所有代码必须带有详细的中文注释和学习要点说明
