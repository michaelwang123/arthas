# Design Document — voice-sender-polish

## Overview

3 项工程质量改进：循环依赖解耦、回归测试补充、ID 格式标准化。纯前端改动，不涉及服务器。

## Architecture

```
main.tsx
  └── import './voice/init'  (top-level static import, side-effect: 注册回调)
        ├── import useFileTransferStore
        ├── import useVoiceStore
        └── initVoice() → registerTransferCompleteCallback(cb)

src/voice/voiceStore.ts     ← 删除 subscribe/setTimeout/ensureCallbackRegistered
src/voice/voiceSender.ts    ← 使用 generateChatMessageId('voice')
src/file-transfer/sender.ts ← 使用 generateChatMessageId('file')
src/file-transfer/receiver.ts ← 使用 generateChatMessageId('file'|'voice')
src/file-transfer/chatMessageId.ts ← 新建：共享 ID 生成工具
src/file-transfer/__tests__/sender.dedup.test.ts ← 新建：回归测试
```

## Component Design

### 1. voice/init.ts — 回调注册模块

```typescript
// src/voice/init.ts
import { useFileTransferStore } from '../file-transfer/fileTransferStore';
import { useVoiceStore } from './voiceStore';

/**
 * 执行语音模块初始化：注册传输完成回调。
 * 作为 main.tsx 的 side-effect import 执行。
 *
 * 📚 学习要点: 为什么用独立模块而非 voiceStore 内部注册？
 * voiceStore.ts import fileTransferStore → fileTransferStore import ... → 可能形成循环。
 * 独立的 init.ts 打破循环：它 import 两个 store 但不被任何 store import。
 * 依赖方向：init.ts → voiceStore + fileTransferStore（单向，无环）。
 */
export function initVoice(): void {
  try {
    useFileTransferStore.getState().registerTransferCompleteCallback(
      (transferId, blobUrl, metadata) => {
        if (metadata.isVoice) {
          useVoiceStore.getState().registerVoiceBlob(transferId, blobUrl);
        }
      }
    );
  } catch (error) {
    console.warn('[VoiceInit] Failed to register callback:', error);
  }
}

export const initVoiceModule = initVoice;

// Side-effect: 模块加载时立即执行
initVoice();
```

**main.tsx 修改：** 在文件顶部添加 `import './voice/init'`（静态 import，模块加载时执行）。

**voiceStore.ts 清理：** 删除以下代码块（约 40 行）：
- `let _callbackRegistered = false`
- `function ensureCallbackRegistered() { ... }`
- `useVoiceStore.subscribe(() => { ... })`
- `setTimeout(() => { ... }, 0)`
- `export function initVoiceModule() { ... }`

### 2. chatMessageId.ts — 共享 ID 生成工具

```typescript
// src/file-transfer/chatMessageId.ts

/**
 * 生成标准化的 ChatMessageId。
 * 格式: `${timestamp}-${type}-${random8chars}`
 *
 * 📚 学习要点: 为什么统一 ID 格式？
 * 之前 voiceSender 用 Math.random().toString(36)，sender.ts 用 transferId.slice(0,8)。
 * 统一格式便于调试（从 ID 即可判断消息类型和创建时间）和避免碰撞。
 *
 * 📚 学习要点: padEnd(8, '0') 的防御性
 * Math.random().toString(36).slice(2, 10) 在极端情况下（如 Math.random() 返回 0）
 * 可能产生少于 8 字符。padEnd 确保输出始终为固定 8 字符，
 * 使 ID 格式可预测，便于正则匹配和日志解析。
 *
 * @param type - 'file' | 'voice'
 */
export function generateChatMessageId(type: 'file' | 'voice'): string {
  const timestamp = Date.now();
  const random8 = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `${timestamp}-${type}-${random8}`;
}
```

**各模块替换：**

| 文件 | 当前 | 替换为 |
|------|------|--------|
| voiceSender.ts | `` `${Date.now()}-voice-${Math.random()...}` `` | `generateChatMessageId('voice')` |
| sender.ts | `` `${timestamp}-file-${transferId.slice(0,8)}` `` | `generateChatMessageId('file')` |
| receiver.ts (file) | `` `${timestamp}-file-${data.transferId.slice(0,8)}` `` | `generateChatMessageId('file')` |
| receiver.ts (voice) | `` `${timestamp}-voice-${data.transferId.slice(0,8)}` `` | `generateChatMessageId('voice')` |

### 3. sender.dedup.test.ts — 回归测试

验证 `sendFile()` 的去重逻辑：`transfer.chatMessageId` 非空时跳过 `insertChatFileMessage`。

**测试策略：** Mock fileTransferStore 返回带有预设 chatMessageId 的 transfer，调用 sendFile，断言 useChatStore.setState 未被调用（无新消息插入）。

## Correctness Properties

### Property 1: ChatMessageId format consistency

*For any* generated ChatMessageId, the ID SHALL match the pattern `^\d{13,}-(file|voice)-[a-z0-9]{8}$`.

### Property 2: SendFile deduplication

*For any* transfer where `transfer.chatMessageId !== ''`, `sendFile` SHALL NOT insert a new chat message.

## Error Handling

| 场景 | 处理 |
|------|------|
| `initVoice()` 时 store 不可用 | console.warn + 静默降级 |
| `generateChatMessageId` 中 Math.random 异常 | 不可能发生（Math.random 不抛异常） |
