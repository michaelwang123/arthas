# Tasks — Arthas Hub (Public Room Directory)

## Task 1: Backend — HubRegistry Core (internal/hub/registry.go)

- [x] Create `internal/hub/` package directory
- [x] Implement `RoomListing` struct with all fields (RoomID, KeyEncoded, ShareCode, Title, Description, Tags, MemberCount, HasPassword, CreatedAt, ExpiresAt, Ephemeral)
- [x] Implement `HubRegistry` struct with `sync.RWMutex` + `map[string]*RoomListing` + `maxRooms int`
- [x] Implement `NewHubRegistry(maxRooms int) *HubRegistry`
- [x] Implement `Register(listing *RoomListing) error` — adds to map, returns `ErrHubFull` if at capacity
- [x] Implement `Unregister(roomID string)` — safe delete (no-op for non-existent)
- [x] Implement `UpdateMemberCount(roomID string, count int)` — updates live member count
- [x] Implement `List(opts ListOptions) *ListResult` — filter by tag + query, sort by memberCount DESC then createdAt DESC, paginate with limit/offset
- [x] Implement `Count() int`
- [x] Implement share code construction in `Register`: `shareCode = roomId:keyEncoded:ephemeral:expiresAt`
- [x] Write unit tests for Register/Unregister/UpdateMemberCount/List (edge cases: capacity full, empty query, pagination bounds)

## Task 2: Backend — Input Validation (internal/hub/validate.go)

- [x] Implement `ValidateListing(title, description string, tags []string) error`
  - title: 1-50 runes, non-empty after trim, no control characters
  - description: 0-200 runes, no control characters
  - tags: 0-5 items, each 1-20 chars, regex `^[a-zA-Z0-9-]+$`
- [x] Implement `SanitizeString(s string) string` — strip HTML tags, trim whitespace, reject control chars
- [x] Write unit tests for validation edge cases (empty, too long, unicode, HTML injection, control chars)

## Task 3: Backend — Rate Limiter (internal/hub/ratelimit.go)

- [x] Implement `RateLimiter` struct with fixed-window per-IP tracking
- [x] Implement `NewRateLimiter(limit int, window time.Duration) *RateLimiter`
- [x] Implement `Allow(ip string) bool` — returns false if over limit, cleans stale entries lazily
- [x] Add IP cap (max 10,000 tracked IPs, evict oldest when exceeded)
- [x] Write unit tests (within window, exceeded, window reset, IP cap eviction)

## Task 4: Backend — HTTP API Handler (internal/hub/api.go)

- [x] Implement `NewHubHandler(registry *HubRegistry, rateLimiter *RateLimiter, allowedOrigins string) http.Handler`
- [x] Parse query params: `tag`, `q`, `limit` (default 50, max 100), `offset` (default 0)
- [x] Validate params: negative limit → 400, limit > 100 → 400, negative offset → 400
- [x] Call `registry.List(opts)` and JSON-encode the `ListResult`
- [x] Set CORS headers based on `allowedOrigins`
- [x] Integrate rate limiter: return 429 + `Retry-After` header when exceeded
- [x] Write integration test (HTTP request → JSON response, pagination, filtering, rate limiting, CORS)

## Task 5: Backend — Protocol Extension + handleCreateRoom Integration

- [x] Add field constants to `internal/network/protocol.go`: `FieldPublic`, `FieldTitle`, `FieldDescription`, `FieldTags`, `FieldKeyEncoded`
- [x] Add error codes: `ErrCodeHubFull = "E010"`, `ErrCodeInvalidListing = "E011"`
- [x] Modify `handleCreateRoom` in `hub.go`:
  - Parse `public` boolean from dataMap (default false)
  - If `public=true`: parse `title`, `description`, `tags`, `keyEncoded` (base64url AES-256 key)
  - Validate with `hub.ValidateListing()`
  - After room creation succeeds (roomId generated): construct `RoomListing` with shareCode = `roomId:keyEncoded:ephemeral:expiresAt`
  - Call `hubRegistry.Register(listing)`
  - If registry full → send error E010, but still create room as private
  - If validation fails → send error E011, still create room as private
- [x] Wire `HubRegistry` into `Hub` struct (add field, pass from main.go)

## Task 6: Backend — Member Count Updates + Unregister on Destroy

- [x] In `handleJoinRoom`: after successful `r.AddMember()`, call `hubRegistry.UpdateMemberCount(roomId, r.MemberCount())` if room is in registry
- [x] In `handleLeaveRoom`: after `r.RemoveMember()`, call `hubRegistry.UpdateMemberCount(roomId, remaining)`. When `remaining == 0` and room is destroyed, call `hubRegistry.Unregister(roomId)`
- [x] In `cleanupExpiredRooms`: when destroying an expired room, call `hubRegistry.Unregister(roomId)`
- [x] Write integration test: create public room → join → verify member count updates → leave → verify unregistered

## Task 7: Backend — Wire Everything in main.go

- [x] Add `--max-public-rooms` CLI flag (default 200) + `MAX_PUBLIC_ROOMS` env var
- [x] Create `HubRegistry` instance in main()
- [x] Pass `HubRegistry` to `Hub` struct (add constructor param or setter)
- [x] Create rate limiter (30 req/min)
- [x] Register `/api/hub` handler on HTTP mux with `hub.NewHubHandler(registry, rateLimiter, allowedOrigins)`
- [x] Verify: `go run` → `curl localhost:8080/api/hub` returns `{"rooms":[],"total":0,"limit":50,"offset":0}`

## Task 8: Frontend — Hub Types + API Client

- [x] Create `src/hub/types.ts` with `RoomListing`, `HubListResponse`, `HubFilters` interfaces
- [x] Create `src/hub/hubApi.ts` with `fetchHubRooms(filters)` function
- [x] Implement API base URL derivation (relative for same-origin, from VITE_WS_URL for split deployment)
- [x] Handle error responses (non-200 → throw)

## Task 9: Frontend — Hub Zustand Store

- [x] Create `src/hub/hubStore.ts` with Zustand store
- [x] State: `rooms`, `total`, `loading`, `error`, `filters` (tag + query)
- [x] Actions: `fetchRooms()`, `setTagFilter(tag)`, `setSearchQuery(query)`, `startPolling()`, `stopPolling()`
- [x] Implement 30s polling with `setInterval` (start on mount, stop on unmount)
- [x] Debounce search query (300ms) before triggering fetch

## Task 10: Frontend — Hub Page + Components

- [x] Create `src/pages/Hub.tsx` — main Hub page layout
  - Loading state (skeleton cards)
  - Empty state ("No public rooms yet. Create one!")
  - Room card grid (responsive: 1 col mobile, 2 col tablet, 3 col desktop)
  - Total rooms count display
  - Polling lifecycle (startPolling on mount, stopPolling on unmount)
- [x] Create `src/components/HubRoomCard.tsx`
  - Title, description (truncated 100 chars), tags as badges
  - Member count icon + number
  - Relative time since creation ("2m ago", "1h ago")
  - Expiry countdown (if set)
  - 🔒 icon for password-protected rooms
  - Click handler → join flow
- [x] Create `src/components/HubFilters.tsx`
  - Search input with debounce
  - Tag badges (click to filter, click again to clear)
  - Clear all filters button
- [x] Add Hub navigation button to Home page
- [x] Add page routing: `page === 'hub'` renders Hub component

## Task 11: Frontend — Create Room Public Fields Extension

- [x] Create `src/components/CreateRoomPublicFields.tsx`
  - Toggle: "List in Arthas Hub (public)"
  - Conditional fields (shown when toggle ON): Title input, Description textarea, Tags input (add/remove badges)
  - Tag validation (alphanumeric + hyphens, max 5, max 20 chars each)
- [x] Integrate into existing CreateRoom form/flow
- [x] When `public=true`, include `public`, `title`, `description`, `tags`, `keyEncoded` in the CreateRoom WebSocket message
- [x] The `keyEncoded` value is obtained from `await exportRoomKey(roomKey)` — this is already available because `generateRoomKey()` runs BEFORE the CreateRoom message is sent in the existing flow

## Task 12: Frontend — Join from Hub Flow

- [x] When user clicks a HubRoomCard:
  - If room has password → show password prompt modal
  - Extract shareCode from listing
  - Call existing `chatStore.joinRoom(shareCode, nickname)` (or navigate to join with pre-filled code)
  - Handle errors: room full, room not found (remove from local list)
- [x] After successful join, navigate to Chat view

## Task 13: Integration Testing + Polish

- [x] End-to-end test: Create public room (web client) → verify it appears in `/api/hub` → join from another client via Hub
- [x] Test: Create public room with password → verify 🔒 in Hub → join requires password
- [x] Test: Room expires → verify removed from Hub
- [x] Test: All members leave → verify removed from Hub
- [x] Test: Hub at capacity (200 rooms) → new public room creation falls back to private with error
- [x] Test: Rate limiting → 31st request in 1 minute returns 429
- [x] i18n: Add Hub-related strings (EN/ZH/JA) for UI labels
- [x] Mobile responsive testing for Hub page
