# Arthas

> 端到端加密实时聊天室 —— 创建 Group · 分享密钥 · 加密通信

一个极简的 E2EE 聊天应用。创建临时房间，生成唯一密钥分享给伙伴，所有消息端到端加密。服务器只做密文中转，无法读取任何聊天内容。无需注册，打开即用。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 加密 | Web Crypto API — AES-256-GCM (E2EE) |
| 前端 | React 18 + TypeScript + Zustand + Tailwind |
| 构建 | Vite 5 |
| 协议 | WebSocket (WSS/TLS 1.3) + MessagePack |
| 后端 | Go 1.22 + gorilla/websocket (纯中转) |
| 部署 | Vercel (前端) + Docker/HF Spaces (后端) |

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

## 文档

- [技术架构](docs/technical_architecture.md)
- [功能待办](docs/backlog.md)
- [路线图](docs/roadmap.md)

---

## 当前状态

开发中 — 房间系统 + E2EE 加密 + 实时聊天
