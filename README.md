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
| 保活 | Cron-job.org | 每 10 分钟 ping 后端，防 HF Spaces 休眠 |

### 网络策略

- **心跳保活**：服务器每 25s 发送 Ping，客户端回复 Pong（防中间代理超时断连）
- **自动重连**：前端 WebSocket 断线后指数退避重连
- **二进制传输**：MessagePack 序列化密文，降低带宽消耗

---

## 核心特性

- 🔒 **端到端加密** — AES-256-GCM，服务器零知识
- ⚡ **实时通信** — WebSocket 全双工，消息即时送达
- 🔑 **密钥即邀请** — 一个字符串同时包含房间地址和解密密钥
- 🗑️ **阅后即焚** — 无持久化，所有人离开房间自动销毁
- 🚫 **无需注册** — 无账号体系，打开即用

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
├── arthas-client/          # 前端
│   └── src/
│       ├── crypto/         # E2EE 加密层 (Web Crypto API)
│       ├── pages/          # 首页 / 聊天室
│       ├── components/     # 消息列表 / 成员 / 分享
│       ├── network/        # WebSocket + MessagePack
│       └── stores/         # Zustand 状态
├── arthas-server/          # 后端 (纯中转)
│   ├── cmd/server/         # 入口
│   └── internal/
│       ├── room/           # 房间管理 + 转发
│       └── network/        # Hub + Client + 协议
└── docs/
    ├── technical_architecture.md
    ├── backlog.md
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
   服务器永远只看到密文，无法解密
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

## 文档

- [技术架构](docs/technical_architecture.md)
- [功能待办](docs/backlog.md)
- [路线图](docs/roadmap.md)

---

## 当前状态

开发中 — 房间系统 + E2EE 加密 + 实时聊天
