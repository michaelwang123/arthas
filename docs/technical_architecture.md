# Arthas 技术架构文档

> 战斗系统：实时 + 技能冷却  
> 视角：俯视角 Top-down  
> 目标：4 周 MVP 原型（2-8 人 PvP 争夺资源）

---

## 一、系统架构总览

```
┌─────────────────────────────────────────────────────────┐
│                      客户端 (Browser)                     │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐    │
│  │  React   │  │  Zustand  │  │      PixiJS        │    │
│  │  UI层    │  │  状态管理  │  │   游戏渲染层        │    │
│  └────┬─────┘  └─────┬────┘  └─────────┬──────────┘    │
│       │               │                 │               │
│       └───────────────┼─────────────────┘               │
│                       │                                 │
│              ┌────────┴────────┐                        │
│              │  WebSocket 层    │                        │
│              │  (MessagePack)   │                        │
│              └────────┬────────┘                        │
└───────────────────────┼─────────────────────────────────┘
                        │ WSS
┌───────────────────────┼─────────────────────────────────┐
│                       │         服务端 (Go)              │
│              ┌────────┴────────┐                        │
│              │  WebSocket Hub   │                        │
│              │  连接管理         │                        │
│              └────────┬────────┘                        │
│                       │                                 │
│              ┌────────┴────────┐                        │
│              │   Game Loop      │                        │
│              │   20Hz Tick      │                        │
│              └────────┬────────┘                        │
│                       │                                 │
│  ┌────────┐  ┌───────┴───┐  ┌──────────┐  ┌────────┐  │
│  │ 物理   │  │  战斗系统  │  │ 资源点   │  │ 计分   │  │
│  │ 移动   │  │  伤害判定  │  │ 占领逻辑 │  │ 系统   │  │
│  └────────┘  └───────────┘  └──────────┘  └────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 二、网络协议设计

### 2.1 传输层

| 属性 | 选择 |
|------|------|
| 协议 | WebSocket (WSS) |
| 序列化 | MessagePack (二进制) |
| Tick Rate | 20Hz (服务器每 50ms 广播一次状态) |
| 心跳 | 服务器每 25 秒发送 Ping，客户端回复 Pong |

### 2.2 消息格式

所有消息遵循统一信封格式：

```
{
  "type": uint8,     // 消息类型 ID
  "seq": uint32,     // 序列号（用于客户端预测校正）
  "data": object     // 消息体
}
```

### 2.3 消息类型定义

#### 客户端 → 服务器

| Type ID | 名称 | 数据 | 说明 |
|---------|------|------|------|
| 0x01 | PlayerInput | `{seq, dx, dy, attack}` | 每帧输入（方向 + 是否攻击） |
| 0x02 | SkillUse | `{skillId, targetX, targetY}` | 使用技能 |
| 0x03 | Ping | `{timestamp}` | 心跳回复 |

#### 服务器 → 客户端

| Type ID | 名称 | 数据 | 说明 |
|---------|------|------|------|
| 0x10 | GameState | `{tick, players[], projectiles[], coreshard}` | 每 tick 广播 |
| 0x11 | PlayerJoined | `{id, x, y}` | 新玩家加入 |
| 0x12 | PlayerLeft | `{id}` | 玩家离开 |
| 0x13 | SkillEffect | `{skillId, sourceId, x, y, dx, dy}` | 技能视觉效果触发 |
| 0x14 | PlayerDied | `{id, killerId}` | 玩家死亡 |
| 0x15 | PlayerRespawned | `{id, x, y}` | 玩家重生 |
| 0x16 | ScoreUpdate | `{scores: {id: score}}` | 分数变化 |
| 0x17 | GameOver | `{winnerId, scores}` | 游戏结束 |
| 0x18 | ServerPing | `{timestamp}` | 心跳 |
| 0x19 | Welcome | `{playerId, gameConfig}` | 连接成功，分配 ID |

### 2.4 GameState 数据结构

```typescript
interface GameState {
  tick: number;           // 服务器 tick 序号
  players: PlayerState[];
  projectiles: ProjectileState[];
  coreshard: CoreshardState;
}

interface PlayerState {
  id: string;
  x: number;             // float32
  y: number;             // float32
  hp: number;            // uint8 (0-100)
  maxHp: number;         // uint8
  dir: number;           // float32 (弧度，面朝方向)
  state: PlayerStateEnum; // idle/moving/attacking/dead
  lastInputSeq: number;  // 用于客户端预测校正
}

interface ProjectileState {
  id: string;
  x: number;
  y: number;
  dx: number;            // 方向向量 x
  dy: number;            // 方向向量 y
  ownerId: string;
  skillId: number;
}

interface CoreshardState {
  x: number;
  y: number;
  state: 'idle' | 'capturing' | 'cooldown';
  capturingPlayerId: string | null;
  captureProgress: number; // 0-100
  respawnTimer: number;    // 剩余冷却秒数
}
```

---

## 三、游戏循环设计

### 3.1 服务器 Game Loop（20Hz）

```
每 50ms 执行一次：
┌─────────────────────────────────────────┐
│ 1. 收集所有客户端输入                     │
│ 2. 处理输入 → 更新玩家移动意图            │
│ 3. 物理更新 → 移动所有实体               │
│ 4. 碰撞检测 → 边界 + 实体间              │
│ 5. 战斗处理 → 攻击判定 + 伤害计算        │
│ 6. 投射物更新 → 移动 + 命中检测          │
│ 7. 资源点更新 → 占领进度                 │
│ 8. 死亡/重生处理                         │
│ 9. 计分更新                              │
│ 10. 广播 GameState 给所有客户端           │
└─────────────────────────────────────────┘
```

### 3.2 客户端渲染循环（60 FPS）

```
每帧（~16.6ms）：
┌─────────────────────────────────────────┐
│ 1. 读取键盘/鼠标输入                     │
│ 2. 客户端预测：立即移动本地玩家           │
│ 3. 发送 PlayerInput 到服务器             │
│ 4. 接收 GameState                        │
│ 5. 校正本地玩家位置（如有偏差）           │
│ 6. 实体插值：平滑其他玩家位置            │
│ 7. 渲染所有实体                          │
│ 8. 更新 UI（血条、冷却、分数）           │
└─────────────────────────────────────────┘
```

---

## 四、客户端预测与校正

### 4.1 预测流程

```
1. 玩家按下 W 键
2. 客户端立即移动角色（预测位置）
3. 同时发送 PlayerInput{seq: 42, dx: 0, dy: -1} 到服务器
4. 客户端保存：pendingInputs.push({seq: 42, dx: 0, dy: -1})
5. 服务器处理后返回 GameState，其中 player.lastInputSeq = 42
6. 客户端收到后：
   - 删除 seq <= 42 的所有 pendingInputs
   - 将本地位置设为服务器位置
   - 重新应用剩余的 pendingInputs（seq > 42）
7. 如果偏差 < 阈值（2px），不校正（避免抖动）
```

### 4.2 实体插值

```
对于其他玩家：
1. 收到 GameState 时，不直接设置位置
2. 存入 buffer: positionBuffer.push({tick, x, y, timestamp})
3. 渲染时，取 100ms 前的两个快照
4. 在两个快照之间做线性插值（LERP）
5. 结果：其他玩家平滑移动，但有 100ms 视觉延迟
```

---

## 五、战斗系统技术设计

### 5.1 MVP 战斗参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 玩家 HP | 100 | — |
| 移动速度 | 200 units/s | 每 tick 移动 10 units |
| 基础攻击伤害 | 15 | — |
| 基础攻击范围 | 60 units | 近战圆形判定 |
| 基础攻击间隔 | 500ms | 每秒最多 2 次 |
| 技能1：冲刺 | 150 units 位移 | 5s 冷却 |
| 技能2：火球 | 30 伤害，射程 300 | 3s 冷却，速度 400 units/s |
| 死亡重生时间 | 3 秒 | 重生在随机位置 |
| 地图大小 | 800 × 800 units | — |

### 5.2 命中检测（服务器端）

```go
// 基础攻击：圆形范围检测
func checkMeleeHit(attacker, target Player) bool {
    dx := target.X - attacker.X
    dy := target.Y - attacker.Y
    dist := math.Sqrt(dx*dx + dy*dy)
    
    // 在攻击范围内
    if dist > MELEE_RANGE {
        return false
    }
    
    // 在面朝方向的 90° 扇形内
    angle := math.Atan2(dy, dx)
    diff := angleDiff(attacker.Dir, angle)
    return math.Abs(diff) < math.Pi/4
}

// 火球：圆形碰撞检测
func checkProjectileHit(proj Projectile, target Player) bool {
    dx := target.X - proj.X
    dy := target.Y - proj.Y
    dist := math.Sqrt(dx*dx + dy*dy)
    return dist < PROJECTILE_RADIUS + PLAYER_RADIUS
}
```

### 5.3 技能冷却管理

```go
type CooldownManager struct {
    cooldowns map[int]time.Time // skillId -> 可用时间
}

func (cm *CooldownManager) CanUse(skillId int) bool {
    readyAt, exists := cm.cooldowns[skillId]
    if !exists {
        return true
    }
    return time.Now().After(readyAt)
}

func (cm *CooldownManager) Use(skillId int, cooldownDuration time.Duration) {
    cm.cooldowns[skillId] = time.Now().Add(cooldownDuration)
}
```

---

## 六、资源点（源石碎片）机制

### 6.1 状态机

```
        [idle]
          │
    玩家进入范围
          │
          ▼
     [capturing]  ←── 受到伤害 → 中断回到 [idle]
          │
    3 秒占领完成
          │
          ▼
     [collected]  → 给玩家 +10 分
          │
    15 秒冷却
          │
          ▼
      [respawn] → 回到 [idle]
```

### 6.2 服务器逻辑

```go
func (cs *Coreshard) Update(players []Player, dt float64) {
    switch cs.State {
    case Idle:
        // 检测是否有玩家在范围内
        for _, p := range players {
            if p.IsAlive() && cs.InRange(p) {
                cs.State = Capturing
                cs.CapturingPlayerID = p.ID
                cs.Progress = 0
                break
            }
        }
    case Capturing:
        player := findPlayer(cs.CapturingPlayerID)
        // 玩家离开范围或死亡 → 中断
        if player == nil || !player.IsAlive() || !cs.InRange(*player) {
            cs.State = Idle
            cs.Progress = 0
            return
        }
        // 推进占领
        cs.Progress += dt / CAPTURE_TIME * 100
        if cs.Progress >= 100 {
            cs.State = Cooldown
            cs.RespawnTimer = RESPAWN_TIME
            // 给玩家加分
        }
    case Cooldown:
        cs.RespawnTimer -= dt
        if cs.RespawnTimer <= 0 {
            cs.State = Idle
            cs.RandomizePosition() // 随机新位置
        }
    }
}
```

---

## 七、反作弊校验（MVP 级别）

| 校验项 | 实现 | 处理 |
|--------|------|------|
| 移动速度 | 每 tick 检查位移 ≤ maxSpeed × tickDuration × 1.2 | 强制回退位置 |
| 攻击频率 | 检查两次攻击间隔 ≥ minInterval × 0.9 | 忽略该次攻击 |
| 技能冷却 | 服务器维护冷却状态 | 忽略未冷却完的技能请求 |
| 非法坐标 | 检查坐标在地图边界内 | 钳制到边界 |

---

## 八、项目结构

### 8.1 前端 (arthas-client/)

```
arthas-client/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── public/
│   └── favicon.ico
└── src/
    ├── main.tsx                 # React 入口
    ├── App.tsx                  # 主组件：Canvas + UI
    ├── game/
    │   ├── Game.ts             # PixiJS Application + 游戏主循环
    │   ├── constants.ts        # 游戏常量
    │   ├── entities/
    │   │   ├── Player.ts       # 玩家实体渲染
    │   │   ├── Projectile.ts   # 投射物渲染
    │   │   └── Coreshard.ts    # 资源点渲染
    │   └── systems/
    │       ├── InputSystem.ts      # 输入处理
    │       ├── PredictionSystem.ts # 客户端预测
    │       └── InterpolationSystem.ts # 实体插值
    ├── network/
    │   ├── protocol.ts         # 消息类型定义
    │   ├── websocket.ts        # WebSocket 连接管理
    │   └── codec.ts            # MessagePack 编解码
    ├── ui/
    │   ├── HUD.tsx             # 血条 + 技能栏
    │   ├── Scoreboard.tsx      # 计分板
    │   └── DeathScreen.tsx     # 死亡画面
    ├── stores/
    │   ├── gameStore.ts        # 游戏状态
    │   └── uiStore.ts          # UI 状态
    └── styles/
        └── index.css           # Tailwind 入口
```

### 8.2 后端 (arthas-server/)

```
arthas-server/
├── go.mod
├── go.sum
├── cmd/
│   └── server/
│       └── main.go             # 入口：启动 HTTP + WebSocket
├── internal/
│   ├── game/
│   │   ├── game.go            # Game Loop 主循环
│   │   ├── player.go          # 玩家实体 + 逻辑
│   │   ├── projectile.go      # 投射物实体
│   │   ├── coreshard.go       # 资源点逻辑
│   │   ├── combat.go          # 战斗系统
│   │   └── constants.go       # 游戏常量
│   ├── network/
│   │   ├── hub.go             # WebSocket Hub（连接管理）
│   │   ├── client.go          # 单个客户端连接
│   │   └── protocol.go        # 消息协议定义
│   └── config/
│       └── config.go          # 配置
└── Dockerfile                  # HF Spaces 部署用
```

---

## 九、部署架构（MVP）

```
[玩家浏览器] ──HTTPS──→ [Vercel CDN] (前端静态资源)
      │
      └──WSS──→ [Hugging Face Spaces] (Go WebSocket 服务)
                        │
                  [内存游戏状态]  (MVP 不需要数据库)
```

### 部署配置

**前端 (Vercel)**：
- 构建命令：`npm run build`
- 输出目录：`dist/`
- 环境变量：`VITE_WS_URL=wss://xxx.hf.space/ws`

**后端 (HF Spaces)**：
- Docker 容器运行 Go 二进制
- 暴露端口 7860（HF Spaces 默认）
- 健康检查端点：`GET /ping`

---

## 十、开发里程碑

| 里程碑 | 目标 | 验收标准 |
|--------|------|----------|
| M1 | WebSocket 连接 | 打开网页能连上服务器，看到 "Connected" |
| M2 | 角色渲染 | 屏幕上出现一个色块代表自己 |
| M3 | 移动同步 | 两个浏览器窗口能看到对方移动 |
| M4 | 客户端预测 | 移动无延迟感，其他玩家平滑 |
| M5 | 基础攻击 | 能打到对方，血量减少 |
| M6 | 技能系统 | 冲刺 + 火球可用 |
| M7 | 资源点 | 能占领源石碎片得分 |
| M8 | 完整循环 | 5 分钟一局，有胜负判定 |

---

## 相关文档

- [需求文档](../req_draw.md)
- [游戏设计](./game_design.md)
- [路线图](./roadmap.md)
- [地图设计](./map_design.md)
