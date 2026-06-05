package hub

import (
	"testing"
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
