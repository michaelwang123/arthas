[中文](self-hosting.md) | English

# Self-Hosting Deployment Guide

This guide helps you deploy a private Arthas instance on your own server. Arthas offers two deployment methods:

| Method | Use Case | Dependencies | HTTPS |
|--------|----------|--------------|-------|
| **Tier 1 — Single Binary** | Local/intranet/development/quick trial | None (single file) | None (HTTP) |
| **Tier 2 — Docker Compose** | Public-facing production | Docker + Compose v2 | Automatic (Let's Encrypt) |

> **Zero-knowledge architecture remains unchanged** — Regardless of deployment method, the server only relays encrypted ciphertext and never stores any message content.

---

## Prerequisites

### Minimum Hardware Requirements

| Resource | Minimum | Notes |
|----------|---------|-------|
| CPU | 1 core | Go server has very low resource usage |
| Memory | 512 MB | Including OS overhead |
| Disk | 1 GB | Including Docker images and certificate storage |
| Network | Ports 80 + 443 open | Required for Tier 2 public deployment (Tier 1 only needs a custom port) |

### Tier 1 Prerequisites

- No additional dependencies — download the binary and run

### Tier 2 Prerequisites

- Docker Engine 20.10+
- Docker Compose v2 (`docker compose` plugin, not the standalone `docker-compose`)
- A domain name pointing to your server's IP (for public deployment)
- Server firewall with ports 80 and 443 open

Verify your Docker environment:

```bash
docker --version          # Docker version 20.10+
docker compose version    # Docker Compose version v2.x.x
```

---

## Quick Start: Tier 1 (Single Binary)

Suitable for local testing, intranet deployment, or development. The Go binary embeds frontend static files — download and run.

### 1. Download the Binary

Download the binary for your platform from [GitHub Releases](https://github.com/anthropics/arthas/releases):

```bash
# Linux (x86_64)
curl -Lo arthas-server https://github.com/anthropics/arthas/releases/latest/download/arthas-server-linux-amd64
chmod +x arthas-server

# Linux (ARM64, e.g. Raspberry Pi)
curl -Lo arthas-server https://github.com/anthropics/arthas/releases/latest/download/arthas-server-linux-arm64
chmod +x arthas-server

# macOS (Apple Silicon)
curl -Lo arthas-server https://github.com/anthropics/arthas/releases/latest/download/arthas-server-darwin-arm64
chmod +x arthas-server

# macOS (Intel)
curl -Lo arthas-server https://github.com/anthropics/arthas/releases/latest/download/arthas-server-darwin-amd64
chmod +x arthas-server
```

### 2. Start the Service

```bash
# Default port 8080
./arthas-server

# Custom port
./arthas-server --port 3000

# Restrict WebSocket origins (recommended for production)
./arthas-server --port 443 --allowed-origins "https://chat.example.com"
```

### 3. Access

Open your browser and navigate to `http://localhost:8080` (or the port you specified) to start using Arthas.

### CLI Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--port` | `8080` (or `$PORT` env variable) | HTTP listening port |
| `--allowed-origins` | `*` (allow all origins) | WebSocket CORS whitelist, comma-separated for multiple values |
| `--version` | — | Print version and exit |

> **Note:** Tier 1 does not provide HTTPS. For public HTTPS deployment, use Tier 2 or configure a reverse proxy yourself.

---

## Quick Start: Tier 2 (Docker Compose)

Suitable for public-facing production environments. Caddy automatically obtains Let's Encrypt certificates — deploy with a single command.

### 1. Clone the Repository

```bash
git clone https://github.com/anthropics/arthas.git
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

# View logs for troubleshooting
./deploy.sh --logs

# Upgrade to the latest version
./deploy.sh --upgrade

# Stop services
./deploy.sh --down

# Switch domain (stop first, then reconfigure)
./deploy.sh --down
./deploy.sh --reconfigure
```

---

## Configuration Reference

All configuration is managed through the `deploy/.env` file. It is interactively generated on the first run of `deploy.sh`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DOMAIN` | Yes | — | Deployment domain. Use your actual domain for public deployment (e.g., `chat.example.com`), or `localhost` for local |
| `EMAIL` | Required for public | — | Let's Encrypt certificate registration email for expiry notifications. Can be left empty when `DOMAIN=localhost` |
| `ARTHAS_VERSION` | No | `latest` | Docker image version tag (e.g., `v1.0.0`). Recommended to pin a specific version in production |
| `GITHUB_OWNER` | Yes | — | GitHub username/organization, used to construct image address `ghcr.io/{GITHUB_OWNER}/arthas` |
| `ALLOWED_ORIGINS` | No | Auto-generated | WebSocket CORS whitelist. Automatically set to `https://{DOMAIN}` for public, `*` for local |

### Manually Editing Configuration

If you need to manually modify the configuration:

```bash
# Edit the .env file
vim deploy/.env

# Regenerate Caddyfile and restart
./deploy.sh --reconfigure
```

### Configuration File Template

Refer to `deploy/.env.example` for the complete configuration template with comments.

---

## Upgrading

### Tier 2 (Docker Compose) Upgrade

```bash
cd deploy

# Option 1: Upgrade to the latest version
./deploy.sh --upgrade

# Option 2: Upgrade to a specific version
# 1. Modify ARTHAS_VERSION in .env
sed -i 's/ARTHAS_VERSION=.*/ARTHAS_VERSION=v1.2.0/' .env
# 2. Pull new image and restart
./deploy.sh --upgrade
```

What `--upgrade` does:
1. `docker compose pull` — Pull the latest images
2. `docker compose up -d` — Restart services with new images (zero-downtime, old containers replaced with new ones)

### Tier 1 (Single Binary) Upgrade

```bash
# 1. Stop the currently running service
kill $(pgrep arthas-server)

# 2. Download the new version (overwrite the old file)
curl -Lo arthas-server https://github.com/anthropics/arthas/releases/latest/download/arthas-server-linux-amd64
chmod +x arthas-server

# 3. Restart
./arthas-server --port 8080
```

> **Tip:** Arthas is a stateless service (no message storage), so upgrades do not involve data migration.

---

## Backup

### Caddy Certificate Backup (Tier 2)

Caddy's TLS certificates are stored in the Docker named volume `caddy_data`. Regular backups are recommended to avoid frequently requesting new certificates from Let's Encrypt (which has rate limits).

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

> **Note:** Even if certificates are lost, Caddy will automatically re-request them. However, Let's Encrypt has [rate limits](https://letsencrypt.org/docs/rate-limits/) for the same domain (5 certificates per week), and frequent rebuilds may trigger these limits.

### Tier 1 Backup

Tier 1 is stateless — no backup needed. The binary can be re-downloaded at any time.

---

## Troubleshooting

### DNS Not Propagated

**Symptoms:** After deployment, visiting the domain shows "This site can't be reached", and Caddy logs report ACME challenge failure.

**Troubleshooting steps:**

```bash
# Check if DNS resolves to your server IP
dig +short chat.example.com
# Should return your server's public IP

# If empty or wrong IP, DNS has not propagated yet
# DNS propagation typically takes 5 minutes to 48 hours

# Verify using a specific DNS server
dig @8.8.8.8 chat.example.com
```

**Solution:**
1. Confirm the domain's DNS A record points to your server IP
2. Wait for DNS propagation (typically 5-30 minutes, up to 48 hours)
3. After DNS propagates, restart Caddy: `./deploy.sh --down && ./deploy.sh`

### Port Conflict

**Symptoms:** `deploy.sh` reports that port 80 or 443 is already in use.

**Troubleshooting steps:**

```bash
# Linux: Check which process is using the port
sudo ss -tlnp | grep ':80 '
sudo ss -tlnp | grep ':443 '

# macOS: Check which process is using the port
sudo lsof -i :80 -sTCP:LISTEN
sudo lsof -i :443 -sTCP:LISTEN
```

**Common conflicting processes and solutions:**

| Process | Solution |
|---------|----------|
| nginx | `sudo systemctl stop nginx && sudo systemctl disable nginx` |
| apache2/httpd | `sudo systemctl stop apache2 && sudo systemctl disable apache2` |
| Another Caddy instance | `sudo systemctl stop caddy` |

### Certificate Request Failed

**Symptoms:** Caddy logs show ACME challenge failure, HTTPS is unavailable.

**Troubleshooting steps:**

```bash
# View detailed Caddy logs
./deploy.sh --logs

# Common error messages:
# "challenge failed" — DNS not propagated or port 80 blocked by firewall
# "too many certificates" — Let's Encrypt rate limit triggered
```

**Solution:**
1. Confirm port 80 is open to the internet (required for Let's Encrypt HTTP-01 validation)
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
4. If rate limited, wait one week before retrying, or use the Let's Encrypt staging environment for testing

### ARM64 Compatibility

**Symptoms:** Image pull fails or runtime issues on Raspberry Pi or ARM64 servers.

**Confirm architecture:**

```bash
# Check system architecture
uname -m
# aarch64 = ARM64, x86_64 = AMD64
```

**Solution:**

Arthas Docker images support both `linux/amd64` and `linux/arm64` architectures. Docker will automatically pull the matching image. If you encounter issues:

```bash
# Force pull for a specific platform
docker pull --platform linux/arm64 ghcr.io/{GITHUB_OWNER}/arthas:latest

# Verify image architecture
docker inspect ghcr.io/{GITHUB_OWNER}/arthas:latest | grep Architecture
```

For Tier 1 single binary, download the `arthas-server-linux-arm64` version.

### Unhealthy Service

**Symptoms:** `./deploy.sh --status` shows a service as unhealthy.

**Troubleshooting steps:**

```bash
# View detailed health check status
docker inspect arthas-backend --format='{{.State.Health.Status}}'
docker inspect arthas-caddy --format='{{.State.Health.Status}}'

# View recent health check logs
docker inspect arthas-backend --format='{{range .State.Health.Log}}{{.Output}}{{end}}'

# Manually test the backend health endpoint
docker exec arthas-backend wget -qO- http://localhost:8080/ping
# Should return "pong"
```

**Solution:**
- Services will automatically restart (`restart: unless-stopped` policy)
- If persistently unhealthy, check logs: `./deploy.sh --logs`
- Try a full restart: `./deploy.sh --down && ./deploy.sh`

---

## Architecture Overview

### Tier 1 Architecture

```
Browser ──HTTP/WS──▶ Go Binary (port 8080)
                       ├── Static file server (embedded dist/)
                       └── WebSocket Hub (message relay)
```

### Tier 2 Architecture

```
Browser ──HTTPS──▶ Caddy (port 443)
                     │
                     ▼ (reverse proxy)
                   Go Container (internal port 8080)
                     ├── Static file server (embedded dist/)
                     └── WebSocket Hub (message relay)
```

Caddy is responsible for:
- HTTPS termination and automatic certificate renewal
- HTTP → HTTPS redirect
- Reverse proxying all requests to the Go backend
- Security response header injection

Go backend is responsible for:
- Serving frontend static files (SPA routing)
- WebSocket message relay
- Health check endpoint (`/ping`)

---

## Building from Source

If you want to build from source rather than using prebuilt images:

```bash
# Clone the repository
git clone https://github.com/anthropics/arthas.git
cd arthas

# Build binaries for all platforms (requires Go 1.22+ and Node.js 18+)
make build-all

# Output in dist/ directory:
# dist/arthas-server-linux-amd64
# dist/arthas-server-linux-arm64
# dist/arthas-server-darwin-amd64
# dist/arthas-server-darwin-arm64
# dist/arthas-server-windows-amd64.exe

# Build development version for current platform only (no frontend needed)
make dev-server
```

---

## Next Steps

- [System Architecture](architecture.en.md) — Understand the overall design
- [Configuration Reference](configuration.en.md) — All configurable parameters
- [Security Design](security.md) — Encryption and security mechanisms
- [Getting Started](getting-started.en.md) — Set up a local development environment
