# Implementation Plan: File Transfer Tech Debt

## Overview

Two surgical hardening improvements to the file transfer module:
1. Add a 60-second offline timeout timer in `setupOfflineDetection()` (sender.ts) that proactively fails stale transfers when the network remains offline before the chunk loop starts.
2. Harden the `processQueue()` → `sendFile()` bridge in `fileTransferStore.ts` with a `.catch()` safety net, a pre-flight WebSocket connection check, and a transfer-state validity guard.

## Tasks

- [x] 1. Implement offline timeout timer in sender.ts
  - [x] 1.1 Add module-level state variables and helper function for offline timeout
    - Add `offlineTimeoutId`, `offlineStartTime`, and `OFFLINE_TIMEOUT_MS` module-level variables
    - Implement `failActiveSendWithError(transferId, error)` helper that marks the transfer as failed, clears `activeSendId`, calls `removeFileRef`, and triggers `processQueue`
    - Export test helpers: `resetOfflineDetectionState()`, `getOfflineTimeoutId()`, `getOfflineStartTime()`
    - _Requirements: 1.1, 1.3_

  - [x] 1.2 Modify `setupOfflineDetection()` offline listener to start 60s timeout
    - In the `offline` event handler, guard against duplicate timers (if `offlineTimeoutId !== null`, return early)
    - Record `offlineStartTime = Date.now()`
    - Start a 60-second `setTimeout` that checks `activeSendId` and calls `failActiveSendWithError` if an active send exists, otherwise treats as no-op
    - _Requirements: 1.1, 1.4, 1.5, 1.6_

  - [x] 1.3 Modify `setupOfflineDetection()` online listener to clear timeout
    - In the `online` event handler, clear the timeout via `clearTimeout(offlineTimeoutId)` and set `offlineTimeoutId = null`
    - Reset `offlineStartTime = 0`
    - _Requirements: 1.2_

  - [x] 1.4 Write property tests for offline timeout behavior
    - **Property 1: Offline event always starts a timeout timer**
    - **Property 2: Online event cancels the offline timeout (round-trip)**
    - **Property 5: Offline timer idempotence (no duplicate timers)**
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.6**

  - [x] 1.5 Write property tests for timeout firing behavior
    - **Property 3: Offline timeout with active send fails the transfer**
    - **Property 4: Offline timeout without active send is a no-op**
    - **Validates: Requirements 1.1, 1.3, 1.5**

- [x] 2. Checkpoint - Verify offline timeout implementation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Harden processQueue-to-sendFile bridge in fileTransferStore.ts
  - [x] 3.1 Add `.catch()` safety net to the existing `sendFile()` call
    - The existing `sendFile(nextTransferId, roomKey)` call on line ~834 currently has no error handler. Add `.catch()` that extracts the error message, checks `activeSendId === nextTransferId` for idempotency, marks the transfer as failed, clears `activeSendId`, calls `removeFileRef`, and triggers `processQueue`
    - Import `removeFileRef` from `./sender` if not already imported (verify existing imports first)
    - _Requirements: 2.1_

  - [x] 3.2 Add pre-flight WebSocket connection check before the existing sendFile call
    - BEFORE the existing `sendFile(nextTransferId, roomKey)` line, add an `isConnected()` check
    - If not connected, mark the transfer as failed with descriptive connection error, clear `activeSendId`, and call `processQueue()`
    - `isConnected` is already available from `../network/websocket` (used elsewhere in the codebase) — verify it's imported in fileTransferStore.ts
    - _Requirements: 2.2, 2.3_

  - [x] 3.3 Add transfer-state validity guard before the existing sendFile call
    - AFTER the connection check but BEFORE sendFile, re-read the transfer from the store and verify it exists with status `sending`
    - If invalid, clear `activeSendId` and call `processQueue()` without invoking `sendFile()`
    - This guards against race conditions where transfer status changes between setState and sendFile invocation
    - _Requirements: 2.4, 2.5_

  - [x] 3.4 Write property tests for processQueue guards
    - **Property 6: Catch handler propagates sendFile errors to transfer state**
    - **Property 7: Pre-flight connection check fails transfer when disconnected**
    - **Property 8: Transfer validity guard prevents stale sendFile invocation**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

- [x] 4. Integration wiring and final verification
  - [x] 4.1 Verify imports and module integration
    - Ensure `isConnected` is properly imported in `fileTransferStore.ts` from `../network/websocket`
    - Ensure `removeFileRef` is imported in `fileTransferStore.ts` from `./sender`
    - Verify no circular dependency issues between sender.ts and fileTransferStore.ts
    - _Requirements: 2.2, 2.1_

  - [x] 4.2 Write integration tests for offline timeout + processQueue interaction
    - Test that offline timeout fires and fails active send during processQueue-initiated transfer
    - Test that `.catch()` handler and offline timeout do not conflict (double-fail guard)
    - _Requirements: 1.1, 1.3, 2.1_

- [x] 5. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The implementation language is TypeScript (matching the existing arthas-client codebase)
- Both changes are surgical additions to existing functions — no architectural changes needed
- The `.catch()` handler includes an idempotency guard (`activeSendId === nextTransferId`) to prevent double-failure if sendFile already handled the error internally

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["3.3"] },
    { "id": 5, "tasks": ["3.4", "4.1"] },
    { "id": 6, "tasks": ["4.2"] }
  ]
}
```
