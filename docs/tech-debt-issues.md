# Tech Debt Issues

> 本文件追踪代码中的 TODO/FIXME 注释，将其转化为可跟踪的技术债务条目。
> 每个条目对应一个待实现的功能或待修复的问题，方便贡献者认领任务。

---

## Issue 1: [Tech Debt] Implement 60s offline timeout for file transfer pause/resume

**Labels:** `tech-debt`, `frontend`, `file-transfer`

**File:** `arthas-client/src/file-transfer/sender.ts`

**Context:**

The `setupOfflineDetection()` function registers `offline` and `online` event listeners that pause/resume file transfers when network connectivity changes. Currently, the handlers only toggle the `isPaused` flag but lack a 60-second timeout mechanism — if the user stays offline for more than 60 seconds, the transfer should be aborted rather than indefinitely paused.

```typescript
window.addEventListener('offline', () => {
  isPaused = true;
  // TODO: 实现 60s 离线超时判断（记录离线开始时间）

  // 更新活跃传输的 UI 状态（如果有的话）
  const { activeSendId } = useFileTransferStore.getState();
  if (activeSendId) {
    console.warn('[FileTransfer] Network offline, pausing transfer:', activeSendId);
  }
});

window.addEventListener('online', () => {
  isPaused = false;
  // TODO: 实现 60s 离线超时判断（重置在线时间）

  // 检查 WebSocket 是否仍然连接
  if (isConnected()) {
    console.log('[FileTransfer] Network online, resuming transfer');
  } else {
    console.log('[FileTransfer] Network online but WebSocket disconnected, waiting for reconnect');
  }
});
```

**What needs to be done:**

1. In the `offline` handler: record `Date.now()` as the offline start time and start a 60-second `setTimeout` that aborts the active transfer if it fires.
2. In the `online` handler: clear the timeout, check elapsed time since going offline, and only resume if under 60 seconds — otherwise abort the transfer.
3. Update the file transfer store state to reflect timeout-based failure (call `failActiveSend()` with an appropriate error message).

---

## Issue 2: [Tech Debt] Wire up file send queue to actual sender logic

**Labels:** `tech-debt`, `frontend`, `file-transfer`

**File:** `arthas-client/src/file-transfer/fileTransferStore.ts`

**Context:**

The `processQueue` function in the file transfer store correctly manages the send queue (dequeuing the next file, setting it as active, tracking start time), but the actual call to `sender.ts` send logic is stubbed out. The queue management is complete but the bridge to the real sending mechanism is missing.

```typescript
return {
  transfers: newTransfers,
  sendQueue: state.sendQueue.slice(1), // 从队列中移除
  activeSendId: nextTransferId,
};

// TODO: task 4.3 — 触发 sender.ts 的实际发送逻辑
// sender.sendFile(file, roomKey) 将在 task 4.3 中实现
// 发送完成后，sender.ts 会调用 completeActiveSend() 或 failActiveSend()
console.log('[FileTransfer] Queue processing: starting send for', nextTransferId);
```

**What needs to be done:**

1. Import and call `sender.sendFile(file, roomKey)` when a queued file becomes the active transfer.
2. Ensure `sender.sendFile` calls `completeActiveSend()` on success or `failActiveSend()` on error to advance the queue.
3. Handle edge cases: missing room key (already partially handled), WebSocket disconnection during send, and user-initiated cancellation.
