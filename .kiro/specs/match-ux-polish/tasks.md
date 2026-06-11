# Implementation Plan: Random Match UX Polish

## Overview

This plan addresses four gaps in the Random Match feature: indistinguishable user identities, session lifecycle state leaks, missing MatchRoom header, and server test compatibility. Server changes are in Go, client changes are in TypeScript/React.

## Tasks

- [x] 1. Implement server-side name generation
  - [x] 1.1 Create `arthas-server/internal/match/names.go` with `GenerateMatchName` function
    - Define the `matchNames` slice with emoji+animal pairs (minimum 64 entries / 32 pairs for <3.2% collision rate)
    - Implement `GenerateMatchName(roomId string, position int) string` using deterministic hash of roomId
    - Ensure position 0 and position 1 always yield adjacent but different names from the pair
    - Add guard clause: if position is not 0 or 1, return "Stranger" (defensive against invalid input)
    - Add fallback for empty roomId ("Stranger A" / "Stranger B")
    - _Requirements: 1.1, 1.2, 1.4_

  - [x] 1.2 Integrate name generation into `handleMatchKeyRelay` in `arthas-server/internal/match/server.go`
    - Replace hardcoded `"Anonymous"` in `JoinClientToRoom` calls with `GenerateMatchName(roomId, 0)` and `GenerateMatchName(roomId, 1)`
    - Import the `GenerateMatchName` function (same package, no import needed)
    - _Requirements: 1.1, 1.4_

  - [x] 1.3 Write property test for name determinism and distinctness
    - **Property 1: Name Determinism and Distinctness**
    - **Validates: Requirements 1.1, 1.2**
    - Create `arthas-server/internal/match/names_property_test.go`
    - Use `pgregory.net/rapid` to generate random roomId strings
    - Assert: `GenerateMatchName(id, 0) != GenerateMatchName(id, 1)` for all inputs
    - Assert: `GenerateMatchName(id, 0) == GenerateMatchName(id, 0)` (determinism) for all inputs
    - Minimum 100 iterations

- [x] 2. Implement session lifecycle cleanup
  - [x] 2.1 Create `resetChatStoreForMatch()` cleanup function in `arthas-client/src/match/matchCleanup.ts` (new file)
    - Export a synchronous function that cancels voice recording, calls voiceStore.cleanup(), aborts file transfers, and resets all chatStore room-related fields to initial values
    - Reset fields: roomId=null, roomKey=null, shareCode=null, members=[], messages=[], hasPassword=false, ephemeral=0, expiresAt=0, typingMembers=empty Map, replyTo=null, reactions=empty Map, signingKeyPair=null, publicKeyMap=empty Map
    - Import from: `../stores/chatStore`, `../voice/voiceStore`, `../file-transfer/fileTransferStore`
    - _Requirements: 2.1, 2.4_

  - [x] 2.2 Update `nextMatch()` action in `arthas-client/src/match/matchStore.ts` to call `resetChatStoreForMatch()` before re-queue
    - Import `resetChatStoreForMatch` from `./matchCleanup`
    - Call `resetChatStoreForMatch()` as the first step in `nextMatch()`
    - Then reset matchStore session fields (matchRoomId, matchKey, matchKeyRaw, matchExpiresAt, matchEphemeral, partnerId, etc.)
    - Then send MSG_MATCH_NEXT with tags
    - _Requirements: 2.1, 2.4_

  - [x] 2.3 Update `handleBackToHub` in `arthas-client/src/match/MatchPage.tsx` to reset both chatStore and matchStore
    - Import `resetChatStoreForMatch` from `./matchCleanup`
    - Call `resetChatStoreForMatch()` before resetting matchStore to idle
    - Reset matchStore status to 'idle' and clear all session fields
    - _Requirements: 2.2, 2.4_

  - [x] 2.4 Add `MsgRoomClosed` cross-store coordination in chatStore message handler
    - In `chatStore.handleServerMessage` for `MSG_ROOM_CLOSED` case, check if `useMatchStore.getState().status === 'in-room'`
    - If true, transition matchStore to `status: 'expired'` and clear session fields (matchRoomId, matchKey, matchExpiresAt)
    - Note: Use 'expired' (not 'timeout') to distinguish from queue timeout state
    - **Must also add `'expired'` to the `MatchStatus` union type** in `matchStore.ts`
    - **Must also add `'expired'` status rendering** in `MatchPage.tsx` switch/conditional (show expired UI with re-match and back-to-hub options)
    - Existing chatStore reset logic continues to apply
    - _Requirements: 2.3_

  - [x] 2.5 Write property test for next-match cleanup completeness
    - **Property 2: Next-Match Cleanup Completeness**
    - **Validates: Requirements 2.1, 2.4**
    - Create `arthas-client/src/match/__tests__/cleanup.property.test.ts`
    - Use `fast-check` (already in devDependencies) to generate random chatStore state (arbitrary messages, members, roomKey, reactions, typing state)
    - Call `resetChatStoreForMatch()`
    - Assert all room-related fields equal initial/empty values

  - [x] 2.6 Write property test for back-to-hub cleanup completeness
    - **Property 3: Back-to-Hub Cleanup Completeness**
    - **Validates: Requirements 2.2, 2.4**
    - Add to `arthas-client/src/match/__tests__/cleanup.property.test.ts`
    - Use `fast-check` to generate random chatStore + matchStore combined state
    - Invoke handleBackToHub logic
    - Assert both stores contain only initial/empty values for session-related fields

  - [x] 2.7 Write property test for room-closed state coordination
    - **Property 4: Room-Closed State Coordination**
    - **Validates: Requirements 2.3**
    - Add to `arthas-client/src/match/__tests__/cleanup.property.test.ts`
    - Use `fast-check` to generate random matchStore state with `status === 'in-room'`
    - Dispatch MsgRoomClosed event
    - Assert matchStore.status === 'expired' and chatStore room fields are reset

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement MatchRoom header component
  - [x] 4.1 Create `arthas-client/src/match/MatchRoomHeader.tsx` component
    - Implement header with: 🔒 E2EE lock icon (left), partner name or i18n placeholder, ⏱️ ephemeral duration badge (right), ExpiryCountdown component (right)
    - Use existing `ExpiryCountdown` component for expiry display
    - Use i18n translate for all user-facing strings (e.g., `t('match.room.waitingForPartner')`, `t('match.room.e2eeLabel')`)
    - Add i18n keys to translation files: `match.room.waitingForPartner`, `match.room.e2eeLabel`
    - Do NOT include room ID, share code, or "Leave Room" button
    - Apply styling: `bg-gray-800/90 border-b border-gray-700`, flex layout with justify-between
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.2 Integrate `MatchRoomHeader` into `MatchRoom.tsx`
    - Import and render MatchRoomHeader at the top of MatchRoom's flex column
    - Derive `partnerName` from `useChatStore.members` by filtering out own ID
    - Pass `matchExpiresAt` and `matchEphemeral` from matchStore as props
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [x] 4.3 Write unit tests for MatchRoomHeader rendering
    - Test rendering with partner name present
    - Test rendering with partner name absent (shows "Waiting for partner...")
    - Test rendering with ephemeral > 0 (shows duration badge)
    - Test rendering with ephemeral = 0 (no badge)
    - Verify header does NOT contain room ID or Leave button
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 5. Fix server test compatibility
  - [x] 5.1 Update `arthas-server/internal/match/server_test.go` assertions to use `decodeMatchMsg` helper
    - Find all assertions that directly inspect `client.sent` byte arrays
    - Replace with `decodeMatchMsg(msg)` calls followed by type/data struct unmarshaling
    - Ensure all test cases compile and pass
    - _Requirements: 4.1, 4.3_

  - [x] 5.2 Ensure `arthas-server/internal/match/hub_integration_test.go` passes
    - Apply same `decodeMatchMsg` migration if any assertions use old format
    - Run `go test ./internal/match/...` to verify green
    - _Requirements: 4.2_

  - [x] 5.3 Verify property-based test `TestProperty_DisconnectionCleanup` passes with new format
    - Run the existing property test and ensure it passes with the msgpack envelope format
    - Fix any format-related assertion failures
    - _Requirements: 4.4_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Server-side changes (Go) and client-side changes (TypeScript/React) can proceed in parallel where noted
- Name generation is deterministic and server-side — no client logic needed for name creation
- Session cleanup uses explicit synchronous resets — no reliance on eventual GC
- **Cross-boundary parallelism:** Wave 0 tasks (1.1 Go, 4.1 TS) can be developed in parallel by different engineers
- **Partner name integration:** Tasks 4.x can be developed/tested with placeholder names from existing "Anonymous" members; real generated names require Task 1.2 deployed to server
- **New MatchStatus value:** Task 2.4 introduces a new `'expired'` state — MatchPage.tsx rendering logic must handle this state (show expired UI with re-match/hub options)
- **fast-check already available:** TypeScript property tests (2.5-2.7) use `fast-check@^4.8.0` already in devDependencies — no new dependency needed

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "4.2"] },
    { "id": 2, "tasks": ["1.3", "2.2", "4.3"] },
    { "id": 3, "tasks": ["2.3", "5.1"] },
    { "id": 4, "tasks": ["2.4", "2.5", "5.2"] },
    { "id": 5, "tasks": ["2.6", "2.7", "5.3"] }
  ]
}
```
