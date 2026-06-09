# Implementation Plan: Random Match (随机配对聊天)

## Overview

This plan implements the "encrypted Omegle" random match feature for Arthas Hub. The server-side is built as an independent Go module (`arthas-server/internal/match/`) that integrates with the existing Hub via range-based message routing and the `RoomCreator` interface. The client-side adds a React module (`arthas-client/src/match/`) with a Zustand store managing the full match state machine. Implementation proceeds bottom-up: protocol → server core → server integration → client store → client UI → wiring.

## Tasks

- [x] 1. Define protocol constants and message data structures
  - [x] 1.1 Define match message type constants in the match package
    - Create `arthas-server/internal/match/protocol.go` with constants `MsgMatchRequest` (0x20) through `MsgMatchInviteCreated` (0x2F)
    - Define client→server types (0x20-0x27) and server→client types (0x28-0x2F)
    - Add match error code constants (M001-M012)
    - Add a comment in `arthas-server/internal/network/protocol.go` reserving 0x20-0x2F for the match module (no actual constant definitions there — avoids circular imports since hub.go imports match)
    - _Requirements: 6.1, 6.2_

  - [x] 1.2 Create match message data structures with MessagePack serialization
    - Create `arthas-server/internal/match/messages.go` with all request/response structs: `MatchRequestData`, `MatchKeyRelayData`, `MatchInviteJoinData`, `MatchReportData`, `MatchNextData`, `MatchGenerateKeyData`, `MatchFoundData`, `MatchTimeoutData`, `MatchErrorData`, `MatchExtendedData`, `MatchInviteCreatedData`
    - Use `msgpack` struct tags consistent with existing protocol
    - _Requirements: 6.4, 6.5_

  - [x] 1.3 Define client-side match protocol constants and TypeScript interfaces
    - Create `arthas-client/src/match/protocol.ts` with match message type constants (0x20-0x2F) and TypeScript interfaces for all message data structures (MatchRequestData, MatchFoundData, etc.)
    - _Requirements: 6.1, 6.4_

- [x] 2. Implement server-side match configuration
  - [x] 2.1 Create match configuration module
    - Create `arthas-server/internal/match/config.go` with the `Config` struct containing all configurable parameters: `Enabled`, `MatchTimeout` (60s), `KeyExchangeTimeout` (5s), `RoomExpiry` (30min), `EphemeralSeconds` (60), `MaxQueueSize` (100), `CooldownPeriod` (10s), `HourlyRateLimit` (20), `BlockDuration` (24h), `MaxExtensions` (3), `TagFallbackDelay` (10s), `InviteLinkTTL` (5min), `CleanupInterval` (30s)
    - Implement `DefaultConfig()` and `Validate()` with fail-fast descriptive errors
    - Implement `ParseEnv()` helper that reads environment variables (`DISABLE_RANDOM_MATCH`, etc.) into Config fields (CLI flag registration is handled in task 12.7 within `cmd/server/main.go`)
    - _Requirements: 14.1, 14.4, 14.5_

  - [x] 2.2 Write property test for configuration validation (Property 13)
    - **Property 13: Configuration validation**
    - Generate random Config values; verify `Validate()` returns error iff any parameter is invalid (negative durations, zero max queue size, etc.)
    - Test file: `arthas-server/internal/match/config_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 14.5**

- [x] 3. Implement Match Queue core
  - [x] 3.1 Create MatchQueue data structure and operations
    - Create `arthas-server/internal/match/queue.go` with `MatchEntry` struct and `MatchQueue` struct (sync.Mutex, entries slice, byClient map, maxSize)
    - Implement `Enqueue()` (reject duplicates + full queue), `Remove()`, `DequeuePair()` (atomic removal), `Size()`, `Contains()`, `ExpireEntries()`
    - _Requirements: 1.2, 1.3, 1.7, 2.6, 8.5_

  - [x] 3.2 Write property test for queue uniqueness (Property 1)
    - **Property 1: Queue uniqueness**
    - For any sequence of Enqueue operations, verify a client ID appears at most once in the queue
    - Test file: `arthas-server/internal/match/queue_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 1.3, 2.5**

  - [x] 3.3 Write property test for atomic pair removal (Property 2)
    - **Property 2: Atomic pair removal**
    - After DequeuePair, verify neither client ID exists in queue
    - Test file: `arthas-server/internal/match/queue_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 2.6**

- [x] 4. Implement matching algorithm
  - [x] 4.1 Implement RecentPairsTracker as independent module
    - Create `arthas-server/internal/match/recent_pairs.go` with `RecentPairsTracker` struct (sync.Mutex, pairs map)
    - Implement `RecordPair()` (bidirectional, ring buffer of last 5), `IsRecentPair()`, `Remove()`
    - _Requirements: 12.5_

  - [x] 4.2 Implement FindMatch and FindAllMatches with tag-based priority and FIFO fallback
    - Add `FindMatch()` to `queue.go`: prefer tag overlap, fall back to FIFO after `TagFallbackDelay`, respect recent pairs exclusion
    - Add `FindAllMatches()`: loop `FindMatch` until no more pairs (batch matching)
    - Define `ValidTags` set and tag validation helper in `arthas-server/internal/match/tags.go`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 5.5, 5.6_

  - [x] 4.3 Write property test for tag-based matching preference (Property 3)
    - **Property 3: Tag-based matching preference**
    - Verify that users sharing tags are paired before non-sharing users when within TagFallbackDelay
    - Test file: `arthas-server/internal/match/match_algorithm_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 2.1, 2.3**

  - [x] 4.4 Write property test for FIFO fallback ordering (Property 4)
    - **Property 4: FIFO fallback ordering**
    - Verify earliest-enqueued user is matched first when no tag overlap exists
    - Test file: `arthas-server/internal/match/queue_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 2.2, 2.3**

  - [x] 4.5 Write property test for no self-match or recent-partner re-match (Property 5)
    - **Property 5: No self-match or recent-partner re-match**
    - Verify system never pairs a user with themselves or with a recent partner from RecentPairsTracker
    - Test file: `arthas-server/internal/match/match_algorithm_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 12.5**

  - [x] 4.6 Write property test for tag validation round-trip (Property 6)
    - **Property 6: Tag validation round-trip**
    - Verify server accepts tag sets iff 0-3 elements all from ValidTags
    - Test file: `arthas-server/internal/match/match_algorithm_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 5.5, 5.6**

  - [x] 4.7 Write property test for batch matching completeness (Property 15)
    - **Property 15: Batch matching completeness**
    - Enqueue N random users; verify FindAllMatches returns floor(N/2) pairs in a single call
    - Test file: `arthas-server/internal/match/queue_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 2.4**

- [x] 5. Checkpoint - Ensure all queue and matching tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement rate limiting and IP blocking
  - [x] 6.1 Create rate limiter module
    - Create `arthas-server/internal/match/ratelimit.go` with `MatchRateLimiter` struct (sync.Mutex, per-connection cooldown tracking, per-IP hourly sliding window, IP block list with expiry)
    - Implement `CheckCooldown()`, `CheckHourlyLimit()`, `IsBlocked()`, `RecordReport()`, `CleanExpired()`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.3, 8.4_

  - [x] 6.2 Write property test for rate limit enforcement (Property 7)
    - **Property 7: Rate limit enforcement**
    - Verify cooldown rejects requests within period; verify hourly limit rejects after threshold
    - Test file: `arthas-server/internal/match/ratelimit_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 7. Implement Invite Link system
  - [x] 7.1 Create InviteLinkStore module
    - Create `arthas-server/internal/match/invite.go` with `InviteLink` struct and `InviteLinkStore` (sync.Mutex, token map, creator index)
    - Implement `Create()` (crypto-random token, 5min TTL), `Use()` (single-use + expiry validation), `GetByCreator()`, `CleanExpired()`
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.7_

  - [x] 7.2 Write property test for invite link single-use and expiry (Property 8)
    - **Property 8: Invite link single-use and expiry**
    - Verify token rejected after use; verify token rejected after TTL expiry
    - Test file: `arthas-server/internal/match/invite_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 11.4, 11.5**

- [x] 8. Implement Match Room State and Extension logic
  - [x] 8.1 Create MatchRoomStateStore module
    - Create `arthas-server/internal/match/room_state.go` with `MatchRoomState` struct and `MatchRoomStateStore` (sync.Mutex, states map by roomID)
    - Implement `Add()`, `Get()`, `Remove()`, `ProposeExtend()` (mutual consent logic: returns true when both users propose), `CleanExpiredProposals()` (60s TTL)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 8.2 Write property test for room extension mutual consent (Property 9)
    - **Property 9: Room extension mutual consent**
    - Verify room expiry only extends when both users propose; single proposal alone does not extend
    - Test file: `arthas-server/internal/match/room_state_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 13.3**

  - [x] 8.3 Write property test for extension count limit (Property 10)
    - **Property 10: Extension count limit**
    - Verify extensions never exceed MaxExtensions; proposals after limit are rejected
    - Test file: `arthas-server/internal/match/room_state_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 13.4**

- [x] 9. Implement PendingMatchStore and key exchange flow
  - [x] 9.1 Create PendingMatchStore for key exchange state management
    - Create `arthas-server/internal/match/pending.go` with `PendingMatch` struct and `PendingMatchStore` (sync.Mutex, pending map, byAny bidirectional index)
    - Implement `Add()`, `GetByClient()`, `Remove()`, `ExpireAll()`
    - Note: The actual key relay handler logic (receive key → forward → create room) is implemented in task 10.4
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_

  - [x] 9.2 Write property test for key exchange timeout (Property 14)
    - **Property 14: Key exchange timeout**
    - Verify PendingMatch is cancelled and users re-queued if MatchKeyRelay not received within KeyExchangeTimeout
    - Test file: `arthas-server/internal/match/server_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 3.6**

- [x] 10. Implement MatchServer main logic
  - [x] 10.1 Create MatchServer struct with Run/Stop lifecycle
    - Create `arthas-server/internal/match/server.go` as the main orchestrator
    - Implement `NewMatchServer(config, roomCreator)`, `Run()` (match ticker 1s, cleanup ticker 30s, timeout ticker 5s), `Stop()`
    - Implement `HandleMessage()` router dispatching to specific handlers based on message type
    - Implement `HandleDisconnect()` checking queue, pending match, and room state
    - _Requirements: 1.1, 1.6, 1.7, 2.4, 3.6, 4.1, 10.1, 10.2_

  - [x] 10.2 Write property test for disconnection cleanup (Property 11)
    - **Property 11: Disconnection cleanup**
    - Verify disconnected client removed from queue, pending match (partner re-queued), and recent pairs
    - Test file: `arthas-server/internal/match/server_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 10.1, 10.2**

  - [x] 10.3 Implement queue entry and cancel handlers
    - `handleMatchRequest`: validate tags, check cooldown/rate limit/block/queue full/already in queue/already in room, enqueue
    - `handleMatchCancel`: remove from queue
    - _Requirements: 1.1-1.7, 7.1-7.4, 8.1-8.5_

  - [x] 10.4 Implement key relay and room creation handler
    - `handleMatchKeyRelay`: forward key to Client B, create room via RoomCreator, create MatchRoomState, send MatchFound to both
    - _Requirements: 3.1-3.6_

  - [x] 10.5 Implement session flow handlers
    - `handleInviteJoin`: validate token, pair with creator, initiate key exchange
    - `handleNext`: leave current room, re-enter queue with same tags, exclude recent partner via RecentPairsTracker
    - _Requirements: 11.2-11.5, 12.1-12.5_

  - [x] 10.6 Implement report and extension handlers
    - `handleReport`: validate reason, record report, check IP threshold for blocking
    - `handleExtendRequest`: delegate to MatchRoomStateStore.ProposeExtend, extend room if mutual
    - _Requirements: 8.1-8.4, 13.1-13.5_

- [x] 11. Checkpoint - Ensure all server-side tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Integrate MatchServer with Hub
  - [x] 12.1 Add range-based message routing in Hub.HandleMessage
    - Modify `arthas-server/internal/network/hub.go` to route message types 0x20-0x2F to `matchServer.HandleMessage()`
    - If `matchServer` is nil (feature disabled), respond with M001 error
    - _Requirements: 6.1, 6.3, 14.1, 14.2_

  - [x] 12.2 Add disconnect notification to Hub unregister flow
    - In Hub's unregister case, call `matchServer.HandleDisconnect(client.ID)` if matchServer is non-nil
    - _Requirements: 10.1, 10.2_

  - [x] 12.3 Add per-room MaxMembers field to Room and enforce in join logic
    - Add `MaxMembers int` field to `room.Room` struct in `arthas-server/internal/room/`
    - Rename existing package-level `MaxMembers` constant to `DefaultMaxMembers`
    - Update `IsFull()`: if per-room `MaxMembers > 0`, use it as the limit; if `MaxMembers == 0`, fall back to `DefaultMaxMembers` (50) for backward compatibility
    - Update `NewRoom()` signature to accept optional maxMembers parameter (0 = use default)
    - Update existing `CreateRoom()` call sites to pass 0 (preserves current behavior)
    - _Requirements: 3.3_

  - [x] 12.4 Implement RoomCreator interface on Hub
    - Add `CreateMatchRoom(expiresAt, ephemeral)` method to Hub — creates room with maxMembers=2, no HubRegistry registration
    - Add `JoinClientToRoom(client, roomId, name)` method to Hub
    - Add compile-time interface check: `var _ match.RoomCreator = (*Hub)(nil)`
    - _Requirements: 3.3, 3.5_

  - [x] 12.5 Write property test for Match_Room isolation (Property 12)
    - **Property 12: Match_Room isolation**
    - Verify match rooms don't appear in HubRegistry listing and don't count toward maxPublicRooms
    - Test file: `arthas-server/internal/match/hub_integration_test.go`
    - Use `pgregory.net/rapid` library
    - **Validates: Requirements 3.3**

  - [x] 12.6 Add Hub Stats API endpoint
    - Create `arthas-server/internal/hub/stats.go` with `HubStatsHandler` struct implementing `http.Handler`
    - Return JSON: `HubStatsData { online, matchEnabled, matchQueueSize }`
    - Apply same CORS handling as existing `/api/hub` endpoint (AllowedOrigins)
    - Register route in `cmd/server/main.go`: `mux.Handle("/api/hub/stats", statsHandler)`
    - _Requirements: 9.2, 14.3_

  - [x] 12.7 Wire MatchServer initialization in Hub startup
    - Parse `--disable-random-match` flag and `DISABLE_RANDOM_MATCH` env var in `cmd/server/main.go`
    - If enabled: create Config, validate, instantiate MatchServer, start `matchServer.Run()` goroutine
    - If disabled: leave `matchServer` nil (range router returns M001)
    - Add `matchServer.Stop()` to Hub shutdown flow
    - _Requirements: 14.1, 14.2, 14.4, 14.5_

  - [x] 12.8 Add SPA catch-all route for `/match/*` path
    - Ensure Go HTTP server returns `index.html` for `/match/*` routes (consistent with existing SPA catch-all)
    - _Requirements: 11.7_

- [x] 13. Checkpoint - Ensure server integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement client-side match store
  - [x] 14.1 Create matchStore state definition and basic actions
    - Create `arthas-client/src/match/matchStore.ts` with Zustand store
    - Define full state type: status (`idle` | `selecting-tags` | `waiting` | `pairing` | `found` | `timeout` | `in-room`), selectedTags, waitStartTime, elapsedSeconds, matchRoomId, matchKey, isKeyGenerator, inviteLink, extensionProposed, extensionCount, partnerProposedExtend, recentPartnerIds, matchEnabled, onlineCount
    - Implement `startMatch(tags)`, `cancelMatch()`, `fetchMatchStatus()` actions
    - Persist `lastSelectedTags` in localStorage
    - _Requirements: 1.1, 1.5, 1.6, 5.4, 9.2_

  - [x] 14.2 Implement match message handler in matchStore
    - Add `handleMatchMessage(msg)` action dispatching incoming server messages
    - Handle: MatchGenerateKey, MatchFound, MatchTimeout, MatchError, MatchPartnerLeft, MatchExtendReq, MatchExtended, MatchInviteCreated
    - Update store state machine transitions based on each message type
    - _Requirements: 3.4, 4.2, 4.3, 9.3, 9.4, 9.5, 10.3_

  - [x] 14.3 Implement AES-256 key generation in matchStore
    - Add key generation logic using Web Crypto API (when `isKeyGenerator` is true in MatchGenerateKey handler)
    - Generate AES-256-GCM key, export as base64url, send MatchKeyRelay to server
    - _Requirements: 3.1, 3.2_

  - [x] 14.4 Implement session flow actions in matchStore
    - Implement `nextMatch()`: leave room + re-queue with same tags
    - Implement `generateInviteLink()`: request invite link from server
    - Implement `reportPartner(reason)`: send report to server
    - Implement `proposeExtension()`: send extend request
    - _Requirements: 12.2, 11.1, 8.1, 13.2_

  - [x] 14.5 Write unit tests for matchStore state transitions
    - Test all state transitions (idle→selecting-tags→waiting→pairing→found→in-room)
    - Test timeout path and error handling
    - Test pairing state: key generation (Client A) and key reception (Client B)
    - Test localStorage persistence of tags
    - Use Vitest
    - _Requirements: 1.5, 3.1, 3.4, 4.2_

- [x] 15. Implement client-side match UI components
  - [x] 15.1 Create TagSelector component
    - Create `arthas-client/src/match/TagSelector.tsx` with predefined tags (#tech, #music, #gaming, #random, #language, #movies)
    - Allow 0-3 tag selection with visual feedback
    - Load last-selected tags from localStorage
    - Support keyboard navigation and ARIA labels
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 9.7_

  - [x] 15.2 Create MatchEntry component (Hub page entry point)
    - Create `arthas-client/src/match/MatchEntry.tsx` with prominent "Random Match" button/card
    - Display `onlineCount` from Hub Stats API near the button
    - Hide component when `matchEnabled` is false
    - Support all three locales (zh, en, ja)
    - _Requirements: 9.1, 9.2, 9.6, 14.3_

  - [x] 15.3 Create MatchWaiting component
    - Create `arthas-client/src/match/MatchWaiting.tsx` with animated waiting indicator (pulsing/orbiting)
    - Display elapsed wait time updated every second
    - Show "Cancel" button (Escape key support) and "Invite a Friend" option
    - Support ARIA labels for screen readers
    - _Requirements: 1.5, 4.3, 9.3, 9.5, 9.7, 11.1_

  - [x] 15.4 Create MatchFound component
    - Create `arthas-client/src/match/MatchFound.tsx` with "Match Found!" success animation (1-2 seconds)
    - Auto-navigate to Match_Room after animation completes
    - _Requirements: 9.4_

  - [x] 15.5 Create MatchTimeout component
    - Create `arthas-client/src/match/MatchTimeout.tsx` with three action options: "Try Again", "Invite a Friend", "Back to Hub"
    - _Requirements: 4.2_

  - [x] 15.6 Create InviteLink component
    - Create `arthas-client/src/match/InviteLink.tsx` with copy-to-clipboard button and Web Share API integration (mobile)
    - Display invite link URL and expiry countdown
    - _Requirements: 4.4, 11.6_

  - [x] 15.7 Create MatchRoom container component
    - Create `arthas-client/src/match/MatchRoom.tsx` wrapping the standard chat room interface
    - Add "Next" button (visually distinct from room controls)
    - Add "Report" button (accessible but not prominent)
    - Add "Extend" prompt when room has ≤5 minutes remaining
    - Show extension status (partner proposed, waiting for mutual consent)
    - Show "partner left" message with re-queue option when appropriate
    - _Requirements: 3.5, 8.1, 8.2, 10.4, 12.1, 12.2, 12.3, 13.1, 13.2_

  - [x] 15.8 Create MatchInvitePage route component
    - Create `arthas-client/src/match/MatchInvitePage.tsx` for `/match/:token` route
    - On mount: establish WebSocket connection, send MsgMatchInviteJoin with token
    - Handle responses: MatchFound → navigate to room; MatchError → show "link expired" + offer regular queue
    - _Requirements: 11.3, 11.5_

- [x] 16. Wire client-side routing and i18n
  - [x] 16.1 Add React Router route for `/match/:token`
    - Register `/match/:token` route pointing to `MatchInvitePage` component
    - _Requirements: 11.7_

  - [x] 16.2 Add i18n translation keys for all match UI text
    - Add translation keys for zh, en, ja locales covering: button labels, status messages, error messages, tag names, report reasons, timeout messages, extension prompts
    - _Requirements: 9.6_

  - [x] 16.3 Integrate MatchEntry into Hub page
    - Add `MatchEntry` component to the Hub page layout
    - Call `fetchMatchStatus()` on Hub page load to determine visibility and online count
    - _Requirements: 9.1, 9.2_

- [x] 17. Checkpoint - Ensure client builds and unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. End-to-end integration wiring
  - [x] 18.1 Wire match message serialization/deserialization on client
    - Add match message type handling to the client's WebSocket message processor (import constants from `match/protocol.ts`)
    - Serialize outgoing match messages (MatchRequest, MatchCancel, MatchKeyRelay, MatchInviteJoin, MatchReport, MatchExtend, MatchNext) using MessagePack
    - Deserialize incoming match messages and dispatch to `matchStore.handleMatchMessage()`
    - _Requirements: 6.1, 6.4, 6.5_

  - [x] 18.2 Implement navigation flow between match states and room
    - Wire auto-navigation from MatchFound animation → Match_Room chat interface
    - Wire "Next" button: leave room → re-enter queue with same tags
    - Wire "Back to Hub" navigation from timeout state
    - Handle browser back button and page refresh (send MatchCancel on unmount)
    - _Requirements: 3.4, 4.2, 10.3, 12.2, 12.3_

  - [x] 18.3 Write integration tests for full match flow
    - Test complete flow: two clients → queue → pair → key exchange → room join
    - Test key exchange timeout recovery
    - Test invite link flow end-to-end
    - Test session loop (next → re-match, no repeat pairing)
    - Test feature disabled state
    - _Requirements: 3.4, 3.6, 11.3, 12.5, 14.2_

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using `pgregory.net/rapid` (already a project dependency)
- Unit tests validate specific examples and edge cases
- Server implementation (Go) is in `arthas-server/internal/match/`
- Client implementation (TypeScript/React) is in `arthas-client/src/match/`
- All in-memory state uses `sync.Mutex` for thread safety (two goroutines: Hub.Run + MatchServer.Run)
- Key material never persists — forwarded immediately in the same function call
- Match message type constants live in the `match` package (not `network/protocol.go`) to avoid circular imports — Hub uses numeric range `0x20-0x2F` for routing

## Test File Organization

| Test File | Properties Covered |
|---|---|
| `match/config_test.go` | Property 13 (config validation) |
| `match/queue_test.go` | Properties 1, 2, 4, 15 (queue ops) |
| `match/match_algorithm_test.go` | Properties 3, 5, 6 (matching logic) |
| `match/ratelimit_test.go` | Property 7 (rate limiting) |
| `match/invite_test.go` | Property 8 (invite links) |
| `match/room_state_test.go` | Properties 9, 10 (extensions) |
| `match/server_test.go` | Properties 11, 14 (server lifecycle) |
| `match/hub_integration_test.go` | Property 12 (room isolation) |

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1"] },
    { "id": 1, "tasks": ["2.2", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "4.1", "6.1", "7.1", "8.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "6.2", "7.2", "8.2", "8.3", "9.1"] },
    { "id": 4, "tasks": ["9.2", "10.1"] },
    { "id": 5, "tasks": ["10.2", "10.3", "10.4", "10.5", "10.6"] },
    { "id": 6, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.6", "12.7", "12.8"] },
    { "id": 7, "tasks": ["12.5", "14.1"] },
    { "id": 8, "tasks": ["14.2", "14.3", "14.4", "14.5"] },
    { "id": 9, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7", "15.8"] },
    { "id": 10, "tasks": ["16.1", "16.2", "16.3"] },
    { "id": 11, "tasks": ["18.1", "18.2"] },
    { "id": 12, "tasks": ["18.3"] }
  ]
}
```
