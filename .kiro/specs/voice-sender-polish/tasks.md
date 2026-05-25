# Implementation Plan: voice-sender-polish

## Overview

3 项独立的工程质量改进：循环依赖解耦、回归测试、ID 格式标准化。纯前端 TypeScript 改动。

## Tasks

- [x] 1. ChatMessageId 格式标准化
  - [x] 1.1 创建 `src/file-transfer/chatMessageId.ts`
    - 导出 `generateChatMessageId(type: 'file' | 'voice'): string`
    - 格式: `${Date.now()}-${type}-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`
    - padEnd(8, '0') 确保始终输出固定 8 字符（防御 Math.random() 极端值）
    - 添加文件级注释和 📚 学习要点
    - _Requirements: 3.5, 3.7_

  - [x] 1.2 更新 `src/voice/voiceSender.ts`
    - 替换 `${Date.now()}-voice-${Math.random().toString(36).slice(2, 10)}` 为 `generateChatMessageId('voice')`
    - 添加 import
    - _Requirements: 3.2_

  - [x] 1.3 更新 `src/file-transfer/sender.ts`
    - 替换 `${timestamp}-file-${transferId.slice(0, 8)}` 为 `generateChatMessageId('file')`
    - 添加 import
    - _Requirements: 3.1_

  - [x] 1.4 更新 `src/file-transfer/receiver.ts`
    - 替换文件消息 ID: `generateChatMessageId('file')`
    - 替换语音消息 ID: `generateChatMessageId('voice')`
    - 添加 import
    - _Requirements: 3.3, 3.4_

- [x] 2. 循环依赖解耦 — voice/init.ts
  - [x] 2.1 创建 `src/voice/init.ts`
    - 导出 `initVoice()` 执行回调注册
    - 导出 `initVoiceModule` 别名（向后兼容）
    - 模块顶层调用 `initVoice()`（side-effect）
    - try-catch + console.warn 防御性处理
    - _Requirements: 1.1, 1.3, 1.5, 1.6_

  - [x] 2.2 在 `main.tsx` 顶部添加 `import './voice/init'`
    - 静态 import（ES module 语义：模块加载时执行）
    - _Requirements: 1.2_

  - [x] 2.3 清理 `src/voice/voiceStore.ts`
    - 删除 `_callbackRegistered` 变量
    - 删除 `ensureCallbackRegistered()` 函数
    - 删除 `useVoiceStore.subscribe(...)` 块
    - 删除 `setTimeout(...)` 调用
    - 删除 `export function initVoiceModule()`
    - 更新 `src/voice/index.ts` 的 `initVoiceModule` 导出指向 `./init`
    - _Requirements: 1.4_

- [x] 3. sendFile 去重回归测试
  - [x] 3.1 创建 `src/file-transfer/__tests__/sender.dedup.test.ts`
    - 测试 1: chatMessageId 预设时 sendFile 不插入重复消息
    - 测试 2: chatMessageId 为空时 sendFile 正常插入消息
    - Mock: useChatStore, useFileTransferStore, websocket, chunker, encryptChunk
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

- [x] 4. Checkpoint — 全部测试通过
  - 运行 `npm test -- --run` 确认 344+ 测试通过
  - 运行 TypeScript 诊断确认零错误

## Notes

- 所有任务独立，可并行执行
- Task 2.3 依赖 2.1 和 2.2 完成后再执行（先建新的再删旧的）
- 不引入新依赖，不修改服务器代码

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "2.2"] },
    { "id": 2, "tasks": ["2.3"] }
  ]
}
```
