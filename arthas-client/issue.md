# Voice Push-to-Talk 模块问题清单

## 概述

语音模块代码评审发现 3 个关键功能性 Bug（导致接收端完全不可用）、2 个逻辑缺陷、2 个性能问题和 1 个可维护性问题。

---

## P0 — 关键 Bug（功能性阻断）

### ~~Bug 2: extraMetadata 未传递到 sendEncryptedMetadata~~  ✅ 已修复

- **文件**: `src/file-transfer/sender.ts`
- **问题**: `sendFile()` 第 523 行调用 `sendEncryptedMetadata(transferId, file, roomKey)` 只传 3 个参数，未调用 `consumeExtraMetadata(transferId)` 获取语音元数据并传递为第 4 个参数
- **影响**: `isVoice: true` 和 `duration` 永远不会出现在加密 metadata 中，接收方将所有语音消息当作普通文件处理
- **修复**: 在 sendFile 中调用 `consumeExtraMetadata` 并传递给 `sendEncryptedMetadata`

### ~~Bug 1: voiceStore 从未注册 onTransferComplete 回调~~ ✅ 已修复

- **文件**: `src/voice/voiceStore.ts`
- **问题**: 设计文档说明 voiceStore 应在初始化时调用 `fileTransferStore.registerTransferCompleteCallback()` 注册回调，但实际代码中从未执行此注册
- **影响**: 接收方解密完成后，blob URL 不会进入 voiceStore 的 blobCache，`playVoice` 找不到 blobUrl，接收的语音消息永远不可播放
- **修复**: 在 voiceStore 模块底部添加回调注册代码

### ~~Bug 3: sender.ts insertChatFileMessage 无条件执行导致重复消息~~ ✅ 已修复

- **文件**: `src/file-transfer/sender.ts`
- **问题**: voiceSender 在 `initiateTransfer` 后立即插入 ChatVoiceMessage 并设置 `chatMessageId`，但 `sender.ts` 的 `sendFile()` 无条件调用 `insertChatFileMessage`，没有检查 `chatMessageId` 是否已存在
- **影响**: 语音消息在发送方聊天列表中出现两条（一条语音气泡 + 一条文件卡片）
- **修复**: 在 sendFile 中检查 transfer.chatMessageId 是否已设置，已设置则跳过插入

---

## P1 — 逻辑缺陷

### ~~LRU 播放时不更新访问顺序~~ ✅ 已修复

- **文件**: `src/voice/voiceStore.ts` — `playVoice` action
- **问题**: 用户播放一条语音消息时，该消息不会在 `lruOrder` 中移到末尾（最近使用位置）
- **影响**: 频繁播放的旧消息仍在 lruOrder 头部，新消息到来时会被优先淘汰（违反 LRU 语义）
- **修复**: 在 playVoice 中更新 lruOrder

### ~~发送方自己的语音消息不可回放~~ ✅ 已修复

- **文件**: `src/voice/voiceSender.ts`
- **问题**: 发送方录音后通过文件传输发送，但发送方不会收到 `handleFileComplete` 回调（那是接收方流程），发送方的 blobCache 中没有自己的语音 blob URL
- **影响**: 发送方无法回放自己刚发送的语音消息
- **修复**: 在 sendVoice 中，发送前将 blob 的 URL 注册到 voiceStore.blobCache

---

## P2 — 性能问题

### updatePlaybackProgress 每 250ms 创建新 Map

- **文件**: `src/voice/voiceStore.ts` — `updatePlaybackProgress` action
- **问题**: 每次 `timeupdate` 事件（~250ms）都 `new Map(playbackStates)` 并 `set()`，导致所有订阅 `playbackStates` 的 VoiceMessage 组件重渲染
- **影响**: 大量语音消息时可能造成不必要的 CPU 开销
- **建议**: VoiceMessage 使用自定义 equality 函数的 selector，或将 currentTime 移到 ref 中

### playbackStates Map 无限增长

- **文件**: `src/voice/voiceStore.ts`
- **问题**: `playbackStates` Map 只在 `cleanup()`（离开房间）时清理，每条播放过的消息都留下条目
- **影响**: 长时间使用时内存缓慢增长
- **建议**: 在 `evictBlob` 时同步删除对应的 playbackStates 条目

---

## P3 — 可维护性

### 字段命名与注释密度

- **`recordingError` 字段语义不清**: 同时承载录音错误和播放错误（通过 player 的 `onError` 回调），建议重命名为 `voiceError`
- **注释密度过高**: voiceStore.ts 约 500 行中 60%+ 是注释，建议将教程性注释移到独立文档，保留"为什么"类注释在代码旁

---

## 修复进度

| 优先级 | 问题 | 状态 |
|--------|------|------|
| P0 | Bug 2: extraMetadata 未传递 | ✅ 已修复 |
| P0 | Bug 1: 回调未注册 | ✅ 已修复 |
| P0 | Bug 3: 重复消息 | ✅ 已修复 |
| P1 | LRU 播放时不更新 | ✅ 已修复 |
| P1 | 发送方不可回放 | ✅ 已修复 |
| P2 | 进度更新性能 | 待优化 |
| P2 | playbackStates 泄漏 | 待优化 |
| P3 | 字段命名、注释密度 | 待优化 |
