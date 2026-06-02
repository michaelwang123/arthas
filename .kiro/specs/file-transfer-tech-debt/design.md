# Design Document: File Transfer Tech Debt

## Overview

This design addresses two defensive hardening improvements in the file transfer module:

1. **Offline Timeout Timer** — A 60-second proactive timeout in `setupOfflineDetection()` that fails stale transfers when the network remains offline before the chunk loop's own timeout kicks in. Note: `sendAllChunks()` already has a 60s polling timeout inside its chunk-sending loop; this is a complementary defense-in-depth layer covering the metadata encryption phase.
2. **Robust processQueue-to-sendFile Bridge** — The existing `sendFile(nextTransferId, roomKey)` call in `processQueue()` works correctly but lacks defensive guards. This adds a `.catch()` safety net, a pre-flight WebSocket connection check, and a transfer-state validity guard around the existing call to prevent unhandled rejections and permanently blocked queues.

Both changes are surgical additions to existing functions with no architectural changes.

## Architecture

The changes fit within the existing layered architecture:

```
┌──────────────────────────────────────────────┐
│           setupOfflineDetection()            │  ← NEW: 60s OfflineTimeout
│  (sender.ts — module-level event listeners)  │
└──────────────────────────┬───────────────────┘
                           │ calls FailActiveSend
                           ▼
┌──────────────────────────────────────────────┐
│              processQueue()                  │  ← NEW: .catch(), isConnected(),
│  (fileTransferStore.ts — queue scheduler)    │         validity guard
└──────────────────────────┬───────────────────┘
                           │ invokes
                           ▼
┌──────────────────────────────────────────────┐
│              sendFile()                      │
│  (sender.ts — chunk encryption & send loop) │
└──────────────────────────────────────────────┘
```

## Component Design

### Component 1: Offline Timeout Timer (`sender.ts`)

#### Module-Level State Additions

```typescript
/** Offline timeout timer handle (null when not active) */
let offlineTimeoutId: ReturnType<typeof setTimeout> | null = null;

/** Timestamp when the browser went offline (0 when online) */
let offlineStartTime = 0;

/** Offline timeout duration in milliseconds */
const OFFLINE_TIMEOUT_MS = 60_000;
```

#### Modified `setupOfflineDetection()`

The existing `offline` event listener gains timer-start logic. The `online` listener gains timer-clear logic.

```typescript
export function setupOfflineDetection(): void {
  if (offlineDetectionInitialized) return;
  offlineDetectionInitialized = true;

  window.addEventListener('offline', () => {
    isPaused = true;

    // Guard: do not start a duplicate timer if one is already running
    if (offlineTimeoutId !== null) return;

    offlineStartTime = Date.now();

    offlineTimeoutId = setTimeout(() => {
      offlineTimeoutId = null; // Timer has fired, clear handle

      // If an active send exists, fail it with a timeout error
      const { activeSendId } = useFileTransferStore.getState();
      if (activeSendId) {
        console.warn('[FileTransfer] Offline timeout: failing active send', activeSendId);
        failActiveSendWithError(activeSendId, 'Network offline for 60 seconds, transfer timed out');
      }
      // If no active send, this is a no-op
    }, OFFLINE_TIMEOUT_MS);

    const { activeSendId } = useFileTransferStore.getState();
    if (activeSendId) {
      console.warn('[FileTransfer] Network offline, pausing transfer:', activeSendId);
    }
  });

  window.addEventListener('online', () => {
    isPaused = false;

    // Clear the offline timeout if active
    if (offlineTimeoutId !== null) {
      clearTimeout(offlineTimeoutId);
      offlineTimeoutId = null;
    }
    offlineStartTime = 0;

    if (isConnected()) {
      console.log('[FileTransfer] Network online, resuming transfer');
    } else {
      console.log('[FileTransfer] Network online but WebSocket disconnected, waiting for reconnect');
    }
  });
}
```

#### Helper: `failActiveSendWithError`

```typescript
/**
 * Fail the active send transfer and advance the queue.
 * Reuses the existing pattern from failTransfer() but operates on the
 * activeSendId without needing a separate transferId lookup.
 */
function failActiveSendWithError(transferId: string, error: string): void {
  useFileTransferStore.setState((state) => {
    const transfers = new Map(state.transfers);
    const transfer = transfers.get(transferId);
    if (transfer && transfer.status === 'sending') {
      transfers.set(transferId, {
        ...transfer,
        status: 'failed' as TransferStatus,
        error,
      });
    }
    return {
      transfers,
      activeSendId: null,
    };
  });

  removeFileRef(transferId);
  triggerProcessQueue();
}
```

#### Test Helpers (exported for testing)

```typescript
/** Reset offline detection state (for tests only) */
export function resetOfflineDetectionState(): void {
  if (offlineTimeoutId !== null) {
    clearTimeout(offlineTimeoutId);
    offlineTimeoutId = null;
  }
  offlineStartTime = 0;
  isPaused = false;
  offlineDetectionInitialized = false;
}

/** Get the current offline timeout ID (for test assertions) */
export function getOfflineTimeoutId(): ReturnType<typeof setTimeout> | null {
  return offlineTimeoutId;
}

/** Get the offline start time (for test assertions) */
export function getOfflineStartTime(): number {
  return offlineStartTime;
}
```

---

### Component 2: Robust `processQueue()` Bridge (`fileTransferStore.ts`)

The existing `processQueue()` function already calls `sendFile(nextTransferId, roomKey)` correctly (line ~834). The modification adds three defensive guards **around** the existing call without changing the core logic.

#### Current Code (line ~832-834 of fileTransferStore.ts)

```typescript
// Current: bare call without guards
sendFile(nextTransferId, roomKey);
```

#### Modified Code: Add guards before and .catch() after the existing call

```typescript
function processQueue(): void {
  const { activeSendId, sendQueue, transfers } = useFileTransferStore.getState();

  if (activeSendId !== null) return;
  if (sendQueue.length === 0) return;

  const nextTransferId = sendQueue[0];
  const transfer = transfers.get(nextTransferId);

  if (!transfer || transfer.status !== 'pending') {
    useFileTransferStore.setState((state) => ({
      sendQueue: state.sendQueue.slice(1),
    }));
    processQueue();
    return;
  }

  // Mark as sending and set as active
  useFileTransferStore.setState((state) => {
    const newTransfers = new Map(state.transfers);
    const currentTransfer = newTransfers.get(nextTransferId);
    if (currentTransfer) {
      newTransfers.set(nextTransferId, {
        ...currentTransfer,
        status: 'sending' as TransferStatus,
        startTime: Date.now(),
      });
    }
    return {
      transfers: newTransfers,
      sendQueue: state.sendQueue.slice(1),
      activeSendId: nextTransferId,
    };
  });

  // --- NEW: Pre-flight guard 1: WebSocket connection check ---
  if (!isConnected()) {
    console.warn('[FileTransfer] WebSocket not connected, failing transfer:', nextTransferId);
    useFileTransferStore.setState((state) => {
      const newTransfers = new Map(state.transfers);
      const t = newTransfers.get(nextTransferId);
      if (t) {
        newTransfers.set(nextTransferId, {
          ...t,
          status: 'failed' as TransferStatus,
          error: 'WebSocket connection not available, cannot send file',
        });
      }
      return { transfers: newTransfers, activeSendId: null };
    });
    processQueue();
    return;
  }

  // --- NEW: Pre-flight guard 2: Transfer validity check ---
  const freshTransfer = useFileTransferStore.getState().transfers.get(nextTransferId);
  if (!freshTransfer || freshTransfer.status !== 'sending') {
    console.warn('[FileTransfer] Transfer state invalid at send time, skipping:', nextTransferId);
    useFileTransferStore.setState({ activeSendId: null });
    processQueue();
    return;
  }

  const { roomKey } = useChatStore.getState();
  if (!roomKey) {
    useFileTransferStore.setState((state) => {
      const newTransfers = new Map(state.transfers);
      const t = newTransfers.get(nextTransferId);
      if (t) {
        newTransfers.set(nextTransferId, {
          ...t,
          status: 'failed' as TransferStatus,
          error: '房间密钥不可用，无法加密文件',
        });
      }
      return { transfers: newTransfers, activeSendId: null };
    });
    processQueue();
    return;
  }

  // --- NEW: .catch() safety net on sendFile promise ---
  sendFile(nextTransferId, roomKey).catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : 'Unknown sendFile error';
    console.error('[FileTransfer] sendFile unhandled rejection:', errorMessage);

    // Only fail if this transfer is still the active send (not already handled)
    const currentState = useFileTransferStore.getState();
    if (currentState.activeSendId === nextTransferId) {
      useFileTransferStore.setState((state) => {
        const newTransfers = new Map(state.transfers);
        const t = newTransfers.get(nextTransferId);
        if (t && t.status === 'sending') {
          newTransfers.set(nextTransferId, {
            ...t,
            status: 'failed' as TransferStatus,
            error: errorMessage,
          });
        }
        return { transfers: newTransfers, activeSendId: null };
      });
      removeFileRef(nextTransferId);
      processQueue();
    }
  });
}
```

#### Import Addition

`fileTransferStore.ts` needs to import `isConnected` and `removeFileRef`:

```typescript
import { storeFileRef, sendFile, removeFileRef } from './sender';
import { isConnected } from '../network/websocket';
```

---

## Interfaces

No new public interfaces are introduced. The changes are internal to existing modules.

### Modified Exports from `sender.ts`

| Export | Type | Purpose |
|--------|------|---------|
| `resetOfflineDetectionState()` | Function | Test helper to reset timer state |
| `getOfflineTimeoutId()` | Function | Test helper to inspect timer handle |
| `getOfflineStartTime()` | Function | Test helper to inspect offline timestamp |

---

## Data Models

No new data models. The changes add module-level state variables:

| Variable | Type | Location | Purpose |
|----------|------|----------|---------|
| `offlineTimeoutId` | `ReturnType<typeof setTimeout> \| null` | sender.ts | Handle for the 60s timeout |
| `offlineStartTime` | `number` | sender.ts | Timestamp when offline started |
| `OFFLINE_TIMEOUT_MS` | `number` (const) | sender.ts | 60000ms timeout duration |

---

## Error Handling

### Offline Timeout Error Flow

1. Browser fires `offline` → timer starts (60s)
2. Timer fires → check `activeSendId`
3. If active send exists → `failActiveSendWithError(id, "Network offline for 60 seconds, transfer timed out")`
4. Transfer marked `failed`, `activeSendId` cleared, queue advances
5. If no active send → no-op (timer silently clears)

### processQueue Error Flows

| Guard | Condition | Error Message | Recovery |
|-------|-----------|---------------|----------|
| Connection check | `!isConnected()` | "WebSocket connection not available, cannot send file" | Fail transfer, advance queue |
| Validity check | Transfer missing or status ≠ `sending` | N/A (skip, no error set) | Clear activeSendId, advance queue |
| `.catch()` handler | `sendFile()` rejects | Caught error message | Fail transfer, advance queue |

### Idempotency Guarantees

- The `.catch()` handler checks `activeSendId === nextTransferId` before modifying state, preventing double-failure if `sendFile` already handled the error internally.
- The offline timeout callback checks transfer status before failing, preventing modification of already-completed transfers.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Offline event always starts a timeout timer

*For any* application state (with or without an active send), when the browser fires the `offline` event and no timer is currently running, the offline timeout timer SHALL be started (timer handle becomes non-null and offline start time is recorded).

**Validates: Requirements 1.1, 1.4**

### Property 2: Online event cancels the offline timeout (round-trip)

*For any* state where an offline timeout is running, when the browser fires the `online` event, the timer SHALL be cleared (timer handle becomes null) and the offline start time SHALL be reset to zero. No FailActiveSend shall occur after the online event even if 60 seconds have elapsed since offline.

**Validates: Requirements 1.2**

### Property 3: Offline timeout with active send fails the transfer

*For any* active send transfer, if the offline timeout fires (60 seconds elapsed while offline), the transfer SHALL be marked as `failed` with a timeout error message, `activeSendId` SHALL be cleared, and the queue SHALL advance.

**Validates: Requirements 1.1, 1.3**

### Property 4: Offline timeout without active send is a no-op

*For any* state where no active send exists (`activeSendId` is null) when the offline timeout fires, the transfers map SHALL remain unchanged and no transfer state shall be modified.

**Validates: Requirements 1.5**

### Property 5: Offline timer idempotence (no duplicate timers)

*For any* state where an offline timeout is already running, firing a second `offline` event SHALL NOT create an additional timer. The timer handle remains the same (only one timer is active at any time).

**Validates: Requirements 1.6**

### Property 6: Catch handler propagates sendFile errors to transfer state

*For any* error thrown or rejected by `sendFile()`, the `.catch()` handler SHALL mark the active transfer as `failed` with the error message, clear `activeSendId`, and trigger `processQueue()` to advance the queue.

**Validates: Requirements 2.1**

### Property 7: Pre-flight connection check fails transfer when disconnected

*For any* queued transfer that reaches the sendFile invocation point, if `isConnected()` returns false, the transfer SHALL be marked as `failed` with a connection error message, `activeSendId` SHALL be cleared, `sendFile()` SHALL NOT be invoked, and the queue SHALL advance.

**Validates: Requirements 2.2, 2.3**

### Property 8: Transfer validity guard prevents stale sendFile invocation

*For any* queued transfer that reaches the sendFile invocation point, if the transfer no longer exists in the transfers Map or its status is not `sending`, `sendFile()` SHALL NOT be invoked, `activeSendId` SHALL be cleared, and the queue SHALL advance.

**Validates: Requirements 2.4, 2.5**
