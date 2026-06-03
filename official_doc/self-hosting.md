# 自托管部署指南 (Self-Hosting Guide)

本指南帮助你在自己的服务器上部署 Arthas 私有实例。Arthas 提供三种部署方式：

| 方式 | 适用场景 | 依赖 | HTTPS |
|------|----------|------|-------|
| **Tier 1 — 单二进制** | 本地/内网/开发快速体验 | 无（单文件） | 无（HTTP） |
| **Tier 2 — Docker 单容器** | 快速部署/测试/内网 | Docker | 无（HTTP） |
| **Tier 3 — Docker Compose** | 公网生产环境 | Docker + Compose v2 | 自动（Let's Encrypt） |

> **零知识架构不变** — 无论哪种部署方式，服务器仅中转加密密文，不存储任何消息内容。

---

## 项目中的两个 Dockerfile

| 文件 | 用途 | 包含前端 | 默认端口 | 构建上下文 |
|------|------|----------|----------|------------|
| `deploy/Dockerfile` | **自托管部署（Tier 2/3 推荐）** | ✅ 三阶段构建 | 8080 | 项目根目录 |
| `arthas-server/Dockerfile` | HF Spaces 纯后端中继 | ❌ 仅后端 | 7860 | arthas-server/ |

**关键区别：**
- `deploy/Dockerfile` 会先构建前端（Node.js），再将产物嵌入 Go 二进制，最终镜像包含完整的前端页面 + WebSocket 后端
- `arthas-server/Dockerfile` 只编译 Go 后端，不构建前端，用于前后端分离部署（前端在 Vercel，后端在 HF Spaces）

> ⚠️ **常见错误：** 如果你用 `docker build -t arthas-server ./arthas-server` 构建，访问根路径只会看到空白页面（placeholder HTML）。这是因为用错了 Dockerfile。自托管请使用 `deploy/Dockerfile`。

---

## 前置要求

### 最低硬件配置

| 资源 | 最低要求 | 说明 |
|------|----------|------|
| CPU | 1 核 | Go 服务器资源占用极低 |
| 内存 | 512 MB | 含操作系统开销 |
| 磁盘 | 1 GB | 含 Docker 镜像和证书存储 |
| 网络 | 端口 80 + 443 开放 | Tier 3 公网部署需要（Tier 1/2 仅需自定义端口） |

### Tier 1 前置要求

- 无额外依赖，下载二进制即可运行

### Tier 2 前置要求

- Docker Engine 20.10+

```bash
docker --version    # Docker version 20.10+
```

### Tier 3 前置要求

- Docker Engine 20.10+
- Docker Compose v2（`docker compose` 插件，非独立的 `docker-compose`）
- 一个指向服务器 IP 的域名（公网部署）
- 服务器防火墙开放 80 和 443 端口

```bash
docker --version          # Docker version 20.10+
docker compose version    # Docker Compose version v2.x.x
```

---

## 快速开始：Tier 1（单二进制）

适合本地体验、内网部署或开发测试。Go 二进制内嵌前端静态文件，下载即用。

### 1. 下载二进制

从 [GitHub Releases](https://github.com/michaelwang123/arthas/releases) 下载对应平台的二进制文件：

```bash
# Linux (x86_64)
curl -Lo arthas-server https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-linux-amd64
chmod +x arthas-server

# Linux (ARM64, 如树莓派)
curl -Lo arthas-server https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-linux-arm64
chmod +x arthas-server

# macOS (Apple Silicon)
curl -Lo arthas-server https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-darwin-arm64
chmod +x arthas-server

# macOS (Intel)
curl -Lo arthas-server https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-darwin-amd64
chmod +x arthas-server
```

### 2. 启动服务

```bash
# 默认端口 8080
./arthas-server

# 自定义端口
./arthas-server --port 3000

# 限制 WebSocket 来源（生产环境推荐）
./arthas-server --port 443 --allowed-origins "https://chat.example.com"
```

### 3. 访问

打开浏览器访问 `http://localhost:8080`（或你指定的端口），即可开始使用。

### CLI 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--port` | `8080`（或 `$PORT` 环境变量） | HTTP 监听端口 |
| `--allowed-origins` | `*`（允许所有来源） | WebSocket CORS 白名单，多个用逗号分隔 |
| `--version` | — | 打印版本号并退出 |

> **注意：** Tier 1 不提供 HTTPS。如需公网 HTTPS 部署，请使用 Tier 3 或自行配置反向代理。

---

## 快速开始：Tier 2（Docker 单容器）

适合快速部署、内网使用或测试。预构建镜像已发布到 GitHub Container Registry，一条命令即可运行。

### 方式 A：使用预构建镜像（推荐）

```bash
# 直接拉取并运行（镜像 < 30MB，含完整前端 + 后端）
docker run -d -p 8080:8080 --name arthas ghcr.io/michaelwang123/arthas:latest

# 自定义端口
docker run -d -p 3000:3000 -e PORT=3000 --name arthas ghcr.io/michaelwang123/arthas:latest

# 限制 CORS 来源
docker run -d -p 8080:8080 -e ALLOWED_ORIGINS=https://chat.example.com --name arthas ghcr.io/michaelwang123/arthas:latest
```

或使用 Docker Compose：

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

### 方式 B：从源码构建

如果你需要自定义修改：

```bash
git clone https://github.com/michaelwang123/arthas.git
cd arthas

# 从项目根目录构建（必须使用 deploy/Dockerfile）
docker build -f deploy/Dockerfile -t arthas-server .

# 启动
docker run -d -p 8080:8080 --name arthas arthas-server
```

### 4. 验证

```bash
# 健康检查
curl http://localhost:8080/ping
# 返回 "pong"

# 查看容器状态（等待约 30 秒后显示 healthy）
docker ps --filter name=arthas
# STATUS: Up X seconds (healthy)

# 查看日志
docker logs arthas
# [2024-01-01T12:00:00Z] [INFO] [Server] started on :8080 (version latest)
```

### 5. 访问

打开浏览器访问 `http://localhost:8080`，即可看到完整的前端页面并开始使用。

**容器内的路由：**

| 路径 | 功能 |
|------|------|
| `/` | 前端 SPA 页面（index.html） |
| `/assets/*` | 前端静态资源（JS/CSS，带内容哈希长期缓存） |
| `/ws` | WebSocket 连接端点 |
| `/ping` | 健康检查 |

### 6. 停止和清理

```bash
# 停止容器
docker stop arthas

# 删除容器
docker rm arthas

# 删除镜像（可选）
docker rmi ghcr.io/michaelwang123/arthas:latest
```

### Docker Compose 单容器模式

如果你偏好使用 Docker Compose 管理：

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

## 快速开始：Tier 3（Docker Compose + HTTPS）

适合公网生产环境。Caddy 自动申请 Let's Encrypt 证书，一条命令完成部署。

### 1. 克隆仓库

```bash
git clone https://github.com/michaelwang123/arthas.git
cd arthas/deploy
```

### 2. 运行部署脚本

```bash
./deploy.sh
```

脚本会交互式引导你完成配置：

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

### 3. 访问

部署完成后，打开浏览器访问 `https://你的域名` 即可使用。

### 本地模式（无域名测试）

如果只想在本地快速体验 Docker Compose 部署：

```bash
./deploy.sh --local
```

这会自动设置 `DOMAIN=localhost`，使用 HTTP（无 HTTPS），访问 `http://localhost`。

---

## 部署脚本命令参考

`deploy.sh` 支持以下子命令：

| 命令 | 说明 |
|------|------|
| `./deploy.sh` | 完整部署流程（检查 → 配置 → 启动） |
| `./deploy.sh --local` | 本地 HTTP 模式部署（DOMAIN=localhost） |
| `./deploy.sh --status` | 查看所有服务的健康状态 |
| `./deploy.sh --logs` | 查看最近 50 行容器日志 |
| `./deploy.sh --upgrade` | 拉取最新镜像并重启服务 |
| `./deploy.sh --down` | 停止并移除所有容器 |
| `./deploy.sh --reconfigure` | 删除配置文件，重新进入交互式设置 |

### 示例

```bash
# 查看服务状态
./deploy.sh --status
# 输出:
# arthas-backend: healthy (running)
# arthas-caddy:   healthy (running)

# 查看日志排查问题
./deploy.sh --logs

# 升级到最新版本
./deploy.sh --upgrade

# 停止服务
./deploy.sh --down

# 切换域名（先停止，再重新配置）
./deploy.sh --down
./deploy.sh --reconfigure
```

---

## 配置参考

所有配置通过 `deploy/.env` 文件管理。首次运行 `deploy.sh` 时会交互式生成。

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `DOMAIN` | 是 | — | 部署域名。公网填实际域名（如 `chat.example.com`），本地填 `localhost` |
| `EMAIL` | 公网必填 | — | Let's Encrypt 证书注册邮箱，用于接收到期提醒。`DOMAIN=localhost` 时可留空 |
| `ARTHAS_VERSION` | 否 | `latest` | Docker 镜像版本 tag（如 `v1.0.0`）。生产环境建议锁定具体版本 |
| `GITHUB_OWNER` | 是 | — | GitHub 用户名/组织名，用于拼接镜像地址 `ghcr.io/{GITHUB_OWNER}/arthas` |
| `ALLOWED_ORIGINS` | 否 | 自动生成 | WebSocket CORS 白名单。公网自动设为 `https://{DOMAIN}`，本地设为 `*` |

### 手动编辑配置

```bash
# 编辑 .env 文件
vim deploy/.env

# 重新生成 Caddyfile 并重启
./deploy.sh --reconfigure
```

---

## 升级

### Tier 3（Docker Compose）升级

```bash
cd deploy

# 方式一：升级到最新版本
./deploy.sh --upgrade

# 方式二：升级到指定版本
# 1. 修改 .env 中的 ARTHAS_VERSION
sed -i 's/ARTHAS_VERSION=.*/ARTHAS_VERSION=v1.2.0/' .env
# 2. 拉取新镜像并重启
./deploy.sh --upgrade
```

### Tier 2（Docker 单容器）升级

```bash
# 拉取最新镜像并替换容器
docker pull ghcr.io/michaelwang123/arthas:latest
docker rm -f arthas
docker run -d -p 8080:8080 --name arthas ghcr.io/michaelwang123/arthas:latest
```

### Tier 1（单二进制）升级

```bash
# 1. 停止当前运行的服务
kill $(pgrep arthas-server)

# 2. 下载新版本（覆盖旧文件）
curl -Lo arthas-server https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-linux-amd64
chmod +x arthas-server

# 3. 重新启动
./arthas-server --port 8080
```

> **提示：** Arthas 是无状态服务（不存储消息），升级不涉及数据迁移。

---

## 备份

### Caddy 证书备份（Tier 3）

Caddy 的 TLS 证书存储在 Docker 命名卷 `caddy_data` 中。建议定期备份以避免频繁向 Let's Encrypt 请求新证书（有速率限制）。

```bash
# 备份证书卷
docker run --rm \
  -v arthas_caddy_data:/data \
  -v $(pwd)/backup:/backup \
  alpine tar czf /backup/caddy-certs-$(date +%Y%m%d).tar.gz /data

# 恢复证书卷
docker run --rm \
  -v arthas_caddy_data:/data \
  -v $(pwd)/backup:/backup \
  alpine sh -c "cd / && tar xzf /backup/caddy-certs-20240101.tar.gz"
```

### Tier 1/2 备份

Tier 1 和 Tier 2 无状态，无需备份。二进制文件可随时重新下载，Docker 镜像可随时重新构建。

---

## 故障排查

### 访问根路径显示空白页面

**症状：** `docker run` 后访问 `http://localhost:8080` 显示空白或只有 `<div id="root"></div>`。

**原因：** 使用了错误的 Dockerfile。`arthas-server/Dockerfile` 不包含前端构建步骤。

**解决方案：**

```bash
# 错误 ❌（只构建后端，无前端）
docker build -t arthas-server ./arthas-server

# 正确 ✅（使用预构建镜像，含完整前端 + 后端）
docker run -d -p 8080:8080 ghcr.io/michaelwang123/arthas:latest

# 或从源码构建（使用 deploy/Dockerfile）
docker build -f deploy/Dockerfile -t arthas-server .
```

### 端口被占用

**症状：** `docker run` 报错 `port is already allocated`。

**排查步骤：**

```bash
# Linux/macOS
lsof -i :8080

# Windows
netstat -ano | findstr "8080"

# 查看是否有其他 Docker 容器占用
docker ps --filter "publish=8080"
```

**解决方案：**

```bash
# 停止占用端口的容器
docker rm -f <container_name>

# 或使用其他端口
docker run -d -p 9090:9090 -e PORT=9090 --name arthas arthas-server
```

### DNS 未生效（Tier 3）

**症状：** 部署后访问域名显示"无法访问此网站"，Caddy 日志报 ACME challenge 失败。

**排查步骤：**

```bash
# 检查 DNS 解析是否指向你的服务器 IP
dig +short chat.example.com

# 使用指定 DNS 服务器验证
dig @8.8.8.8 chat.example.com
```

**解决方案：**
1. 确认域名 DNS A 记录指向服务器 IP
2. 等待 DNS 传播（通常 5-30 分钟，最长 48 小时）
3. DNS 生效后重启 Caddy：`./deploy.sh --down && ./deploy.sh`

### 端口冲突（Tier 3）

**症状：** `deploy.sh` 报告端口 80 或 443 被占用。

**排查步骤：**

```bash
# Linux
sudo ss -tlnp | grep ':80 '
sudo ss -tlnp | grep ':443 '

# macOS
sudo lsof -i :80 -sTCP:LISTEN
sudo lsof -i :443 -sTCP:LISTEN
```

**常见占用进程及解决方案：**

| 进程 | 解决方案 |
|------|----------|
| nginx | `sudo systemctl stop nginx && sudo systemctl disable nginx` |
| apache2/httpd | `sudo systemctl stop apache2 && sudo systemctl disable apache2` |
| 其他 Caddy 实例 | `sudo systemctl stop caddy` |

### 证书申请失败（Tier 3）

**症状：** Caddy 日志显示 ACME challenge 失败，HTTPS 不可用。

**解决方案：**
1. 确认端口 80 对外开放（Let's Encrypt HTTP-01 验证需要）
2. 确认 DNS 已正确解析到服务器
3. 检查服务器防火墙规则：
   ```bash
   # Ubuntu/Debian
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp

   # CentOS/RHEL
   sudo firewall-cmd --permanent --add-service=http
   sudo firewall-cmd --permanent --add-service=https
   sudo firewall-cmd --reload
   ```

### 服务不健康

**症状：** `docker ps` 显示容器 unhealthy。

**排查步骤：**

```bash
# 查看健康检查状态
docker inspect arthas --format='{{.State.Health.Status}}'

# 手动测试健康端点
docker exec arthas wget -qO- http://localhost:8080/ping
# 应返回 "pong"

# 查看日志
docker logs arthas
```

### ARM64 兼容性

Arthas Docker 镜像支持 `linux/amd64` 和 `linux/arm64` 双架构。Docker 会自动拉取匹配的镜像。

```bash
# 查看系统架构
uname -m
# aarch64 = ARM64, x86_64 = AMD64

# 从源码构建时自动适配当前架构
docker build -f deploy/Dockerfile -t arthas-server .
```

---

## 架构说明

### Tier 1 / Tier 2 架构

```
用户浏览器 ──HTTP/WS──→ Go 服务 (端口 8080)
                          ├── 静态文件服务（内嵌 dist/）
                          ├── WebSocket Hub（消息中转）
                          └── /ping 健康检查
```

### Tier 3 架构

```
用户浏览器 ──HTTPS──→ Caddy (端口 443)
                        │
                        │ (反向代理)
                        ↓
                      Go 容器 (内部端口 8080)
                        ├── 静态文件服务（内嵌 dist/）
                        ├── WebSocket Hub（消息中转）
                        └── /ping 健康检查
```

Caddy 负责：
- HTTPS 终止和证书自动续期
- HTTP → HTTPS 重定向
- 反向代理所有请求到 Go 后端
- 安全响应头注入

Go 后端负责：
- 服务前端静态文件（SPA 路由 fallback）
- WebSocket 消息中转
- 健康检查端点 (`/ping`)

---

## 从源码构建

如果你想从源码构建而非使用预构建镜像：

### Docker 构建（自定义修改时使用）

```bash
# 克隆仓库
git clone https://github.com/michaelwang123/arthas.git
cd arthas

# 构建完整镜像（前端 + 后端）
docker build -f deploy/Dockerfile -t arthas-server .

# 指定版本号
docker build -f deploy/Dockerfile --build-arg VERSION=v1.2.3 -t arthas-server:v1.2.3 .

# 运行
docker run -d -p 8080:8080 --name arthas arthas-server
```

> **注意：** 对于普通用户，建议直接使用预构建镜像 `ghcr.io/michaelwang123/arthas:latest`，无需克隆仓库和构建。

### 本地构建（需要 Go + Node.js）

```bash
# 克隆仓库
git clone https://github.com/michaelwang123/arthas.git
cd arthas

# 构建所有平台的二进制（需要 Go 1.22+ 和 Node.js 18+）
make build-all

# 产出在 dist/ 目录:
# dist/arthas-server-linux-amd64
# dist/arthas-server-linux-arm64
# dist/arthas-server-darwin-amd64
# dist/arthas-server-darwin-arm64
# dist/arthas-server-windows-amd64.exe

# 仅构建当前平台的开发版本（无需前端）
make dev-server
```

---

## 下一步

- [系统架构](architecture.md) — 了解整体设计
- [配置参考](configuration.md) — 所有可配置参数
- [快速开始](getting-started.md) — 本地开发环境搭建
