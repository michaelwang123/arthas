# Design Document: Production Deployment

## Overview

This design covers the code changes and configuration files needed to make Arthas production-ready. The scope includes five areas:

1. **Health check & graceful shutdown** — Add `/ping` HTTP endpoint and SIGTERM-aware shutdown to `main.go`
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
- Graceful shutdown uses `http.Server.Shutdown()` with a 5-second context deadline, which drains existing connections.
- Origin validation happens inside the `websocket.Upgrader.CheckOrigin` function, before the WebSocket handshake completes.
- Structured logging is implemented as a thin helper in a new `internal/logger` package wrapping the standard `log` package.

## Components and Interfaces

### 1. `cmd/server/main.go` — Server Lifecycle

**Current state:** Calls `http.ListenAndServe` directly with no shutdown handling.

**Changes:**

```go
// New constants/variables
var Version = "1.0.0" // overridable via -ldflags

func main() {
    // 1. Initialize structured logger
    // 2. Create Hub, start Hub.Run()
    // 3. Register routes: /ping, /ws
    // 4. Create http.Server{Addr: ":PORT", Handler: mux}
    // 5. Start server in goroutine
    // 6. Wait for SIGTERM/SIGINT via os/signal
    // 7. Call server.Shutdown(ctx) with 5s timeout
    // 8. Exit 0
}
```

**Interface:**
- `GET /ping` → 200 `"pong"` (plain text, no auth)
- `GET /ws` → WebSocket upgrade (existing)

### 2. `internal/logger/logger.go` — Structured Logging

A new package providing formatted log output using only the standard library.

```go
package logger

// Level constants
const (
    INFO  = "INFO"
    WARN  = "WARN"
    ERROR = "ERROR"
)

// Init disables default log flags and sets output to stdout
func Init()

// Info logs an INFO-level message: [RFC3339] [INFO] [module] message
func Info(module, format string, args ...interface{})

// Warn logs a WARN-level message
func Warn(module, format string, args ...interface{})

// Error logs an ERROR-level message
func Error(module, format string, args ...interface{})
```

**Design rationale:** A dedicated package avoids scattering `time.Now().Format(time.RFC3339)` across every call site. The module tag (e.g., `Server`, `Hub`, `WS`, `CORS`) enables log filtering.

### 3. `internal/network/client.go` — Origin Validation

**Changes to `upgrader`:**

```go
var allowedOrigins []string // populated from ALLOWED_ORIGINS env var

func InitOriginControl(origins string) {
    // Parse comma-separated origins, trim whitespace
    // Store in allowedOrigins slice
}

var upgrader = websocket.Upgrader{
    CheckOrigin: func(r *http.Request) bool {
        if len(allowedOrigins) == 0 {
            return true // dev mode: allow all
        }
        origin := r.Header.Get("Origin")
        for _, allowed := range allowedOrigins {
            if origin == allowed {
                return true
            }
        }
        // Log warning with rejected origin
        logger.Warn("CORS", "rejected origin: %s", origin)
        return false
    },
}
```

**Design rationale:** Origin checking lives in the same file as the upgrader since `CheckOrigin` is a field on `websocket.Upgrader`. The `InitOriginControl` function is called from `main.go` during startup.

### 4. `arthas-client/vercel.json` — SPA Configuration

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

**Design rationale:** Vite outputs hashed filenames to `/assets/` by default. The rewrite rule enables client-side routing. Cache headers target only hashed assets to enable aggressive caching.

### 5. `arthas-client/.env.production.example`

```
VITE_WS_URL=wss://your-backend-domain/ws
```

Documents the required build-time variable without committing secrets.

### 6. Dockerfile Optimization

**Current state:** Already multi-stage (Go 1.22 Alpine → Alpine runtime). Exposes 7860.

**Changes:**
- Add `-ldflags "-s -w -X main.Version=${VERSION}"` to strip debug symbols and inject version
- Add `HEALTHCHECK` instruction for container orchestrators
- Verify final image stays under 30MB (current Go binary ~10MB + Alpine base ~7MB = ~17MB)

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=1.0.0
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags "-s -w -X main.Version=${VERSION}" -o server ./cmd/server

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/server .
EXPOSE 7860
ENV PORT=7860
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:7860/ping || exit 1
CMD ["./server"]
```

## Data Models

This feature introduces no new persistent data models. The changes are purely operational:

| Item | Type | Description |
|------|------|-------------|
| `Version` | `string` (compile-time) | Server version, injected via ldflags |
| `allowedOrigins` | `[]string` (runtime) | Parsed from `ALLOWED_ORIGINS` env var |
| Log entry | Structured text | `[RFC3339] [LEVEL] [MODULE] message` |

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

*For any* comma-separated string of valid origin URLs (with arbitrary leading/trailing whitespace per entry), parsing the string into an origin list SHALL produce exactly the same set of trimmed, non-empty origins in the same order.

**Validates: Requirements 2.2, 3.4**

### Property 2: Origin validation correctness

*For any* origin string and any non-empty allowed origins list, the origin validation function SHALL return `true` if and only if the origin exactly matches one of the entries in the allowed list.

**Validates: Requirements 3.1, 3.3**

### Property 3: Structured log format invariant

*For any* log event (with any module name, any level, and any message string), the formatted log output SHALL contain a valid RFC 3339 timestamp, the level string, and the module tag, in that order.

**Validates: Requirements 4.1**

### Property 4: Zero-knowledge log invariant

*For any* message relay operation with any iv and ciphertext values, the log output produced during that operation SHALL NOT contain the iv or ciphertext strings.

**Validates: Requirements 4.5**

## Error Handling

| Scenario | Behavior | HTTP/WS Response |
|----------|----------|------------------|
| Invalid Origin on WS upgrade | Reject upgrade, log WARN | HTTP 403 Forbidden |
| `/ping` during shutdown | May return 503 (server closing) | HTTP 503 |
| SIGTERM received | Stop accepting, drain existing, exit 0 | N/A (process level) |
| `ALLOWED_ORIGINS` malformed | Treat as empty (allow all), log WARN at startup | N/A |
| `PORT` non-numeric | Fatal log + exit 1 at startup | N/A |
| WebSocket write fails during shutdown | Close connection, don't block shutdown | N/A |

**Graceful shutdown sequence:**

1. Receive SIGTERM → log "shutting down"
2. Call `server.Shutdown(ctx)` with 5s deadline
3. `Shutdown` stops accepting new connections and waits for active requests to complete
4. If timeout expires, `Shutdown` returns context error → force close remaining connections
5. Exit with code 0

**CORS rejection flow:**

1. WebSocket upgrade request arrives
2. `CheckOrigin` reads `Origin` header
3. If `allowedOrigins` is empty → return true (dev mode)
4. If origin matches any entry → return true
5. Otherwise → log WARN with rejected origin, return false
6. Gorilla WebSocket library returns HTTP 403 to client

## Testing Strategy

### Unit Tests (Example-Based)

| Test | What it verifies |
|------|-----------------|
| `TestPingEndpoint` | GET /ping returns 200 + "pong" |
| `TestPingNoAuth` | /ping accessible without any headers |
| `TestPortDefault` | Server defaults to 8080 when PORT unset |
| `TestPortFromEnv` | Server uses PORT env var value |
| `TestStartupLog` | Startup log contains port, version, RFC 3339 timestamp |
| `TestOriginRejection403` | Non-allowed origin gets HTTP 403 on WS upgrade |
| `TestAllowedOriginAccepted` | Allowed origin successfully upgrades |
| `TestEmptyOriginsAllowAll` | Empty ALLOWED_ORIGINS allows any origin |
| `TestLogConnectDisconnect` | Connect/disconnect logs contain client ID + count |
| `TestLogRoomCreateDestroy` | Room events log room ID + count |
| `TestVersionLdflags` | Version injected via ldflags appears in startup log |

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

| Test | What it verifies |
|------|-----------------|
| `TestGracefulShutdown` | SIGTERM → server stops accepting, exits within 5s |
| `TestDockerImageSize` | Built image < 30MB |
| `TestFrontendBuildSelfContained` | `npm run build` produces dist/ with no external CDN refs |

### Test File Locations

- `arthas-server/cmd/server/main_test.go` — ping endpoint, startup, shutdown
- `arthas-server/internal/logger/logger_test.go` — log format properties
- `arthas-server/internal/network/origin_test.go` — CORS/origin validation properties
