# Arthas

> 暗黑奇幻 · 堕落王朝 — 在线多人网页游戏

## 项目结构

```
arthas/
├── arthas-client/       # 前端（Vite + React + PixiJS + Zustand）
├── arthas-server/       # 后端（Go + Gorilla WebSocket）
├── docs/                # 设计文档
│   ├── lore_timeline.md       # 世界观时间线
│   ├── lore_races.md          # 六大始族设定
│   ├── lore_npcs.md           # NPC 角色设定
│   ├── map_design.md          # 地图设计
│   ├── game_design.md         # 游戏设计概要
│   ├── technical_architecture.md  # 技术架构
│   └── roadmap.md             # 路线图
└── req_draw.md          # 技术需求
```

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

## 技术栈

- **前端**：Vite + React + PixiJS + Zustand + Tailwind CSS
- **后端**：Go + Gorilla WebSocket + MessagePack
- **部署**：Vercel（前端）+ Hugging Face Spaces（后端）

## 游戏操作

| 操作 | 按键 |
|------|------|
| 移动 | WASD / 方向键 |
| 基础攻击 | 鼠标左键 |
| 冲刺 | Q |
| 火球 | E |

## 当前状态

MVP 原型开发中 — 2-8 人 PvP 争夺源石碎片
