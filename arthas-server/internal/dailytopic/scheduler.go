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
// Immediately checks if today's room needs creation, then ticks every hour.
func (s *Scheduler) Start() {
	s.tryCreateToday()

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

// generateAESKey generates a random 256-bit key and returns base64url encoding (no padding).
// Output is 43 characters (32 bytes → 43 base64url chars without padding).
func generateAESKey() string {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		panic("dailytopic: crypto/rand failed: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(key)
}
