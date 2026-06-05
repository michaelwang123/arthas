package dailytopic

import (
	"crypto/rand"
	"encoding/base64"
	"sync"
	"time"

	"github.com/arthas/arthas-server/internal/logger"
)

// topicEpoch is the fixed reference date for deterministic topic index calculation.
// Any fixed date works; using 2026-01-01 for readability.
var topicEpoch = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// retryInterval is the shorter interval used when room creation fails.
// This ensures the daily topic appears quickly after transient failures,
// rather than waiting the full hourly tick.
const retryInterval = 5 * time.Minute

// normalInterval is the standard check interval for daily topic creation.
const normalInterval = 1 * time.Hour

// RoomCreator is the interface the scheduler uses to create rooms.
// Implemented by network.Hub.
type RoomCreator interface {
	CreateDailyTopicRoom(params DailyRoomParams) (string, error)
}

// DailyRoomParams holds parameters for creating a daily topic room.
type DailyRoomParams struct {
	Title       string   // 话题标题
	Description string   // 话题描述
	Tags        []string // 标签列表（含 "daily-topic"）
	KeyEncoded  string   // base64url AES-256 key（服务端生成）
	ExpiresAt   int64    // Unix timestamp（下一个 UTC 0:00）
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
	stopOnce        sync.Once // 防止重复关闭 stopCh 导致 panic
	running         bool      // 防止重复 Start 导致 goroutine 泄漏
}

// NewScheduler creates a new daily topic Scheduler.
// nowFunc can be nil, in which case time.Now is used.
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
// Immediately checks if today's room needs creation, then ticks periodically.
// Safe to call only once; subsequent calls are no-ops.
func (s *Scheduler) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.mu.Unlock()

	logger.Info("DailyTopic", "scheduler started, %d topics loaded", len(s.topics))

	// 立即尝试创建今日房间
	created := s.tryCreateToday()

	// 根据首次创建结果决定初始检查间隔：
	// 成功 → 1 小时后再检查；失败 → 5 分钟后重试
	initialInterval := normalInterval
	if !created {
		initialInterval = retryInterval
	}

	go func() {
		ticker := time.NewTicker(initialInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				if s.tryCreateToday() {
					// 创建成功或已存在，切换到正常间隔
					ticker.Reset(normalInterval)
				} else {
					// 创建失败，使用短间隔重试
					ticker.Reset(retryInterval)
				}
			case <-s.stopCh:
				return
			}
		}
	}()
}

// Stop stops the scheduler gracefully.
// Safe to call multiple times; only the first call has effect.
func (s *Scheduler) Stop() {
	s.stopOnce.Do(func() {
		close(s.stopCh)
		logger.Info("DailyTopic", "scheduler stopped")
	})
}

// tryCreateToday checks if today's room already exists; if not, creates it.
// Returns true if today's room exists (already created or just created successfully).
// Returns false if creation was attempted but failed (caller should retry).
func (s *Scheduler) tryCreateToday() bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.nowFunc().UTC()
	today := now.Format("2006-01-02")

	// 幂等检查：今天已创建则跳过
	if s.lastCreatedDate == today {
		return true
	}

	// 确定性话题选择
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
		return false
	}

	s.lastCreatedDate = today
	s.activeRoomID = roomID
	logger.Info("DailyTopic", "created room %s, topic: %q, expires: %s",
		roomID, topic.Title, tomorrow.Format(time.RFC3339))
	return true
}

// topicForDate returns the topic for a given date using deterministic indexing.
// Same date always returns same topic, regardless of restarts.
// Uses integer day arithmetic (truncated to midnight) to avoid floating point precision issues.
func (s *Scheduler) topicForDate(t time.Time) Topic {
	// 截断到 UTC 午夜，避免浮点除法精度问题
	d := t.UTC().Truncate(24 * time.Hour)
	e := topicEpoch.Truncate(24 * time.Hour)
	days := int(d.Sub(e) / (24 * time.Hour))
	if days < 0 {
		days = -days
	}
	idx := days % len(s.topics)
	return s.topics[idx]
}

// generateAESKey generates a random 256-bit key and returns base64url encoding (no padding).
// Output is 43 characters (32 bytes → 43 base64url chars without padding).
// Panics if crypto/rand fails, which indicates a catastrophic system failure.
func generateAESKey() string {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		panic("dailytopic: crypto/rand failed: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(key)
}
