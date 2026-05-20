# Arthas

> 端到端加密实时聊天室 —— 创建 Group · 分享密钥 · 加密通信

一个极简的 E2EE 聊天应用。创建临时房间，生成唯一密钥分享给伙伴，所有消息端到端加密。服务器只做密文中转，无法读取任何聊天内容。无需注册，打开即用。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 加密 | Web Crypto API | AES-256-GCM 端到端加密，浏览器原生硬件加速 |
| 前端 | React 18 + TypeScript | 组件化 UI，类型安全 |
| 状态 | Zustand | 极简状态管理 |
| 样式 | Tailwind CSS | 原子化 CSS |
| 构建 | Vite 5 | ESBuild 预构建，亚秒级 HMR |
| 协议 | WebSocket (WSS/TLS 1.3) | 全双工实时通信，TLS 传输加密 |
| 序列化 | MessagePack | 二进制编码，比 JSON 省 30-50% 带宽 |
| 后端 | Go 1.22 + gorilla/websocket | goroutine 高并发，纯消息中转 |
| 部署 | Vercel + HF Spaces (Docker) | 前后端分离，零成本起步 |
| 自托管 | Go embed + Caddy + Docker | 单二进制或 Docker Compose，一键部署 |
| 保活 | Cron-job.org | 每 10 分钟 ping 后端，防 HF Spaces 休眠 |

### 网络策略

- **心跳保活**：服务器每 25s 发送 Ping，客户端回复 Pong（防中间代理超时断连）
- **自动重连**：前端 WebSocket 断线后指数退避重连
- **二进制传输**：MessagePack 序列化密文，降低带宽消耗

---

## 核心特性

- 🔒 **端到端加密** — AES-256-GCM，服务器零知识
- ⚡ **实时通信** — WebSocket 全双工，消息即时送达
- 📎 **加密文件分享** — 分片加密传输，图片缩略图预览，拖拽/粘贴上传
- 🔑 **密钥即邀请** — 一个字符串同时包含房间地址和解密密钥
- 🗑️ **阅后即焚** — 可选定时消失（10s/30s/60s/5min），纯客户端实现
- 💬 **消息回复 & 反应** — 引用回复 + emoji 反应，数据加密传输
- 🔐 **房间密码** — 可选密码保护，防止分享码泄露后被陌生人加入
- 🖥️ **CLI 客户端** — 独立 Go 二进制，终端内创建/加入加密聊天室
- 🚫 **无需注册** — 无账号体系，打开即用
- 🏠 **自托管部署** — 单二进制零依赖，或 Docker Compose 自动 HTTPS

---

## 快速开始

### 后端

```bash
cd arthas-server
go mod tidy
go run cmd/server/main.go
```

服务器启动在 `http://localhost:8080`，WebSocket 端点：`ws://localhost:8080/ws`

### 前端

```bash
cd arthas-client
npm install
npm run dev
```

前端启动在 `http://localhost:3000`

### CLI 客户端

```bash
cd arthas-cli
go build -o arthas-cli.exe ./cmd/arthas-cli/

# 创建房间
./arthas-cli create --server ws://localhost:8080/ws --name Alice

# 加入房间（使用创建时输出的分享码）
./arthas-cli join <share_code> --server ws://localhost:8080/ws --name Bob
```

CLI 是独立的 Go 二进制，实现与 Web 客户端完全相同的 E2EE 协议，两端可互操作。

---

## 使用流程

```
创建房间 → 获得分享码 (roomId:encryptionKey)
    → 通过安全渠道分享给朋友
    → 朋友输入分享码加入
    → 端到端加密聊天
    → 所有人离开 → 房间销毁，密文消失
```

---

## 项目结构

```
arthas/
├── arthas-client/          # Web 前端
│   └── src/
│       ├── crypto/         # E2EE 加密层 (Web Crypto API)
│       ├── file-transfer/  # 加密文件分享模块
│       │   ├── components/ # FileMessage, ProgressBar, DropZone, FileAttachButton
│       │   ├── sender.ts   # 发送引擎（分片加密 + 流控）
│       │   ├── receiver.ts # 接收引擎（解密重组 + 超时）
│       │   └── ...         # types, chunker, thumbnail, persistence
│       ├── pages/          # 首页 / 聊天室
│       ├── components/     # 消息列表 / 成员 / 分享
│       ├── network/        # WebSocket + MessagePack
│       └── stores/         # Zustand 状态
├── arthas-server/          # 后端 (纯中转)
│   ├── cmd/server/         # 入口（CLI flags: --port, --version）
│   └── internal/
│       ├── room/           # 房间管理 + 转发
│       ├── network/        # Hub + Client + 协议
│       └── static/         # 内嵌前端静态文件服务（SPA fallback）
├── arthas-cli/             # CLI 客户端 (独立 Go 二进制)
│   ├── cmd/arthas-cli/     # 入口（子命令: create, join）
│   └── internal/
│       ├── protocol/       # MessagePack 协议编解码
│       ├── crypto/         # AES-256-GCM 加密/解密 + 分享码
│       ├── network/        # WebSocket 连接管理
│       ├── ui/             # 终端输出格式化 + 颜色
│       └── chat/           # 会话协调（状态机 + 事件循环）
├── deploy/                 # 自托管部署基础设施
│   ├── Dockerfile          # 三阶段构建（前端→Go→Alpine）
│   ├── docker-compose.yml  # Caddy + Backend 编排
│   ├── deploy.sh           # 一键部署脚本
│   ├── Caddyfile.*.example # Caddy 配置模板
│   └── .env.example        # 环境变量模板
├── official_doc/           # 用户文档
│   └── self-hosting.md     # 自托管部署指南
└── docs/
    ├── technical_architecture.md
    └── roadmap.md
```

---

## 架构

```
浏览器 A                    Go Server (Relay)              浏览器 B
   │                            │                            │
   │── 明文 → AES加密 → 密文 ──→│── 原样转发密文 ──→│         │
   │                            │                  │→ 密文 → AES解密 → 明文
   │                            │                            │
                                │
CLI 客户端 C                    │
   │── 明文 → AES加密 → 密文 ──→│── 原样转发密文 ──→ 浏览器/CLI
   │                            │
   服务器永远只看到密文，无法解密
   Web 和 CLI 使用相同协议，完全互操作
```

- **E2EE**：Web Crypto API + AES-256-GCM，密钥只在客户端
- **纯中转**：服务器不解密、不存储、不解析消息
- **二进制协议**：MessagePack 编码密文，传输高效
- **事件驱动**：收到即转发，无轮询

---

## 部署方案

| 层级 | 平台　　　　　　　　| 说明　　　　　　　　　　　　　　　　 |
| ------| ---------------------| --------------------------------------|
| 前端 | Vercel　　　　　　　| 静态资源 + 全球 CDN，自动 HTTPS　　　|
| 后端 | Hugging Face Spaces | Docker 容器运行 Go 二进制，端口 7860 |
| 保活 | Cron-job.org　　　　| 每 10 分钟 ping `/ping`，防实例休眠　|
| 备选 | Railway / Fly.io　　| 如 HF Spaces WebSocket 不稳定　　　　|

---

## 自托管部署

除了 Vercel + HF Spaces 的托管方案，Arthas 支持完全自托管，让你对数据和基础设施拥有完全控制权。

| 方案 | 适用场景 | 说明 |
|------|----------|------|
| **Tier 1 — 单二进制** | 本地/内网/开发 | 零依赖，下载即运行，Go embed 内嵌前端 |
| **Tier 2 — Docker Compose** | 公网生产环境 | Caddy 自动 HTTPS + Go 后端，一键部署 |

👉 完整指南：[自托管部署文档](official_doc/self-hosting.md)

---

## 文档

- [技术架构](docs/technical_architecture.md)
- [功能待办](docs/backlog.md)
- [路线图](docs/roadmap.md)
- [自托管部署](official_doc/self-hosting.md)
- [CLI 客户端使用指南](official_doc/cli-guide.md)

---

## 当前状态

Phase 6 差异化功能全部完成 + Phase 7.4 自托管部署完成 + Phase 8 CLI 客户端完成 — 加密聊天 + 文件分享 + 回复反应 + 密码保护 + 阅后即焚 + 一键自托管 + 终端客户端
