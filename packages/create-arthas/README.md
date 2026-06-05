# create-arthas

> Self-host Arthas E2EE chat with one command.

```bash
npx @arthas-chat/create-arthas
```

---

## What It Does

Generates a ready-to-run Docker deployment for your own Arthas instance:

```
./arthas/
├── docker-compose.yml   # Container orchestration
├── .env                 # Configuration (domain, port, version)
└── Caddyfile            # HTTPS reverse proxy (if enabled)
```

Then optionally starts the containers immediately.

---

## Usage

### Interactive Mode (default)

```bash
npx @arthas-chat/create-arthas
```

Prompts for:
- Domain name (or `localhost` for local testing)
- Port number (default: 8080)
- HTTPS with auto Let's Encrypt (if domain is not localhost)
- Email for certificate notifications
- Docker image version
- Whether to start containers immediately

### Non-Interactive Mode

```bash
npx @arthas-chat/create-arthas --defaults
```

Uses localhost:8080, no HTTPS, starts immediately.

---

## Requirements

- Node.js 18+
- Docker & Docker Compose

---

## Examples

### Local Development

```bash
npx @arthas-chat/create-arthas --defaults
# �?Arthas running at http://localhost:8080
# �?WebSocket: ws://localhost:8080/ws
```

### Production with HTTPS

```bash
npx @arthas-chat/create-arthas
# Domain: chat.example.com
# HTTPS: Yes
# Email: admin@example.com
# �?Arthas running at https://chat.example.com
# �?Auto Let's Encrypt certificate
```

---

## After Setup

```bash
cd arthas

# View logs
docker compose logs -f

# Stop
docker compose down

# Update to latest version
docker compose pull && docker compose up -d

# Reconfigure
npx @arthas-chat/create-arthas  # re-run, overwrites existing files
```

---

## License

MIT
