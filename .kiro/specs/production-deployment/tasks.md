# Implementation Plan: Production Deployment

## Overview

将 Arthas E2EE 聊天室从开发环境升级为生产就绪状态。实现健康检查端点、优雅关闭、CORS Origin 控制、结构化日志，以及前端/后端部署配置文件。所有后端变更仅使用 Go 标准库，不引入新依赖。

## Tasks

- [x] 1. Create structured logger package
  - [x] 1.1 Create `internal/logger/logger.go` with Init, Info, Warn, Error functions
    - Implement `[RFC3339] [LEVEL] [MODULE] message` format using standard `log` package
    - Include `Init()` function that sets `log.SetFlags(0)` and `log.SetOutput(os.Stdout)`
    - Include detailed GoDoc comments and 📚 学习要点 annotations as specified in design
    - _Requirements: 4.1, 4.5_

  - [x] 1.2 Write property test for structured log format (Property 3)
    - **Property 3: Structured log format invariant**
    - Use `testing/quick` with minimum 100 iterations
    - Verify output matches `[<RFC3339>] [<LEVEL>] [<MODULE>] <message>` for any module/level/message
    - Test file: `internal/logger/logger_test.go`
    - **Validates: Requirements 4.1**

- [x] 2. Implement Origin validation
  - [x] 2.1 Create `internal/network/origin.go` with InitOriginControl and CheckOriginAllowed
    - Parse `ALLOWED_ORIGINS` env var: split by comma, trim whitespace, filter empty entries
    - `CheckOriginAllowed` returns true if origin matches any entry, or if list is empty (dev mode)
    - Include defensive parsing (handle extra commas, whitespace) per Postel's Law
    - Include detailed comments and 📚 学习要点 annotations
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.2 Write property test for origin list parsing (Property 1)
    - **Property 1: Origin list parsing preserves all entries**
    - Use `testing/quick` with minimum 100 iterations
    - Verify parsing produces same set of trimmed non-empty origins, empty entries filtered
    - Test file: `internal/network/origin_test.go`
    - **Validates: Requirements 2.2, 3.4**

  - [x] 2.3 Write property test for origin validation correctness (Property 2)
    - **Property 2: Origin validation correctness**
    - Use `testing/quick` with minimum 100 iterations
    - Verify returns true iff origin matches an entry, or list is empty
    - Test file: `internal/network/origin_test.go`
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 2.4 Write unit tests for origin validation edge cases
    - Test `"a.com,,b.com,"` parses to `["a.com", "b.com"]`
    - Test empty ALLOWED_ORIGINS allows all origins
    - Test non-allowed origin is rejected
    - Test allowed origin is accepted
    - Test file: `internal/network/origin_test.go`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Create frontend deployment configuration files
  - [x] 3.1 Create `arthas-client/vercel.json` with SPA rewrite and cache headers
    - Add rewrite rule: all routes → `/index.html`
    - Add cache headers for `/assets/(.*)`: `public, immutable, max-age=31536000`
    - _Requirements: 2.4_

  - [x] 3.2 Create `arthas-client/.env.production.example`
    - Document `VITE_WS_URL=wss://your-backend-domain/ws`
    - Note: `websocket.ts` already reads `import.meta.env.VITE_WS_URL` with fallback — no code change needed
    - _Requirements: 2.5_

- [x] 4. Checkpoint — Logger, Origin, and Frontend config
  - Run: `go build ./...` (verify compilation)
  - Run: `go test ./internal/logger/... ./internal/network/... -v` (verify tests)
  - Run: `go vet ./...` (static analysis)
  - Verify `arthas-client/vercel.json` is valid JSON
  - Ask the user if questions arise.

- [x] 5. Implement Hub graceful shutdown support
  - ⚠️ **Risk: HIGH** — Modifies core Hub struct that all connections depend on. Verify existing room tests pass after each sub-task.

  - [x] 5.1 Add `done` channel to Hub and modify `Run()` for clean exit
    - Add `done chan struct{}` field initialized in `NewHub()`
    - Modify `Run()` to add `case <-h.done: return` in the select loop
    - This enables the shutdown signal without changing any other behavior
    - _Requirements: 1.3_

  - [x] 5.2 Add `sync.WaitGroup`, `Stop()`, and `Wait()` methods to Hub
    - Add `wg sync.WaitGroup` field for tracking readPump/writePump goroutines
    - Implement `Stop()`: close done, then acquire `h.mu.Lock()` before iterating clients to close send channels and clear map (existing `mu` field already in Hub — use write lock to prevent race with `clientCount()`)
    - Implement `Wait()`: call `wg.Wait()`
    - Include detailed comments explaining close-broadcast pattern and shutdown ordering
    - _Requirements: 1.3, 1.4_

  - [x] 5.3 Update `ServeWs` for WaitGroup tracking and shutdown-safe registration
    - Add `hub.wg.Add(2)` before launching readPump/writePump goroutines
    - Wrap goroutines with `defer hub.wg.Done()`
    - Add `select` guard on `hub.register <- client` with `case <-hub.done` fallback
    - _Requirements: 1.3, 1.4_

  - [x] 5.4 Update `readPump` defer for shutdown-safe unregistration
    - Add `select` guard on `hub.unregister <- c` with `case <-hub.done` fallback
    - Prevents goroutine leak when Hub.Run() has already exited
    - _Requirements: 1.3, 1.4_

  - [x] 5.5 Write unit tests for Hub lifecycle (Stop/Wait behavior)
    - Test that Stop() causes Run() to exit
    - Test that Wait() returns after all goroutines finish
    - Test that register after Stop doesn't block
    - Test file: `internal/network/hub_test.go`
    - _Requirements: 1.3, 1.4_

- [x] 6. Implement CORS integration in WebSocket upgrader
  - [x] 6.1 Update `client.go` upgrader CheckOrigin to use `CheckOriginAllowed`
    - Set `CheckOrigin` function to validate Origin header via `CheckOriginAllowed`
    - Log WARN with rejected origin and remote address on rejection
    - Add `isCORSRejection` helper to detect CORS-specific upgrade errors
    - ⚠️ **Fragility note**: `isCORSRejection` uses `strings.Contains(err.Error(), "origin not allowed")` — this depends on gorilla/websocket's internal error message. If the library updates, this may silently break. Add a comment documenting this coupling and consider a fallback strategy.
    - Update `ServeWs` to skip double-logging for CORS rejections
    - _Requirements: 3.1, 3.2_

  - [x] 6.2 Write unit tests for CORS rejection flow
    - Test non-allowed origin gets HTTP 403 on WS upgrade
    - Test CORS rejection produces exactly one log entry (no double-logging)
    - **Test that `isCORSRejection` correctly identifies the gorilla/websocket error string** (regression guard for fragile string matching)
    - Test file: `internal/network/origin_test.go`
    - _Requirements: 3.1, 3.2_

- [x] 7. Checkpoint — Hub shutdown, CORS, and regression verification
  - Run: `go build ./...`
  - Run: `go test ./internal/network/... -v` (Hub + CORS tests)
  - Run: `go test ./internal/room/... -v` (**regression**: verify room tests still pass after Hub modifications)
  - Run: `go test -race ./internal/network/... ./internal/room/...` (**race detection**: Hub changes involve heavy concurrency — channels, WaitGroup, mutex)
  - Run: `go vet ./...`
  - Ask the user if questions arise.

- [x] 8. Rewrite `cmd/server/main.go` for production server lifecycle
  - ⚠️ **Risk: MEDIUM** — Complete rewrite of the application entry point. Keep a mental model of the old main.go for rollback.

  - [x] 8.1 Implement production-ready main.go with explicit ServeMux and http.Server
    - Add `var Version = "1.0.0"` overridable via ldflags
    - Initialize logger, create Hub, start `hub.Run()` in goroutine
    - Create explicit `http.NewServeMux()` with `/ping` and `/ws` routes
    - Read `PORT` env var (default "8080"), read `ALLOWED_ORIGINS` and call `InitOriginControl`
    - Create `http.Server` with `ReadHeaderTimeout: 10 * time.Second`
    - Start `srv.ListenAndServe()` in goroutine
    - Log startup message with port, version, RFC 3339 timestamp
    - _Requirements: 1.1, 1.2, 1.5, 2.1, 2.2_

  - [x] 8.2 Implement signal handling and two-phase graceful shutdown
    - Listen for SIGTERM/SIGINT via `signal.Notify` on buffered channel
    - Phase 1: `srv.Shutdown(ctx)` with 5-second timeout context
    - Phase 2: `hub.Stop()` to close all WebSocket connections
    - Phase 3: `hub.Wait()` with select on done channel vs context deadline
    - Exit with code 0
    - Include detailed 📚 学习要点 annotations for signal handling and context patterns
    - _Requirements: 1.3, 1.4_

  - [x] 8.3 Implement `/ping` health check handler
    - Return HTTP 200 with `Content-Type: text/plain` and body `"pong"`
    - No authentication required
    - Served on same port and mux as `/ws`
    - _Requirements: 1.1, 1.2_

  - [x] 8.4 Write unit tests for ping endpoint and startup behavior
    - Test GET /ping returns 200 + "pong"
    - Test /ping accessible without auth headers
    - Test /ping responds within 100ms
    - Test PORT defaults to 8080 when unset
    - Test startup log contains port, version, RFC 3339 timestamp
    - Test file: `cmd/server/main_test.go`
    - _Requirements: 1.1, 1.2, 1.5, 2.1_

- [x] 9. Migrate existing log calls to structured logger
  - [x] 9.1 Replace all `log.Printf` calls in `hub.go` and `client.go` with logger calls
    - Replace `log.Printf("[Hub] ...")` with `logger.Info("Hub", ...)`
    - Replace error logs with `logger.Error(...)` or `logger.Warn(...)`
    - Add connect/disconnect logs with client ID and total connection count
    - Add room create/destroy logs with room ID and total room count
    - Ensure no message content (iv, ciphertext) is ever logged
    - **Update imports**: remove `"log"` package, add `"github.com/arthas/arthas-server/internal/logger"`
    - **Scope**: Only `hub.go` and `client.go` need migration. Verified: `protocol.go` and `room/` package have zero `log.` calls.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 10. Write property test for zero-knowledge log invariant (Property 4)
  - **Property 4: Zero-knowledge log invariant**
  - Use `testing/quick` with minimum 100 iterations
  - Capture log output (redirect via `log.SetOutput`) during simulated message relay
  - Verify that log output never contains the iv or ciphertext strings passed to the relay
  - Depends on: Task 1.1 (logger), Task 9.1 (log migration complete so relay uses logger)
  - Test file: `internal/logger/logger_test.go` or `internal/network/hub_test.go`
  - **Validates: Requirements 4.5**

- [x] 11. Checkpoint — Full server lifecycle verification
  - Run: `go build ./...`
  - Run: `go test ./... -v` (all packages)
  - Run: `go test -race ./...` (**race detection**: full concurrency verification across all packages)
  - Run: `go vet ./...`
  - Manual verification (platform-neutral): start server in one terminal with `go run ./cmd/server`, then in another terminal run `curl http://localhost:8080/ping` (or `Invoke-WebRequest http://localhost:8080/ping` on Windows PowerShell). Expect response: `pong`
  - Ask the user if questions arise.

- [x] 12. Optimize Dockerfile for production
  - [x] 12.0 Create `arthas-server/.dockerignore` for build cache optimization
    - Exclude: `.git`, `docs/`, `official_doc/`, `arthas-client/`, `*.md`, `.kiro/`
    - This prevents unnecessary cache invalidation when non-server files change
    - _Requirements: 5.1_

  - [x] 12.1 Update `arthas-server/Dockerfile` with ldflags, non-root user, and HEALTHCHECK
    - Add `ARG VERSION=1.0.0` and `-ldflags "-s -w -X main.Version=${VERSION}"` to build
    - Add non-root user (UID 1000) for security
    - **Note**: Change `WORKDIR` from `/root/` to `/home/appuser` — this is a significant path change
    - Add `HEALTHCHECK` instruction using wget to `/ping` (BusyBox wget is included in Alpine by default)
    - Set `EXPOSE 7860` and `ENV PORT=7860`
    - Ensure final image < 30MB
    - Depends on: Task 8.1 (main.go must declare `var Version` for ldflags `-X main.Version` to work)
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 12.2 Write integration test for Docker image size
    - Verify built image is under 30MB
    - Use `//go:build integration` tag
    - _Requirements: 5.1_

- [x] 13. Final checkpoint — Full build verification
  - Run: `go build ./...` (no errors)
  - Run: `go test ./... -v` (all tests pass)
  - Run: `go vet ./...` (no issues)
  - Verify frontend: `cd arthas-client && npm run build` (produces self-contained `dist/`)
  - Verify Docker: `docker build -t arthas-server .` (builds successfully)
  - Verify image size: `docker images arthas-server --format "{{.Size}}"` (< 30MB)
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints include specific commands for reproducible verification
- Property tests validate universal correctness properties using Go's `testing/quick` package
- Unit tests validate specific examples and edge cases
- All backend code uses Go standard library only (no new dependencies)
- Frontend requires no runtime code changes — only configuration files added
- The VERSION constant is overridable via `-ldflags "-X main.Version=..."` for CI/CD
- ⚠️ Risk annotations highlight tasks that modify core infrastructure
- **Future consideration**: If `golangci-lint` is configured for this project (`.golangci.yml`), add `golangci-lint run` to the final checkpoint. Currently not in scope as no lint config exists.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "3.2", "5.1"], "note": "Logger, frontend config, Hub done channel (all independent)" },
    { "id": 1, "tasks": ["2.1", "1.2", "5.2", "5.4"], "note": "Origin (needs logger), logger test, Hub WaitGroup+Stop/Wait, readPump guard" },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "5.3", "6.1"], "note": "Origin tests, ServeWs update (needs wg from 5.2), CORS integration" },
    { "id": 3, "tasks": ["5.5", "6.2", "8.1"], "note": "Hub lifecycle tests, CORS tests, main.go rewrite" },
    { "id": 4, "tasks": ["8.2", "8.3", "9.1"], "note": "Signal handling, ping handler, log migration" },
    { "id": 5, "tasks": ["8.4", "10.1"], "note": "Main tests + zero-knowledge property test" },
    { "id": 6, "tasks": ["12.0", "12.1"], "note": "Dockerignore + Dockerfile (needs 8.1 for var Version)" },
    { "id": 7, "tasks": ["12.2"], "note": "Docker image size test" }
  ]
}
```

## Dependency Rationale

| Dependency | Reason |
|------------|--------|
| 5.1 in Wave 0 | `done` channel addition is self-contained, no dependency on logger or origin |
| 2.1 in Wave 1 | `origin.go` calls `logger.Warn` and `logger.Info` — depends on 1.1 (logger package) |
| 5.4 in Wave 1 | readPump `select` guard only needs `hub.done` (from 5.1), not `hub.wg` |
| 5.3 in Wave 2 | ServeWs uses both `hub.done` (5.1) AND `hub.wg.Add` (5.2) — must wait for both |
| 6.1 in Wave 2 | CORS integration calls `CheckOriginAllowed` (2.1) and `logger.Warn` (1.1) |
| 8.1 in Wave 3 | main.go uses `hub.Stop()` and `hub.Wait()` which are added in Task 5.2 |
| 9.1 in Wave 4 | Log migration should happen after main.go is stable to avoid merge conflicts |
| 10.1 in Wave 5 | Zero-knowledge test needs the relay path to use structured logger (after 9.1) |
| 12.1 in Wave 6 | Dockerfile `-X main.Version` requires `var Version` declaration in main.go (8.1) |
