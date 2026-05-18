# Implementation Plan: Self-Hosted Deployment

## Overview

This plan implements self-hosted one-click deployment for Arthas with two tiers: a zero-dependency single binary (Tier 1) and a Docker Compose stack with automatic HTTPS via Caddy (Tier 2). The implementation proceeds bottom-up: frontend WebSocket URL change → Go static file server → server integration → Docker/deploy infrastructure → CI/CD → documentation.

> **Note**: The existing `arthas-server/Dockerfile` (HF Spaces, port 7860) remains unchanged. This spec creates a separate `deploy/Dockerfile` (self-hosted, port 8080) for the new deployment path.

## Tasks

- [x] 1. Frontend relative WebSocket URL
  - [x] 1.1 Implement relative WebSocket URL fallback in `arthas-client/src/network/websocket.ts`
    - Replace the hardcoded `DEFAULT_WS_URL = 'ws://localhost:8080/ws'` with a `getDefaultWsUrl()` function
    - The function derives protocol (`ws:` or `wss:`) from `window.location.protocol` and uses `window.location.host`
    - Fallback to `'ws://localhost:8080/ws'` when `window` is undefined (SSR/test environments)
    - Ensure `import.meta.env.VITE_WS_URL` still takes precedence when set (backward compatible)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Write property test for WebSocket URL derivation
    - **Property 3: WebSocket URL derivation correctness**
    - Use `fast-check` library (already available in project devDependencies)
    - Test that for any `location.protocol` in `{http:, https:}` and any valid `location.host`, the function returns the correct `ws:`/`wss:` protocol, matching host, and `/ws` path
    - Test file: `arthas-client/src/network/websocket.property.test.ts`
    - **Validates: Requirement 1 AC1**

- [x] 2. Go static file server package
  - [x] 2.1 Create `arthas-server/internal/static/static_prod.go` with production embed handler
    - Use `//go:build !dev` build tag
    - Embed `dist` directory using `//go:embed dist`
    - Implement `Handler() http.Handler` that serves embedded files with SPA fallback
    - Set `Cache-Control: public, immutable, max-age=31536000` for `/assets/*` paths
    - Set `Cache-Control: no-cache` for SPA fallback responses (index.html)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.2 Create `arthas-server/internal/static/static_dev.go` with development stub
    - Use `//go:build dev` build tag
    - Return HTTP 501 with message directing developers to use Vite dev server on :5173
    - _Requirements: 2.5_

  - [x] 2.3 Create test fixture `arthas-server/internal/static/dist/` with minimal files
    - Create `dist/index.html` (minimal valid HTML)
    - Create `dist/assets/app.js` (minimal JS placeholder)
    - These fixtures enable property tests and `go build` without full frontend build
    - _Requirements: 2.1 (compile-time embed requirement)_

  - [x] 2.4 Write property test for static file serving correctness
    - **Property 1: Static file serving correctness**
    - Use `testing/quick` with minimum 100 iterations (consistent with production-deployment spec)
    - For any file in the embedded dist/ filesystem, verify GET returns correct content with appropriate Content-Type and HTTP 200
    - Test file: `arthas-server/internal/static/static_test.go`
    - **Validates: Requirement 2 AC2**

  - [x] 2.5 Write property test for SPA fallback correctness
    - **Property 2: SPA fallback correctness**
    - Use `testing/quick` with minimum 100 iterations
    - For any URL path that doesn't match a static file and isn't `/ws` or `/ping`, verify GET returns index.html content with `Content-Type: text/html` and `Cache-Control: no-cache`
    - Test file: `arthas-server/internal/static/static_test.go`
    - **Validates: Requirement 2 AC3**

  - [x] 2.6 Write property test for cache header correctness
    - **Property 5: Cache header correctness**
    - Use `testing/quick` with minimum 100 iterations
    - For any request to `/assets/*`, verify `Cache-Control: public, immutable, max-age=31536000`; for any SPA fallback, verify `Cache-Control: no-cache`
    - Test file: `arthas-server/internal/static/static_test.go`
    - **Validates: Requirement 2 AC4**

- [x] 3. Integrate static handler into server entry point
  - [x] 3.1 Add CLI flags and static handler to `arthas-server/cmd/server/main.go`
    - Add `flag` package import and parse `--port`, `--allowed-origins`, `--version` flags
    - Implement port resolution priority: flag > env > default (8080)
    - Implement origins resolution priority: flag > env > default (`*`)
    - Register `static.Handler()` on the `/` route (after `/ping` and `/ws`)
    - Print version and exit when `--version` is passed
    - _Requirements: 2.7, 2.2, 2.3_

  - [x] 3.2 Write unit test for `--version` flag and port resolution
    - Test `--version` outputs version string and exits
    - Test port resolution priority: flag > env > default
    - Test origins resolution priority: flag > env > default
    - Test file: `arthas-server/cmd/server/main_test.go`
    - _Requirements: 2.7_

- [x] 4. Checkpoint - Core Go changes complete
  - Run: `go build ./...` (verify compilation with static package)
  - Run: `go build -tags dev ./cmd/server` (verify dev mode compiles without dist/)
  - Run: `go test ./internal/static/... -v` (static handler tests)
  - Run: `go test ./... -v` (full test suite including existing tests)
  - Run: `go test -race ./...` (race detection for concurrency safety)
  - Run: `go vet ./...` (static analysis)
  - Ask the user if questions arise.

- [x] 5. Docker and deployment infrastructure
  - [x] 5.1 Create `.dockerignore` at project root
    - Exclude `node_modules`, `.git`, `dist`, `.env*` (except `.env.example`), `.vscode`, `.idea`, `docs/`, `official_doc/`, `.kiro/`
    - _Requirements: 9.7_

  - [x] 5.2 Update root `.gitignore` for deploy/ generated files
    - Add `deploy/.env` (contains user secrets)
    - Add `deploy/Caddyfile` (generated by deploy.sh)
    - Add `deploy/docker-compose.override.yml` (generated for localhost mode)
    - Keep `deploy/.env.example` tracked (template)
    - _Requirements: 8.3 (security)_

  - [x] 5.3 Create three-stage Dockerfile at `deploy/Dockerfile`
    - Stage 1 (frontend): `node:20-alpine`, `npm ci`, `npm run build` (no VITE_WS_URL set)
    - Stage 2 (builder): `golang:1.22-alpine`, copy dist/ from stage 1 to `internal/static/dist/`, compile with ldflags
    - Stage 3 (runtime): `alpine:3.23`, non-root user (UID 1000), HEALTHCHECK on `/ping`, expose 8080
    - Accept `VERSION` and `TARGETARCH` build args
    - _Requirements: 9.7, 8.1, 7.1_

  - [x] 5.4 Create Docker Compose stack at `deploy/docker-compose.yml`
    - Define `backend` service using `ghcr.io/${GITHUB_OWNER}/arthas:${ARTHAS_VERSION:-latest}`
    - Define `caddy` service using `caddy:2-alpine` with depends_on backend (condition: service_healthy)
    - Configure custom bridge network `arthas-net`, only Caddy exposes ports 80/443
    - Set `read_only: true` and `restart: unless-stopped` on backend
    - Configure health checks (30s interval, 3s timeout, 3 retries) for both services
    - Configure logging driver `json-file` with `max-size: 10m` and `max-file: 3`
    - Use named volumes `caddy_data` and `caddy_config` for certificate persistence
    - Pass `DOMAIN` and `EMAIL` environment variables to Caddy container
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 7.1, 7.2, 7.3, 8.2, 8.4, NFR-9_

  - [x] 5.5 Create Caddyfile example templates at `deploy/Caddyfile.production.example` and `deploy/Caddyfile.localhost.example`
    - Production: global email block, `{$DOMAIN}` site block, `reverse_proxy backend:8080`, security headers
    - Localhost: `:80` site block (HTTP-only, no TLS), `reverse_proxy backend:8080`, security headers
    - Include comments explaining design decisions (why `:80` instead of `localhost`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 8.5, NFR-7_

  - [x] 5.6 Create environment configuration template at `deploy/.env.example`
    - Document all variables: `DOMAIN`, `EMAIL`, `ARTHAS_VERSION`, `GITHUB_OWNER`, `ALLOWED_ORIGINS`
    - Include Chinese comments explaining each variable's purpose and valid values
    - _Requirements: 5.1, 5.4_

- [x] 6. Deploy script
  - [x] 6.1 Create `deploy/deploy.sh` with prerequisite checks and interactive configuration
    - Implement `set -euo pipefail` strict mode
    - Use `cd "$(dirname "$0")"` to ensure script runs from `deploy/` directory (docker compose needs relative paths)
    - Check for `docker` binary and running daemon
    - Check for `docker compose` v2 (not standalone `docker-compose`)
    - Check ports 80/443 availability using platform-aware detection:
      - Linux: `ss -tlnp | grep -q ':80 '`
      - macOS: `lsof -i :80 -sTCP:LISTEN`
      - Fallback: skip check with warning if neither tool available
    - Interactive prompts for domain, email, and GITHUB_OWNER when `.env` doesn't exist
    - Generate `.env` from user input
    - Generate mode-aware Caddyfile (`:80` for localhost, `{$DOMAIN}` for production)
    - _Requirements: 6.1, 6.2, 6.6, 5.3, 5.5_

  - [x] 6.2 Implement deploy script subcommands and flags
    - Default (no flag): full deploy flow → prereq check → config → generate Caddyfile → `docker compose up -d` → display access URL
    - `--local`: set DOMAIN=localhost, ALLOWED_ORIGINS=*, generate HTTP-only Caddyfile, generate override.yml removing port 443
    - `--down`: `docker compose down`
    - `--status`: display health status of all services
    - `--upgrade`: `docker compose pull && docker compose up -d`
    - `--logs`: `docker compose logs --tail=50`
    - `--reconfigure`: remove `.env`, `Caddyfile`, `docker-compose.override.yml`, re-enter setup
    - Ensure idempotency (re-running without changes is a no-op)
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 7.4, 8.6_

- [x] 7. Checkpoint - Deployment infrastructure complete
  - Verify: `deploy/Dockerfile` builds successfully: `docker build -f deploy/Dockerfile -t arthas-test .`
  - Verify: `deploy/docker-compose.yml` is valid: `docker compose -f deploy/docker-compose.yml config`
  - Verify: `deploy/deploy.sh` passes shellcheck: `shellcheck deploy/deploy.sh`
  - Verify: `.dockerignore` excludes expected paths
  - Verify: `.gitignore` includes deploy/ generated files
  - Run: `go test ./... -v` (ensure no regressions)
  - Ask the user if questions arise.

- [x] 8. CI/CD and build system
  - [x] 8.1 Create GitHub Actions workflow at `.github/workflows/release.yml`
    - Trigger on push tags matching `v*.*.*`
    - Set up QEMU + Docker Buildx for multi-arch builds
    - Login to ghcr.io using `GITHUB_TOKEN`
    - Build and push `linux/amd64` and `linux/arm64` images
    - Tag with semver version and `latest`
    - Pass `VERSION` build arg from git tag
    - Enable GitHub Actions cache (`type=gha`)
    - Note: ARM64 builds via QEMU take ~15-20 min (acceptable tradeoff vs native ARM runner cost)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, NFR-8_

  - [x] 8.2 Create cross-compilation Makefile at project root
    - `build-all` target: build frontend then cross-compile for linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64
    - `build-frontend` target: `npm ci && npm run build`, copy dist/ to embed location
    - `dev-server` target: build with `-tags dev` (no frontend needed)
    - `clean` target: remove dist/ and embedded static dir
    - Inject version via ldflags from `git describe --tags`
    - _Requirements: 2.6, NFR-4_

- [x] 9. Self-hosting documentation
  - [x] 9.1 Create `official_doc/self-hosting.md` with complete self-hosting guide
    - Prerequisites section: 1 CPU, 512MB RAM, 1GB disk, ports 80/443
    - Quick-start for Tier 1 (download binary, run with `--port`)
    - Quick-start for Tier 2 (clone, `./deploy.sh`, access URL)
    - Configuration reference table for all `.env` variables
    - Troubleshooting: DNS propagation, port conflicts, certificate errors, ARM64 compatibility
    - Upgrade instructions: `./deploy.sh --upgrade` for Docker, binary replacement for Tier 1
    - Backup section: Caddy certificate volume backup
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 9.2 Update `README.md` with self-hosting section and link to documentation
    - Add a "Self-Hosting" section linking to `official_doc/self-hosting.md`
    - Brief mention of both deployment tiers
    - _Requirements: 10.7_

- [x] 10. Final checkpoint - All implementation complete
  - Run: `go build ./...` (no errors)
  - Run: `go test ./... -v` (all tests pass)
  - Run: `go test -race ./...` (race detection)
  - Run: `go vet ./...` (no issues)
  - Verify frontend: `cd arthas-client && npm run build` (produces dist/)
  - Verify Docker: `docker build -f deploy/Dockerfile -t arthas-self-hosted .` (builds successfully)
  - Verify image size: `docker images arthas-self-hosted --format "{{.Size}}"` (< 30MB)
  - Verify deploy script: `bash -n deploy/deploy.sh` (syntax check)
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints include specific verification commands for reproducible validation
- Property tests use `testing/quick` (Go) and `fast-check` (TypeScript) — consistent with existing project conventions
- The `dist/` directory for Go embed testing uses a minimal fixture (Task 2.3) — not the full frontend build
- Deploy script testing is manual (shell scripts in Docker environments)
- The existing `arthas-server/Dockerfile` (HF Spaces, port 7860) is NOT modified — self-hosted uses `deploy/Dockerfile` (port 8080)
- Performance NFRs (NFR-1: <5ms static serving latency, NFR-2: <30s Docker startup) are validated manually on target hardware, not in CI
- The design uses Go, TypeScript, and Bash — all code must include 📚 学习要点 annotations per project conventions

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1", "5.2", "5.6"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["2.4", "2.5", "2.6", "3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["5.3", "5.4", "5.5", "8.2"] },
    { "id": 5, "tasks": ["6.1", "8.1"] },
    { "id": 6, "tasks": ["6.2"] },
    { "id": 7, "tasks": ["9.1", "9.2"] }
  ]
}
```

## Dependency Rationale

| Dependency | Reason |
|------------|--------|
| 1.1 in Wave 0 | Independent — modifies frontend only, no server dependency |
| 5.1, 5.2, 5.6 in Wave 0 | Config files (.dockerignore, .gitignore, .env.example) are independent of code |
| 2.1, 2.2 in Wave 1 | Static package needs no prior tasks, but logically follows Wave 0 setup |
| 2.3 in Wave 1 | Test fixture must exist before property tests (Wave 2) and before `go build` without `-tags dev` |
| 2.4-2.6 in Wave 2 | Property tests depend on 2.1 (implementation) and 2.3 (fixture) |
| 3.1 in Wave 2 | Server integration depends on static package (2.1, 2.2) existing |
| 3.2 in Wave 3 | Tests for 3.1 must come after 3.1 implementation |
| 5.3, 5.4, 5.5 in Wave 4 | Docker/Compose files reference the project structure established in Waves 0-3 |
| 8.2 in Wave 4 | Makefile references project structure and embed paths from Waves 0-3 |
| 6.1 in Wave 5 | Deploy script depends on docker-compose.yml (5.4) and .env.example (5.6) |
| 8.1 in Wave 5 | GitHub Actions depends on Dockerfile (5.3) existing |
| 6.2 in Wave 6 | Subcommands extend the base script from 6.1 |
| 9.1, 9.2 in Wave 7 | Documentation written last, references all prior artifacts |
