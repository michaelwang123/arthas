# Design Document — 每日话题房间 (Daily Topic Room)

## Overview

在 Arthas Server 中增加一个内置定时任务（scheduler），每天自动创建一个带话题的公开 Hub 房间。利用现有的 Hub Registry + Room 过期机制，最小化新增代码量。

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| 服务端内置调度器（不用外部 cron） | 保持单二进制零依赖特性，与 Arthas 自托管哲学一致 |
| 话题池用 Go embed JSON | 编译时打包，无需外部配置文件，单二进制即完整 |
| 确定性话题索引（daysSinceEpoch % len） | 无状态，重启不影响，同一天始终同一话题 |
| 固定到 UTC 0:00 过期（非固定 24h） | 全球用户体验一致，每天同一时间切换话题 |
| 服务端生成 AES 密钥 | 没有"创建者客户端"，密钥必须由服务端生成 |
| 每日话题不受 maxRooms 限制 | 系统功能不应被用户行为阻塞 |
| 复用现有 HubRegistry.Register() | 每日话题就是标记了 isDailyTopic 的公开房间 |
| 注入 nowFunc 用于测试 | 时间相关逻辑必须可测试，避免 flaky tests |
| 重启 = 创建新房间 | 所有状态在内存中，这是 Arthas 架构的必然结果 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     arthas-server                             │
│                                                              │
│  ┌──────────────────────────────────┐                       │
│  │  internal/dailytopic/ (NEW)      │                       │
│  │                                  │                       │
│  │  topics.json (go:embed)          │  ← 30+ 话题池        │
│  │  topic.go   — Topic struct       │                       │
│  │  scheduler.go — 调度+创建逻辑    │                       │
│  └──────────┬───────────────────────┘                       │
│             │                                                │
│             │ RoomCreator.CreateDailyTopicRoom()             │
│             ▼                                                │
│  ┌──────────────────┐      ┌────────────────────┐          │
│  │  network/hub.go  │      │  hub/registry.go   │          │
│  │  (CreateRoom)    │─────▶│  (Register)        │          │
│  └──────────────────┘      └────────────────────┘          │
│                                                              │
│  ┌──────────────────┐                                       │
│  │  cmd/server/     │  main.go: 创建并启动 Scheduler       │
│  │  main.go         │  优雅关闭时 scheduler.Stop()          │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

### Integration Points

1. **`cmd/server/main.go`** (~15 lines): 新增 flag、加载话题、创建/启动/停止调度器
2. **`internal/hub/registry.go`** (~5 lines): RoomListing 新增 `IsDailyTopic`，Register 跳过容量检查
3. **`internal/network/hub.go`** (~30 lines): 新增 `CreateDailyTopicRoom()` 方法

---

## Data Models

### Topic (话题配置)

```go
// Topic represents a single daily topic entry from the embedded pool.
type Topic struct {
    Title       string   `json:"title"`       // 话题标题（直接显示在 Hub）
    Description string   `json:"description"` // 话题描述
    Tags        []string `json:"tags"`        // 额外标签（合并 "daily-topic"）
}
```

### topics.json (内嵌话题池 — 中英混合)

```json
[
  {
    "title": "📅 推荐一个你离不开的 CLI 工具",
    "description": "分享你日常开发中最常用的命令行工具，说说为什么喜欢它",
    "tags": ["dev", "tools"]
  },
  {
    "title": "📅 What open source project impressed you recently?",
    "description": "Share a project you discovered recently and what makes it special",
    "tags": ["opensource"]
  },
  {
    "title": "📅 如果只能保留 3 个 App，你选哪些？",
    "description": "手机上只留三个应用，你的选择是什么？说说理由",
    "tags": ["life", "apps"]
  },
  {
    "title": "📅 Share your unpopular tech opinion",
    "description": "What's a tech opinion you hold that most people disagree with?",
    "tags": ["tech", "opinion"]
  }
]
```

### RoomListing Extension (hub/registry.go)

```go
type RoomListing struct {
    // ... 现有字段不变 ...
    IsDailyTopic bool `json:"isDailyTopic,omitempty"` // true = 系统每日话题房间
}
```

### DailyRoomParams (调度器→Hub 的参数传递)

```go
// DailyRoomParams holds parameters for creating a daily topic room.
type DailyRoomParams struct {
    Title       string   // 话题标题
    Description string   // 话题描述
    Tags        []string // 标签列表（含 "daily-topic"）
    KeyEncoded  string   // base64url AES-256 key（服务端生成）
    ExpiresAt   int64    // Unix timestamp（下一个 UTC 0:00）
}
```

---

## Backend Design

### New Package: `internal/dailytopic/`

#### `topic.go` — 数据结构 + 加载逻辑

```go
package dailytopic

import (
    "embed"
    "encoding/json"
    "fmt"
)

//go:embed topics.json
var embeddedTopicsData []byte

// Topic represents a daily topic entry.
type Topic struct {
    Title       string   `json:"title"`
    Description string   `json:"description"`
    Tags        []string `json:"tags"`
}

// LoadTopics loads the topic pool from embedded JSON.
// Returns error if JSON is malformed or pool is empty.
func LoadTopics() ([]Topic, error) {
    var topics []Topic
    if err := json.Unmarshal(embeddedTopicsData, &topics); err != nil {
        return nil, fmt.Errorf("dailytopic: failed to parse topics.json: %w", err)
    }
    if len(topics) == 0 {
        return nil, fmt.Errorf("dailytopic: topics.json is empty")
    }
    return topics, nil
}
```

#### `scheduler.go` — 调度器核心逻辑

```go
package dailytopic

import (
    "crypto/rand"
    "encoding/base64"
    "sync"
    "time"

    "github.com/arthas/arthas-server/internal/logger"
)

// Epoch for deterministic topic index calculation.
// Any fixed date works; using 2026-01-01 for readability.
var topicEpoch = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// RoomCreator is the interface the scheduler uses to create rooms.
// Implemented by network.Hub.
type RoomCreator interface {
    CreateDailyTopicRoom(params DailyRoomParams) (string, error)
}

// DailyRoomParams holds parameters for creating a daily topic room.
type DailyRoomParams struct {
    Title       string
    Description string
    Tags        []string
    KeyEncoded  string // base64url AES-256 key
    ExpiresAt   int64  // Unix timestamp
}

// Scheduler manages the daily topic room lifecycle.
type Scheduler struct {
    topics  []Topic
    creator RoomCreator
    nowFunc func() time.Time // 可注入的时间函数，默认 time.Now

    mu              sync.Mutex
    lastCreatedDate string // "2006-01-02" 格式，幂等控制
    activeRoomID    string // 当前活跃房间 ID
    stopCh          chan struct{}
}

// NewScheduler creates a new DailyTopicScheduler.
// nowFunc 可传 nil，默认使用 time.Now。
func NewScheduler(topics []Topic, creator RoomCreator, nowFunc func() time.Time) *Scheduler {
    if nowFunc == nil {
        nowFunc = time.Now
    }
    return &Scheduler{
        topics:  topics,
        creator: creator,
        nowFunc: nowFunc,
        stopCh:  make(chan struct{}),
    }
}

// Start begins the scheduling loop.
// Immediately checks if today's room needs creation, then ticks every hour.
func (s *Scheduler) Start() {
    // 立即尝试创建今日房间
    s.tryCreateToday()

    // 每小时检查（比精确计算下一个 UTC 0:00 更简单可靠）
    ticker := time.NewTicker(1 * time.Hour)
    go func() {
        for {
            select {
            case <-ticker.C:
                s.tryCreateToday()
            case <-s.stopCh:
                ticker.Stop()
                return
            }
        }
    }()

    logger.Info("DailyTopic", "scheduler started, %d topics loaded", len(s.topics))
}

// Stop stops the scheduler gracefully.
func (s *Scheduler) Stop() {
    close(s.stopCh)
    logger.Info("DailyTopic", "scheduler stopped")
}

// tryCreateToday checks if today's room already exists; if not, creates it.
// This method is idempotent: calling it multiple times on the same UTC day is safe.
func (s *Scheduler) tryCreateToday() {
    s.mu.Lock()
    defer s.mu.Unlock()

    now := s.nowFunc().UTC()
    today := now.Format("2006-01-02")

    // 幂等检查：今天已创建则跳过
    if s.lastCreatedDate == today {
        return
    }

    // 确定性话题选择：基于日期计算索引
    topic := s.topicForDate(now)

    // 生成 AES-256 密钥
    keyEncoded := generateAESKey()

    // 计算过期时间：下一个 UTC 0:00
    tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)

    params := DailyRoomParams{
        Title:       topic.Title,
        Description: topic.Description,
        Tags:        append([]string{"daily-topic"}, topic.Tags...),
        KeyEncoded:  keyEncoded,
        ExpiresAt:   tomorrow.Unix(),
    }

    roomID, err := s.creator.CreateDailyTopicRoom(params)
    if err != nil {
        logger.Error("DailyTopic", "failed to create daily topic room: %v", err)
        return
    }

    s.lastCreatedDate = today
    s.activeRoomID = roomID
    logger.Info("DailyTopic", "created room %s, topic: %q, expires: %s",
        roomID, topic.Title, tomorrow.Format(time.RFC3339))
}

// topicForDate returns the topic for a given date using deterministic indexing.
// Same date always returns same topic, regardless of restarts.
func (s *Scheduler) topicForDate(t time.Time) Topic {
    days := int(t.Sub(topicEpoch).Hours() / 24)
    if days < 0 {
        days = -days
    }
    idx := days % len(s.topics)
    return s.topics[idx]
}

// generateAESKey generates a random 256-bit key and returns base64url encoding.
func generateAESKey() string {
    key := make([]byte, 32)
    if _, err := rand.Read(key); err != nil {
        panic("dailytopic: crypto/rand failed: " + err.Error())
    }
    return base64.RawURLEncoding.EncodeToString(key)
}
```

---

### Hub Integration

#### `internal/hub/registry.go` — 容量豁免

```go
// Register adds a public room listing. Returns ErrHubFull if at capacity.
// Daily topic rooms bypass the capacity limit (system-created, reserved slot).
func (r *HubRegistry) Register(listing *RoomListing) error {
    r.mu.Lock()
    defer r.mu.Unlock()
    // 每日话题不受容量限制
    if !listing.IsDailyTopic && len(r.listings) >= r.maxRooms {
        return ErrHubFull
    }
    listing.ShareCode = fmt.Sprintf("%s:%s:%d:%d",
        listing.RoomID, listing.KeyEncoded, listing.Ephemeral, listing.ExpiresAt)
    r.listings[listing.RoomID] = listing
    return nil
}
```

#### `internal/network/hub.go` — CreateDailyTopicRoom 方法

```go
// CreateDailyTopicRoom creates a room internally (no WebSocket client involved)
// and registers it as a daily topic in the Hub directory.
// Called by the DailyTopic scheduler.
func (h *Hub) CreateDailyTopicRoom(params dailytopic.DailyRoomParams) (string, error) {
    // 1. 生成 NanoID
    roomID := nanoid.Must()

    // 2. 创建房间（无密码、非阅后即焚、指定过期时间）
    expirySeconds := params.ExpiresAt - time.Now().Unix()
    if expirySeconds <= 0 {
        return "", fmt.Errorf("daily topic expiry is in the past")
    }
    _ = h.roomManager.CreateRoom(roomID, "", 0, params.ExpiresAt)

    // 3. 注册到 Hub Registry
    listing := &hub.RoomListing{
        RoomID:       roomID,
        KeyEncoded:   params.KeyEncoded,
        Title:        params.Title,
        Description:  params.Description,
        Tags:         params.Tags,
        MemberCount:  0,
        HasPassword:  false,
        CreatedAt:    time.Now().Unix(),
        ExpiresAt:    params.ExpiresAt,
        Ephemeral:    0,
        IsDailyTopic: true,
    }

    if err := h.hubRegistry.Register(listing); err != nil {
        h.roomManager.RemoveRoom(roomID)
        return "", fmt.Errorf("failed to register daily topic: %w", err)
    }

    return roomID, nil
}
```

#### `cmd/server/main.go` — 启动集成

```go
// --- Daily Topic Scheduler ---
disableDailyTopic := flag.Bool("disable-daily-topic", false,
    "Disable daily topic room feature (default: $DISABLE_DAILY_TOPIC or false)")
// ...

if !*disableDailyTopic && os.Getenv("DISABLE_DAILY_TOPIC") != "true" {
    topics, err := dailytopic.LoadTopics()
    if err != nil {
        logger.Error("Server", "failed to load daily topics: %v", err)
    } else {
        scheduler := dailytopic.NewScheduler(topics, wsHub, nil)
        scheduler.Start()
        defer scheduler.Stop()
    }
}
```

---

## Frontend Design

### TypeScript Type Extension

```typescript
// src/hub/types.ts — 新增可选字段
export interface RoomListing {
  roomId: string;
  shareCode: string;
  title: string;
  description: string;
  tags: string[];
  memberCount: number;
  hasPassword: boolean;
  createdAt: number;
  expiresAt: number;
  isDailyTopic?: boolean; // NEW: true = 系统每日话题房间
}
```

### hubStore.ts — 分离每日话题（含过滤隔离）

```typescript
interface HubState {
  rooms: RoomListing[];           // 普通公开房间（受搜索/过滤影响）
  dailyTopic: RoomListing | null; // 今日话题（不受搜索/过滤影响）
  total: number;
  loading: boolean;
  error: string | null;
  filters: HubFilters;
  
  fetchRooms: () => Promise<void>;
  fetchDailyTopic: () => Promise<void>; // 独立获取，不受 filters 影响
  startPolling: () => void;
  stopPolling: () => void;
  // ...
}
```

**过滤隔离策略：**

每日话题的获取与普通房间列表的获取是**独立的**，确保搜索/标签过滤不会导致每日话题消失：

```typescript
// 初始加载：同时获取 dailyTopic 和 rooms
startPolling: () => {
  get().fetchDailyTopic(); // 独立获取，无 filter
  get().fetchRooms();       // 带 filter
  // 30s 轮询只刷新 rooms（dailyTopic 变化频率极低）
  interval = setInterval(() => get().fetchRooms(), 30000);
}

// 获取每日话题：无 filter，仅提取 isDailyTopic 项
fetchDailyTopic: async () => {
  const response = await fetchHubRooms({}); // 空 filter
  const daily = response.rooms.find(r => r.isDailyTopic);
  set({ dailyTopic: daily ?? null });
}

// 获取普通房间列表：带 filter，排除 isDailyTopic
fetchRooms: async () => {
  const response = await fetchHubRooms(get().filters);
  const others = response.rooms.filter(r => !r.isDailyTopic);
  set({ rooms: others, total: response.total });
}
```

**为什么不合并为一次请求：**
- 如果合并，用户搜索"golang"时 API 不返回不匹配的 daily topic → daily topic 消失
- 分离后，dailyTopic 始终通过无 filter 请求获取，不受用户搜索行为影响
- 额外请求量极低（仅初始化时一次，不参与 30s 轮询）

**优化：dailyTopic 刷新策略：**
- 初始化时获取一次 dailyTopic
- 此后每 5 分钟刷新一次（检测过期/新话题），而非每 30s
- 过期后 (`expiresAt < now`) 前端主动清除并重新获取

### DailyTopicCard 组件

```
┌─────────────────────────────────────────────────────────────┐
│  📅 今日话题 · Daily Topic              ⏱ 剩余 16h 32m     │
│  ─────────────────────────────────────────────────────────  │
│  推荐一个你离不开的 CLI 工具                                │
│  分享你日常开发中最常用的命令行工具，说说为什么喜欢它        │
│                                                              │
│  [daily-topic] [dev] [tools]          👥 12 人正在讨论       │
│  🌐 公开房间                                                │
│                                                              │
│  [加入讨论 →]                                               │
└─────────────────────────────────────────────────────────────┘
```

**样式特征：**
- 渐变边框（amber-400 → orange-500），与普通灰色卡片区分
- 全宽布局（占满一行，不参与网格排列）
- 📅 图标 + "今日话题 · Daily Topic" 标题
- 倒计时每分钟更新（`setInterval(60000)`）
- "🌐 公开房间" 安全标记
- 移动端全宽适配

### Hub Page Layout

```
┌─────────────────────────────────────────────────────┐
│  🌐 Arthas Hub                                       │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  📅 DailyTopicCard（置顶，始终显示）           │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  [Search...]            Tags: [go] [react]           │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ HubRoomCard  │  │ HubRoomCard  │  ← 普通房间    │
│  └──────────────┘  └──────────────┘                 │
│                                                      │
│  [Load more...]                                      │
└─────────────────────────────────────────────────────┘
```

- DailyTopicCard 在搜索/过滤区域**上方**，不受搜索影响
- dailyTopic 通过独立的无 filter 请求获取（不与普通房间列表混合）
- 如果 `dailyTopic === null`（功能被禁用或尚未创建），此区域不渲染
- Join 流程完全复用现有逻辑：提取 shareCode → chatStore.joinRoom()

---

## Observability (可观测性)

| 事件 | 日志级别 | 消息格式 |
|------|----------|----------|
| 调度器启动 | INFO | `"scheduler started, %d topics loaded"` |
| 话题房间创建成功 | INFO | `"created room %s, topic: %q, expires: %s"` |
| 话题房间创建失败 | ERROR | `"failed to create daily topic room: %v"` |
| 话题池加载失败 | ERROR | `"failed to load daily topics: %v"` |
| 调度器停止 | INFO | `"scheduler stopped"` |

---

## Security Considerations

1. **密钥由服务端生成**: 与 Hub 公开房间安全模型一致。公开房间的 share code 包含密钥，任何人都可以加入和解密。服务端生成密钥只是让这个事实更显式。
2. **前端安全标记**: DailyTopicCard 显示"🌐 公开房间"标记，让用户知情。
3. **不影响私有房间安全**: 此功能仅涉及 Hub 公开房间，私有房间安全性不受影响。
4. **代码开源可审计**: 服务端密钥生成逻辑在 `scheduler.go` 中，完全透明。

---

## File Summary

### New Files

| File | Purpose |
|------|---------|
| `internal/dailytopic/topic.go` | Topic struct + JSON 加载 |
| `internal/dailytopic/scheduler.go` | 调度器（创建逻辑 + 幂等 + 定时） |
| `internal/dailytopic/topics.json` | 内嵌话题池（30+ 条，中英混合） |
| `internal/dailytopic/scheduler_test.go` | 调度器单元测试（含时间 mock） |
| `src/components/DailyTopicCard.tsx` | 今日话题卡片组件 |

### Modified Files

| File | Change | Lines |
|------|--------|-------|
| `internal/hub/registry.go` | RoomListing 新增 IsDailyTopic + Register 容量豁免 | ~5 |
| `internal/network/hub.go` | 新增 CreateDailyTopicRoom() 方法 | ~30 |
| `cmd/server/main.go` | 新增 flag + 创建/启动/停止调度器 | ~15 |
| `src/hub/types.ts` | RoomListing 新增 isDailyTopic 字段 | ~1 |
| `src/hub/hubStore.ts` | fetchRooms 分离 dailyTopic + 新 state | ~10 |
| `src/pages/Hub.tsx` | 渲染 DailyTopicCard 组件 | ~10 |

---

## Testing Strategy

### 单元测试 (`scheduler_test.go`)

```go
func TestTopicForDate_Deterministic(t *testing.T) {
    // 同一天多次调用返回同一话题
}

func TestTopicForDate_DifferentDays(t *testing.T) {
    // 不同天返回不同话题（除非 len(topics) 整除）
}

func TestTryCreateToday_Idempotent(t *testing.T) {
    // 同一天多次 tryCreateToday 只调用 creator 一次
    mockCreator := &MockRoomCreator{}
    s := NewScheduler(topics, mockCreator, func() time.Time {
        return time.Date(2026, 6, 10, 15, 0, 0, 0, time.UTC)
    })
    s.tryCreateToday()
    s.tryCreateToday()
    assert.Equal(t, 1, mockCreator.CallCount)
}

func TestTryCreateToday_NewDayCreatesNew(t *testing.T) {
    // 模拟日期变化 → 创建新房间
}

func TestGenerateAESKey_Format(t *testing.T) {
    // 验证输出是 43 字符 base64url（32 bytes → 43 chars without padding）
}
```

### 前端测试

- DailyTopicCard 渲染：标题、描述、倒计时、标签
- hubStore：isDailyTopic 分离逻辑
- Hub.tsx：dailyTopic 存在时渲染卡片，null 时不渲染
