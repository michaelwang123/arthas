# Requirements Document

## Introduction

Self-hosted one-click deployment for Arthas — an E2EE chat application with Go backend and React frontend. This feature enables privacy-conscious users to deploy their own Arthas instance with minimal effort, providing two deployment tiers:

- **Tier 1（单二进制）**：Go embed 前端静态文件，零依赖单文件部署，适合本地/内网/开发
- **Tier 2（Docker Compose）**：Caddy 自动 HTTPS + Go 后端，适合公网生产环境

Currently, Arthas is deployed on Vercel (frontend) + HF Spaces (backend Docker). This spec provides an alternative self-hosted deployment path that gives users full control over their data and infrastructure. Corresponds to roadmap Phase 7.4.

> **设计决策：相对 WebSocket URL**
> 自托管模式下，前端和后端通过同一域名访问（Caddy 反向代理）。
> 前端使用相对 URL `wss://${location.host}/ws` 自动连接后端，
> 无需构建时注入 `VITE_WS_URL`，换域名无需重新构建镜像。

## Glossary

- **Deploy_Script**: Shell 脚本 (`deploy.sh`)，编排整个自托管部署流程（前置检查、配置生成、服务启动）
- **Compose_Stack**: Docker Compose 服务组，包含 Caddy 反向代理和 Go 后端两个容器
- **Caddy_Proxy**: Caddy 反向代理服务，提供自动 HTTPS 证书、静态文件服务、WebSocket 反向代理
- **Backend_Service**: Go WebSocket 中转服务器容器，内部端口 8080，提供 `/ws` 和 `/ping` 端点
- **Single_Binary**: 使用 Go `embed` 包将前端 dist/ 嵌入的单一可执行文件，同时服务前端和 WebSocket
- **Health_Check**: 自动化周期性探针，验证服务是否正常运行
- **Env_Config**: `.env` 配置文件，包含用户可配置的部署参数（域名、邮箱、端口等）
- **Image_Registry**: Docker 镜像发布仓库（GitHub Container Registry `ghcr.io`）

## Constraints

- 服务器零知识架构不变 — 自托管不改变加密模型
- 不引入新的运行时依赖（Go embed 使用标准库）
- 现有 HF Spaces Dockerfile（端口 7860）保持不变，自托管使用独立配置
- 前端使用相对 WebSocket URL，不依赖构建时环境变量注入
- Docker 镜像支持 `linux/amd64` 和 `linux/arm64`（覆盖 Raspberry Pi 和 Apple Silicon）

## Requirements

### Requirement 1: Relative WebSocket URL

**User Story:** As a self-hosting user, I want the frontend to automatically connect to the backend on the same domain without any URL configuration, so that I can deploy on any domain without rebuilding the frontend.

#### Acceptance Criteria

1. WHEN `VITE_WS_URL` environment variable is not set, THE frontend SHALL construct the WebSocket URL as `${protocol}://${location.host}/ws` where protocol is `wss` for HTTPS pages and `ws` for HTTP pages
2. WHEN `VITE_WS_URL` environment variable IS set (e.g., development mode), THE frontend SHALL use the configured URL (backward compatible with current behavior)
3. THE change SHALL be limited to the `DEFAULT_WS_URL` fallback logic in `src/network/websocket.ts`
4. THE relative URL approach SHALL work for both Tier 1 (single binary on localhost) and Tier 2 (Docker Compose with Caddy)

### Requirement 2: Single Binary Deployment (Tier 1)

**User Story:** As a developer or small-team user, I want to run a single executable file that serves both the frontend and WebSocket backend, so that I can deploy Arthas without Docker or any external dependencies.

#### Acceptance Criteria

1. THE Go server SHALL embed the frontend `dist/` directory using Go's `embed` package
2. THE server SHALL serve embedded static files on all paths except `/ws` and `/ping`
3. THE server SHALL serve `index.html` for any path that does not match a static file (SPA fallback)
4. THE server SHALL set appropriate cache headers: long-lived for hashed assets (`/assets/*`), no-cache for `index.html`
5. WHEN the `dist/` directory does not exist at compile time, THE build SHALL fail with a clear error message indicating the frontend must be built first
6. THE single binary SHALL be cross-compiled for `linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64`, and `windows/amd64`
7. THE binary SHALL accept a `--port` flag (default 8080) and a `--allowed-origins` flag (default `*` for local use)

### Requirement 3: Docker Compose Orchestration (Tier 2)

**User Story:** As a self-hosting user deploying to a public server, I want to run `docker compose up -d` to get a fully working HTTPS instance, so that I do not need to manually configure certificates or reverse proxies.

> **架构决策：Go 服务器统一服务前端和 WebSocket**
> 由于 Requirement 2 已让 Go 二进制嵌入前端静态文件，Docker 中复用同一二进制。
> Caddy 只负责 HTTPS 终止 + 反向代理，Go 服务器处理一切业务逻辑（静态文件 + WebSocket）。
> 这消除了"共享 volume 存放前端文件"的复杂性，两个服务职责清晰：
> - Caddy: HTTPS + 证书 + 安全头 + 代理
> - Go: 静态文件 + WebSocket 中转

#### Acceptance Criteria

1. THE Compose_Stack SHALL define two services: Caddy_Proxy and Backend_Service
2. WHEN `docker compose up -d` is executed, THE Compose_Stack SHALL start both services with Backend_Service starting first (Caddy depends_on Backend)
3. THE Backend_Service SHALL use the published multi-arch Docker image (which embeds frontend static files) and expose port 8080 only to the internal Docker network
4. THE Caddy_Proxy SHALL be the only service exposing ports 80 and 443 to the host
5. THE Caddy_Proxy SHALL reverse-proxy ALL requests to the Backend_Service (the Go server handles static files + WebSocket routing internally)
6. WHEN the Backend_Service starts, THE Compose_Stack SHALL pass the `ALLOWED_ORIGINS` environment variable with `https://{DOMAIN}`
7. THE Compose_Stack SHALL use a named Docker volume for Caddy certificate storage to persist certificates across restarts

### Requirement 4: Automatic HTTPS with Caddy

**User Story:** As a self-hosting user, I want HTTPS to be automatically configured without manual certificate management, so that my Arthas instance is secure from the first connection.

#### Acceptance Criteria

1. WHEN a valid domain name is configured in Env_Config, THE Caddy_Proxy SHALL automatically obtain a TLS certificate from Let's Encrypt
2. THE Caddy_Proxy SHALL redirect all HTTP (port 80) traffic to HTTPS (port 443)
3. THE Caddy_Proxy SHALL reverse-proxy all traffic to the Backend_Service (Go server handles static files + WebSocket internally)
4. THE Caddy_Proxy SHALL pass WebSocket upgrade headers correctly when proxying `/ws` connections
5. THE Caddy_Proxy SHALL automatically renew TLS certificates before expiration
6. WHEN `DOMAIN=localhost` is configured, THE Caddy_Proxy SHALL use HTTP only (no TLS) for local development and testing

### Requirement 5: Environment Variable Configuration

**User Story:** As a self-hosting user, I want to configure my deployment through a single `.env` file, so that I can customize domain, email, and other settings without editing multiple files.

#### Acceptance Criteria

1. THE Env_Config SHALL support the following variables: `DOMAIN` (required), `EMAIL` (required for Let's Encrypt, optional when DOMAIN=localhost), `ARTHAS_VERSION` (optional, default `latest`)
2. THE Compose_Stack SHALL read all configuration from the Env_Config file
3. IF a required variable is missing from Env_Config, THEN THE Deploy_Script SHALL exit with a descriptive error message naming the missing variable
4. THE Deploy_Script SHALL generate a template `.env` file with documented defaults and descriptions for each variable
5. WHEN `DOMAIN=localhost` is set, THE Deploy_Script SHALL skip email validation and configure HTTP-only mode

### Requirement 6: One-Command Deploy Script

**User Story:** As a self-hosting user, I want to run a single command to deploy Arthas on my server, so that I can get a working instance without deep Docker or networking knowledge.

#### Acceptance Criteria

1. WHEN the Deploy_Script is executed, THE Deploy_Script SHALL check for required prerequisites (Docker, Docker Compose v2) and report missing dependencies with installation URLs
2. WHEN prerequisites are satisfied and Env_Config does not exist, THE Deploy_Script SHALL prompt the user for domain name and email interactively
3. WHEN configuration is complete, THE Deploy_Script SHALL execute `docker compose up -d` to start the Compose_Stack
4. WHEN the Compose_Stack starts successfully, THE Deploy_Script SHALL display the access URL and basic status information
5. THE Deploy_Script SHALL support the following flags:
   - `--down`: stop and remove all containers
   - `--status`: display health status of all services
   - `--upgrade`: pull latest images and restart services
   - `--logs`: show recent container logs
6. THE Deploy_Script SHALL be executable on Linux (Ubuntu 20.04+, Debian 11+) and macOS with Bash 4.0+
7. THE Deploy_Script SHALL support `--local` flag to deploy in HTTP-only mode on localhost (sets DOMAIN=localhost automatically)

### Requirement 7: Health Checks and Auto-Restart

**User Story:** As a self-hosting user, I want automated health checks for all services, so that Docker automatically restarts unhealthy containers without manual intervention.

#### Acceptance Criteria

1. THE Backend_Service SHALL define a Docker health check that probes the `/ping` endpoint every 30 seconds with a 3-second timeout
2. THE Caddy_Proxy SHALL define a Docker health check that verifies Caddy is responsive every 30 seconds
3. WHEN a service health check fails 3 consecutive times, THE Compose_Stack SHALL restart that service automatically via `restart: unless-stopped` policy
4. WHEN the Deploy_Script `--status` flag is used, THE Deploy_Script SHALL display the health status (healthy/unhealthy/starting) of each service

### Requirement 8: Security Hardening

**User Story:** As a privacy-conscious user, I want the self-hosted deployment to follow security best practices by default, so that my instance is protected without additional configuration.

#### Acceptance Criteria

1. THE Backend_Service SHALL run as a non-root user (UID 1000) inside the container
2. THE Compose_Stack SHALL use read-only root filesystems for Backend_Service where possible
3. THE Backend_Service SHALL set the `ALLOWED_ORIGINS` environment variable to `https://{DOMAIN}`, restricting WebSocket connections to the legitimate origin
4. THE Compose_Stack SHALL define a custom Docker network isolating inter-service communication from the host network
5. THE Caddy_Proxy SHALL set security headers (X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy: no-referrer) on all responses
6. WHEN `DOMAIN=localhost`, THE Backend_Service SHALL set `ALLOWED_ORIGINS=*` to allow local development

### Requirement 9: Docker Image Publishing

**User Story:** As a self-hosting user, I want pre-built Docker images available in a public registry, so that I can pull and deploy without building from source.

> **构建流程：三阶段 Dockerfile**
> 由于 Go 二进制嵌入前端 dist/，Docker 构建需要三个阶段：
> 1. Node.js 阶段：`npm ci && npm run build` → 产出 `dist/`
> 2. Go 阶段：`COPY --from=frontend dist/ → go build`（embed dist/）→ 产出二进制
> 3. Runtime 阶段：Alpine + 二进制（最终镜像 < 30MB）

#### Acceptance Criteria

1. THE project SHALL publish Docker images to GitHub Container Registry (`ghcr.io/{owner}/arthas`)
2. THE CI/CD pipeline SHALL build and push images on every tagged release (e.g., `v1.0.0`)
3. THE images SHALL be multi-architecture: `linux/amd64` and `linux/arm64`
4. THE images SHALL be tagged with both the version number and `latest`
5. THE GitHub Actions workflow SHALL use Docker Buildx for multi-platform builds
6. THE Compose_Stack SHALL reference the published image with the `ARTHAS_VERSION` variable for version pinning
7. THE Dockerfile SHALL use a three-stage build: Node.js (frontend build) → Go (compile with embedded dist/) → Alpine (runtime)

### Requirement 10: Self-Hosting Documentation

**User Story:** As a self-hosting user, I want clear documentation covering prerequisites, setup steps, troubleshooting, and maintenance, so that I can deploy and maintain my instance independently.

#### Acceptance Criteria

1. THE documentation SHALL include a prerequisites section listing minimum server requirements (1 CPU, 512MB RAM, 1GB disk, ports 80/443 open)
2. THE documentation SHALL include a quick-start section with both Tier 1 (single binary) and Tier 2 (Docker Compose) deployment steps
3. THE documentation SHALL include a configuration reference table documenting all Env_Config variables with types, defaults, and descriptions
4. THE documentation SHALL include a troubleshooting section covering: DNS not propagated, port conflicts, certificate errors, ARM64 compatibility
5. THE documentation SHALL include an upgrade section: `./deploy.sh --upgrade` for Docker, binary replacement for Tier 1
6. THE documentation SHALL include a backup section for Caddy certificate data (volume backup)
7. THE documentation SHALL be placed at `official_doc/self-hosting.md` and linked from README

## Non-Functional Requirements

### Performance
- NFR-1: Single binary mode SHALL add < 5ms latency to static file serving compared to dedicated Nginx
- NFR-2: Docker Compose startup SHALL complete within 30 seconds on a 1-core VPS

### Compatibility
- NFR-3: Docker images SHALL support `linux/amd64` and `linux/arm64` architectures
- NFR-4: Single binary SHALL be cross-compiled for Linux, macOS, and Windows (amd64 + arm64)
- NFR-5: Deploy script SHALL work with Docker Compose v2 (the `docker compose` plugin, not standalone `docker-compose`)

### Maintainability
- NFR-6: All deployment configuration files SHALL be in a dedicated `deploy/` directory at the project root
- NFR-7: The Caddyfile SHALL be human-readable and well-commented for users who want to customize
- NFR-8: GitHub Actions workflow SHALL be triggered only on version tags (`v*.*.*`), not on every push
- NFR-9: Container logs SHALL use Docker's default `json-file` logging driver with `max-size: 10m` and `max-file: 3` to prevent disk exhaustion on long-running instances
