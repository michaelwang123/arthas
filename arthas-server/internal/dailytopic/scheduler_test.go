package dailytopic

import (
	"errors"
	"sync"
	"testing"
	"time"
)

// mockRoomCreator tracks call count and can be configured to return errors.
type mockRoomCreator struct {
	mu          sync.Mutex
	callCount   int
	lastParam   DailyRoomParams
	errToReturn error
}

func (m *mockRoomCreator) CreateDailyTopicRoom(params DailyRoomParams) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.callCount++
	m.lastParam = params
	if m.errToReturn != nil {
		return "", m.errToReturn
	}
	return "room-" + params.Title, nil
}

func (m *mockRoomCreator) getCallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.callCount
}

// testTopics returns a small deterministic topic pool for testing.
func testTopics() []Topic {
	return []Topic{
		{Title: "Topic A", Description: "Desc A", Tags: []string{"tag-a"}},
		{Title: "Topic B", Description: "Desc B", Tags: []string{"tag-b"}},
		{Title: "Topic C", Description: "Desc C", Tags: []string{"tag-c"}},
		{Title: "Topic D", Description: "Desc D", Tags: []string{"tag-d"}},
		{Title: "Topic E", Description: "Desc E", Tags: []string{"tag-e"}},
	}
}

// --- topicForDate tests ---

func TestTopicForDate_Deterministic(t *testing.T) {
	topics := testTopics()
	creator := &mockRoomCreator{}
	s := NewScheduler(topics, creator, nil)

	date := time.Date(2026, 6, 15, 10, 30, 0, 0, time.UTC)

	// Same date called multiple times must return same topic.
	first := s.topicForDate(date)
	for i := 0; i < 10; i++ {
		got := s.topicForDate(date)
		if got.Title != first.Title {
			t.Errorf("call %d: expected %q, got %q", i, first.Title, got.Title)
		}
	}
}

func TestTopicForDate_DifferentDays(t *testing.T) {
	topics := testTopics()
	creator := &mockRoomCreator{}
	s := NewScheduler(topics, creator, nil)

	day1 := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	day2 := time.Date(2026, 6, 16, 12, 0, 0, 0, time.UTC)

	topic1 := s.topicForDate(day1)
	topic2 := s.topicForDate(day2)

	if topic1.Title == topic2.Title {
		t.Errorf("adjacent days should return different topics, both got %q", topic1.Title)
	}
}

func TestTopicForDate_Cycles(t *testing.T) {
	topics := testTopics()
	creator := &mockRoomCreator{}
	s := NewScheduler(topics, creator, nil)

	baseDate := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)

	// dayN should equal dayN+len(topics)
	for dayOffset := 0; dayOffset < 10; dayOffset++ {
		d := baseDate.AddDate(0, 0, dayOffset)
		dCycle := baseDate.AddDate(0, 0, dayOffset+len(topics))

		topicD := s.topicForDate(d)
		topicCycle := s.topicForDate(dCycle)

		if topicD.Title != topicCycle.Title {
			t.Errorf("day %d and day %d+len should have same topic: got %q vs %q",
				dayOffset, dayOffset, topicD.Title, topicCycle.Title)
		}
	}
}

// --- tryCreateToday tests ---

func TestTryCreateToday_Idempotent(t *testing.T) {
	topics := testTopics()
	creator := &mockRoomCreator{}

	fixedTime := time.Date(2026, 6, 10, 15, 0, 0, 0, time.UTC)
	s := NewScheduler(topics, creator, func() time.Time {
		return fixedTime
	})

	// Call tryCreateToday twice with the same date.
	s.tryCreateToday()
	s.tryCreateToday()

	if creator.getCallCount() != 1 {
		t.Errorf("expected creator called once (idempotent), got %d", creator.getCallCount())
	}
}

func TestTryCreateToday_NewDay(t *testing.T) {
	topics := testTopics()
	creator := &mockRoomCreator{}

	var mu sync.Mutex
	currentTime := time.Date(2026, 6, 10, 15, 0, 0, 0, time.UTC)

	s := NewScheduler(topics, creator, func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return currentTime
	})

	// Day 1 creation.
	s.tryCreateToday()
	if creator.getCallCount() != 1 {
		t.Fatalf("expected 1 call after day 1, got %d", creator.getCallCount())
	}

	// Advance to next day.
	mu.Lock()
	currentTime = time.Date(2026, 6, 11, 8, 0, 0, 0, time.UTC)
	mu.Unlock()

	// Day 2 creation.
	s.tryCreateToday()
	if creator.getCallCount() != 2 {
		t.Errorf("expected 2 calls after day change, got %d", creator.getCallCount())
	}
}

func TestTryCreateToday_CreatorError(t *testing.T) {
	topics := testTopics()
	creator := &mockRoomCreator{
		errToReturn: errors.New("simulated creation failure"),
	}

	fixedTime := time.Date(2026, 6, 10, 15, 0, 0, 0, time.UTC)
	s := NewScheduler(topics, creator, func() time.Time {
		return fixedTime
	})

	// Should not panic.
	s.tryCreateToday()

	if creator.getCallCount() != 1 {
		t.Errorf("expected creator called once, got %d", creator.getCallCount())
	}

	// lastCreatedDate should NOT be updated on error.
	s.mu.Lock()
	lastDate := s.lastCreatedDate
	s.mu.Unlock()

	if lastDate != "" {
		t.Errorf("lastCreatedDate should be empty after error, got %q", lastDate)
	}

	// Calling again should retry (not skip due to idempotent check).
	s.tryCreateToday()
	if creator.getCallCount() != 2 {
		t.Errorf("expected creator called again on retry, got %d", creator.getCallCount())
	}
}

// --- generateAESKey tests ---

func TestGenerateAESKey_Length(t *testing.T) {
	key := generateAESKey()
	// 32 bytes base64url without padding = 43 characters.
	if len(key) != 43 {
		t.Errorf("expected key length 43, got %d (key: %q)", len(key), key)
	}
}

func TestGenerateAESKey_Unique(t *testing.T) {
	key1 := generateAESKey()
	key2 := generateAESKey()

	if key1 == key2 {
		t.Errorf("two generated keys should be different, both are %q", key1)
	}
}
