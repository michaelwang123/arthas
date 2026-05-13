# Arthas — 端到端加密实时聊天室

> Create Group · Share Key · Encrypted Communication

---

## 项目简介

Arthas 是一个开源的端到端加密 (E2EE) 实时聊天应用。用户可以创建临时聊天房间，通过分享密钥邀请伙伴加入，所有消息在客户端加密后传输，服务器仅做密文中转，无法读取任何聊天内容。

**核心理念：** 服务器零知识 (Zero-Knowledge) — 不持有密钥、不解密消息、不存储历史。

---

## 核心特性

| 特性 | 说明 |
|------|------|
| 🔒 端到端加密 | AES-256-GCM，服务器零知识设计 |
| ⚡ 实时通信 | WebSocket 全双工，消息即时送达 |
| 🔑 密钥即邀请 | 一个字符串同时包含房间地址和解密密钥 |
| 🗑️ 阅后即焚 | 无持久化，所有人离开房间自动销毁 |
| 🚫 无需注册 | 无账号体系，打开即用 |
| 📦 轻量部署 | Docker 一键部署，前后端分离 |

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 加密 | Web Crypto API | AES-256-GCM，浏览器原生硬件加速 |
| 前端 | React 18 + TypeScript | 组件化 UI，类型安全 |
| 状态 | Zustand | 极简状态管理 |
| 样式 | Tailwind CSS | 原子化 CSS，暗色主题 |
| 构建 | Vite 5 | ESBuild 预构建，亚秒级 HMR |
| 协议 | WebSocket + MessagePack | 全双工实时通信，二进制序列化 |
| 后端 | Go 1.22 + gorilla/websocket | goroutine 高并发，纯消息中转 |
| 部署 | Docker + Vercel | 前后端分离，零成本起步 |

---

## 文档导航

| 文档 | 说明 |
|------|------|
| [快速开始](getting-started.md) | 5 分钟本地运行项目 |
| [系统架构](architecture.md) | 整体架构设计与模块划分 |
| [部署指南](deployment.md) | 生产环境部署方案 |
| [配置参考](configuration.md) | 所有可配置参数说明 |
| [协议规范](protocol.md) | WebSocket 消息协议详细定义 |
| [安全模型](security.md) | E2EE 安全设计与威胁分析 |
| [开发指南](development.md) | 本地开发环境搭建与代码结构 |
| [贡献指南](contributing.md) | 如何参与项目贡献 |
| [常见问题](faq.md) | FAQ |

---

## 快速体验

```bash
# 克隆项目
git clone https://github.com/arthas/arthas.git
cd arthas

# 启动后端
cd arthas-server
go mod tidy
go run cmd/server/main.go

# 启动前端（新终端）
cd arthas-client
npm install
npm run dev
```

打开 `http://localhost:3000`，创建房间，分享密钥给朋友，开始加密聊天。

---

## 使用流程

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. 创建房间 → 获得分享码 (roomId:encryptionKey)        │
│                                                         │
│  2. 通过安全渠道分享给朋友（面对面、加密 IM 等）         │
│                                                         │
│  3. 朋友输入分享码加入房间                               │
│                                                         │
│  4. 端到端加密聊天（服务器只见密文）                     │
│                                                         │
│  5. 所有人离开 → 房间销毁，密文消失                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 许可证

MIT License

---

## 社区

- GitHub Issues: 提交 Bug 和功能建议
- Pull Requests: 欢迎贡献代码
