# Implementation Plan: Room Activity Ranking

## Overview

This plan implements activity-based sorting and a global online count for the Arthas Hub page. The server-side work is in Go (`arthas-server`) and the frontend work is in TypeScript/React (`arthas-client`). Implementation proceeds bottom-up: ActivityTracker → HubRegistry extensions → API handler → Hub integration → Frontend store/API → UI components → i18n.

## Tasks

- [x] 1. Implement ActivityTracker module
  - [x] 1.1 Create `internal/activity/tracker.go` with Tracker struct, New(), WithNowFunc(), Increment(), GetCount(), Remove(), and Cleanup()
    - Implement sliding window with `[]int64` ring buffer (max 10,000 timestamps per room)
    - Use `sync.RWMutex` for thread safety
    - Lazy pruning in GetCount, O(1) amortized Increment
    - Run `go get pgregory.net/rapid` to promote from indirect to direct dependency (needed by property tests)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 8.1, 8.3, 8.4, 8.5_

  - [x] 1.2 Write property tests for ActivityTracker (`internal/activity/tracker_property_test.go`)
    - **Property 1: Increment grows count** — N increments within window → GetCount returns N
    - **Property 2: Sliding window expiry** — Events older than 5min excluded from count
    - **Property 3: Remove discards all data** — After Remove, GetCount returns 0
    - **Property 5: Event cap with ring buffer semantics** — Cap at 10,000, oldest evicted
    - **Property 7: Monotonicity within frozen time** — Count non-decreasing under frozen nowFunc
    - **Property 9: Concurrent safety** — No panics/races under parallel Increment/GetCount/Remove/Cleanup
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 7.3, 8.1, 8.2, 8.4, 8.5**

  - [x] 1.3 Write unit tests for ActivityTracker (`internal/activity/tracker_test.go`)
    - Test increment once and check count
    - Test time advance via nowFunc causes count to drop
    - Test Remove non-existent room (no panic)
    - Test ring buffer eviction at cap (10,001st event evicts oldest)
    - Test Cleanup on empty tracker
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 8.4_

- [x] 2. Extend HubRegistry with Copy-on-Enrichment and sort logic
  - [x] 2.1 Define `ActivityGetter` interface and add `MessageCount5min` field to `RoomListing` struct, add `Sort` field to `ListOptions`, add `TotalOnline` field to `ListResult`
    - Define interface in hub package to avoid import cycles
    - Add JSON tags (`messageCount5min`, `totalOnline`)
    - _Requirements: 2.1, 2.2, 3.1_

  - [x] 2.2 Update `HubRegistry.List()` to accept `ActivityGetter` parameter, create shallow copies, pre-compute activity counts, and sort according to sort mode
    - Change signature from `List(opts ListOptions)` to `List(opts ListOptions, ag ActivityGetter)`
    - **CRITICAL**: Also update ALL existing call sites of `List()` to pass `nil` as ActivityGetter to maintain compilation:
      - `internal/hub/api.go` — 1 call inside handler closure: `registry.List(opts)` → `registry.List(opts, nil)`
      - `internal/hub/registry_test.go` — ~17 calls: `reg.List(ListOptions{...})` → `reg.List(ListOptions{...}, nil)`
      - Note: `api_test.go` and `integration_test.go` use NewHubHandler (don't call List directly) — no changes needed at this step
    - Implement copy-on-enrichment pattern (shallow copy before mutation)
    - Pre-compute MessageCount5min from ActivityGetter on copies
    - Implement sort logic: active (messageCount DESC, memberCount DESC), people (memberCount DESC, messageCount DESC), newest (createdAt DESC), default (memberCount DESC, createdAt DESC)
    - Handle nil ActivityGetter gracefully (all counts 0)
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 2.3 Write property tests for HubRegistry sort and copy safety (`internal/hub/registry_property_test.go`)
    - **Property 4: Sort ordering invariant** — Output ordered correctly for each sort mode
    - **Property 6: Activity count consistency** — messageCount5min equals ActivityGetter.GetCount at query time
    - **Property 8: Concurrent safety (Copy-on-Enrichment)** — Parallel List() calls return independent copies
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6, 2.7**

  - [x] 2.4 Write unit tests for HubRegistry List extensions (`internal/hub/registry_test.go`)
    - Test List returns copies (mutating result doesn't affect registry)
    - Test List pre-computes counts before sort
    - Test List with nil ActivityGetter (all counts 0)
    - Test concurrent List calls with `-race` flag
    - _Requirements: 2.1, 2.8_

- [x] 3. Checkpoint - Verify server-side core logic compiles and tests pass
  - Run: `cd arthas-server && go build ./... && go test -race ./internal/activity/... ./internal/hub/...`
  - Verify no compilation errors and all tests pass. Ask the user if questions arise.

- [x] 4. Extend Hub API handler
  - [x] 4.1 Refactor `NewHubHandler` to accept `HubHandlerConfig` struct with `ActivityGetter` and `OnlineCountFn` fields
    - Create `HubHandlerConfig` struct (fields: Registry, RateLimiter, AllowedOrigins, ActivityGetter, OnlineCountFn)
    - Update handler to parse `sort` query parameter and pass to `List(opts, cfg.ActivityGetter)`
    - Set `result.TotalOnline` from `OnlineCountFn` (nil-safe, default 0)
    - Update all existing call sites (`cmd/server/main.go` line ~204, `internal/hub/api_test.go` setupTestHandler + 10 test functions, `internal/hub/integration_test.go` 2 functions) to use config struct with `ActivityGetter: nil` and `OnlineCountFn: nil` for backward compatibility
    - _Requirements: 2.2, 2.7, 3.1, 3.2, 3.3_

  - [x] 4.2 Write unit tests for Hub API sort and online count (`internal/hub/api_test.go`)
    - Test sort=active returns correctly sorted HTTP 200 response
    - Test invalid sort param returns default-sorted results
    - Test totalOnline field present with correct value
    - Test 0 rooms with sort param (empty array, not error)
    - Test nil ActivityGetter graceful degradation
    - Test concurrent API requests don't interfere (with `-race`)
    - _Requirements: 2.2, 2.3, 2.7, 2.8, 3.1, 3.2, 3.3_

- [x] 5. Integrate ActivityTracker with Hub
  - [x] 5.1 Wire ActivityTracker into Hub (`internal/network/hub.go`)
    - Add `activityTracker *activity.Tracker` field to Hub struct; initialize in `NewHub()` with `activity.New(5*time.Minute, 10000)`
    - In `handleSendMessage`: immediately after `r.Broadcast(client.ID, broadcastData)`, add public room check and increment:
      ```go
      if h.hubRegistry != nil && h.hubRegistry.GetListing(client.RoomID) != nil {
          h.activityTracker.Increment(client.RoomID)
      }
      ```
    - Do NOT add Increment in `handleSendReaction` (reactions excluded from activity — Req 1.8)
    - Piggyback cleanup on existing `expiryTicker` case in `Run()` — add `h.activityTracker.Cleanup()` call after `h.cleanupExpiredRooms()` (avoids adding a redundant 60s ticker)
    - In `handleLeaveRoom`: call `h.activityTracker.Remove(roomID)` when a non-daily-topic room is unregistered from hub (alongside existing `h.hubRegistry.Unregister(roomId)`)
    - In `cleanupExpiredRooms`: call `h.activityTracker.Remove(roomId)` alongside existing `h.hubRegistry.Unregister(roomId)` at step 2f
    - Note: Daily topic rooms that go empty keep their hub listing — activity data will naturally decay to 0 within 5 min via Cleanup(), no explicit Remove() needed
    - Expose `ClientCount() int` public method wrapping existing unexported `clientCount()` (line ~1774)
    - _Requirements: 1.1, 1.7, 1.8, 3.2, 7.3_

  - [x] 5.2 Wire ActivityTracker and ClientCount into Hub API handler in `cmd/server/main.go`
    - Pass `ActivityGetter: hub.activityTracker` and `OnlineCountFn: hub.ClientCount` to `HubHandlerConfig`
    - Note: `activityTracker` field may need to be exported or accessed via a getter method
    - _Requirements: 2.1, 3.1_

  - [x] 5.3 Write integration tests for full activity flow (`internal/hub/integration_test.go`)
    - Test: create public room → send messages → query API with sort=active → verify ordering
    - Test: verify totalOnline matches connected client count
    - Test: verify reactions do NOT increment activity count
    - Test: verify private room messages do NOT appear in activity counts
    - _Requirements: 1.1, 1.7, 1.8, 2.3, 3.1_

- [x] 6. Checkpoint - Verify full server compiles and all tests pass with -race
  - Run: `cd arthas-server && go build ./... && go test -race ./...`
  - Verify no compilation errors, no race conditions, all tests pass. Ask the user if questions arise.

- [x] 7. Implement frontend store and API extensions
  - [x] 7.1 Extend hub types (`arthas-client/src/hub/types.ts`) with `messageCount5min` on `RoomListing` and `totalOnline` on `HubListResponse`
    - Add TypeScript interface fields with proper types
    - _Requirements: 2.1, 3.1_

  - [x] 7.2 Extend hub API client (`arthas-client/src/hub/hubApi.ts`) to pass `sort` query parameter
    - Add `sort?: string` to `FetchHubOptions` interface
    - Append sort param to URL query string when non-empty: `if (sort) params.set('sort', sort);`
    - _Requirements: 2.2, 7.2_

  - [x] 7.3 Extend hub store (`arthas-client/src/hub/hubStore.ts`) with `sortMode`, `totalOnline`, and `setSortMode` action
    - Add `SortMode` type (`'active' | 'people' | 'newest' | ''`) and state fields
    - `setSortMode` updates state and triggers immediate fetchRooms with offset reset to 0
    - Include sortMode in each polling request (pass `sort: get().sortMode` to fetchHubRooms)
    - Extract totalOnline from API response: `response.totalOnline ?? 0`
    - _Requirements: 4.2, 4.5, 4.6, 5.2, 7.1, 7.2_

  - [x] 7.4 Write unit tests for hubStore sort mode behavior (`arthas-client/src/hub/hubStore.test.ts`)
    - Test sort mode switch resets pagination offset
    - Test sort mode persists across polling cycles
    - Test totalOnline updates from API response
    - Test default sort mode is '' on initial load
    - Test totalOnline defaults to 0 when field missing
    - _Requirements: 4.4, 4.5, 4.6, 5.2_

- [x] 8. Implement frontend UI components
  - [x] 8.1 Add sort mode tab row to HubFilters component (`arthas-client/src/components/HubFilters.tsx`)
    - Render 4 sort mode buttons (All, 🔥 Most Active, 👥 Most People, 🆕 Newest)
    - Use `aria-pressed` attribute for active state
    - Add `aria-live="polite"` region for sort mode change announcements
    - Distinct selected style (background color) on active button
    - Place sort buttons ABOVE the existing search input
    - _Requirements: 4.1, 4.3, 4.7, 4.8_

  - [x] 8.2 Add online count display to Hub page header (`arthas-client/src/pages/Hub.tsx`)
    - Display totalOnline with green dot icon and "N online now" text
    - Show "0" when no clients connected (don't hide the indicator)
    - Use i18n translation key with `{{count}}` interpolation
    - Update existing `Hub.test.tsx` mock state to include `totalOnline: 0` to prevent test failures
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 8.3 Write unit tests for HubFilters sort buttons (`arthas-client/src/components/HubFilters.test.tsx`)
    - Test renders 4 sort buttons with correct labels
    - Test clicking sort button calls setSortMode
    - Test active button has `aria-pressed="true"`
    - Test aria-live region announces sort change
    - _Requirements: 4.1, 4.3, 4.7, 4.8_

- [x] 9. Add i18n translation keys
  - [x] 9.1 Add translation keys to locale files at `arthas-client/src/i18n/locales/`
    - Files: `en.json`, `zh.json`, `ja.json`
    - Add keys: `hub.sort.all`, `hub.sort.active`, `hub.sort.people`, `hub.sort.newest`, `hub.onlineCount`, `hub.sort.changed`
    - Use `{{count}}` interpolation for onlineCount (i18next-style double curly braces)
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 10. Final checkpoint - Verify all tests pass (server + client)
  - Run server tests: `cd arthas-server && go test -race ./...`
  - Run client tests: `cd arthas-client && npx vitest --run`
  - Verify no failures. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation with concrete test commands
- Property tests validate universal correctness properties from the design document (Properties 1–9)
- All Go tests should be run with `-race` flag to catch concurrency issues
- The `pgregory.net/rapid` library is an indirect dependency — task 1.1 promotes it to direct
- Server code is in Go (`arthas-server`), frontend code is in TypeScript/React (`arthas-client`)
- Task 2.2 includes updating existing callers to maintain compilation continuity across waves
- Task 5.1 piggybacks cleanup on the existing expiryTicker (60s) to avoid adding a redundant timer

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.1", "7.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "7.2"] },
    { "id": 5, "tasks": ["7.3", "9.1"] },
    { "id": 6, "tasks": ["7.4", "8.1", "8.2"] },
    { "id": 7, "tasks": ["8.3"] }
  ]
}
```
