# Implementation Plan: 加密语音消息 (Push-to-Talk)

## Overview

为 Arthas E2EE 聊天应用实现 Push-to-Talk 加密语音消息功能。实现策略是复用现有文件传输协议（分片加密 + WebSocket 中转），新增独立的 `src/voice/` 模块负责录音和播放，对现有文件传输模块做最小侵入式扩展（增加 metadata 扩展点和 isVoice 分支）。

技术栈：TypeScript + React + Zustand + Tailwind CSS + Vitest + fast-check

## Tasks

- [x] 1. Define voice module types, i18n keys, and extend file transfer interfaces
  - [x] 1.1 Create `src/voice/types.ts` with voice module type definitions
    - Define `RecordingState`, `PlaybackState`, `RecordingResult`, `VoicePlaybackState` types
    - Define `VoiceFileMetadata` interface extending FileMetadata with `isVoice` and `duration`
    - Include detailed 📚 学习要点 comments explaining each type's role
    - _Requirements: 3.3, 2.1_

  - [x] 1.2 Extend `src/file-transfer/types.ts` with optional voice fields
    - Add optional `isVoice?: boolean` and `duration?: number` to `FileMetadata` interface
    - Add optional `isVoice?: boolean` to `TransferState` interface (set by handleFileMeta when decrypted metadata has isVoice === true, used by handleFileComplete to trigger voice callback)
    - Define `TransferInitiateOptions` interface with optional `extraMetadata?: Record<string, unknown>`
    - Maintain backward compatibility — all new fields are optional
    - _Requirements: 3.3, 6.4_

  - [x] 1.3 Extend `src/network/protocol.ts` with `ChatVoiceMessage` interface and type guards
    - Define `ChatVoiceMessage` extending `ChatFileMessage` with `subType: 'voice'` and `duration: number`
    - Add type guard function `isVoiceMessage(msg: ChatMessage | ChatFileMessage): msg is ChatVoiceMessage`
    - Ensure `isFileMessage()` in `MessageList.tsx` still works correctly (ChatVoiceMessage is a subtype of ChatFileMessage)
    - _Requirements: 6.1, 6.4_

  - [x] 1.4 Add voice-related i18n keys to all locale files
    - Add keys under `voice.*` namespace to `src/i18n/locales/zh.json`, `en.json`, and `ja.json`
    - Error keys: `voice.error.micDenied`, `voice.error.tooShort`, `voice.error.micDisconnected`, `voice.error.tooLarge`, `voice.error.transferBusy`, `voice.error.disconnected`, `voice.error.decryptFailed`, `voice.error.autoplayBlocked`
    - UI text keys: `voice.recording`, `voice.expired`, `voice.receiving`, `voice.decryptFailed`
    - This task is intentionally early so all subsequent tasks can use i18n keys from the start
    - _Requirements: 1.4, 1.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 1.5 Add `onVoiceTransferComplete` callback hook to `src/file-transfer/fileTransferStore.ts`
    - Add optional `onTransferComplete?: (transferId: string, blobUrl: string, metadata: FileMetadata) => void` callback field to store state
    - Add `registerTransferCompleteCallback(cb)` and `unregisterTransferCompleteCallback()` actions
    - In `handleFileComplete` flow (receiver.ts), after creating blobUrl, invoke the callback if metadata has `isVoice === true`
    - 📚 学习要点: 使用回调注册模式避免 receiver.ts → voiceStore 的循环依赖
    - _Requirements: 4.1, 4.2_

- [x] 2. Implement voice recorder engine
  - [x] 2.1 Create `src/voice/recorder.ts` — MediaRecorder wrapper
    - Implement `createVoiceRecorder()` factory function returning `VoiceRecorder` interface
    - Handle MIME type negotiation: try `audio/webm;codecs=opus` → `audio/mp4;codecs=opus` → browser default
    - Implement `start()`: request getUserMedia (mono channel), create MediaRecorder, collect data chunks
    - Implement `stop()`: stop MediaRecorder, assemble Blob, calculate duration via Date.now() diff
    - Implement `cancel()`: stop without returning data, release stream
    - Implement `dispose()`: release all MediaStream tracks (prevent mic indicator staying on)
    - Enforce 500ms minimum duration check and 60s maximum auto-stop
    - Use i18n keys from task 1.4 for all error messages (e.g., `translate(locale, 'voice.error.micDenied')`)
    - Include 📚 学习要点 comments on MediaRecorder lifecycle and browser compatibility
    - _Requirements: 1.1, 1.2, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.2 Write unit tests for `src/voice/__tests__/recorder.test.ts`
    - Mock MediaRecorder, getUserMedia, MediaRecorder.isTypeSupported
    - Test state transitions: idle → requesting → recording → processing → idle
    - Test permission denied error path
    - Test minimum duration rejection (< 500ms)
    - Test maximum duration auto-stop (60s)
    - Test MIME type fallback chain
    - Test stream track cleanup on all error paths
    - _Requirements: 1.3, 1.4, 1.7, 1.8, 7.2_

- [x] 3. Implement voice player engine
  - [x] 3.1 Create `src/voice/player.ts` — HTML5 Audio playback controller
    - Implement `createVoicePlayer()` factory function returning `VoicePlayer` interface
    - Implement singleton playback: only one voice message plays at a time
    - Implement `play(transferId, blobUrl)`: stop current if any, create Audio, start playback
    - Implement `pause()`, `resume()`, `stop()` with proper state transitions
    - Track `currentTime` via `timeupdate` event, handle `ended` event to reset state
    - Handle autoplay policy error: catch `play()` rejection, surface `voice.error.autoplayBlocked` via i18n
    - Include 📚 学习要点 on why HTML5 Audio over Web Audio API
    - _Requirements: 4.3, 4.4, 4.5, 4.6_

  - [x] 3.2 Write unit tests for `src/voice/__tests__/player.test.ts`
    - Mock Audio constructor and its methods (play, pause, currentTime, duration)
    - Test singleton behavior: playing new message stops previous
    - Test play → pause → resume → stop transitions
    - Test `ended` event resets state to idle
    - Test autoplay policy error handling
    - _Requirements: 4.4, 4.5, 4.6, 7.5_

- [x] 4. Implement voice state management
  - [x] 4.1a Create `src/voice/voiceStore.ts` — recording state slice
    - Create Zustand store with `create()` (consistent with project pattern)
    - Implement recording state: `recordingState`, `recordingStartTime`, `recordingElapsed`, `recordingError`
    - Implement `startRecording()`: check fileTransferStore.activeSendId mutex, delegate to recorder
    - Implement `stopRecording(): Promise<RecordingResult | null>` — stops recorder and returns result (caller handles sending)
    - Implement `cancelRecording()`: cancel recorder, reset state
    - 📚 学习要点: stopRecording 返回 Promise 而非直接调用 sendVoice，让 PttButton (task 8.1) 作为协调者连接 recorder → sender，避免 voiceStore 对 voiceSender 的前向依赖
    - Use i18n keys for error messages (`voice.error.transferBusy`, `voice.error.tooShort`)
    - Include 📚 学习要点 on recording state machine and transfer mutex
    - _Requirements: 7.3, 7.4_

  - [x] 4.1b Extend `src/voice/voiceStore.ts` — playback state slice
    - Add `activePlaybackId: string | null` and `playbackStates: Map<string, VoicePlaybackState>`
    - Implement `playVoice(transferId)`: delegate to player, update activePlaybackId
    - Implement `pauseVoice()`: delegate to player, update state
    - Implement `updatePlaybackProgress(transferId, currentTime)`: called by player's timeupdate
    - Include 📚 学习要点 on singleton playback strategy
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.8_

  - [x] 4.1c Extend `src/voice/voiceStore.ts` — LRU Blob cache slice
    - Add `blobCache: Map<string, string>` and `lruOrder: string[]`, constant `MAX_VOICE_CACHE = 10`
    - Implement `registerVoiceBlob(transferId, blobUrl)`: add to cache, enforce LRU eviction
    - Implement `evictBlob(transferId)`: call `URL.revokeObjectURL()`, remove from cache, set playback state to 'expired'
    - Implement `cleanup()`: revoke all URLs, reset all state (called on room leave)
    - Register `onVoiceTransferComplete` callback (from task 1.5) to auto-register blobs on receive
    - Include 📚 学习要点 on LRU strategy, why voiceStore is the sole Blob owner, and memory budget (10 × 240KB ≤ 2.5MB)
    - _Requirements: 4.8, 8.3, NFR-6, NFR-7_

  - [x] 4.2 Write property test for LRU cache invariant — `src/voice/__tests__/voiceStore.property.test.ts`
    - **Property 7: LRU cache invariant**
    - **Validates: Requirements NFR-6, NFR-7**
    - For any sequence of registerVoiceBlob calls, cache size never exceeds MAX_VOICE_CACHE
    - Evicted blob has URL.revokeObjectURL called exactly once

  - [x] 4.3 Write property test for recording mutual exclusion — `src/voice/__tests__/voiceStore.property.test.ts`
    - **Property 5: Recording mutual exclusion**
    - **Validates: Requirements 7.3**
    - When fileTransferStore has activeSendId !== null, startRecording is rejected

- [x] 5. Checkpoint — Core voice logic complete
  - Run `npx vitest run --reporter=verbose` in `arthas-client/` and verify all voice module tests pass
  - Verify no TypeScript compilation errors: `npx tsc --noEmit`
  - Ask the user if questions arise

- [x] 6. Implement voice sender and file transfer extensions
  - [x] 6.1 Create `src/voice/voiceSender.ts` — adapter from voice to file transfer
    - Implement `sendVoice(blob, duration, mimeType)` function
    - Wrap Audio_Blob as File object with name format `voice_YYYYMMDD_HHmmss.webm`
    - Call `fileTransferStore.initiateTransfer(file, { extraMetadata: { isVoice: true, duration } })`
    - Handle `initiateTransfer` returning `null` (queue full or file too large): surface `voice.error.transferBusy` or `voice.error.tooLarge` via toast
    - Insert voice message placeholder in chat store (subType: 'voice', duration)
    - 📚 学习要点: PttButton 的 onRelease handler 调用 `const result = await stopRecording(); if (result) sendVoice(result.blob, result.duration, result.mimeType)`，voiceSender 不依赖 voiceStore 内部状态
    - Include 📚 学习要点 on adapter pattern and why we go through initiateTransfer
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 7.4, 7.6_

  - [x] 6.2 Extend `src/file-transfer/fileTransferStore.ts` — add extraMetadata support
    - Modify `initiateTransfer()` signature: `(file: File, options?: TransferInitiateOptions) => string | null`
    - Store extraMetadata in a module-level Map alongside File refs (same pattern as `storeFileRef`)
    - Pass extraMetadata through to `sendEncryptedMetadata()` when processQueue triggers send
    - No changes to existing transfer logic (queue, mutex, progress tracking all preserved)
    - _Requirements: 3.2, 6.4, 6.5_

  - [x] 6.3 Extend `src/file-transfer/sender.ts` — inject extra fields into metadata
    - Modify `sendEncryptedMetadata()` to accept optional `extraFields?: Record<string, unknown>` parameter
    - Merge extraFields into the FileMetadata object before JSON serialization and encryption
    - Existing callers unaffected (parameter is optional with default `undefined`)
    - _Requirements: 3.3, 6.4_

  - [x] 6.4 Extend `src/file-transfer/receiver.ts` — detect voice messages on receive
    - In `handleFileMeta()`, after decrypting metadata, check for `isVoice === true`
    - If voice: set `transferState.isVoice = true` on the new TransferState (field added in task 1.2)
    - If voice: call new `insertReceiverChatVoiceMessage()` helper (inserts ChatVoiceMessage with subType:'voice' and duration)
    - If not voice: continue through existing `insertReceiverChatFileMessage()` path unchanged
    - In `handleFileComplete()`, after creating blobUrl, check `transfer.isVoice === true` and invoke the registered `onTransferComplete` callback (from task 1.5)
    - 📚 学习要点: receiver.ts 不直接 import voiceStore — 通过回调模式解耦，避免 file-transfer ↔ voice 循环依赖
    - _Requirements: 4.1, 4.2, 6.1, 6.2_

  - [x] 6.5 Write property test for voice metadata invariant — `src/voice/__tests__/voiceSender.property.test.ts`
    - **Property 2: Voice metadata invariant**
    - **Validates: Requirements 3.3**
    - For any valid recording (0.5-60s, valid blob size), constructed metadata always has isVoice: true, correct duration, valid mimeType, correct totalChunks

  - [x] 6.6 Write property test for encryption round-trip — `src/voice/__tests__/encryption.property.test.ts`
    - **Property 1: Voice message encryption round-trip**
    - **Validates: Requirements 3.1, 4.1**
    - For any audio data 500B-240KB, encrypt via chunk mechanism then decrypt produces identical data
    - Note: complements existing `encryptChunk.property.test.ts` by testing voice-specific size range

- [x] 7. Checkpoint — Voice transmission pipeline complete
  - Run `npx vitest run --reporter=verbose` in `arthas-client/` and verify all tests pass
  - Verify no TypeScript compilation errors: `npx tsc --noEmit`
  - Ask the user if questions arise

- [x] 8. Implement UI components
  - [x] 8.1 Create `src/voice/components/PttButton.tsx` — Push-to-Talk button
    - Render microphone icon button (🎤) with 44px minimum touch area
    - Handle mousedown/mouseup and touchstart/touchend events
    - Only render when `MediaRecorder.isTypeSupported()` returns true (graceful degradation)
    - On press: call `voiceStore.startRecording()`
    - On release: `const result = await voiceStore.stopRecording(); if (result) sendVoice(result.blob, result.duration, result.mimeType)`
    - Show disabled state when transfer is active (activeSendId !== null)
    - Use Tailwind dark theme classes consistent with existing UI
    - Include aria-label using i18n key for accessibility
    - _Requirements: 1.1, 1.2, 1.5, 1.9, NFR-11, NFR-12_

  - [x] 8.2 Create `src/voice/components/RecordingIndicator.tsx` — recording status overlay
    - Display pulsing red dot + elapsed time in "0:XX" format (using formatDuration from 8.3)
    - Position as absolute overlay above message input area
    - Update elapsed time every second using requestAnimationFrame/setInterval + Date.now() diff
    - Respect `prefers-reduced-motion`: use `motion-reduce:animate-none` Tailwind variant
    - _Requirements: 1.6, 5.7, NFR-13_

  - [x] 8.3 Create `src/voice/formatDuration.ts` — time formatting utility
    - Implement `formatDuration(seconds: number): string` returning "M:SS" format
    - Handle edge cases: 0 → "0:00", 60 → "1:00", negative → "0:00"
    - Include 📚 学习要点 on formatting logic
    - _Requirements: 5.7_

  - [x] 8.4 Create `src/voice/components/VoiceMessage.tsx` — voice message bubble
    - Display sender name, formatted duration, play/pause toggle button (▶️/⏸️)
    - Show playback progress (currentTime / duration) while playing
    - Show "receiving..." state with progress indicator during transfer (use i18n key `voice.receiving`)
    - Show i18n key `voice.expired` for expired state (Blob evicted from LRU cache)
    - Show i18n key `voice.decryptFailed` for decryption failure state
    - Visually distinct from text messages (audio waveform placeholder icon + different bg)
    - Right-align for own messages, left-align with sender name for received
    - Use Tailwind dark theme classes
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 4.5, 4.7, NFR-11_

  - [x] 8.5 Write property test for duration format — `src/voice/__tests__/formatDuration.property.test.ts`
    - **Property 4: Duration format correctness**
    - **Validates: Requirements 5.7**
    - For any t in [0, 60], formatDuration produces "M:SS" pattern with correct numeric value

  - [x] 8.6 Write property test for voice bubble rendering — `src/voice/__tests__/VoiceMessage.property.test.ts`
    - **Property 3: Voice bubble rendering completeness**
    - **Validates: Requirements 5.2**
    - For any sender name (1-20 chars) and duration (0.5-60s), rendered bubble contains sender name, formatted duration, and play/pause button

- [x] 9. Integrate voice module with existing UI
  - [x] 9.0 Create `src/voice/index.ts` — barrel export for clean imports
    - Export: `useVoiceStore`, `sendVoice`, `formatDuration`
    - Export components: `PttButton`, `VoiceMessage`, `RecordingIndicator`
    - Export types: `RecordingState`, `PlaybackState`, `VoicePlaybackState`, `RecordingResult`
    - 📚 学习要点: barrel export 让外部模块通过 `import { PttButton } from '../voice'` 引用，无需知道内部文件结构
    - _Requirements: N/A (code organization)_

  - [x] 9.1 Integrate PttButton into `src/components/MessageInput.tsx`
    - Import and render `<PttButton />` between `<FileAttachButton />` and the Send button (actual layout: [Emoji] [Input] [FileAttach] [🎤 PTT] [Send])
    - Conditionally render only when MediaRecorder is supported
    - Import and render `<RecordingIndicator />` as absolute overlay above the input row when recording
    - Ensure recording does not clear or modify text input content
    - _Requirements: 5.1, 1.10_

  - [x] 9.2 Integrate VoiceMessage into `src/components/MessageList.tsx`
    - Import `isVoiceMessage` type guard from `protocol.ts`
    - Add rendering branch: when `isVoiceMessage(msg)` returns true, render `<VoiceMessage />` instead of `<FileMessage />`
    - Pass transferId, duration, sender info to VoiceMessage component
    - Maintain existing rendering for non-voice file messages (backward compatible)
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 6.2_

  - [x] 9.3 Wire ephemeral cleanup and room leave cleanup for voice messages
    - In `EphemeralWrapper` component (inside `MessageList.tsx`), detect voice messages via `isVoiceMessage` check
    - When ephemeral fade timer fires for a voice message, call `voiceStore.evictBlob(transferId)` to revoke Blob URL
    - Ephemeral countdown already starts after transfer complete (existing `isTransferTerminal` logic applies)
    - Ensure cleanup runs even if voice is currently playing (stop playback first)
    - In `chatStore.leaveRoom()`, call `voiceStore.cleanup()` to revoke all Blob URLs, stop active recording/playback, and reset all voice state
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 9.4 Wire error handling in voiceStore and UI components
    - Use `translate()` for all user-facing error messages (no hardcoded strings)
    - Display errors via existing toast/notification mechanism
    - Ensure errors don't block text messaging functionality
    - Ensure MediaStream tracks are released on all error paths (try/finally pattern)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 9.5 Write property test for ephemeral voice cleanup — `src/voice/__tests__/ephemeral.property.test.ts`
    - **Property 6: Ephemeral voice cleanup**
    - **Validates: Requirements 8.3**
    - When ephemeral timeout removes a voice message, Blob URL is revoked and removed from cache

- [x] 10. Final checkpoint — Full integration complete
  - Run `npx vitest run --reporter=verbose` in `arthas-client/` and verify ALL tests pass (voice + existing)
  - Verify no TypeScript compilation errors: `npx tsc --noEmit`
  - Manually verify PTT button renders in MessageInput (browser dev tools)
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation with specific commands
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The design specifies zero server changes — all work is in `arthas-client/`
- No new npm dependencies required (MediaRecorder, Audio, fast-check all available)
- All code must include detailed 📚 学习要点 comments per project steering rules
- All UI text uses i18n keys (added in task 1.4), not hardcoded Chinese strings
- Circular dependency prevention: `file-transfer/` → `voice/` dependency is avoided via callback registration pattern (task 1.5)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["2.1", "3.1", "8.3"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.1a", "8.5"] },
    { "id": 3, "tasks": ["4.1b", "4.1c", "4.3"] },
    { "id": 4, "tasks": ["4.2", "6.2", "6.3"] },
    { "id": 5, "tasks": ["6.1", "6.4", "6.6"] },
    { "id": 6, "tasks": ["6.5", "8.1", "8.2", "8.4"] },
    { "id": 7, "tasks": ["8.6", "9.0", "9.1", "9.2"] },
    { "id": 8, "tasks": ["9.3", "9.4", "9.5"] }
  ]
}
```

### Wave 依赖说明

| Wave | 关键依赖关系 |
|------|-------------|
| 0 | 无依赖 — 类型定义、i18n keys、回调钩子（纯接口层） |
| 1 | 依赖 wave 0 的类型定义 |
| 2 | 2.2/3.2 测试依赖 wave 1 实现；4.1a 依赖 recorder(2.1) + types(1.1) |
| 3 | 4.1b 依赖 player(3.1) + 4.1a；4.1c 依赖 callback hook(1.5) + 4.1a |
| 4 | 4.2 测试依赖 4.1c；6.2/6.3 是独立的 file-transfer 扩展 |
| 5 | 6.1 依赖 6.2（调用扩展后的 initiateTransfer）；6.4 依赖 1.5 回调 + 1.3 类型 + 1.2 的 TransferState.isVoice |
| 6 | 6.5 测试依赖 6.1；UI 组件依赖 voiceStore(4.1a-c) + formatDuration(8.3) + voiceSender(6.1) |
| 7 | 9.0 barrel export 依赖所有 voice 模块文件；集成依赖 UI 组件(wave 6) |
| 8 | Ephemeral/错误处理依赖集成完成(wave 7) |

### 数据流：stopRecording → sendVoice（无前向依赖）

```
PttButton.onRelease (wave 6)
  → await voiceStore.stopRecording() → RecordingResult (wave 2)
  → sendVoice(result.blob, result.duration, result.mimeType) (wave 5)
  → fileTransferStore.initiateTransfer(file, { extraMetadata }) (wave 4)
```

PttButton 作为协调者，在 wave 6 才实现，此时 voiceStore(wave 2) 和 voiceSender(wave 5) 都已就绪。无前向依赖问题。
