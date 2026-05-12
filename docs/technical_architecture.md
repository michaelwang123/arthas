# Arthas 技术架构

> 多人实时在线页面 —— 用户同屏出现、自由移动、实时沟通  
> 技术栈：Go · WebSocket · MessagePack · PixiJS · WebGL · React · Vite

---

## 技术栈选型

| 层级 | 技术 | 选择理由 |
|------|------|----------|
| **渲染** | PixiJS 8 (WebGL2) | GPU 加速 2D 渲染，轻松处理数百实体 |
| **着色器** | GLSL (PIXI.Filter) | 零带宽视觉效果，纯 GPU 计算背景 |
| **前端框架** | React 18 + TypeScript | UI 层与渲染层分离，类型安全 |
| **构建** | Vite 5 | 亚秒级 HMR，ESBuild 预构建 |
| **状态** | Zustand | 极简状态管理，无 Provider 嵌套 |
| **网络协议** | WebSocket (WSS) | 全双工低延迟，适合实时同步 |
| **序列化** | MessagePack | 比 JSON 小 30-50%，二进制编解码快 |
| **后端** | Go 1.22 | goroutine 天然适合高并发连接管理 |
| **WebSocket 库** | gorilla/websocket | 生产级 Go WebSocket 实现 |
| **部署** | Docker + Vercel + HF Spaces | 前后端分离，零成本起步 |

---

## 系统架构

```
┌──────────────────────────────────────────────────────┐
│                   浏览器 (Client)                      │
│                                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────────────────┐  │
│  │ React   │  │ Zustand │  │  PixiJS (WebGL2)    │  │
│  │ UI 层   │  │ Store   │  │  Canvas 渲染        │  │
│  └────┬────┘  └────┬────┘  └──────────┬──────────┘  │
│       └─────────────┼──────────────────┘             │
│                     │                                │
│           ┌─────────┴──────────┐                     │
│           │  WebSocket Client   │                     │
│           │  MessagePack codec  │                     │
│           └─────────┬──────────┘                     │
└─────────────────────┼────────────────────────────────┘
                      │ WSS (binary frames)
┌─────────────────────┼────────────────────────────────┐
│                     │          Go Server              │
│           ┌─────────┴──────────┐                     │
│           │   WebSocket Hub     │                     │
│           │   goroutine/conn    │                     │
│           └─────────┬──────────┘                     │
│                     │                                │
│           ┌─────────┴──────────┐                     │
│           │   Event Dispatcher  │                     │
│           │   事件驱动处理       │                     │
│           └─────────┬──────────┘                     │
│                     │                                │
│      ┌──────────────┼──────────────┐                 │
│      │              │              │                 │
│  ┌───┴───┐   ┌─────┴─────┐  ┌────┴────┐            │
│  │ 移动  │   │ 聊天消息  │  │ 广播    │            │
│  │ 处理  │   │ 处理      │  │ 分发    │            │
│  └───────┘   └───────────┘  └─────────┘            │
└──────────────────────────────────────────────────────┘
```

---

## 核心设计：事件驱动

与游戏的固定频率 Tick Loop 不同，本项目采用**事件驱动**模型：

```
客户端发送消息 → 服务器立即处理 → 立即广播给所有人
```

**为什么不用 Tick Loop：**
- 不需要物理模拟，没有"每帧计算"的需求
- 事件驱动延迟更低（收到即处理，无需等下一个 tick）
- CPU 占用更低（无事件时服务器空闲）
- 代码更简单直观

**服务器处理流程：**

```
收到 PlayerInput(move) → 更新位置 → 广播 PlayerMoved 给所有人
收到 ChatMessage       → 广播 ChatBroadcast 给所有人
连接建立               → 广播 PlayerJoined 给所有人
连接断开               → 广播 PlayerLeft 给所有人
```

**客户端渲染：**

```
收到 PlayerMoved    → 直接更新对应实体位置（PixiJS 渲染）
收到 ChatBroadcast  → 显示气泡
收到 PlayerJoined   → 创建新实体
收到 PlayerLeft     → 移除实体
本地输入            → 发送到服务器，同时本地移动（乐观更新）
```

> 本地移动采用"乐观更新"：按键时本地立即移动，不等服务器确认。  
> 如果网络正常，服务器广播的位置和本地一致；如果不一致，以服务器为准覆盖。  
> 对于简单移动场景，这已经足够流畅。

---

## 网络协议

### 消息信封

```typescript
// 所有消息统一格式，MessagePack 编码
{
  type: uint8       // 消息类型
  data: object      // 消息体
}
```

### 消息类型

#### Client → Server

| ID | 名称 | Payload | 说明 |
|----|------|---------|------|
| `0x01` | Move | `{x, y}` | 移动到目标位置 / 方向 |
| `0x02` | Chat | `{text}` | 发送消息 |
| `0x03` | Pong | `{t}` | 心跳回复 |

#### Server → Client

| ID | 名称 | Payload | 说明 |
|----|------|---------|------|
| `0x10` | PlayerMoved | `{id, x, y}` | 某玩家位置更新 |
| `0x11` | PlayerJoined | `{id, name, x, y, color}` | 新用户上线 |
| `0x12` | PlayerLeft | `{id}` | 用户离线 |
| `0x13` | ChatBroadcast | `{id, text}` | 聊天广播 |
| `0x18` | Ping | `{t}` | 心跳 |
| `0x19` | Welcome | `{id, players[], config}` | 连接成功，返回当前所有在线用户 |

### Welcome 消息

连接成功时，服务器返回当前完整状态，客户端据此初始化场景：

```typescript
interface WelcomeData {
  id: string                // 分配给你的 ID
  players: PlayerInfo[]     // 当前所有在线用户
  config: {
    mapWidth: number
    mapHeight: number
  }
}

interface PlayerInfo {
  id: string
  name: string
  x: number
  y: number
  color: string             // 随机分配的颜色
}
```

---

## 移动方案

客户端按键 → 计算新位置 → 发送 Move{x, y} → 服务器校验边界 → 广播 PlayerMoved

```typescript
// 客户端：按键处理
onKeyDown(key) {
  const speed = 4  // px per frame
  let {x, y} = myPosition
  if (key === 'W') y -= speed
  if (key === 'S') y += speed
  if (key === 'A') x -= speed
  if (key === 'D') x += speed
  
  // 边界钳制
  x = clamp(x, 0, MAP_WIDTH)
  y = clamp(y, 0, MAP_HEIGHT)
  
  myPosition = {x, y}       // 乐观更新：本地立即移动
  ws.send(Move{x, y})       // 告知服务器
}
```

```go
// 服务器：收到 Move
func (h *Hub) handleMove(client *Client, msg MoveMsg) {
    // 边界校验
    x := clamp(msg.X, 0, MAP_WIDTH)
    y := clamp(msg.Y, 0, MAP_HEIGHT)
    
    client.Player.X = x
    client.Player.Y = y
    
    // 广播给所有人（包括发送者，用于校正）
    h.broadcast(PlayerMoved{ID: client.ID, X: x, Y: y})
}
```

---

## 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 地图尺寸 | 800 × 800 px | 可视区域 |
| 移动速度 | 4 px/frame | 客户端控制 |
| 玩家半径 | 15 px | 渲染大小 |
| 心跳间隔 | 25s | 保活检测 |
| 断线超时 | 60s | 无心跳则踢出 |
| 气泡持续 | 3s | 聊天气泡显示时间 |

---

## 项目结构

### 前端 (arthas-client/)

```
arthas-client/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── src/
    ├── main.tsx                    # 入口
    ├── App.tsx                     # Canvas + UI 容器
    ├── game/
    │   ├── Game.ts                # PixiJS Application 生命周期
    │   ├── constants.ts           # 配置常量
    │   └── shaders/
    │       └── VoidBackground.ts  # GLSL 背景着色器
    ├── network/
    │   ├── protocol.ts            # 消息类型 & 编解码
    │   └── websocket.ts           # WS 连接管理 + 重连
    ├── ui/
    │   ├── HUD.tsx                # 在线人数 / 延迟 / 状态
    │   └── PlayerList.tsx         # 在线玩家列表
    ├── stores/
    │   └── gameStore.ts           # Zustand 全局状态
    └── styles/
        └── index.css              # Tailwind 入口
```

### 后端 (arthas-server/)

```
arthas-server/
├── go.mod
├── go.sum
├── Dockerfile
├── cmd/
│   └── server/
│       └── main.go                # HTTP + WS 启动入口
└── internal/
    ├── game/
    │   ├── player.go             # 玩家实体
    │   └── constants.go          # 配置常量
    └── network/
        ├── hub.go                # 连接池 + 事件分发
        ├── client.go             # 单连接 goroutine（读/写）
        └── protocol.go           # MessagePack 消息定义
```

---

## 部署

```
[浏览器] ──HTTPS──→ [Vercel CDN] (静态前端)
    │
    └──WSS──→ [HF Spaces / Docker] (Go 二进制)
                      │
                [内存状态] (无数据库)
```

| 环境 | 配置 |
|------|------|
| 前端 | Vercel, `npm run build`, 输出 `dist/` |
| 后端 | Docker, Go binary, 端口 7860 |
| 环境变量 | `VITE_WS_URL=wss://xxx.hf.space/ws` |
| 健康检查 | `GET /ping` → 200 |
| 备选 | Railway / Fly.io |

---

## 里程碑

| # | 目标 | 验收 |
|---|------|------|
| M1 | WebSocket 连接 | 打开页面 → 连接成功 → 分配 ID |
| M2 | 多人同屏 | 两个窗口互相可见 |
| M3 | 移动同步 | 一方移动，另一方实时看到 |
| M4 | 实时聊天 | 发消息 → 对方头顶出现气泡 |
| M5 | 公网部署 | 分享链接，朋友能用 |

---

## 技术亮点

- **事件驱动**：无 Tick Loop，收到即处理即广播，延迟最低
- **二进制协议**：MessagePack 替代 JSON，带宽省 30-50%
- **GPU 渲染**：PixiJS WebGL2 + GLSL 着色器背景特效
- **goroutine 并发**：每连接独立 goroutine，天然高并发
- **乐观更新**：本地输入即时响应，服务器广播兜底校正
- **零数据库**：纯内存状态，架构极简
