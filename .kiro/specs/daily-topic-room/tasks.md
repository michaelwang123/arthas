# Tasks — 每日话题房间 (Daily Topic Room)

## Task 1: 话题池数据结构 + 内嵌 JSON

- [x] 创建 `internal/dailytopic/topic.go`
  - Topic 结构体定义（Title, Description, Tags）
  - `//go:embed topics.json` 嵌入话题池（使用 `[]byte` 变量）
  - `LoadTopics() ([]Topic, error)`：解析 JSON 返回话题切片
  - 错误处理：JSON 格式错误返回 wrapped error，空池返回错误
- [x] 创建 `internal/dailytopic/topics.json`
  - 30+ 条预设话题（中英混合，约各占一半）
  - 每条包含 title（含 📅 前缀）, description, tags
  - 话题分类覆盖：tech, life, opensource, career, fun, tools, opinion
  - 示例话题类型：推荐工具、分享经验、观点讨论、创意问题
- [x] 单元测试 `internal/dailytopic/topic_test.go`
  - 验证 LoadTopics 正确解析所有话题
  - 验证每条话题 title 非空、tags 非空
  - 验证话题数量 >= 30

**验收标准：** `LoadTopics()` 返回 30+ 条话题，每条有非空 title 和至少一个 tag，无 panic

---

## Task 2: 调度器核心逻辑

- [x] 创建 `internal/dailytopic/scheduler.go`
  - `topicEpoch` 常量：`time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)`
  - `RoomCreator` 接口：`CreateDailyTopicRoom(DailyRoomParams) (string, error)`
  - `DailyRoomParams` 结构体：Title, Description, Tags, KeyEncoded, ExpiresAt
  - `Scheduler` 结构体字段：topics, creator, nowFunc, lastCreatedDate, activeRoomID, stopCh, mu
  - `NewScheduler(topics, creator, nowFunc)` 构造函数（nowFunc 为 nil 时默认 time.Now）
  - `Start()`：立即 tryCreateToday + 启动 1h ticker goroutine
  - `Stop()`：close(stopCh)，停止 ticker
  - `tryCreateToday()`：
    - 获取 UTC 日期字符串
    - 幂等检查（lastCreatedDate == today → return）
    - 调用 `topicForDate(now)` 获取话题
    - `generateAESKey()`：crypto/rand 32 bytes → base64.RawURLEncoding
    - 计算过期时间：`time.Date(year, month, day+1, 0, 0, 0, 0, UTC).Unix()`
    - 调用 `creator.CreateDailyTopicRoom(params)`
    - 成功后更新 lastCreatedDate + activeRoomID
    - 失败时 logger.Error，不 panic
  - `topicForDate(t time.Time) Topic`：
    - `days := int(t.Sub(topicEpoch).Hours() / 24)`
    - `idx := days % len(s.topics)`
    - 返回 `s.topics[idx]`
  - `generateAESKey() string`：32 bytes rand → base64url（43 chars）
- [x] 创建 `internal/dailytopic/scheduler_test.go`
  - `TestTopicForDate_Deterministic`：同一天多次调用返回相同话题
  - `TestTopicForDate_DifferentDays`：相邻天返回不同话题
  - `TestTopicForDate_Cycles`：验证循环（dayN == dayN+len）
  - `TestTryCreateToday_Idempotent`：mock nowFunc 固定日期，调用两次，creator 只被调一次
  - `TestTryCreateToday_NewDay`：mock 日期变化，验证创建新房间
  - `TestTryCreateToday_CreatorError`：creator 返回 error，scheduler 不崩溃，lastCreatedDate 不更新
  - `TestGenerateAESKey_Length`：验证输出长度 43（32 bytes base64url without padding）
  - `TestGenerateAESKey_Unique`：两次调用返回不同值

**验收标准：** 调度器幂等、确定性选题、密钥格式正确、错误不传播，所有测试通过

---

## Task 3: Hub 后端集成

- [x] `internal/hub/registry.go`:
  - RoomListing 新增 `IsDailyTopic bool` 字段（json tag: `"isDailyTopic,omitempty"`）
  - Register() 方法修改：如果 `listing.IsDailyTopic == true`，跳过 maxRooms 检查
- [x] `internal/network/hub.go`:
  - 新增 `CreateDailyTopicRoom(params dailytopic.DailyRoomParams) (string, error)` 方法
  - 方法内部：生成 NanoID → CreateRoom → 构建 RoomListing → Register
  - 确保 Hub struct 满足 `dailytopic.RoomCreator` 接口（编译时验证：`var _ dailytopic.RoomCreator = (*Hub)(nil)`）
- [x] `cmd/server/main.go`:
  - 新增 `--disable-daily-topic` flag（bool，默认 false）
  - 环境变量 `DISABLE_DAILY_TOPIC=true` 同等效果
  - 条件启动：非 disabled 时 LoadTopics → NewScheduler → Start
  - defer scheduler.Stop()（在 graceful shutdown 之前）
  - LoadTopics 失败时 logger.Error 但不阻止服务器启动
- [-] 集成验证：
  - 启动服务器 → `curl /api/hub` → 验证返回包含 `isDailyTopic: true` 的条目
  - 验证 shareCode 格式正确（4 段）
  - 验证 expiresAt 是下一个 UTC 0:00 的时间戳

**验收标准：** 服务器启动后 Hub API 返回 isDailyTopic 房间；`--disable-daily-topic` 时不创建；shareCode 可被客户端正常解析

---

## Task 4: 前端展示 — DailyTopicCard 组件

- [~] `src/hub/types.ts`: RoomListing 接口新增 `isDailyTopic?: boolean`
- [~] 创建 `src/components/DailyTopicCard.tsx`
  - Props: `{ room: RoomListing; onJoin: (shareCode: string) => void }`
  - 渲染内容：
    - 📅 图标 + "今日话题 · Daily Topic" 双语标题
    - 话题标题（room.title）
    - 话题描述（room.description）
    - 标签列表（room.tags as badges）
    - 参与人数（👥 {room.memberCount} 人正在讨论）
    - 剩余时间倒计时（基于 room.expiresAt，每 60s 更新）
    - "🌐 公开房间" 安全标记
    - "加入讨论 →" 按钮
  - 样式：
    - 渐变边框（amber → orange）
    - 全宽布局（w-full，不参与网格）
    - 背景微渐变（dark: amber-900/10）
    - 移动端适配（padding 调整）
  - 倒计时逻辑：
    - `useEffect` + `setInterval(60000)` 每分钟更新
    - 格式化：>1h 显示 "Xh Ym"，<1h 显示 "Xm"
    - ≤ 0 显示 "即将刷新"
  - 无障碍：
    - aria-label on 卡片容器
    - button role on 加入按钮
    - 倒计时 aria-live="polite"
- [~] i18n keys（如项目已有 i18n 系统）：
  - `hub.dailyTopic.title`: "今日话题 · Daily Topic"
  - `hub.dailyTopic.join`: "加入讨论" / "Join Discussion"
  - `hub.dailyTopic.publicRoom`: "公开房间" / "Public Room"
  - `hub.dailyTopic.discussing`: "人正在讨论" / "people discussing"
  - `hub.dailyTopic.refreshingSoon`: "即将刷新" / "Refreshing soon"

**验收标准：** DailyTopicCard 渲染正确，倒计时更新，点击触发 onJoin，样式与普通卡片有明显区分

---

## Task 5: Hub 页面集成

- [~] `src/hub/hubStore.ts`:
  - 新增 state: `dailyTopic: RoomListing | null`
  - 新增 action: `fetchDailyTopic()`：无 filter 请求 API，提取 isDailyTopic 项
  - 修改 `fetchRooms()`：带 filter 请求 API，结果中排除 isDailyTopic
  - 过滤隔离：dailyTopic 和 rooms 通过**独立请求**获取，搜索/标签不影响 dailyTopic
  - `startPolling()`：初始化时调用 fetchDailyTopic() + fetchRooms()；30s 轮询只刷新 rooms
  - dailyTopic 刷新策略：每 5 分钟检查一次（检测过期/新话题），非 30s 频率
  - 过期检测：`expiresAt < Date.now()/1000` 时清除 dailyTopic 并重新获取
- [~] `src/pages/Hub.tsx`:
  - 在 HubFilters 组件**上方**条件渲染 DailyTopicCard
  - `{dailyTopic && <DailyTopicCard room={dailyTopic} onJoin={handleJoin} />}`
  - onJoin 复用现有 join 流程：`chatStore.joinRoom(shareCode)`
  - dailyTopic 为 null 时不渲染该区域（无空白）
- [ ] 验证：
  - Hub 页面正确展示置顶的今日话题卡片
  - 搜索/标签过滤不影响 dailyTopic 显示（独立请求验证）
  - 用户输入搜索词 → 普通房间列表更新 → dailyTopic 保持不变
  - 点击 "加入讨论" → 成功进入房间 → 可正常发送/接收消息
  - 功能禁用时（无 isDailyTopic 房间）：页面正常渲染，无错误
  - dailyTopic 过期后：卡片消失，5 分钟内自动获取新话题（如有）

**验收标准：** Hub 首页置顶显示今日话题，搜索/过滤时保持可见，点击可正常加入房间聊天

---

## Task 6: 端到端验证 + 文档更新

- [~] 端到端测试场景：
  - 场景1：冷启动 → Hub 出现每日话题 → 前端显示正确
  - 场景2：点击加入 → 成功进入房间 → 收发消息正常（E2EE）
  - 场景3：重启服务器 → 新的每日话题房间创建（旧的已丢失）
  - 场景4：`--disable-daily-topic` → Hub 无每日话题
  - 场景5：验证话题每天切换（调整系统时间或修改 nowFunc 测试）
- [~] 验证前端兼容性：
  - isDailyTopic 字段 omitempty：旧客户端不受影响
  - 不支持 isDailyTopic 的前端仍能看到房间（作为普通公开房间）
- [~] 文档更新：
  - `docs/roadmap.md`：每日话题状态标记为 ✅
  - `docs/arthas-hub-roadmap.md`：每日话题状态更新
  - `official_doc/configuration.md`：新增 `--disable-daily-topic` 说明
- [~] 代码清理：
  - 确认无 TODO/FIXME 遗留
  - 确认日志级别合理（无多余 debug 日志在 production）

**验收标准：** 所有场景跑通，文档同步更新，代码干净无遗留
