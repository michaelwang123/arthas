# 部署指南 (Deployment Guide)

本文档介绍如何将 Arthas 部署到生产环境。

---

## 部署架构

```
[浏览器] ──HTTPS──→ [Vercel / Nginx CDN] (静态前端)
    │
    └──WSS (TLS 1.3)──→ [Docker Container] (Go Relay Server)
                              │
                        [内存: 房间 + 连接]
                        [不存储任何消息]
```

---

## 方案一：推荐部署 (Vercel + Docker)

### 前端部署 (Vercel)

1. **构建前端**

```bash
cd arthas-client
npm install
npm run build
```

输出目录：`dist/`

2. **部署到 Vercel**

```bash
# 安装 Vercel CLI
npm i -g vercel

# 部署
cd arthas-client
vercel --prod
```

或通过 Vercel Dashboard 连接 GitHub 仓库自动部署。

3. **环境变量配置**

在 Vercel 项目设置中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `VITE_WS_URL` | `wss://your-backend.domain/ws` | 后端 WebSocket 地址 |

### 后端部署 (Docker)

1. **构建 Docker 镜像**

```bash
cd arthas-server
docker build -t arthas-server .
```

2. **运行容器**

```bash
docker run -d \
  --name arthas-server \
  -p 7860:7860 \
  -e PORT=7860 \
  arthas-server
```

3. **验证**

```bash
curl http://localhost:7860/ws
# 应返回 400 Bad Request（非 WebSocket 请求）
```

---

## 方案二：Hugging Face Spaces

适合零成本部署，但有冷启动延迟。

### 步骤

1. 创建 HF Space（选择 Docker 类型）
2. 上传 `arthas-server/` 目录内容
3. 确保 Dockerfile 暴露端口 7860
4. Space 自动构建并运行

### 保活配置

HF Spaces 会在无流量时休眠。使用 [cron-job.org](https://cron-job.org) 每 10 分钟 ping 一次：

```
URL: https://your-space.hf.space/ws
间隔: 10 分钟
```

### 注意事项

- HF Spaces 免费版有冷启动延迟（约 30 秒）
- WebSocket 连接可能不稳定
- 如遇问题，考虑 Railway 或 Fly.io 作为备选

---

## 方案三：VPS 自建

适合需要完全控制的场景。

### 使用 Docker Compose

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  arthas-server:
    build: ./arthas-server
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
    restart: unless-stopped
    
  arthas-client:
    build:
      context: ./arthas-client
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - arthas-server
    restart: unless-stopped
```

前端 Nginx Dockerfile (`arthas-client/Dockerfile`)：

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

前端 Nginx 配置 (`arthas-client/nginx.conf`)：

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /ws {
        proxy_pass http://arthas-server:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

### 启动

```bash
docker-compose up -d
```

### TLS 配置 (Let's Encrypt)

使用 Certbot 或 Caddy 自动获取 HTTPS 证书：

```bash
# 使用 Caddy（推荐，自动 HTTPS）
caddy reverse-proxy --from your-domain.com --to localhost:80
```

---

## 方案四：Railway / Fly.io

### Railway

```bash
# 安装 Railway CLI
npm i -g @railway/cli

# 部署后端
cd arthas-server
railway init
railway up
```

### Fly.io

```bash
# 安装 flyctl
curl -L https://fly.io/install.sh | sh

# 部署后端
cd arthas-server
fly launch
fly deploy
```

---

## 生产环境检查清单

### 安全

- [ ] 前端使用 HTTPS
- [ ] WebSocket 使用 WSS (TLS 1.3)
- [ ] CORS 配置正确（仅允许前端域名）
- [ ] 服务器不记录消息内容

### 性能

- [ ] 后端有足够内存（每连接约 10KB）
- [ ] WebSocket 连接数限制合理
- [ ] 心跳间隔配置正确（25s）

### 可用性

- [ ] 后端有健康检查端点
- [ ] 配置了自动重启（Docker restart policy）
- [ ] 监控 WebSocket 连接数

### 环境变量

| 变量 | 后端 | 前端 | 说明 |
|------|------|------|------|
| `PORT` | ✅ | - | 服务器监听端口 |
| `VITE_WS_URL` | - | ✅ | WebSocket 服务器地址 |

---

## 资源估算

| 指标 | 值 | 说明 |
|------|-----|------|
| 内存 | ~50MB 基础 + 10KB/连接 | 纯内存，无数据库 |
| CPU | 极低 | 只做消息转发 |
| 带宽 | 取决于消息量 | 二进制协议节省 30-50% |
| 磁盘 | ~20MB | Go 二进制 + Alpine |

100 并发连接约需 51MB 内存，1000 并发约 60MB。

---

## 下一步

- [配置参考](configuration.md) — 所有可配置参数
- [安全模型](security.md) — 生产环境安全考量
