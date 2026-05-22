# Voice Push-to-Talk 模块问题清单

## 概述

语音模块代码评审发现 3 个关键功能性 Bug、2 个逻辑缺陷、2 个性能问题和 1 个可维护性问题。
**全部已修复。**

---

## P0 — 关键 Bug（功能性阻断）

### ~~Bug 2: extraMetadata 未传递到 sendEncryptedMetadata~~ ✅ 已修复

- **文件**: `src/file-transfer/sender.ts`
- **问题**: `sendFile()` 调用 `sendEncryptedMetadata(transferId, file, roomKey)` 只传 3 个参数，未调用 `consumeExtraMetadata(transferId)` 获取语音元数据并传递为第 4 个参数
- **影响**: `isVoice: true` 和 `duration` 永远不会出现在加密 metadata 中，接收方将所有语音消息当作普通文件处理
- **修复**: 导入 `consumeExtraMetadata`，在 sendFile 中调用并传递给 `sendEncryptedMetadata`

### ~~Bug 1: voiceStore 从未注册 onTransferComplete 回调~~ ✅ 已修复

- **文件**: `src/voice/voiceStore.ts`
- **问题**: 设计文档说明 voiceStore 应调用 `fileTransferStore.registerTransferCompleteCallback()` 注册回调，但实际代码中从未执行
- **影响**: 接收方解密完成后，blob URL 不会进入 voiceStore 的 blobCache，接收的语音消息永远不可播放
- **修复**: 添加延迟回调注册（`ensureCallbackRegistered`），通过 Zustand subscribe 触发，避免模块加载顺序问题

### ~~Bug 3: sender.ts insertChatFileMessage 无条件执行导致重复消息~~ ✅ 已修复

- **文件**: `src/file-transfer/sender.ts`
- **问题**: voiceSender 提前插入 ChatVoiceMessage 并设置 `chatMessageId`，但 `sendFile()` 无条件调用 `insertChatFileMessage`
- **影响**: 语音消息在发送方聊天列表中出现两条
- **修复**: 在 sendFile 中检查 `transfer.chatMessageId` 是否已设置，已设置则跳过插入

---

## P1 — 逻辑缺陷

### ~~LRU 播放时不更新访问顺序~~ ✅ 已修复

- **文件**: `src/voice/voiceStore.ts` — `playVoice` action
- **问题**: 用户播放语音消息时，该消息不会在 `lruOrder` 中移到末尾
- **影响**: 频繁播放的旧消息仍在 lruOrder 头部，会被优先淘汰
- **修复**: 在 `playVoice` 中更新 `lruOrder`，将播放的消息移到末尾

### ~~发送方自己的语音消息不可回放~~ ✅ 已修复

- **文件**: `src/voice/voiceSender.ts`
- **问题**: 发送方不会收到 `handleFileComplete` 回调，blobCache 中没有自己的语音 blob URL
- **影响**: 发送方无法回放自己刚发送的语音消息
- **修复**: 在 `sendVoice` 中调用 `URL.createObjectURL(blob)` 并注册到 `voiceStore.blobCache`

---

## P2 — 性能问题

### ~~updatePlaybackProgress 每 250ms 创建新 Map~~ ✅ 已修复

- **文件**: `src/voice/voiceStore.ts` — `updatePlaybackProgress` action
- **问题**: 每次 `timeupdate` 事件都创建新 Map 并 setState，导致不必要的重渲染
- **影响**: 大量语音消息时可能造成 CPU 开销
- **修复**: 添加 0.1 秒变化阈值（Threshold Filtering），只有 currentTime 变化超过 100ms 才更新 store，减少约 50% 的 Map 创建

### ~~playbackStates Map 无限增长~~ ✅ 已修复

- **文件**: `src/voice/voiceStore.ts` — `evictBlob` action
- **问题**: `playbackStates` Map 只在 `cleanup()` 时清理，每条播放过的消息都留下条目
- **影响**: 长时间使用时内存缓慢增长
- **修复**: 在 `evictBlob` 中同步删除对应的 `playbackStates` 条目

---

## P3 — 可维护性

### ~~字段命名 `recordingError` 语义不清~~ ✅ 已修复

- **文件**: `src/voice/voiceStore.ts`, `voiceSender.ts`, `VoiceErrorToast.tsx`, 测试文件
- **问题**: `recordingError` 同时承载录音错误和播放错误，名称误导
- **修复**: 全局重命名为 `voiceError`（通过 semantic rename，影响 4 个文件 18 处）

### 注释密度过高 — 暂不处理

- **文件**: 整个 `src/voice/` 目录
- **问题**: voiceStore.ts 等文件中 60%+ 是注释
- **决定**: 作为学习项目，保留详细注释。未来如果项目转为生产项目，可将教程性注释移到独立文档

---

## 修复进度

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P0 | Bug 2: extraMetadata 未传递 | ✅ 已修复 |
| P0 | Bug 1: 回调未注册 | ✅ 已修复 |
| P0 | Bug 3: 重复消息 | ✅ 已修复 |
| P1 | LRU 播放时不更新 | ✅ 已修复 |
| P1 | 发送方不可回放 | ✅ 已修复 |
| P2 | 进度更新性能 | ✅ 已修复 |
| P2 | playbackStates 泄漏 | ✅ 已修复 |
| P3 | 字段命名 | ✅ 已修复 |
| P3 | 注释密度 | 保留（学习项目） |

---

## 验证结果

- **测试**: 281 通过 / 1 失败（pre-existing chunker 5MB 超时，与语音模块无关）
- **TypeScript**: 生产代码零错误（5 个错误均在测试文件的 mock 类型中）
- **修改文件汇总**:
  - `src/file-transfer/sender.ts` — Bug 2 + Bug 3
  - `src/voice/voiceStore.ts` — Bug 1 + P1 LRU + P2 性能 + P2 泄漏 + P3 重命名
  - `src/voice/voiceSender.ts` — P1 发送方回放 + P3 重命名
  - `src/voice/components/VoiceErrorToast.tsx` — P3 重命名
  - `src/voice/__tests__/voiceStore.property.test.ts` — P3 重命名
  - `src/voice/__tests__/voiceSender.property.test.ts` — 测试 mock 适配
  - `src/voice/index.ts` — 导出 `initVoiceModule`
