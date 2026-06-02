# Requirements Document

## Introduction

This specification addresses two tech debt items in the file transfer module of the Arthas client. The first adds a defense-in-depth 60-second offline timeout in `setupOfflineDetection()` that proactively fails an active transfer when the network remains offline, covering the edge case where a transfer has not yet entered the chunk loop. The second hardens the `processQueue()` → `sendFile()` bridge with a `.catch()` safety net, a pre-flight WebSocket connection check, and a transfer-state validity guard.

## Glossary

- **Sender**: The `sender.ts` module responsible for encrypting and transmitting file chunks over WebSocket.
- **FileTransferStore**: The Zustand store (`fileTransferStore.ts`) managing transfer lifecycle state and the send queue.
- **OfflineDetection**: The `setupOfflineDetection()` function that registers browser `offline`/`online` event listeners to pause and resume file transfers.
- **ProcessQueue**: The internal `processQueue()` function that dequeues the next pending transfer, marks it as active, and invokes `sendFile()`.
- **ActiveSend**: The currently in-progress file transmission identified by `activeSendId` in the FileTransferStore.
- **OfflineTimeout**: A 60-second `setTimeout` timer started when the browser fires the `offline` event, used to fail the ActiveSend if the network does not recover in time.
- **FailActiveSend**: The action of marking the ActiveSend as `failed`, clearing `activeSendId`, and triggering ProcessQueue to advance to the next queued transfer.

## Requirements

### Requirement 1: Offline Timeout Timer in setupOfflineDetection

**User Story:** As a user sending a file, I want the transfer to fail automatically after 60 seconds of continuous offline state, so that stale transfers do not remain indefinitely paused when the network is lost before the chunk loop starts.

**Current state:** The `sendAllChunks()` chunk loop already has a 60-second polling timeout that aborts the transfer if `isPaused` remains true for 60s. However, `setupOfflineDetection()` itself has no timer — if a transfer is in the metadata encryption phase (before entering the chunk loop), it will pause indefinitely. This requirement adds a defense-in-depth timer at the offline-detection layer.

#### Acceptance Criteria

1.1 WHEN the browser fires the `offline` event AND an ActiveSend exists, THE OfflineDetection SHALL record the current timestamp as the offline start time and start a 60-second setTimeout that invokes FailActiveSend with an appropriate timeout error message.

1.2 WHEN the browser fires the `online` event, THE OfflineDetection SHALL clear the OfflineTimeout timer (if active) and reset the offline start time.

1.3 WHEN the OfflineTimeout fires (60 seconds elapsed while offline), THE OfflineDetection SHALL call FailActiveSend to mark the ActiveSend as `failed` with a descriptive error indicating network offline timeout.

1.4 WHEN no ActiveSend exists at the time the `offline` event fires, THE OfflineDetection SHALL still start the OfflineTimeout so that a transfer entering the active state during the offline period is covered by the existing chunk-loop timeout.

1.5 IF the OfflineTimeout fires but no ActiveSend exists at that moment, THEN THE OfflineDetection SHALL treat the timeout as a no-op and not modify any transfer state.

1.6 WHEN a new `offline` event fires while an existing OfflineTimeout is already running, THE OfflineDetection SHALL not start a duplicate timer (the first timer remains authoritative).

### Requirement 2: Defensive Hardening of sendFile Invocation in processQueue

**User Story:** As a developer, I want the existing processQueue-to-sendFile call to be resilient against unhandled promise rejections, disconnected WebSocket, and stale transfer state, so that unexpected failures do not leave the send queue permanently blocked.

**Current state:** `processQueue()` already correctly calls `sendFile(nextTransferId, roomKey)` (the basic wiring is complete). However, the call lacks three defensive guards: (1) no `.catch()` on the returned Promise, (2) no pre-flight WebSocket connection check, and (3) no re-validation of transfer state after async state changes. This requirement adds those guards around the existing call.

#### Acceptance Criteria

2.1 WHEN ProcessQueue invokes `sendFile()`, THE FileTransferStore SHALL attach a `.catch()` handler to the returned Promise that calls FailActiveSend with the caught error message and triggers ProcessQueue to advance the queue.

2.2 WHEN ProcessQueue is about to invoke `sendFile()`, THE FileTransferStore SHALL verify that the WebSocket connection is open by calling `isConnected()` before invoking `sendFile()`.

2.3 IF the WebSocket connection is not open at the pre-flight check, THEN THE FileTransferStore SHALL mark the transfer as `failed` with a descriptive connection error, clear `activeSendId`, and trigger ProcessQueue to process the next queued transfer.

2.4 WHEN ProcessQueue is about to invoke `sendFile()`, THE FileTransferStore SHALL verify that the transfer still exists in the transfers Map and its status is `sending`.

2.5 IF the transfer does not exist or its status is not `sending` at the validity check, THEN THE FileTransferStore SHALL clear `activeSendId` and trigger ProcessQueue without invoking `sendFile()`.
