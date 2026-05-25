# Requirements Document — voice-sender-polish

## Introduction

本规格定义了语音发送模块（voice sender）的 3 项工程质量改进。这些改进不涉及用户可见功能变更，而是解决代码中的循环依赖 workaround、缺失的回归测试和 ID 格式不一致问题。目标是提升代码可维护性并建立防止回归的测试覆盖。

## Glossary

- **VoiceStore**: `src/voice/voiceStore.ts` 中的 Zustand store，管理语音录音和播放状态
- **FileTransferStore**: `src/file-transfer/fileTransferStore.ts` 中的 Zustand store，管理文件传输生命周期
- **CallbackRegistration**: voiceStore 向 fileTransferStore 注册 `onTransferComplete` 回调的过程
- **VoiceInitModule**: 新建的 `src/voice/init.ts` 模块，负责在应用启动时完成 CallbackRegistration
- **SendFile**: `src/file-transfer/sender.ts` 中的 `sendFile()` 函数，执行文件加密分片发送流程
- **ChatMessageId**: 聊天消息的唯一标识符字符串，用于关联传输状态与聊天气泡
- **InitiateTransfer**: `fileTransferStore.initiateTransfer()` 方法，创建传输状态并加入发送队列

## Requirements

### Requirement 1: 循环依赖解耦 — voice/init.ts 模块

**User Story:** As a developer, I want a dedicated `voice/init.ts` module that handles callback registration imported by `main.tsx`, so that the `setTimeout(0)` + `subscribe()` workaround is replaced with a clean module initialization pattern.

#### Acceptance Criteria

1. THE VoiceInitModule SHALL export a function `initVoice()` that performs CallbackRegistration by calling `useFileTransferStore.getState().registerTransferCompleteCallback()`.
2. THE VoiceInitModule SHALL be imported in `main.tsx` as a top-level static import (`import './voice/init'`).
3. THE VoiceInitModule SHALL execute `initVoice()` as a side-effect of module loading (top-level call).
4. WHEN VoiceInitModule is created, THE VoiceStore SHALL remove all registration workaround code: `_callbackRegistered` flag, `ensureCallbackRegistered()` function, `useVoiceStore.subscribe()` block, `setTimeout(0)` call, and `initVoiceModule()` export.
5. IF `useFileTransferStore` is unavailable when `initVoice()` executes, THEN THE VoiceInitModule SHALL log a warning via `console.warn` and allow the application to continue without crashing.
6. THE VoiceInitModule SHALL export `initVoiceModule` as a backward-compatible alias for `initVoice`.

> 📚 学习要点: ES Module 静态 import 语义
> 静态 `import` 语句在模块加载时执行（声明提升），不受代码位置影响。
> Zustand store 在模块加载时通过 `create()` 完成初始化，因此 `voice/init.ts`
> import `fileTransferStore` 时，store 已经存在。不需要 setTimeout 延迟。

### Requirement 2: sendFile 重复插入回归测试

**User Story:** As a developer, I want a unit test verifying that `sendFile` skips inserting a duplicate `ChatFileMessage` when `transfer.chatMessageId` is pre-set via `initiateTransfer` options, so that the voice message deduplication logic is protected against regressions.

#### Acceptance Criteria

1. THE regression test SHALL verify that WHEN `initiateTransfer` is called with `options.chatMessageId` set to a non-empty string, THE SendFile function SHALL not call `insertChatFileMessage`.
2. THE regression test SHALL verify that WHEN `initiateTransfer` is called without `options.chatMessageId` (empty string default), THE SendFile function SHALL call `insertChatFileMessage` exactly once.
3. THE regression test SHALL use Vitest as the test runner and be located at `src/file-transfer/__tests__/sender.dedup.test.ts`.
4. THE regression test SHALL mock WebSocket and crypto dependencies to isolate the deduplication logic.
5. THE regression test SHALL assert that `useChatStore.setState` is not called with a new file message when `transfer.chatMessageId` is pre-set.

### Requirement 3: ChatMessageId 格式标准化

**User Story:** As a developer, I want all chatMessageId values to follow the format `${timestamp}-${type}-${random8chars}`, so that IDs are consistent and traceable across voice and file messages.

#### Acceptance Criteria

1. THE SendFile function SHALL generate chatMessageId in the format `${timestamp}-file-${random8chars}` where `random8chars` is exactly 8 characters from `Math.random().toString(36).slice(2, 10).padEnd(8, '0')`.
2. THE voiceSender `sendVoice` function SHALL generate chatMessageId in the format `${timestamp}-voice-${random8chars}` using the same random generation method.
3. THE receiver module SHALL generate chatMessageId for received file messages in the format `${timestamp}-file-${random8chars}`.
4. THE receiver module SHALL generate chatMessageId for received voice messages in the format `${timestamp}-voice-${random8chars}`.
5. A shared utility function `generateChatMessageId(type: 'file' | 'voice'): string` SHALL be created at `src/file-transfer/chatMessageId.ts` and used by all generation sites.
6. THE utility SHALL replace the current inconsistent patterns: `Math.random().toString(36).slice(2, 10)` in voiceSender and `transferId.slice(0, 8)` in sender.ts/receiver.ts.
7. THE `random8chars` component SHALL always be exactly 8 characters long (using `padEnd(8, '0')` to handle the edge case where `Math.random()` produces a short base-36 representation).

> 📚 学习要点: 为什么不用 crypto.getRandomValues？
> ChatMessageId 仅用于 UI 去重和调试追踪，不涉及安全性。
> Math.random() 在同一毫秒内碰撞概率极低（timestamp 已提供唯一性），
> 且代码更简洁、无需 fallback 处理。KISS 原则优先。

## Non-Functional Requirements

- NFR-1: 所有改动不得引入新的 npm 依赖。
- NFR-2: 所有现有测试必须继续通过（344/344）。
- NFR-3: TypeScript 严格模式下零诊断错误。
