# 自托管部署指南 (Self-Hosting Guide)

本指南帮助你在自己的服务器上部署 Arthas 私有实例。Arthas 提供两种部署方式：

| 方式 | 适用场景 | 依赖 | HTTPS |
|------|----------|------|-------|
| **Tier 1 — 单二进制** | 本地/内网/开发/快速体验 | 无（单文件） | 无（HTTP） |
| **Tier 2 — Docker Compose** | 公网生产环境 | Docker + Compose v2 | 自动（Let's Encrypt） |

> **零知识架构不变** — 无论哪种部署方式，服务器仅中转加密密文，不存储任何消息内容。

---

## 前置要求

### 最低硬件配置

| 资源 | 最低要求 | 说明 |
|------|----------|------|
| CPU | 1 核 | Go 服务器资源占用极低 |
| 内存 | 512 MB | 含操作系统开销 |
| 磁盘 | 1 GB | 含 Docker 镜像和证书存储 |
| 网络 | 端口 80 + 443 开放 | Tier 2 公网部署需要（Tier 1 仅需自定义端口） |

### Tier 1 前置要求

- 无额外依赖，下载二进制即可运行

### Tier 2 前置要求

- Docker Engine 20.10+
- Docker Compose v2（`docker compose` 插件，非独立的 `docker-compose`）
- 一个指向服务器 IP 的域名（公网部署）
- 服务器防火墙开放 80 和 443 端口

验证 Docker 环境：

```bash
docker --version          # Docker version 20.10+
docker compose version    # Docker Compose version v2.x.x
```

---

## 快速开始：Tier 1（单二进制）

适合本地体验、内网部署或开发测试。Go 二进制内嵌前端静态文件，下载即用。

### 1. 下载二进制

从 [GitHub Releases](https://github.com/anthropics/arthas/releases) 下载对应平台的二进制文件：

```bash
# Linux (x86_64)
curl -Lo arthas-server https://github.com/anthropics/arthas/releases/latest/download/arthas-server-linux-amd64
chmod +x arthas-server

# Linux (ARM64, 如树莓派)
curl -Lo arthas-server https://github.com/anthropics/arthas/releases/latest/download/arthas-server-linux-arm64
chmod +x arthas-server

# macOS (Apple Silicon)
curl -Lo arthas-server https://github.com/anthropics/arthas/releases/latest/download/arthas-server-darwin-arm64
chmod +x arthas-server

# macOS (Intel)
curl -Lo arthas-server https://github.com/anthropics/arthas/releases/latest/download/arthas-server-darwin-amd64
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

> **注意：** Tier 1 不提供 HTTPS。如需公网 HTTPS 部署，请使用 Tier 2 或自行配置反向代理。

---

## 快速开始：Tier 2（Docker Compose）

适合公网生产环境。Caddy 自动申请 Let's Encrypt 证书，一条命令完成部署。

### 1. 克隆仓库

```bash
git clone https://github.com/anthropics/arthas.git
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

如果需要手动修改配置：

```bash
# 编辑 .env 文件
vim deploy/.env

# 重新生成 Caddyfile 并重启
./deploy.sh --reconfigure
```

### 配置文件模板

参考 `deploy/.env.example` 获取完整的配置模板和注释说明。

---

## 升级

### Tier 2（Docker Compose）升级

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

`--upgrade` 执行的操作：
1. `docker compose pull` — 拉取最新镜像
2. `docker compose up -d` — 用新镜像重启服务（零停机，旧容器替换为新容器）

### Tier 1（单二进制）升级

```bash
# 1. 停止当前运行的服务
kill $(pgrep arthas-server)

# 2. 下载新版本（覆盖旧文件）
curl -Lo arthas-server https://github.com/anthropics/arthas/releases/latest/download/arthas-server-linux-amd64
chmod +x arthas-server

# 3. 重新启动
./arthas-server --port 8080
```

> **提示：** Arthas 是无状态服务（不存储消息），升级不涉及数据迁移。

---

## 备份

### Caddy 证书备份（Tier 2）

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

> **注意：** 即使证书丢失，Caddy 也会自动重新申请。但 Let's Encrypt 对同一域名有 [速率限制](https://letsencrypt.org/docs/rate-limits/)（每周 5 张证书），频繁重建可能触发限制。

### Tier 1 备份

Tier 1 无状态，无需备份。二进制文件可随时重新下载。

---

## 故障排查

### DNS 未生效

**症状：** 部署后访问域名显示"无法访问此网站"，Caddy 日志报 ACME challenge 失败。

**排查步骤：**

```bash
# 检查 DNS 解析是否指向你的服务器 IP
dig +short chat.example.com
# 应返回你的服务器公网 IP

# 如果返回空或错误 IP，说明 DNS 尚未生效
# DNS 传播通常需要 5 分钟 ~ 48 小时

# 使用指定 DNS 服务器验证
dig @8.8.8.8 chat.example.com
```

**解决方案：**
1. 确认域名 DNS A 记录指向服务器 IP
2. 等待 DNS 传播（通常 5-30 分钟，最长 48 小时）
3. DNS 生效后重启 Caddy：`./deploy.sh --down && ./deploy.sh`

### 端口冲突

**症状：** `deploy.sh` 报告端口 80 或 443 被占用。

**排查步骤：**

```bash
# Linux: 查看占用端口的进程
sudo ss -tlnp | grep ':80 '
sudo ss -tlnp | grep ':443 '

# macOS: 查看占用端口的进程
sudo lsof -i :80 -sTCP:LISTEN
sudo lsof -i :443 -sTCP:LISTEN
```

**常见占用进程及解决方案：**

| 进程 | 解决方案 |
|------|----------|
| nginx | `sudo systemctl stop nginx && sudo systemctl disable nginx` |
| apache2/httpd | `sudo systemctl stop apache2 && sudo systemctl disable apache2` |
| 其他 Caddy 实例 | `sudo systemctl stop caddy` |

### 证书申请失败

**症状：** Caddy 日志显示 ACME challenge 失败，HTTPS 不可用。

**排查步骤：**

```bash
# 查看 Caddy 详细日志
./deploy.sh --logs

# 常见错误信息:
# "challenge failed" — DNS 未生效或端口 80 被防火墙阻挡
# "too many certificates" — 触发 Let's Encrypt 速率限制
```

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
4. 如触发速率限制，等待一周后重试，或使用 Let's Encrypt staging 环境测试

### ARM64 兼容性

**症状：** 在树莓派或 ARM64 服务器上拉取镜像失败或运行异常。

**确认架构：**

```bash
# 查看系统架构
uname -m
# aarch64 = ARM64, x86_64 = AMD64
```

**解决方案：**

Arthas Docker 镜像支持 `linux/amd64` 和 `linux/arm64` 双架构。Docker 会自动拉取匹配的镜像。如果遇到问题：

```bash
# 强制指定平台拉取
docker pull --platform linux/arm64 ghcr.io/{GITHUB_OWNER}/arthas:latest

# 验证镜像架构
docker inspect ghcr.io/{GITHUB_OWNER}/arthas:latest | grep Architecture
```

对于 Tier 1 单二进制，下载 `arthas-server-linux-arm64` 版本即可。

### 服务不健康

**症状：** `./deploy.sh --status` 显示服务 unhealthy。

**排查步骤：**

```bash
# 查看详细健康检查状态
docker inspect arthas-backend --format='{{.State.Health.Status}}'
docker inspect arthas-caddy --format='{{.State.Health.Status}}'

# 查看最近的健康检查日志
docker inspect arthas-backend --format='{{range .State.Health.Log}}{{.Output}}{{end}}'

# 手动测试后端健康端点
docker exec arthas-backend wget -qO- http://localhost:8080/ping
# 应返回 "pong"
```

**解决方案：**
- 服务会自动重启（`restart: unless-stopped` 策略）
- 如持续不健康，查看日志：`./deploy.sh --logs`
- 尝试完全重启：`./deploy.sh --down && ./deploy.sh`

---

## 架构说明

### Tier 1 架构

```
用户浏览器 ──HTTP/WS──▶ Go 二进制 (端口 8080)
                          ├── 静态文件服务（内嵌 dist/）
                          └── WebSocket Hub（消息中转）
```

### Tier 2 架构

```
用户浏览器 ──HTTPS──▶ Caddy (端口 443)
                        │
                        ▼ (反向代理)
                      Go 容器 (内部端口 8080)
                        ├── 静态文件服务（内嵌 dist/）
                        └── WebSocket Hub（消息中转）
```

Caddy 负责：
- HTTPS 终止和证书自动续期
- HTTP → HTTPS 重定向
- 反向代理所有请求到 Go 后端
- 安全响应头注入

Go 后端负责：
- 服务前端静态文件（SPA 路由）
- WebSocket 消息中转
- 健康检查端点 (`/ping`)

---

## 从源码构建

如果你想从源码构建而非使用预构建镜像：

```bash
# 克隆仓库
git clone https://github.com/anthropics/arthas.git
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
- [安全设计](security.md) — 加密和安全机制
- [快速开始](getting-started.md) — 本地开发环境搭建
