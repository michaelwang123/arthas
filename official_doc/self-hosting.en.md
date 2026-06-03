[中文](self-hosting.md) | English

# Self-Hosting Deployment Guide

This guide helps you deploy a private Arthas instance on your own server. Arthas offers three deployment methods:

| Method                               | Use Case                               | Dependencies        | HTTPS                     |
| --------------------------------------| ----------------------------------------| ---------------------| ---------------------------|
| **Tier 1 — Single Binary**           | Local/intranet/development/quick trial | None (single file)  | None (HTTP)               |
| **Tier 2 — Docker Single Container** | Quick deploy/testing/intranet          | Docker              | None (HTTP)               |
| **Tier 3 — Docker Compose**          | Public-facing production               | Docker + Compose v2 | Automatic (Let's Encrypt) |

> **Zero-knowledge architecture remains unchanged** — Regardless of deployment method, the server only relays encrypted ciphertext and never stores any message content.

---

## Two Dockerfiles in the Project

| File | Purpose | Includes Frontend | Default Port | Build Context |
|------|---------|-------------------|--------------|---------------|
| `deploy/Dockerfile` | **Self-hosting (Tier 2/3, recommended)** | ✅ Three-stage build | 8080 | Project root |
| `arthas-server/Dockerfile` | HF Spaces backend-only relay | ❌ Backend only | 7860 | arthas-server/ |

**Key difference:**
- `deploy/Dockerfile` builds the frontend first (Node.js), then embeds the output into the Go binary. The final image contains the complete frontend UI + WebSocket backend.
- `arthas-server/Dockerfile` only compiles the Go backend without building the frontend. Used for split deployment (frontend on Vercel, backend on HF Spaces).

> ⚠️ **Common mistake:** If you build with `docker build -t arthas-server ./arthas-server`, visiting the root URL will show a blank page (placeholder HTML). This is because you used the wrong Dockerfile. For self-hosting, use `deploy/Dockerfile`.

---

## Prerequisites

### Minimum Hardware Requirements

| Resource | Minimum | Notes |
|----------|---------|-------|
| CPU | 1 core | Go server has very low resource usage |
| Memory | 512 MB | Including OS overhead |
| Disk | 1 GB | Including Docker images and certificate storage |
| Network | Ports 80 + 443 open | Required for Tier 3 public deployment (Tier 1/2 only needs a custom port) |

### Tier 1 Prerequisites

- No additional dependencies — download the binary and run

### Tier 2 Prerequisites

- Docker Engine 20.10+

```bash
docker --version    # Docker version 20.10+
```

### Tier 3 Prerequisites

- Docker Engine 20.10+
- Docker Compose v2 (`docker compose` plugin, not the standalone `docker-compose`)
- A domain name pointing to your server's IP (for public deployment)
- Server firewall with ports 80 and 443 open

```bash
docker --version          # Docker version 20.10+
docker compose version    # Docker Compose version v2.x.x
```

---

## Quick Start: Tier 1 (Single Binary)

Suitable for local testing, intranet deployment, or development. The Go binary embeds frontend static files — download and run.

### 1. Download the Binary

Download the binary for your platform from [GitHub Releases](https://github.com/michaelwang123/arthas/releases) — choose the **arthas-server-all** variant (includes frontend + backend):

```bash
# Linux (x86_64)
curl -Lo arthas-server-all https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-all-linux-amd64
chmod +x arthas-server-all

# Linux (ARM64, e.g. Raspberry Pi)
curl -Lo arthas-server-all https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-all-linux-arm64
chmod +x arthas-server-all

# macOS (Apple Silicon)
curl -Lo arthas-server-all https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-all-darwin-arm64
chmod +x arthas-server-all

# macOS (Intel)
curl -Lo arthas-server-all https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-all-darwin-amd64
chmod +x arthas-server-all
```

> **Binary variants:**
> - `arthas-server-all-*` — Includes frontend + backend (recommended for self-hosting, ~7MB)
> - `arthas-server-*` — Backend WebSocket relay only (for split deployment)

### 2. Start the Service

```bash
# Default port 8080
./arthas-server-all

# Custom port
./arthas-server-all --port 3000

# Restrict WebSocket origins (recommended for production)
./arthas-server-all --port 443 --allowed-origins "https://chat.example.com"
```

### 3. Access

Open your browser and navigate to `http://localhost:8080` (or the port you specified) to start using Arthas.

### CLI Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--port` | `8080` (or `$PORT` env variable) | HTTP listening port |
| `--allowed-origins` | `*` (allow all origins) | WebSocket CORS whitelist, comma-separated for multiple values |
| `--version` | — | Print version and exit |

> **Note:** Tier 1 does not provide HTTPS. For public HTTPS deployment, use Tier 3 or configure a reverse proxy yourself.

---

## Quick Start: Tier 2 (Docker Single Container)

Suitable for quick deployment, intranet use, or testing. Pre-built images are available on GitHub Container Registry — one command to run.

### Option A: Use Pre-built Image (Recommended)

```bash
# Pull and run directly (image < 30MB, includes full frontend + backend)
docker run -d -p 8080:8080 --name arthas ghcr.io/michaelwang123/arthas:latest

# Custom port
docker run -d -p 3000:3000 -e PORT=3000 --name arthas ghcr.io/michaelwang123/arthas:latest

# Restrict CORS origins
docker run -d -p 8080:8080 -e ALLOWED_ORIGINS=https://chat.example.com --name arthas ghcr.io/michaelwang123/arthas:latest
```

Or use Docker Compose:

```yaml
# docker-compose.yml
services:
  arthas:
    image: ghcr.io/michaelwang123/arthas:latest
    ports:
      - "8080:8080"
    restart: unless-stopped
```

```bash
docker compose up -d
```

### Option B: Build from Source

If you need custom modifications:

```bash
git clone https://github.com/michaelwang123/arthas.git
cd arthas

# Build from project root (must use deploy/Dockerfile)
docker build -f deploy/Dockerfile -t arthas-server .

# Start
docker run -d -p 8080:8080 --name arthas arthas-server
```

### 4. Verify

```bash
# Health check
curl http://localhost:8080/ping
# Returns "pong"

# Check container status (shows "healthy" after ~30 seconds)
docker ps --filter name=arthas
# STATUS: Up X seconds (healthy)

# View logs
docker logs arthas
# [2024-01-01T12:00:00Z] [INFO] [Server] started on :8080 (version latest)
```

### 5. Access

Open your browser and navigate to `http://localhost:8080` to see the full frontend and start using Arthas.

**Container routes:**

| Path | Function |
|------|----------|
| `/` | Frontend SPA page (index.html) |
| `/assets/*` | Frontend static assets (JS/CSS, with content-hash long-term caching) |
| `/ws` | WebSocket connection endpoint |
| `/ping` | Health check |

### 6. Stop and Cleanup

```bash
# Stop the container
docker stop arthas

# Remove the container
docker rm arthas

# Remove the image (optional)
docker rmi ghcr.io/michaelwang123/arthas:latest
```

### Docker Compose Single Container Mode

If you prefer using Docker Compose for management:

```yaml
# docker-compose.yml
services:
  arthas:
    image: ghcr.io/michaelwang123/arthas:latest
    ports:
      - "8080:8080"
    environment:
      - ALLOWED_ORIGINS=*
    restart: unless-stopped
```

```bash
docker compose up -d
```

---

## Quick Start: Tier 3 (Docker Compose + HTTPS)

Suitable for public-facing production environments. Caddy automatically obtains Let's Encrypt certificates — deploy with a single command.

### 1. Clone the Repository

```bash
git clone https://github.com/michaelwang123/arthas.git
cd arthas/deploy
```

### 2. Run the Deployment Script

```bash
./deploy.sh
```

The script will interactively guide you through the configuration:

```
[INFO] Checking prerequisites...
[✓] Docker is installed and running
[✓] Docker Compose v2 is available
[✓] Ports 80 and 443 are available

Enter your domain name (e.g., chat.example.com): chat.example.com
Enter your email for Let's Encrypt: admin@example.com
Enter your GitHub username (image registry): your-username

[✓] Configuration saved to .env
[✓] Caddyfile generated (production mode)
[INFO] Starting services...
[✓] Arthas is running at https://chat.example.com
```

### 3. Access

After deployment is complete, open your browser and navigate to `https://your-domain` to start using Arthas.

### Local Mode (Testing Without a Domain)

If you just want to quickly try the Docker Compose deployment locally:

```bash
./deploy.sh --local
```

This automatically sets `DOMAIN=localhost`, uses HTTP (no HTTPS), and is accessible at `http://localhost`.

---

## Deployment Script Command Reference

`deploy.sh` supports the following subcommands:

| Command | Description |
|---------|-------------|
| `./deploy.sh` | Full deployment flow (check → configure → start) |
| `./deploy.sh --local` | Local HTTP mode deployment (DOMAIN=localhost) |
| `./deploy.sh --status` | View health status of all services |
| `./deploy.sh --logs` | View the last 50 lines of container logs |
| `./deploy.sh --upgrade` | Pull latest images and restart services |
| `./deploy.sh --down` | Stop and remove all containers |
| `./deploy.sh --reconfigure` | Delete config files and re-enter interactive setup |

### Examples

```bash
# Check service status
./deploy.sh --status
# Output:
# arthas-backend: healthy (running)
# arthas-caddy:   healthy (running)

# View logs to troubleshoot issues
./deploy.sh --logs

# Upgrade to latest version
./deploy.sh --upgrade

# Stop services
./deploy.sh --down

# Switch domains (stop first, then reconfigure)
./deploy.sh --down
./deploy.sh --reconfigure
```

---

## Configuration Reference

All configuration is managed through the `deploy/.env` file. It is interactively generated on the first run of `deploy.sh`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DOMAIN` | Yes | — | Deployment domain. Use your actual domain for public (e.g., `chat.example.com`), or `localhost` for local |
| `EMAIL` | Required for public | — | Let's Encrypt certificate registration email. Can be left empty when `DOMAIN=localhost` |
| `ARTHAS_VERSION` | No | `latest` | Docker image version tag (e.g., `v1.0.0`). Recommended to pin a specific version in production |
| `GITHUB_OWNER` | Yes | — | GitHub username/organization, used to construct image address `ghcr.io/{GITHUB_OWNER}/arthas` |
| `ALLOWED_ORIGINS` | No | Auto-generated | WebSocket CORS whitelist. Automatically set to `https://{DOMAIN}` for public, `*` for local |

### Manual Configuration

```bash
# Edit the .env file
vim deploy/.env

# Regenerate Caddyfile and restart
./deploy.sh --reconfigure
```

---

## Upgrading

### Tier 3 (Docker Compose) Upgrade

```bash
cd deploy

# Option 1: Upgrade to latest
./deploy.sh --upgrade

# Option 2: Upgrade to a specific version
# 1. Update ARTHAS_VERSION in .env
sed -i 's/ARTHAS_VERSION=.*/ARTHAS_VERSION=v1.2.0/' .env
# 2. Pull new image and restart
./deploy.sh --upgrade
```

### Tier 2 (Docker Single Container) Upgrade

```bash
# Pull latest image and replace container
docker pull ghcr.io/michaelwang123/arthas:latest
docker rm -f arthas
docker run -d -p 8080:8080 --name arthas ghcr.io/michaelwang123/arthas:latest
```

### Tier 1 (Single Binary) Upgrade

```bash
# 1. Stop the current service
kill $(pgrep arthas-server)

# 2. Download new version (overwrite old file)
curl -Lo arthas-server-all https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-all-linux-amd64
chmod +x arthas-server-all

# 3. Restart
./arthas-server-all --port 8080
```

> **Tip:** Arthas is a stateless service (no message storage), so upgrades do not involve data migration.

---

## Backup

### Caddy Certificate Backup (Tier 3)

Caddy's TLS certificates are stored in the Docker named volume `caddy_data`. Regular backups are recommended to avoid hitting Let's Encrypt rate limits when requesting new certificates.

```bash
# Backup the certificate volume
docker run --rm \
  -v arthas_caddy_data:/data \
  -v $(pwd)/backup:/backup \
  alpine tar czf /backup/caddy-certs-$(date +%Y%m%d).tar.gz /data

# Restore the certificate volume
docker run --rm \
  -v arthas_caddy_data:/data \
  -v $(pwd)/backup:/backup \
  alpine sh -c "cd / && tar xzf /backup/caddy-certs-20240101.tar.gz"
```

### Tier 1/2 Backup

Tier 1 and Tier 2 are stateless — no backup needed. Binaries can be re-downloaded anytime, Docker images can be rebuilt anytime.

---

## Troubleshooting

### Blank Page After Docker Run

**Symptoms:** After `docker run`, visiting `http://localhost:8080` shows a blank page or only `<div id="root"></div>`.

**Cause:** Used the wrong Dockerfile. `arthas-server/Dockerfile` does not include the frontend build step.

**Solution:**

```bash
# Wrong ❌ (backend only, no frontend)
docker build -t arthas-server ./arthas-server

# Correct ✅ (use pre-built image with full frontend + backend)
docker run -d -p 8080:8080 ghcr.io/michaelwang123/arthas:latest

# Or build from source (using deploy/Dockerfile)
docker build -f deploy/Dockerfile -t arthas-server .
```

### Port Already Allocated

**Symptoms:** `docker run` reports `port is already allocated`.

**Troubleshooting:**

```bash
# Linux/macOS
lsof -i :8080

# Windows
netstat -ano | findstr "8080"

# Check if another Docker container is using the port
docker ps --filter "publish=8080"
```

**Solution:**

```bash
# Remove the container using the port
docker rm -f <container_name>

# Or use a different port
docker run -d -p 9090:9090 -e PORT=9090 --name arthas arthas-server
```

### DNS Not Propagated (Tier 3)

**Symptoms:** After deployment, visiting the domain shows "This site can't be reached", Caddy logs show ACME challenge failure.

**Troubleshooting:**

```bash
# Check if DNS resolves to your server IP
dig +short chat.example.com

# Verify using a specific DNS server
dig @8.8.8.8 chat.example.com
```

**Solution:**
1. Confirm the domain's DNS A record points to your server IP
2. Wait for DNS propagation (usually 5-30 minutes, up to 48 hours)
3. After DNS is effective, restart Caddy: `./deploy.sh --down && ./deploy.sh`

### Port Conflict (Tier 3)

**Symptoms:** `deploy.sh` reports port 80 or 443 is occupied.

**Troubleshooting:**

```bash
# Linux
sudo ss -tlnp | grep ':80 '
sudo ss -tlnp | grep ':443 '

# macOS
sudo lsof -i :80 -sTCP:LISTEN
sudo lsof -i :443 -sTCP:LISTEN
```

**Common processes and solutions:**

| Process | Solution |
|---------|----------|
| nginx | `sudo systemctl stop nginx && sudo systemctl disable nginx` |
| apache2/httpd | `sudo systemctl stop apache2 && sudo systemctl disable apache2` |
| Another Caddy instance | `sudo systemctl stop caddy` |

### Certificate Request Failed (Tier 3)

**Symptoms:** Caddy logs show ACME challenge failure, HTTPS unavailable.

**Solution:**
1. Confirm port 80 is open to the internet (Let's Encrypt HTTP-01 validation requires it)
2. Confirm DNS correctly resolves to your server
3. Check server firewall rules:
   ```bash
   # Ubuntu/Debian
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp

   # CentOS/RHEL
   sudo firewall-cmd --permanent --add-service=http
   sudo firewall-cmd --permanent --add-service=https
   sudo firewall-cmd --reload
   ```

### Unhealthy Container

**Symptoms:** `docker ps` shows container as unhealthy.

**Troubleshooting:**

```bash
# Check health status
docker inspect arthas --format='{{.State.Health.Status}}'

# Manually test health endpoint
docker exec arthas wget -qO- http://localhost:8080/ping
# Should return "pong"

# View logs
docker logs arthas
```

### ARM64 Compatibility

Arthas Docker images support both `linux/amd64` and `linux/arm64`. Docker automatically pulls the matching image.

```bash
uname -m    # aarch64 = ARM64, x86_64 = AMD64
docker build -f deploy/Dockerfile -t arthas-server .
```

---

## Architecture Overview

### Tier 1 / Tier 2 Architecture

```
Browser ──HTTP/WS──→ Go Service (port 8080)
                       ├── Static file server (embedded dist/)
                       ├── WebSocket Hub (message relay)
                       └── /ping health check
```

### Tier 3 Architecture

```
Browser ──HTTPS──→ Caddy (port 443)
                     │
                     │ (reverse proxy)
                     ↓
                   Go Container (internal port 8080)
                     ├── Static file server (embedded dist/)
                     ├── WebSocket Hub (message relay)
                     └── /ping health check
```

Caddy handles:
- HTTPS termination and automatic certificate renewal
- HTTP → HTTPS redirect
- Reverse proxy all requests to Go backend
- Security response header injection

Go backend handles:
- Serving frontend static files (SPA route fallback)
- WebSocket message relay
- Health check endpoint (`/ping`)

---

## Building from Source

### Docker Build (For Custom Modifications)

```bash
git clone https://github.com/michaelwang123/arthas.git
cd arthas

# Build the full image (frontend + backend)
docker build -f deploy/Dockerfile -t arthas-server .

# Specify version number
docker build -f deploy/Dockerfile --build-arg VERSION=v1.2.3 -t arthas-server:v1.2.3 .

# Run
docker run -d -p 8080:8080 --name arthas arthas-server
```

> **Note:** For most users, the pre-built image `ghcr.io/michaelwang123/arthas:latest` is recommended — no need to clone or build.

### Local Build (Requires Go + Node.js)

```bash
git clone https://github.com/michaelwang123/arthas.git
cd arthas

# Build all platform binaries (requires Go 1.23+ and Node.js 18+)
make build-all

# Output in dist/ directory:
# dist/arthas-server-all-linux-amd64
# dist/arthas-server-all-linux-arm64
# dist/arthas-server-all-darwin-amd64
# dist/arthas-server-all-darwin-arm64
# dist/arthas-server-all-windows-amd64.exe

# Build dev version for current platform only (no frontend)
make dev-server
```

---

## Next Steps

- [System Architecture](architecture.en.md) — Understand the overall design
- [Configuration Reference](configuration.en.md) — All configurable parameters
- [Getting Started](getting-started.en.md) — Set up a local development environment
