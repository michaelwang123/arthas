# Design Document — Arthas Hub (Public Room Directory)

## Overview

Arthas Hub adds a public room directory feature that allows room creators to opt-in to listing their room publicly. Users can browse, filter, and join public rooms from a dedicated Hub page without needing an out-of-band share code.

This design is **purely additive** — it introduces new files and minimal surgical modifications to existing code. No existing behavior changes for private rooms.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| HTTP REST for directory queries (`GET /api/hub`) | Simpler than WebSocket, cacheable, standard HTTP semantics, stateless |
| Client polling (30s) instead of push | MVP simplicity; push deferred to V2 |
| Share code publicly visible | Enables zero-friction join; security boundary clearly documented |
| `title` distinct from user `name` | `name` = creator's nickname; `title` = room display name in Hub |
| Password-protected rooms can be public | Shown with 🔒 icon; share code included but join requires password |
| In-memory registry (no database) | Consistent with existing ephemeral architecture; rooms already in-memory |
| New `internal/hub/` package | Isolates Hub logic; single responsibility; minimal coupling to existing code |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        arthas-server                          │
│                                                              │
│  ┌──────────────┐      ┌──────────────────────────┐         │
│  │  network/    │      │  hub/ (NEW)              │         │
│  │  hub.go      │─────▶│  registry.go  — in-memory│         │
│  │              │      │  api.go       — HTTP GET │         │
│  │handleCreate  │      │  ratelimit.go — per-IP   │         │
│  │handleLeave   │      └──────────────────────────┘         │
│  │cleanupExpired│                                           │
│  └──────────────┘                                           │
│         ▲                                                    │
│         │ WebSocket (msgpack)                                │
│  ┌──────┴──────┐                                            │
│  │  /ws        │     ┌────────────┐                         │
│  └─────────────┘     │ /api/hub   │  HTTP GET (JSON)        │
│                      └────────────┘                         │
└──────────────────────────────────────────────────────────────┘
         ▲                    ▲
         │ WebSocket          │ HTTP (polling every 30s)
         │                    │
┌────────┴────────────────────┴──────────────────────────┐
│                    arthas-client                         │
│                                                         │
│  ┌────────────┐  ┌────────────────┐  ┌──────────────┐  │
│  │ chatStore  │  │ hubStore (NEW) │  │ HubPage (NEW)│  │
│  │ (Zustand)  │  │ (Zustand)      │  │ React comp   │  │
│  └────────────┘  └────────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Integration Points (Existing File Modifications)

Only 4 existing files require changes:

1. **`internal/network/hub.go` — `handleCreateRoom`** (~15 lines): Parse optional `public`, `title`, `description`, `tags`, `shareCode` fields from `dataMap`; validate; call `hubRegistry.Register(...)`.
2. **`internal/network/hub.go` — `handleJoinRoom`** (2 lines): After successful `r.AddMember()`, call `hubRegistry.UpdateMemberCount(roomId, r.MemberCount())` if room is public.
3. **`internal/network/hub.go` — `handleLeaveRoom` / `cleanupExpiredRooms`** (2-3 lines each): After `r.RemoveMember()`, call `hubRegistry.UpdateMemberCount(...)`. When room is destroyed (empty/expired), call `hubRegistry.Unregister(roomId)`.
4. **`cmd/server/main.go`** (~5 lines): Import `hub` package, create `HubRegistry`, wire it into `Hub`, register `/api/hub` handler on `mux`.
5. **`internal/network/protocol.go`** (~10 lines): Add field name constants for the new optional CreateRoom fields (including `shareCode`).

---

## Data Models

### Go Backend

#### RoomListing (new: `internal/hub/registry.go`)

```go
// RoomListing represents a public room's metadata in the Hub directory.
type RoomListing struct {
    RoomID      string   `json:"roomId"`
    KeyEncoded  string   `json:"-"`            // base64url key from client (internal, not in JSON)
    ShareCode   string   `json:"shareCode"`    // Full share code, constructed by server: roomId:key:ephemeral:expiresAt
    Title       string   `json:"title"`        // 1-50 chars, room display name
    Description string   `json:"description"`  // 0-200 chars, optional
    Tags        []string `json:"tags"`         // 0-5 tags, each 1-20 chars
    MemberCount int      `json:"memberCount"`  // Live count from Room.MemberCount()
    HasPassword bool     `json:"hasPassword"`  // True if room requires password
    CreatedAt   int64    `json:"createdAt"`    // Unix seconds
    ExpiresAt   int64    `json:"expiresAt"`    // Unix seconds, 0 = never
    Ephemeral   int      `json:"-"`            // Ephemeral mode (internal, used for share code construction)
}
```

#### HubRegistry (new: `internal/hub/registry.go`)

```go
// HubRegistry is a thread-safe in-memory registry of public rooms.
// It stores only listing metadata; the actual Room state lives in RoomManager.
type HubRegistry struct {
    mu          sync.RWMutex
    listings    map[string]*RoomListing // key = roomId
    maxRooms    int                     // configurable cap (default 200)
}

// Methods:
func NewHubRegistry(maxRooms int) *HubRegistry
func (r *HubRegistry) Register(listing *RoomListing) error   // returns error if at capacity
func (r *HubRegistry) Unregister(roomID string)
func (r *HubRegistry) UpdateMemberCount(roomID string, count int)
func (r *HubRegistry) List(opts ListOptions) (*ListResult, error)
func (r *HubRegistry) Count() int
```

#### ListOptions & ListResult (new: `internal/hub/registry.go`)

```go
// ListOptions defines query parameters for directory listing.
type ListOptions struct {
    Tag    string // filter by tag (case-insensitive match)
    Query  string // search in title + description (case-insensitive contains)
    Limit  int    // max results, default 50, max 100
    Offset int    // pagination offset, default 0
}

// ListResult wraps paginated query results.
type ListResult struct {
    Rooms  []*RoomListing `json:"rooms"`
    Total  int            `json:"total"`  // total matching (before pagination)
    Limit  int            `json:"limit"`
    Offset int            `json:"offset"`
}
```

### CreateRoom Protocol Extension (backward compatible)

Existing `CreateRoomData` msgpack fields remain unchanged. New **optional** fields:

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `public` | bool | No (default false) | If absent/false → private room (no listing) |
| `title` | string | Yes if `public=true` | 1-50 characters |
| `description` | string | No | 0-200 characters |
| `tags` | []string | No | 0-5 items, each 1-20 chars, alphanumeric + hyphens |
| `shareCode` | string | Yes if `public=true` | The base64url-encoded AES-256 key (just the key portion, NOT the full share code). The server constructs the complete share code by combining `roomId` (server-generated) + this key + ephemeral + expiresAt. This avoids a chicken-and-egg problem: the client doesn't know the roomId at CreateRoom time. |

**Why the client sends only the key (not the full share code):**

The share code format is `roomId:base64url(key):ephemeral:expiresAt`. At CreateRoom time:
- `roomId` → generated server-side (NanoID), client doesn't have it yet
- `key` → generated client-side, server never sees it normally
- `ephemeral` / `expiresAt` → already in the CreateRoom message

For public rooms, the client sends `keyEncoded` (the base64url key string). The server uses it to construct the full share code after generating the roomId. The server stores this as opaque metadata — it cannot use the key to decrypt messages, but serves it via the Hub API.

This is consistent with the requirements security boundary: "Public rooms deliberately expose their encryption key to enable zero-friction joining."

### Protocol Constants Addition (`protocol.go`)

```go
// Hub listing field names (used in handleCreateRoom dataMap parsing)
const (
    FieldPublic      = "public"
    FieldTitle       = "title"
    FieldDescription = "description"
    FieldTags        = "tags"
    FieldShareCode   = "keyEncoded"  // Client sends base64url-encoded key for public listing
)

// Hub error codes
const (
    ErrCodeHubFull        = "E010" // max public rooms reached
    ErrCodeInvalidListing = "E011" // invalid title/description/tags
)
```

---

## API Design

### `GET /api/hub` — List Public Rooms

**Query Parameters:**

| Param | Type | Default | Constraint |
|-------|------|---------|------------|
| `tag` | string | (none) | Filter rooms with matching tag (case-insensitive) |
| `q` | string | (none) | Search in title + description (case-insensitive contains) |
| `limit` | int | 50 | 1-100; values > 100 → HTTP 400 |
| `offset` | int | 0 | ≥ 0; negative → HTTP 400 |

**Success Response (200):**

```json
{
  "rooms": [
    {
      "roomId": "abc123...",
      "shareCode": "abc123...#base64key",
      "title": "Golang AMA",
      "description": "Ask me anything about Go",
      "tags": ["golang", "ama"],
      "memberCount": 5,
      "hasPassword": false,
      "createdAt": 1700000000,
      "expiresAt": 1700003600
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

**Sorting:** `memberCount` descending, then `createdAt` descending (newest first for ties).

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| 400 | Invalid params (limit > 100, negative offset) | `{"error": "descriptive message"}` |
| 429 | Rate limit exceeded (30 req/min/IP) | `{"error": "rate limited"}` + `Retry-After` header |

**CORS:** Endpoint respects configured `ALLOWED_ORIGINS` (same as WebSocket origin check).

---

## Backend Design (New Files)

### `internal/hub/registry.go`

Thread-safe in-memory registry. Core responsibilities:
- Store `map[string]*RoomListing` protected by `sync.RWMutex`
- Enforce `maxRooms` capacity limit
- Provide filtered, sorted, paginated listing queries
- Update `MemberCount` on room membership changes

```go
// Register adds a public room listing. Returns error if at capacity.
func (r *HubRegistry) Register(listing *RoomListing) error {
    r.mu.Lock()
    defer r.mu.Unlock()
    if len(r.listings) >= r.maxRooms {
        return ErrHubFull
    }
    r.listings[listing.RoomID] = listing
    return nil
}

// Unregister removes a room from the directory.
// Safe to call for non-existent roomIDs (no-op).
func (r *HubRegistry) Unregister(roomID string) {
    r.mu.Lock()
    defer r.mu.Unlock()
    delete(r.listings, roomID)
}

// List returns a filtered, sorted, paginated slice of listings.
// Sorting: memberCount DESC, createdAt DESC.
// Filtering: tag match (case-insensitive), query search in title+description.
func (r *HubRegistry) List(opts ListOptions) *ListResult {
    r.mu.RLock()
    // ... collect, filter, sort, paginate
    r.mu.RUnlock()
    return result
}
```

**Member count update strategy:** When a member joins or leaves a public room, the Hub calls `registry.UpdateMemberCount(roomId, newCount)`. The API reads this cached value rather than querying RoomManager on each request — keeping the HTTP handler lock-free and fast.

### `internal/hub/api.go`

HTTP handler for `GET /api/hub`:

```go
// NewHubHandler creates the HTTP handler for the Hub directory API.
func NewHubHandler(registry *HubRegistry, allowedOrigins string) http.Handler {
    rateLimiter := NewRateLimiter(30, time.Minute) // 30 req/min per IP
    
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 1. Rate limit check (by IP)
        // 2. Parse & validate query params
        // 3. Call registry.List(opts)
        // 4. Set CORS headers
        // 5. JSON encode response
    })
}
```

### `internal/hub/ratelimit.go`

Simple token-bucket rate limiter per IP:

```go
// RateLimiter tracks request counts per IP with sliding window.
type RateLimiter struct {
    mu       sync.Mutex
    requests map[string]*ipRecord
    limit    int
    window   time.Duration
}

type ipRecord struct {
    count     int
    windowStart time.Time
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter
func (rl *RateLimiter) Allow(ip string) bool
```

Design note: A simple fixed-window counter per IP is sufficient for MVP. No external dependencies (no Redis). Stale IP entries are lazily cleaned during `Allow()` checks. The limiter caps tracked IPs at 10,000 entries — when exceeded, the oldest entries are evicted to prevent memory growth from IP enumeration attacks.

### `internal/hub/validate.go`

Input validation and sanitization:

```go
// ValidateListing validates Hub listing metadata from CreateRoom data.
// Returns sanitized values or an error with descriptive message.
func ValidateListing(title, description string, tags []string) error

// SanitizeString strips HTML tags, trims whitespace, rejects control characters.
func SanitizeString(s string) string
```

Validation rules:
- `title`: 1-50 runes, non-empty after trim, no control characters, no HTML
- `description`: 0-200 runes, no control characters, no HTML
- `tags`: 0-5 items, each 1-20 chars, regex `^[a-zA-Z0-9-]+$`

---

## Frontend Design (New Files)

### New Files

| File | Purpose |
|------|---------|
| `src/hub/hubStore.ts` | Zustand store: directory state, polling, filtering |
| `src/hub/hubApi.ts` | HTTP fetch wrapper for `/api/hub` |
| `src/hub/types.ts` | TypeScript interfaces for Hub data |
| `src/pages/Hub.tsx` | Hub page component (card grid) |
| `src/components/HubRoomCard.tsx` | Individual room card component |
| `src/components/HubFilters.tsx` | Tag filter + search input component |
| `src/components/CreateRoomPublicFields.tsx` | Public toggle + title/desc/tags inputs |

**Routing:** The existing app uses state-based page switching (not React Router). A top-level `page` state controls which view is rendered. Hub adds a new page value (e.g., `page: 'hub'`) with a navigation button on the Home screen. This matches the existing pattern used for Chat view switching.

### `src/hub/types.ts`

```typescript
export interface RoomListing {
  roomId: string;
  shareCode: string;
  title: string;
  description: string;
  tags: string[];
  memberCount: number;
  hasPassword: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface HubListResponse {
  rooms: RoomListing[];
  total: number;
  limit: number;
  offset: number;
}

export interface HubFilters {
  tag: string;
  query: string;
}
```

### `src/hub/hubStore.ts`

```typescript
interface HubState {
  rooms: RoomListing[];
  total: number;
  loading: boolean;
  error: string | null;
  filters: HubFilters;
  
  // Actions
  fetchRooms: () => Promise<void>;
  setTagFilter: (tag: string) => void;
  setSearchQuery: (query: string) => void;
  startPolling: () => void;
  stopPolling: () => void;
}
```

Polling implementation:
- `startPolling()` — sets a 30s `setInterval`, calls `fetchRooms()` immediately
- `stopPolling()` — clears the interval (called on page unmount)
- Debounce search input (300ms) before triggering fetch

### `src/hub/hubApi.ts`

```typescript
const HUB_API_PATH = '/api/hub';

export async function fetchHubRooms(filters: HubFilters): Promise<HubListResponse> {
  const params = new URLSearchParams();
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.query) params.set('q', filters.query);
  
  const res = await fetch(`${HUB_API_PATH}?${params}`);
  if (!res.ok) throw new Error(`Hub API error: ${res.status}`);
  return res.json();
}
```

Uses relative URL path — works with both same-origin deployment (Tier 1 single-binary) and proxied setups.

**Split deployment strategy (Vercel frontend + HF Spaces backend):**
The Hub API base URL is derived from the same source as the WebSocket URL. If `VITE_WS_URL` is set (e.g., `wss://server.hf.space/ws`), the Hub API URL is derived by replacing `wss://` with `https://` and `/ws` with `/api/hub`. For same-origin deployments, the relative path `/api/hub` works directly.

```typescript
function getHubApiBase(): string {
  const wsUrl = import.meta.env.VITE_WS_URL;
  if (wsUrl) {
    // wss://server.hf.space/ws → https://server.hf.space
    return wsUrl.replace(/^wss?:\/\//, 'https://').replace(/\/ws$/, '');
  }
  return ''; // same-origin, use relative path
}
```

### `src/pages/Hub.tsx`

```
┌─────────────────────────────────────────────────┐
│  🌐 Arthas Hub          [Back to Home]          │
│                                                  │
│  [Search rooms...]         Tags: [go] [react]   │
│                                                  │
│  42 public rooms available                       │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐            │
│  │ Golang AMA   │  │ 🔒 React Q&A│            │
│  │ Ask me...    │  │ Help with... │            │
│  │ [go] [ama]   │  │ [react]      │            │
│  │ 👥 5 • 2m ago│  │ 👥 3 • 10m   │            │
│  │ ⏱ 55m left   │  │              │            │
│  └──────────────┘  └──────────────┘            │
│                                                  │
│  [Load more...]                                  │
└─────────────────────────────────────────────────┘
```

Component breakdown:
- **HubPage**: Layout, polling lifecycle, empty/loading states
- **HubFilters**: Search input (debounced) + tag badge toggle
- **HubRoomCard**: Title, description (truncated at 100 chars), tags as badges, member count, relative time, expiry countdown, 🔒 icon, click-to-join

### Join-from-Hub Flow

1. User clicks a `HubRoomCard`
2. Extract `shareCode` from the listing
3. Navigate to join flow: call existing `chatStore.joinRoom(shareCode)` which already handles share code parsing (roomId + key extraction), WebSocket join, and key import
4. If room has password → existing password prompt UI handles it
5. If room no longer exists → error toast + remove from local list

This reuses the existing join infrastructure entirely — no new join logic needed.

### Create Room UI Extension

The existing Create Room form gains a collapsible "Public Listing" section:

```
[Toggle] List in Arthas Hub (public)

  ↳ Room Title: [________________] (required)
  ↳ Description: [________________] (optional)  
  ↳ Tags: [go] [x]  [Add tag...]
```

When `public=true`, the CreateRoom message includes the new optional fields. The server's `handleCreateRoom` detects `public: true` and registers the room in the Hub.

---

## Integration Flow

### Room Creation (public)

```
Client                    Server (hub.go)              HubRegistry
  │                            │                           │
  │─── CreateRoom ────────────▶│                           │
  │  {name, password,          │                           │
  │   public:true, title,      │                           │
  │   description, tags}       │                           │
  │                            │── validate listing ──────▶│
  │                            │── Register(listing) ─────▶│
  │                            │                           │
  │◀── RoomCreated ────────────│                           │
  │◀── RoomJoined ────────────│                           │
```

### Room Destruction (auto-unregister)

```
Hub.handleLeaveRoom()          HubRegistry
  │                                │
  │── (room empty) ──────────────▶│
  │   Unregister(roomId)          │
  │                                │
  
Hub.cleanupExpiredRooms()      HubRegistry
  │                                │
  │── (room expired) ────────────▶│
  │   Unregister(roomId)          │
```

### Hub Browsing

```
Client (HubPage)              Server (/api/hub)         HubRegistry
  │                               │                         │
  │── GET /api/hub?tag=go ───────▶│                         │
  │                               │── List(opts) ──────────▶│
  │                               │◀── ListResult ──────────│
  │◀── JSON response ─────────────│                         │
  │                               │                         │
  │ (30s later, poll again)       │                         │
```

---

## Rate Limiting & Abuse Prevention

| Control | Value | Scope |
|---------|-------|-------|
| Max public rooms | 200 (configurable via `--max-public-rooms`) | Global |
| Hub API rate limit | 30 requests/minute | Per IP |
| Input sanitization | Strip HTML, trim whitespace, reject control chars | Per field |
| Title length | 1-50 runes | Per room |
| Description length | 0-200 runes | Per room |
| Tags | 0-5 items, each 1-20 chars, `^[a-zA-Z0-9-]+$` | Per room |

Rate limit response:
- HTTP 429 with `Retry-After: <seconds>` header
- Body: `{"error": "rate limited, try again later"}`

---

## Configuration

New CLI flag added to `main.go`:

```go
maxPublicRooms := flag.Int("max-public-rooms", 200, "Maximum number of public rooms in Hub")
```

Also supports environment variable `MAX_PUBLIC_ROOMS` with same priority pattern (flag > env > default).

---

## Performance Considerations

- **Hub API response time < 100ms for 1000 rooms**: Registry `List()` operates on in-memory map with O(n) filter + sort. With n ≤ 200 (default cap), this is well under the requirement.
- **No lock contention on hot path**: `List()` uses `RLock` (multiple readers allowed). Write operations (Register/Unregister/UpdateMemberCount) are infrequent relative to reads.
- **Member count updates are incremental**: Hub calls `UpdateMemberCount` on join/leave — no periodic room scanning needed.
- **Polling (30s) is lightweight**: Each poll is a single HTTP GET returning a small JSON payload (200 rooms × ~200 bytes = ~40KB max).

---

## Security Considerations

1. **Share code exposure is intentional**: Public rooms deliberately expose their share code. The encryption protects against server inspection and network eavesdropping, not against Hub visitors.
2. **Password-protected public rooms**: Visible in Hub (with 🔒 icon) but require password to join. The share code alone is insufficient — password hash verification happens server-side.
3. **Input sanitization**: All user-provided metadata (title, description, tags) is sanitized server-side before storage.
4. **Rate limiting**: Prevents API abuse and directory scraping.
5. **No new authentication**: Hub browsing is anonymous (consistent with Arthas's no-account design).

---

## File Summary

### New Files (Server)

| File | Purpose |
|------|---------|
| `internal/hub/registry.go` | HubRegistry struct, Register/Unregister/List/UpdateMemberCount |
| `internal/hub/api.go` | HTTP handler for `GET /api/hub` with CORS |
| `internal/hub/ratelimit.go` | Per-IP rate limiter (fixed-window) |
| `internal/hub/validate.go` | Input validation and sanitization functions |

### New Files (Client)

| File | Purpose |
|------|---------|
| `src/hub/types.ts` | TypeScript interfaces |
| `src/hub/hubApi.ts` | HTTP API client |
| `src/hub/hubStore.ts` | Zustand store for Hub state + polling |
| `src/pages/Hub.tsx` | Hub page component |
| `src/components/HubRoomCard.tsx` | Room card component |
| `src/components/HubFilters.tsx` | Search + tag filter UI |
| `src/components/CreateRoomPublicFields.tsx` | Public listing form fields |

### Modified Files (Minimal Changes)

| File | Change | Lines |
|------|--------|-------|
| `internal/network/hub.go` | Parse public listing fields in `handleCreateRoom`, unregister in `handleLeaveRoom`/`cleanupExpiredRooms` | ~20 |
| `internal/network/protocol.go` | Add field constants and error codes | ~10 |
| `cmd/server/main.go` | Create HubRegistry, register `/api/hub` handler, add CLI flag | ~10 |
| `src/pages/Home.tsx` | Add "Hub" navigation button | ~5 |
| `src/App.tsx` | Add Hub route/page switching | ~5 |
