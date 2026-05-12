# Arthas — 在线网页多人游戏

## 项目概述

在线网页聊天，面向北美或欧洲用户，以最小资源成本部署运行。


---

## 技术栈

### 前端

- Vite + React + PixiJS + Zustand
- Tailwind CSS

### 后端

- Go + Gorilla WebSocket
- PostgreSQL（Supabase / Neon 免费版）
- Redis（Upstash 免费版）

---

## 部署方案（最小资源）

| 层级 | 平台 | 说明 |
|------|------|------|
| 前端 | Vercel | 静态资源 + CDN |
| 后端 | Hugging Face Spaces | Go WebSocket 服务 |
| 保活 | Cron-job.org | 每 10 分钟 ping 后端，防止实例休眠 |

---

## 网络与同步架构


### 心跳保活（Ping/Pong）

- HF Spaces 反向代理层对长连接较严格
- Go 后端每 **20–30 秒**向前端发送 Ping，前端自动回复 Pong
- 作用：防止中间代理层超时断连；

### 自动重连

- 前端 WebSocket 实现自动重连机制，应对网络波动

### 协议优化

- 引入 **MessagePack**（二进制序列化），降低带宽消耗、提升解析速度

## 目标用户

- 北美 / 欧洲地区玩家
