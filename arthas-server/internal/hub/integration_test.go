package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/arthas/arthas-server/internal/activity"
)

// TestHubIntegration_PublicRoomLifecycle tests the full lifecycle:
// create public room → member joins → member count updates → all leave → unregistered
func TestHubIntegration_PublicRoomLifecycle(t *testing.T) {
	reg := NewHubRegistry(200)

	// 1. Create a public room (simulates handleCreateRoom)
	listing := &RoomListing{
		RoomID:      "test-room-1",
		KeyEncoded:  "base64urlKey123",
		Title:       "Integration Test Room",
		Description: "Testing hub lifecycle",
		Tags:        []string{"test", "integration"},
		MemberCount: 1, // Creator joins automatically
		HasPassword: false,
		CreatedAt:   1700000000,
		ExpiresAt:   0,
		Ephemeral:   0,
	}

	err := reg.Register(listing)
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}

	// Verify it appears in listing
	result := reg.List(ListOptions{}, nil)
	if result.Total != 1 {
		t.Fatalf("expected 1 room in listing, got %d", result.Total)
	}
	if result.Rooms[0].MemberCount != 1 {
		t.Fatalf("expected memberCount=1, got %d", result.Rooms[0].MemberCount)
	}

	// Verify share code was constructed
	expectedShareCode := "test-room-1:base64urlKey123:0:0"
	if result.Rooms[0].ShareCode != expectedShareCode {
		t.Fatalf("expected shareCode %q, got %q", expectedShareCode, result.Rooms[0].ShareCode)
	}

	// 2. Another member joins (simulates handleJoinRoom → UpdateMemberCount)
	reg.UpdateMemberCount("test-room-1", 2)

	result = reg.List(ListOptions{}, nil)
	if result.Rooms[0].MemberCount != 2 {
		t.Fatalf("expected memberCount=2 after join, got %d", result.Rooms[0].MemberCount)
	}

	// 3. Third member joins
	reg.UpdateMemberCount("test-room-1", 3)

	result = reg.List(ListOptions{}, nil)
	if result.Rooms[0].MemberCount != 3 {
		t.Fatalf("expected memberCount=3, got %d", result.Rooms[0].MemberCount)
	}

	// 4. One member leaves (simulates handleLeaveRoom → UpdateMemberCount)
	reg.UpdateMemberCount("test-room-1", 2)

	result = reg.List(ListOptions{}, nil)
	if result.Rooms[0].MemberCount != 2 {
		t.Fatalf("expected memberCount=2 after leave, got %d", result.Rooms[0].MemberCount)
	}

	// 5. Last members leave → room destroyed → Unregister
	reg.UpdateMemberCount("test-room-1", 1)
	reg.Unregister("test-room-1")

	result = reg.List(ListOptions{}, nil)
	if result.Total != 0 {
		t.Fatalf("expected 0 rooms after unregister, got %d", result.Total)
	}
	if reg.Count() != 0 {
		t.Fatalf("expected count=0, got %d", reg.Count())
	}
}

// TestHubIntegration_ExpiredRoomUnregistered tests that expired rooms get removed
func TestHubIntegration_ExpiredRoomUnregistered(t *testing.T) {
	reg := NewHubRegistry(200)

	listing := &RoomListing{
		RoomID:      "expiring-room",
		KeyEncoded:  "key123",
		Title:       "Expiring Room",
		MemberCount: 3,
		CreatedAt:   1700000000,
		ExpiresAt:   1700003600, // will expire
		Ephemeral:   1,
	}

	reg.Register(listing)

	if reg.Count() != 1 {
		t.Fatalf("expected 1 room, got %d", reg.Count())
	}

	// Simulate cleanupExpiredRooms calling Unregister
	reg.Unregister("expiring-room")

	if reg.Count() != 0 {
		t.Fatalf("expected 0 rooms after expiry cleanup, got %d", reg.Count())
	}
}

// TestHubIntegration_PasswordProtectedPublicRoom tests password-protected rooms in Hub
func TestHubIntegration_PasswordProtectedPublicRoom(t *testing.T) {
	reg := NewHubRegistry(200)

	listing := &RoomListing{
		RoomID:      "password-room",
		KeyEncoded:  "key456",
		Title:       "Secret Club",
		Description: "Password required",
		Tags:        []string{"private"},
		MemberCount: 1,
		HasPassword: true,
		CreatedAt:   1700000000,
		ExpiresAt:   0,
	}

	reg.Register(listing)

	result := reg.List(ListOptions{}, nil)
	if !result.Rooms[0].HasPassword {
		t.Fatal("expected HasPassword=true")
	}
	if result.Rooms[0].Title != "Secret Club" {
		t.Fatalf("expected title 'Secret Club', got %q", result.Rooms[0].Title)
	}
}

// TestHubIntegration_DailyTopicRoomFlow tests the complete data flow:
// scheduler → CreateDailyTopicRoom → RoomListing{IsDailyTopic: true} → Register → Hub API
// This verifies the integration contract without starting a live server.
func TestHubIntegration_DailyTopicRoomFlow(t *testing.T) {
	reg := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)
	handler := NewHubHandler(HubHandlerConfig{
		Registry:       reg,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: nil,
		OnlineCountFn:  nil,
	})

	// Simulate what CreateDailyTopicRoom does: register a daily topic listing
	now := time.Now().UTC()
	tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	expiresAt := tomorrow.Unix()

	listing := &RoomListing{
		RoomID:       "daily-room-abc123",
		KeyEncoded:   "dGVzdC1rZXktYmFzZTY0dXJsLWVuY29kZWQtMzJieXRl",
		Title:        "📅 推荐一个你离不开的 CLI 工具",
		Description:  "分享你日常开发中最常用的命令行工具",
		Tags:         []string{"daily-topic", "dev", "tools"},
		MemberCount:  0,
		HasPassword:  false,
		CreatedAt:    now.Unix(),
		ExpiresAt:    expiresAt,
		Ephemeral:    0,
		IsDailyTopic: true,
	}

	err := reg.Register(listing)
	if err != nil {
		t.Fatalf("Register daily topic failed: %v", err)
	}

	// Query the Hub API and verify the response
	req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result ListResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if result.Total != 1 {
		t.Fatalf("expected 1 room, got %d", result.Total)
	}

	room := result.Rooms[0]

	// Verify isDailyTopic is true
	if !room.IsDailyTopic {
		t.Error("expected isDailyTopic=true in API response")
	}

	// Verify shareCode format: 4 segments separated by ':'
	// Format: roomId:keyEncoded:ephemeral:expiresAt
	segments := strings.Split(room.ShareCode, ":")
	if len(segments) != 4 {
		t.Errorf("expected shareCode with 4 segments, got %d segments: %q", len(segments), room.ShareCode)
	} else {
		if segments[0] != "daily-room-abc123" {
			t.Errorf("shareCode segment[0] (roomId) = %q, want %q", segments[0], "daily-room-abc123")
		}
		if segments[1] != "dGVzdC1rZXktYmFzZTY0dXJsLWVuY29kZWQtMzJieXRl" {
			t.Errorf("shareCode segment[1] (key) = %q, want key", segments[1])
		}
		if segments[2] != "0" {
			t.Errorf("shareCode segment[2] (ephemeral) = %q, want \"0\"", segments[2])
		}
		// segment[3] is expiresAt (unix timestamp as string)
		if segments[3] == "0" || segments[3] == "" {
			t.Errorf("shareCode segment[3] (expiresAt) should be non-zero, got %q", segments[3])
		}
	}

	// Verify expiresAt is the next UTC 0:00 (midnight)
	if room.ExpiresAt != expiresAt {
		t.Errorf("expected expiresAt=%d, got %d", expiresAt, room.ExpiresAt)
	}
	// Verify the expiresAt timestamp represents midnight UTC
	expiresTime := time.Unix(room.ExpiresAt, 0).UTC()
	if expiresTime.Hour() != 0 || expiresTime.Minute() != 0 || expiresTime.Second() != 0 {
		t.Errorf("expiresAt should be midnight UTC, got %s", expiresTime.Format(time.RFC3339))
	}
	// Verify it's tomorrow (not today or some past date)
	if !expiresTime.After(now) {
		t.Errorf("expiresAt should be in the future, got %s (now: %s)",
			expiresTime.Format(time.RFC3339), now.Format(time.RFC3339))
	}
}

// TestHubIntegration_DailyTopicBypassesCapacity verifies daily topic rooms
// are not blocked by the maxRooms capacity limit.
func TestHubIntegration_DailyTopicBypassesCapacity(t *testing.T) {
	// Create a registry with capacity 1
	reg := NewHubRegistry(1)

	// Fill capacity with a regular room
	err := reg.Register(&RoomListing{
		RoomID:     "regular-room",
		KeyEncoded: "key1",
		Title:      "Regular Room",
		CreatedAt:  1700000000,
	})
	if err != nil {
		t.Fatalf("first register failed: %v", err)
	}

	// A second regular room should fail
	err = reg.Register(&RoomListing{
		RoomID:     "regular-room-2",
		KeyEncoded: "key2",
		Title:      "Regular Room 2",
		CreatedAt:  1700000001,
	})
	if err != ErrHubFull {
		t.Fatalf("expected ErrHubFull for second regular room, got %v", err)
	}

	// Daily topic room should bypass the limit
	err = reg.Register(&RoomListing{
		RoomID:       "daily-topic-room",
		KeyEncoded:   "keyDaily",
		Title:        "📅 Daily Topic",
		Tags:         []string{"daily-topic"},
		CreatedAt:    1700000002,
		ExpiresAt:    1700086400,
		IsDailyTopic: true,
	})
	if err != nil {
		t.Fatalf("daily topic should bypass capacity, got error: %v", err)
	}

	if reg.Count() != 2 {
		t.Errorf("expected 2 rooms (1 regular + 1 daily topic), got %d", reg.Count())
	}
}

// TestHubIntegration_DailyTopicJSON verifies the JSON serialization of isDailyTopic field.
// When isDailyTopic is false/unset, the field should be omitted from JSON (omitempty).
func TestHubIntegration_DailyTopicJSON(t *testing.T) {
	reg := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)
	handler := NewHubHandler(HubHandlerConfig{
		Registry:       reg,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: nil,
		OnlineCountFn:  nil,
	})

	// Register a regular room (IsDailyTopic = false)
	reg.Register(&RoomListing{
		RoomID:     "regular-room",
		KeyEncoded: "key1",
		Title:      "Regular Room",
		CreatedAt:  1700000000,
	})

	// Register a daily topic room (IsDailyTopic = true)
	reg.Register(&RoomListing{
		RoomID:       "daily-room",
		KeyEncoded:   "key2",
		Title:        "📅 Daily Topic",
		Tags:         []string{"daily-topic"},
		CreatedAt:    1700000001,
		ExpiresAt:    1700086400,
		IsDailyTopic: true,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	body := w.Body.String()

	// The daily topic room should have "isDailyTopic":true in JSON
	if !strings.Contains(body, `"isDailyTopic":true`) {
		t.Errorf("expected JSON to contain \"isDailyTopic\":true, body: %s", body)
	}

	// The regular room should NOT have isDailyTopic in JSON (omitempty).
	// Verify at raw JSON level: extract each room's JSON object and confirm omission.
	var result ListResult
	json.Unmarshal([]byte(body), &result)

	for _, room := range result.Rooms {
		if room.RoomID == "regular-room" && room.IsDailyTopic {
			t.Error("regular room should not have isDailyTopic=true")
		}
		if room.RoomID == "daily-room" && !room.IsDailyTopic {
			t.Error("daily room should have isDailyTopic=true")
		}
	}

	// Verify raw JSON omission: marshal a regular RoomListing and confirm no isDailyTopic key
	regularListing := &RoomListing{
		RoomID:    "test-regular",
		Title:     "Test",
		CreatedAt: 1700000000,
	}
	rawJSON, _ := json.Marshal(regularListing)
	rawStr := string(rawJSON)
	if strings.Contains(rawStr, "isDailyTopic") {
		t.Errorf("regular room JSON should NOT contain isDailyTopic key, got: %s", rawStr)
	}

	// Confirm daily topic room DOES include the field
	dailyListing := &RoomListing{
		RoomID:       "test-daily",
		Title:        "Daily",
		IsDailyTopic: true,
	}
	dailyJSON, _ := json.Marshal(dailyListing)
	dailyStr := string(dailyJSON)
	if !strings.Contains(dailyStr, `"isDailyTopic":true`) {
		t.Errorf("daily topic room JSON should contain isDailyTopic:true, got: %s", dailyStr)
	}
}

// TestIntegration_ActivitySortFlow tests the full activity flow:
// create public rooms → send messages (increment activity) → query API with sort=active → verify ordering.
// Validates: Requirements 1.1, 2.3
func TestIntegration_ActivitySortFlow(t *testing.T) {
	// Create a real activity tracker with a short window for testing
	tracker := activity.New(5*time.Minute, 10000)

	// Create registry and register 3 rooms
	reg := NewHubRegistry(200)
	reg.Register(&RoomListing{
		RoomID:      "room-low",
		KeyEncoded:  "key1",
		Title:       "Low Activity Room",
		MemberCount: 2,
		CreatedAt:   1700000000,
	})
	reg.Register(&RoomListing{
		RoomID:      "room-high",
		KeyEncoded:  "key2",
		Title:       "High Activity Room",
		MemberCount: 3,
		CreatedAt:   1700000001,
	})
	reg.Register(&RoomListing{
		RoomID:      "room-mid",
		KeyEncoded:  "key3",
		Title:       "Mid Activity Room",
		MemberCount: 1,
		CreatedAt:   1700000002,
	})

	// Simulate message activity: high=10, mid=5, low=1
	for i := 0; i < 10; i++ {
		tracker.Increment("room-high")
	}
	for i := 0; i < 5; i++ {
		tracker.Increment("room-mid")
	}
	tracker.Increment("room-low")

	// Set up handler with real tracker
	rateLimiter := NewRateLimiter(30, time.Minute)
	handler := NewHubHandler(HubHandlerConfig{
		Registry:       reg,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: tracker,
		OnlineCountFn:  nil,
	})

	// Query with sort=active
	req := httptest.NewRequest(http.MethodGet, "/api/hub?sort=active", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result ListResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if result.Total != 3 {
		t.Fatalf("expected 3 rooms, got %d", result.Total)
	}

	// Verify ordering: room-high (10) > room-mid (5) > room-low (1)
	if result.Rooms[0].RoomID != "room-high" {
		t.Errorf("expected first room to be room-high, got %s", result.Rooms[0].RoomID)
	}
	if result.Rooms[1].RoomID != "room-mid" {
		t.Errorf("expected second room to be room-mid, got %s", result.Rooms[1].RoomID)
	}
	if result.Rooms[2].RoomID != "room-low" {
		t.Errorf("expected third room to be room-low, got %s", result.Rooms[2].RoomID)
	}

	// Verify messageCount5min values are populated correctly
	if result.Rooms[0].MessageCount5min != 10 {
		t.Errorf("expected room-high messageCount5min=10, got %d", result.Rooms[0].MessageCount5min)
	}
	if result.Rooms[1].MessageCount5min != 5 {
		t.Errorf("expected room-mid messageCount5min=5, got %d", result.Rooms[1].MessageCount5min)
	}
	if result.Rooms[2].MessageCount5min != 1 {
		t.Errorf("expected room-low messageCount5min=1, got %d", result.Rooms[2].MessageCount5min)
	}
}

// TestIntegration_TotalOnlineCount verifies that totalOnline in the API response
// matches the value returned by the OnlineCountFn.
// Validates: Requirements 3.1
func TestIntegration_TotalOnlineCount(t *testing.T) {
	reg := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)

	// Register a room so the response has content
	reg.Register(&RoomListing{
		RoomID:      "online-test-room",
		KeyEncoded:  "key1",
		Title:       "Online Count Test",
		MemberCount: 3,
		CreatedAt:   1700000000,
	})

	handler := NewHubHandler(HubHandlerConfig{
		Registry:       reg,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: nil,
		OnlineCountFn:  func() int { return 15 },
	})

	req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result ListResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if result.TotalOnline != 15 {
		t.Errorf("expected totalOnline=15, got %d", result.TotalOnline)
	}
}

// TestIntegration_ReactionsNotCounted validates the design decision that reactions
// do NOT increment activity counts. Since reactions are excluded at the hub.go layer
// (handleSendReaction does NOT call tracker.Increment), this test validates that
// only explicit Increment calls (representing messages) affect GetCount.
// Validates: Requirements 1.8
func TestIntegration_ReactionsNotCounted(t *testing.T) {
	tracker := activity.New(5*time.Minute, 10000)

	// Simulate: 3 messages sent to room (each triggers Increment)
	tracker.Increment("reaction-test-room")
	tracker.Increment("reaction-test-room")
	tracker.Increment("reaction-test-room")

	// Reactions would NOT call tracker.Increment (handled in hub.go).
	// We do NOT call Increment here — simulating that reactions are excluded.

	// Verify count reflects only the 3 message increments
	count := tracker.GetCount("reaction-test-room")
	if count != 3 {
		t.Errorf("expected count=3 (messages only, no reactions), got %d", count)
	}

	// Also verify via API handler integration
	reg := NewHubRegistry(200)
	reg.Register(&RoomListing{
		RoomID:      "reaction-test-room",
		KeyEncoded:  "key1",
		Title:       "Reaction Test Room",
		MemberCount: 2,
		CreatedAt:   1700000000,
	})

	rateLimiter := NewRateLimiter(30, time.Minute)
	handler := NewHubHandler(HubHandlerConfig{
		Registry:       reg,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: tracker,
		OnlineCountFn:  nil,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/hub?sort=active", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var result ListResult
	json.NewDecoder(w.Body).Decode(&result)

	if len(result.Rooms) != 1 {
		t.Fatalf("expected 1 room, got %d", len(result.Rooms))
	}
	if result.Rooms[0].MessageCount5min != 3 {
		t.Errorf("expected messageCount5min=3 (reactions excluded), got %d", result.Rooms[0].MessageCount5min)
	}
}

// TestIntegration_PrivateRoomNotTracked verifies that private rooms (not registered
// in HubRegistry) do not appear in Hub API responses, even if activity is tracked
// for them on the tracker. The Hub only shows registered public rooms.
// Validates: Requirements 1.7
func TestIntegration_PrivateRoomNotTracked(t *testing.T) {
	tracker := activity.New(5*time.Minute, 10000)

	reg := NewHubRegistry(200)

	// Register only the public room
	reg.Register(&RoomListing{
		RoomID:      "public-room",
		KeyEncoded:  "key1",
		Title:       "Public Room",
		MemberCount: 5,
		CreatedAt:   1700000000,
	})
	// "private-room" is NOT registered in HubRegistry

	// Increment both rooms on the tracker
	for i := 0; i < 8; i++ {
		tracker.Increment("public-room")
	}
	for i := 0; i < 20; i++ {
		tracker.Increment("private-room")
	}

	// Set up handler
	rateLimiter := NewRateLimiter(30, time.Minute)
	handler := NewHubHandler(HubHandlerConfig{
		Registry:       reg,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: tracker,
		OnlineCountFn:  nil,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result ListResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Only public-room should appear (private-room is not registered)
	if result.Total != 1 {
		t.Fatalf("expected 1 room (only public), got %d", result.Total)
	}
	if result.Rooms[0].RoomID != "public-room" {
		t.Errorf("expected public-room, got %s", result.Rooms[0].RoomID)
	}

	// Verify public room has its correct activity count
	if result.Rooms[0].MessageCount5min != 8 {
		t.Errorf("expected public-room messageCount5min=8, got %d", result.Rooms[0].MessageCount5min)
	}

	// Verify private-room does NOT appear anywhere in response
	for _, room := range result.Rooms {
		if room.RoomID == "private-room" {
			t.Error("private-room should NOT appear in Hub API response")
		}
	}
}
