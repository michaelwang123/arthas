# Design Document: Production Deployment

## Overview

This design covers the code changes and configuration files needed to make Arthas production-ready. The scope includes five areas:

1. **Health check & graceful shutdown** — Add `/ping` HTTP endpoint and two-phase SIGTERM-aware shutdown to `main.go`
2. **Production environment configuration** — Environment variable handling, `vercel.json`, and `.env.production.example`
3. **CORS & Origin control** — Validate WebSocket upgrade `Origin` header against `ALLOWED_ORIGINS`
4. **Structured logging** — Replace raw `log.Printf` calls with a consistent `[RFC3339] [LEVEL] [module] message` format
5. **Deployment artifacts** — Optimize the existing Dockerfile and ensure frontend build is self-contained

All changes use Go standard library only (no new backend dependencies). The frontend gains no new runtime dependencies.

## Architecture

```mermaid
graph TD
    subgraph "Production Infrastructure"
        V[Vercel - Static Hosting]
        CP[Container Platform - HF Spaces / Railway]
        CJ[cron-job.org - Keep-alive]
    end

    subgraph "arthas-client (Vercel)"
        FE[React + Vite SPA]
        VJ[vercel.json - SPA rewrite + cache]
    end

    subgraph "arthas-server (Docker)"
        MAIN[main.go - HTTP server + shutdown]
        PING[/ping handler]
        WS[/ws handler]
        CORS[Origin validator]
        LOG[Structured logger]
        HUB[Hub - connection manager]
    end

    FE -->|WSS| WS
    CJ -->|GET /ping| PING
    V --> FE
    CP --> MAIN
    MAIN --> PING
    MAIN --> WS
    WS --> CORS
    CORS -->|pass| HUB
    CORS -->|reject 403| WS
    HUB --> LOG
```

**Key architectural decisions:**

- The `/ping` endpoint shares the same `http.ServeMux` and port as `/ws` — no separate health-check port.
- Uses an **explicit `http.NewServeMux()`** instead of `DefaultServeMux` for testability and isolation.
- Graceful shutdown uses a **two-phase approach**: `http.Server.Shutdown()` stops the listener, then `Hub.Stop()` actively closes all WebSocket connections. This is necessary because WebSocket connections are hijacked from the HTTP server and `Shutdown()` alone will NOT wait for them.
- Origin validation happens inside the `websocket.Upgrader.CheckOrigin` function, before the WebSocket handshake completes.
- Structured logging is implemented as a thin helper in a new `internal/logger` package wrapping the standard `log` package.
- `ReadHeaderTimeout` is set on `http.Server` to prevent slowloris attacks.

## Components and Interfaces

### 1. `cmd/server/main.go` — Server Lifecycle

**Current state:** Calls `http.ListenAndServe` directly with no shutdown handling, uses `DefaultServeMux`.

**Changes:**

```go
// New constants/variables
var Version = "1.0.0" // overridable via -ldflags "-X main.Version=..."

func main() {
    // 1. Initialize structured logger
    logger.Init()

    // 2. Create Hub, start Hub.Run()
    hub := network.NewHub()
    go hub.Run()

    // 3. Register routes on explicit ServeMux
    mux := http.NewServeMux()
    mux.HandleFunc("/ping", handlePing)
    mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
        network.ServeWs(hub, w, r)
    })

    // 4. Create http.Server with security timeouts
    port := os.Getenv("PORT")
    if port == "" {
        port = "8080"
    }
    srv := &http.Server{
        Addr:              ":" + port,
        Handler:           mux,
        ReadHeaderTimeout: 10 * time.Second, // slowloris 防护
    }

    // 5. Start server in goroutine
    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            logger.Error("Server", "listen failed: %v", err)
            os.Exit(1)
        }
    }()

    logger.Info("Server", "started on :%s (version %s)", port, Version)

    // 6. Wait for SIGTERM/SIGINT
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
    <-quit

    logger.Info("Server", "shutting down...")

    // 7. Two-phase graceful shutdown
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    // Phase 1: Stop accepting new connections
    srv.Shutdown(shutdownCtx)

    // Phase 2: Close existing WebSocket connections
    hub.Stop()

    // Phase 3: Wait for all client goroutines to finish (with timeout)
    done := make(chan struct{})
    go func() {
        hub.Wait()
        close(done)
    }()

    select {
    case <-done:
        logger.Info("Server", "all connections closed gracefully")
    case <-shutdownCtx.Done():
        logger.Warn("Server", "shutdown timeout, forcing exit")
    }

    os.Exit(0)
}

func handlePing(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/plain")
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("pong"))
}
```

**Interface:**
- `GET /ping` → 200 `"pong"` (plain text, no auth, sub-millisecond response)
- `GET /ws` → WebSocket upgrade (existing)

**Design rationale:**
- Explicit `http.NewServeMux()` avoids global state pollution in tests.
- `ReadHeaderTimeout: 10s` prevents slowloris attacks where clients send headers very slowly to exhaust server resources.
- Two-phase shutdown is necessary because `http.Server.Shutdown()` does NOT wait for hijacked (WebSocket) connections — it only waits for non-hijacked HTTP requests.

### 2. `internal/network/hub.go` — Hub Lifecycle & Graceful Shutdown

**Current state:** `Hub.Run()` is an infinite loop with no exit path.

**New fields and methods:**

```go
type Hub struct {
    roomManager *room.RoomManager
    clients     map[*Client]bool
    register    chan *Client
    unregister  chan *Client
    mu          sync.RWMutex

    // Graceful shutdown support
    done chan struct{}   // closed to signal Run() to exit
    wg   sync.WaitGroup // tracks active client goroutines
}

func NewHub() *Hub {
    return &Hub{
        roomManager: room.NewRoomManager(),
        clients:     make(map[*Client]bool),
        register:    make(chan *Client),
        unregister:  make(chan *Client),
        done:        make(chan struct{}),
    }
}

// Run starts the Hub main loop. Returns when Stop() is called.
func (h *Hub) Run() {
    for {
        select {
        case <-h.done:
            return
        case client := <-h.register:
            h.mu.Lock()
            h.clients[client] = true
            h.mu.Unlock()
            logger.Info("Hub", "client %s connected, total: %d", client.ID, h.clientCount())
        case client := <-h.unregister:
            h.mu.Lock()
            if _, ok := h.clients[client]; ok {
                delete(h.clients, client)
                close(client.send)
            }
            h.mu.Unlock()
            h.handleClientDisconnect(client)
            logger.Info("Hub", "client %s disconnected, total: %d", client.ID, h.clientCount())
        }
    }
}

// Stop signals all clients to close and terminates the Hub loop.
func (h *Hub) Stop() {
    close(h.done)
    h.mu.Lock()
    for client := range h.clients {
        close(client.send)
        delete(h.clients, client)
    }
    h.mu.Unlock()
}

// Wait blocks until all client goroutines have finished.
func (h *Hub) Wait() {
    h.wg.Wait()
}
```

**WaitGroup usage in ServeWs:**

```go
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        // Only log non-CORS errors (CORS rejection already logged in CheckOrigin)
        if !isCORSRejection(err) {
            logger.Warn("WS", "upgrade error: %v", err)
        }
        return
    }

    client := &Client{
        ID:   generateID(),
        hub:  hub,
        conn: conn,
        send: make(chan []byte, sendBufferSize),
    }

    // Register with shutdown safety: if Hub is already stopped, close immediately
    select {
    case hub.register <- client:
    case <-hub.done:
        conn.Close()
        return
    }

    // Track goroutines for graceful shutdown
    hub.wg.Add(2)
    go func() {
        defer hub.wg.Done()
        client.writePump()
    }()
    go func() {
        defer hub.wg.Done()
        client.readPump()
    }()
}
```

**Channel safety in readPump defer (prevents blocking after shutdown):**

```go
func (c *Client) readPump() {
    defer func() {
        // Use select with done channel to avoid blocking if Hub has stopped
        select {
        case c.hub.unregister <- c:
        case <-c.hub.done:
            // Hub already stopped, cleanup handled by Hub.Stop()
        }
        c.conn.Close()
    }()
    // ... existing readPump logic
}
```

**Design rationale for channel safety:** After `Hub.Run()` exits (done channel closed), the `register` and `unregister` channels have no reader. Without the `select` guard, goroutines would block forever on these unbuffered channels, causing a goroutine leak and preventing clean shutdown.
```

**Design rationale:**
- `done` channel allows `Run()` to exit cleanly during shutdown.
- `Stop()` closes all client `send` channels, which causes `writePump` to send a close frame and exit.
- `sync.WaitGroup` tracks readPump/writePump goroutines so `main.go` can wait for them to finish before exiting.
- The requirement "exit immediately once all connections have closed before the timeout expires" is satisfied by the `select` on `done` channel vs context deadline.

### 3. `internal/logger/logger.go` — Structured Logging

A new package providing formatted log output using only the standard library.

```go
package logger

import (
    "fmt"
    "log"
    "os"
    "time"
)

// Level constants
const (
    INFO  = "INFO"
    WARN  = "WARN"
    ERROR = "ERROR"
)

// Init disables default log flags and sets output to stdout.
// MUST be called before any goroutines start logging.
func Init() {
    log.SetFlags(0)
    log.SetOutput(os.Stdout)
}

// Info logs an INFO-level message: [RFC3339] [INFO] [module] message
func Info(module, format string, args ...interface{}) {
    emit(INFO, module, format, args...)
}

// Warn logs a WARN-level message: [RFC3339] [WARN] [module] message
func Warn(module, format string, args ...interface{}) {
    emit(WARN, module, format, args...)
}

// Error logs an ERROR-level message: [RFC3339] [ERROR] [module] message
func Error(module, format string, args ...interface{}) {
    emit(ERROR, module, format, args...)
}

func emit(level, module, format string, args ...interface{}) {
    ts := time.Now().Format(time.RFC3339)
    msg := fmt.Sprintf(format, args...)
    log.Printf("[%s] [%s] [%s] %s", ts, level, module, msg)
}
```

**Design rationale:**
- A dedicated package avoids scattering `time.Now().Format(time.RFC3339)` across every call site.
- The module tag (e.g., `Server`, `Hub`, `WS`, `CORS`) enables log filtering via grep.
- `Init()` is called once in `main()` before any goroutines start, ensuring no race condition on log configuration.
- Thread-safe: Go's `log` package uses an internal mutex.

### 4. `internal/network/origin.go` — Origin Validation (New File)

**Extracted to a separate file** for clarity and testability (instead of embedding in `client.go`):

```go
package network

import (
    "strings"

    "github.com/arthas/arthas-server/internal/logger"
)

var allowedOrigins []string

// InitOriginControl parses the ALLOWED_ORIGINS environment variable.
// Empty entries are filtered out. If the result is an empty list,
// all origins will be accepted (development mode).
func InitOriginControl(origins string) {
    if origins == "" {
        allowedOrigins = nil
        return
    }

    parts := strings.Split(origins, ",")
    result := make([]string, 0, len(parts))
    for _, p := range parts {
        trimmed := strings.TrimSpace(p)
        if trimmed != "" {
            result = append(result, trimmed)
        }
    }

    allowedOrigins = result

    if len(result) == 0 {
        logger.Warn("CORS", "ALLOWED_ORIGINS set but contains no valid entries, allowing all origins")
    } else {
        logger.Info("CORS", "origin control enabled, %d allowed origins", len(result))
    }
}

// CheckOriginAllowed validates an origin against the allowed list.
// Returns true if the origin is permitted.
func CheckOriginAllowed(origin string) bool {
    if len(allowedOrigins) == 0 {
        return true // dev mode: allow all
    }
    for _, allowed := range allowedOrigins {
        if origin == allowed {
            return true
        }
    }
    return false
}
```

**Changes to `client.go` upgrader:**

```go
var upgrader = websocket.Upgrader{
    ReadBufferSize:  1024,
    WriteBufferSize: 1024,
    CheckOrigin: func(r *http.Request) bool {
        origin := r.Header.Get("Origin")
        if CheckOriginAllowed(origin) {
            return true
        }
        logger.Warn("CORS", "rejected origin: %s from %s", origin, r.RemoteAddr)
        return false
    },
}
```

**CORS rejection logging deduplication:**

```go
// Helper to detect CORS rejection errors from gorilla/websocket
func isCORSRejection(err error) bool {
    return strings.Contains(err.Error(), "origin not allowed")
}
```

In `ServeWs`, only log non-CORS upgrade errors to avoid double-logging:
```go
if err != nil {
    if !isCORSRejection(err) {
        logger.Warn("WS", "upgrade error: %v", err)
    }
    return
}
```

**Design rationale:**
- Separate file (`origin.go`) keeps origin logic isolated and independently testable.
- Empty entries after split are filtered (not treated as "malformed") — this prevents the dangerous case where `ALLOWED_ORIGINS=,,,` silently allows all origins.
- CORS rejection is logged once in `CheckOrigin`, not again in `ServeWs`, avoiding duplicate log entries.
- `CheckOriginAllowed` is exported for direct unit testing without needing HTTP requests.

### 5. `arthas-client/vercel.json` — SPA Configuration

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, immutable, max-age=31536000"
        }
      ]
    }
  ]
}
```

**Design rationale:** Vite outputs hashed filenames to `/assets/` by default. Vercel serves existing files first before applying rewrites, so static assets are served directly. The rewrite rule enables client-side routing for all other paths. Cache headers target only hashed assets to enable aggressive caching (1 year).

### 6. `arthas-client/.env.production.example`

```
VITE_WS_URL=wss://your-backend-domain/ws
```

Documents the required build-time variable without committing secrets. The actual value is set as a Vercel Environment Variable.

**Note:** No frontend code changes are needed — `websocket.ts` already reads `import.meta.env.VITE_WS_URL` with fallback to `ws://localhost:8080/ws`.

### 7. Dockerfile Optimization

**Current state:** Basic multi-stage build (Go 1.22 Alpine → Alpine runtime), no ldflags, no HEALTHCHECK.

**Changes:**
- Add `-ldflags "-s -w -X main.Version=${VERSION}"` to strip debug symbols and inject version
- Add `HEALTHCHECK` instruction for container orchestrators
- Verify final image stays under 30MB (Go binary ~8MB after stripping + Alpine base ~7MB ≈ ~15MB)

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=1.0.0
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-s -w -X main.Version=${VERSION}" \
    -o server ./cmd/server

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/server .
EXPOSE 7860
ENV PORT=7860
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -qO- http://localhost:7860/ping || exit 1
CMD ["./server"]
```

**Design rationale:**
- `-s -w` strips symbol table and DWARF debug info, reducing binary size by ~30%.
- `-X main.Version=${VERSION}` allows CI/CD to inject the git tag or commit hash.
- `HEALTHCHECK` enables Docker's built-in health monitoring (used by orchestrators like Docker Compose, Kubernetes).
- Alpine's BusyBox includes `wget`, no additional packages needed.
- **Future improvement:** Add non-root user (`adduser -D appuser` + `USER appuser`) once target platform compatibility is confirmed.

## Data Models

This feature introduces no new persistent data models. The changes are purely operational:

| Item | Type | Description |
|------|------|-------------|
| `Version` | `string` (compile-time) | Server version, injected via ldflags |
| `allowedOrigins` | `[]string` (runtime) | Parsed from `ALLOWED_ORIGINS` env var at startup |
| Log entry | Structured text | `[RFC3339] [LEVEL] [MODULE] message` |
| `Hub.done` | `chan struct{}` | Closed to signal shutdown |
| `Hub.wg` | `sync.WaitGroup` | Tracks active client goroutines |

**Environment Variables:**

| Variable | Component | Required | Default | Description |
|----------|-----------|----------|---------|-------------|
| `PORT` | Backend | No | `8080` | HTTP listen port |
| `ALLOWED_ORIGINS` | Backend | No | (empty = allow all) | Comma-separated allowed origins |
| `VITE_WS_URL` | Frontend (build-time) | No | `ws://localhost:8080/ws` | WebSocket server URL |
| `VERSION` | Backend (build-time) | No | `1.0.0` | Injected via Docker ARG / ldflags |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Origin list parsing preserves all entries

*For any* comma-separated string of valid origin URLs (with arbitrary leading/trailing whitespace per entry), parsing the string into an origin list SHALL produce exactly the same set of trimmed, non-empty origins in the same order. Empty entries (resulting from consecutive commas or trailing commas) SHALL be filtered out.

**Validates: Requirements 2.2, 3.4**

### Property 2: Origin validation correctness

*For any* origin string and any non-empty allowed origins list, the origin validation function SHALL return `true` if and only if the origin exactly matches one of the entries in the allowed list. When the allowed list is empty, the function SHALL return `true` for any origin.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 3: Structured log format invariant

*For any* log event (with any module name, any level, and any message string that does not contain newlines), the formatted log output SHALL match the pattern `[<RFC3339>] [<LEVEL>] [<MODULE>] <message>` where `<RFC3339>` is a valid RFC 3339 timestamp, `<LEVEL>` is one of INFO/WARN/ERROR, and `<MODULE>` is the provided module string.

**Validates: Requirements 4.1**

### Property 4: Zero-knowledge log invariant

*For any* message relay operation with any iv and ciphertext values, the log output produced during that operation SHALL NOT contain the iv or ciphertext strings. This property holds regardless of the content of iv/ciphertext (including strings that look like log metadata).

**Validates: Requirements 4.5**

### Property 5: Graceful shutdown bounded termination

*For any* set of active WebSocket connections (0 to N), after SIGTERM is received, the server process SHALL exit within 5 seconds. If all connections close before the timeout, the server SHALL exit immediately without waiting for the full timeout.

**Validates: Requirements 1.3, 1.4**

## Error Handling

| Scenario | Behavior | HTTP/WS Response |
|----------|----------|------------------|
| Invalid Origin on WS upgrade | Reject upgrade, log WARN (once, in CheckOrigin) | HTTP 403 Forbidden |
| `/ping` during shutdown | May return 503 (server closing listener) | HTTP 503 |
| SIGTERM received | Two-phase: stop listener → close WS connections → wait/timeout → exit 0 | N/A (process level) |
| `ALLOWED_ORIGINS` contains only empty entries | Treat as empty list (allow all), log WARN at startup | N/A |
| `PORT` non-numeric | `ListenAndServe` fails → log ERROR + exit 1 | N/A |
| WebSocket write fails during shutdown | writePump exits, wg.Done() called, doesn't block shutdown | N/A |
| In-flight messages during shutdown | May be lost — acceptable for E2EE chat with no persistence guarantee | N/A |
| Slowloris attack (slow headers) | `ReadHeaderTimeout: 10s` closes connection after timeout | Connection reset |

**Graceful shutdown sequence (two-phase):**

```
SIGTERM received
    │
    ▼
Phase 1: srv.Shutdown(ctx)
    ├── Stops accepting new TCP connections
    ├── Waits for active HTTP requests (non-WebSocket) to complete
    └── Returns immediately for hijacked (WebSocket) connections
    │
    ▼
Phase 2: hub.Stop()
    ├── Closes hub.done channel → Hub.Run() exits
    ├── Closes all client.send channels
    └── writePump detects closed channel → sends WS close frame → exits
    │
    ▼
Phase 3: hub.Wait() with timeout
    ├── Waits for all readPump/writePump goroutines (via WaitGroup)
    ├── If all done before timeout → exit immediately
    └── If timeout expires → log warning, force exit
    │
    ▼
Exit with code 0
```

**CORS rejection flow:**

1. WebSocket upgrade request arrives
2. `CheckOrigin` reads `Origin` header
3. If `allowedOrigins` is empty → return true (dev mode)
4. If origin matches any entry → return true
5. Otherwise → log WARN with rejected origin and remote addr, return false
6. Gorilla WebSocket library returns HTTP 403 to client
7. `ServeWs` detects CORS-specific error → does NOT double-log

## Testing Strategy

### Unit Tests (Example-Based)

| Test | What it verifies |
|------|-----------------|
| `TestPingEndpoint` | GET /ping returns 200 + "pong" |
| `TestPingNoAuth` | /ping accessible without any headers |
| `TestPingResponseTime` | /ping responds within 100ms |
| `TestPortDefault` | Server defaults to 8080 when PORT unset |
| `TestPortFromEnv` | Server uses PORT env var value |
| `TestStartupLog` | Startup log contains port, version, RFC 3339 timestamp |
| `TestOriginRejection403` | Non-allowed origin gets HTTP 403 on WS upgrade |
| `TestAllowedOriginAccepted` | Allowed origin successfully upgrades |
| `TestEmptyOriginsAllowAll` | Empty ALLOWED_ORIGINS allows any origin |
| `TestOriginsWithExtraCommas` | `"a.com,,b.com,"` parses to `["a.com", "b.com"]` |
| `TestLogConnectDisconnect` | Connect/disconnect logs contain client ID + count |
| `TestLogRoomCreateDestroy` | Room events log room ID + count |
| `TestLogNoCORSDoubleLog` | CORS rejection produces exactly one log entry |
| `TestVersionLdflags` | Version injected via ldflags appears in startup log |
| `TestReadHeaderTimeout` | Slow client sending headers is disconnected after 10s |

### Property-Based Tests

**Library:** Go standard `testing/quick` package (no new dependencies)

**Configuration:** Minimum 100 iterations per property test.

| Test | Property | Tag |
|------|----------|-----|
| `TestParseOriginsProperty` | Property 1: Origin list parsing | `Feature: production-deployment, Property 1: Origin list parsing preserves all entries` |
| `TestOriginValidationProperty` | Property 2: Origin validation | `Feature: production-deployment, Property 2: Origin validation correctness` |
| `TestLogFormatProperty` | Property 3: Log format invariant | `Feature: production-deployment, Property 3: Structured log format invariant` |
| `TestNoSecretInLogsProperty` | Property 4: Zero-knowledge log | `Feature: production-deployment, Property 4: Zero-knowledge log invariant` |

### Integration Tests

| Test | What it verifies | Environment |
|------|-----------------|-------------|
| `TestGracefulShutdown` | SIGTERM → server stops accepting, exits within 5s | Any |
| `TestGracefulShutdownEarlyExit` | All clients disconnect → server exits before 5s timeout | Any |
| `TestDockerImageSize` | Built image < 30MB | CI only (`//go:build integration`) |
| `TestFrontendBuildSelfContained` | `npm run build` produces dist/ with no external CDN refs | CI only |

### Test File Locations

- `arthas-server/cmd/server/main_test.go` — ping endpoint, startup, shutdown, ReadHeaderTimeout
- `arthas-server/internal/logger/logger_test.go` — log format properties
- `arthas-server/internal/network/origin_test.go` — CORS/origin validation properties + unit tests
- `arthas-server/internal/network/hub_test.go` — Hub lifecycle, Stop/Wait behavior

## Migration Notes

### Logging Migration

All existing `log.Printf("[Hub] ...")` and `log.Printf("[WS] ...")` calls must be replaced with the new logger:

| Before | After |
|--------|-------|
| `log.Printf("[Hub] Client %s connected. Total: %d", ...)` | `logger.Info("Hub", "client %s connected, total: %d", ...)` |
| `log.Printf("[WS] Upgrade error: %v", err)` | `logger.Warn("WS", "upgrade error: %v", err)` |
| `log.Printf("[Hub] Failed to marshal ...: %v", err)` | `logger.Error("Hub", "failed to marshal ...: %v", err)` |

### Files Modified

| File | Change Type |
|------|-------------|
| `cmd/server/main.go` | Major rewrite: explicit mux, http.Server, two-phase shutdown |
| `internal/network/hub.go` | Add done channel, wg, Stop(), Wait() methods |
| `internal/network/client.go` | Update upgrader CheckOrigin, update ServeWs for wg tracking |
| `internal/network/origin.go` | **New file**: origin parsing and validation |
| `internal/logger/logger.go` | **New file**: structured logging |
| `arthas-client/vercel.json` | **New file**: SPA rewrite + cache headers |
| `arthas-client/.env.production.example` | **New file**: documents VITE_WS_URL |
| `arthas-server/Dockerfile` | Add ldflags, HEALTHCHECK |

### Files NOT Modified

| File | Reason |
|------|--------|
| `arthas-client/src/network/websocket.ts` | Already reads `VITE_WS_URL` from `import.meta.env` |
| `internal/room/manager.go` | `RoomCount()` already exists |
| `internal/network/protocol.go` | No protocol changes needed |
| `go.mod` | No new dependencies |
