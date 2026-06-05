package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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
	result := reg.List(ListOptions{})
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

	result = reg.List(ListOptions{})
	if result.Rooms[0].MemberCount != 2 {
		t.Fatalf("expected memberCount=2 after join, got %d", result.Rooms[0].MemberCount)
	}

	// 3. Third member joins
	reg.UpdateMemberCount("test-room-1", 3)

	result = reg.List(ListOptions{})
	if result.Rooms[0].MemberCount != 3 {
		t.Fatalf("expected memberCount=3, got %d", result.Rooms[0].MemberCount)
	}

	// 4. One member leaves (simulates handleLeaveRoom → UpdateMemberCount)
	reg.UpdateMemberCount("test-room-1", 2)

	result = reg.List(ListOptions{})
	if result.Rooms[0].MemberCount != 2 {
		t.Fatalf("expected memberCount=2 after leave, got %d", result.Rooms[0].MemberCount)
	}

	// 5. Last members leave → room destroyed → Unregister
	reg.UpdateMemberCount("test-room-1", 1)
	reg.Unregister("test-room-1")

	result = reg.List(ListOptions{})
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

	result := reg.List(ListOptions{})
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
	handler := NewHubHandler(reg, rateLimiter, "*")

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
	handler := NewHubHandler(reg, rateLimiter, "*")

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

	// The regular room should NOT have isDailyTopic in JSON (omitempty)
	// Parse individual rooms to verify
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
}
