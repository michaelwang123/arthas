package hub

import (
	"testing"
	"time"
)

// --- Register Tests ---

func TestRegister_Success(t *testing.T) {
	reg := NewHubRegistry(10)

	listing := &RoomListing{
		RoomID:     "room-1",
		KeyEncoded: "base64key",
		Title:      "Test Room",
		Tags:       []string{"go"},
		Ephemeral:  1,
		ExpiresAt:  1700003600,
		CreatedAt:  time.Now().Unix(),
	}

	err := reg.Register(listing)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if reg.Count() != 1 {
		t.Fatalf("expected count 1, got %d", reg.Count())
	}
}

func TestRegister_CapacityFull_ReturnsErrHubFull(t *testing.T) {
	reg := NewHubRegistry(2)

	for i := 0; i < 2; i++ {
		err := reg.Register(&RoomListing{
			RoomID:     "room-" + string(rune('a'+i)),
			KeyEncoded: "key",
			Title:      "Room",
			Ephemeral:  0,
			ExpiresAt:  0,
		})
		if err != nil {
			t.Fatalf("unexpected error registering room %d: %v", i, err)
		}
	}

	// Third registration should fail
	err := reg.Register(&RoomListing{
		RoomID:     "room-c",
		KeyEncoded: "key",
		Title:      "Room C",
	})
	if err != ErrHubFull {
		t.Fatalf("expected ErrHubFull, got %v", err)
	}

	if reg.Count() != 2 {
		t.Fatalf("expected count to remain 2, got %d", reg.Count())
	}
}

func TestRegister_ShareCodeConstruction(t *testing.T) {
	reg := NewHubRegistry(10)

	listing := &RoomListing{
		RoomID:     "abc123",
		KeyEncoded: "dGVzdGtleQ",
		Title:      "Share Code Test",
		Ephemeral:  1,
		ExpiresAt:  1700003600,
	}

	err := reg.Register(listing)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "abc123:dGVzdGtleQ:1:1700003600"
	if listing.ShareCode != expected {
		t.Fatalf("expected shareCode %q, got %q", expected, listing.ShareCode)
	}
}

func TestRegister_ShareCodeConstruction_NoExpiry(t *testing.T) {
	reg := NewHubRegistry(10)

	listing := &RoomListing{
		RoomID:     "room-xyz",
		KeyEncoded: "mykey",
		Title:      "Permanent Room",
		Ephemeral:  0,
		ExpiresAt:  0,
	}

	err := reg.Register(listing)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "room-xyz:mykey:0:0"
	if listing.ShareCode != expected {
		t.Fatalf("expected shareCode %q, got %q", expected, listing.ShareCode)
	}
}

// --- Unregister Tests ---

func TestUnregister_ExistingRoom(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{
		RoomID:     "room-1",
		KeyEncoded: "key",
		Title:      "Room 1",
	})

	if reg.Count() != 1 {
		t.Fatalf("expected count 1, got %d", reg.Count())
	}

	reg.Unregister("room-1")

	if reg.Count() != 0 {
		t.Fatalf("expected count 0 after unregister, got %d", reg.Count())
	}
}

func TestUnregister_NonExistentRoom_NoOp(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{
		RoomID:     "room-1",
		KeyEncoded: "key",
		Title:      "Room 1",
	})

	// Unregister a non-existent room — should not panic or change count
	reg.Unregister("non-existent-room")

	if reg.Count() != 1 {
		t.Fatalf("expected count to remain 1, got %d", reg.Count())
	}
}

func TestUnregister_EmptyRegistry_NoOp(t *testing.T) {
	reg := NewHubRegistry(10)

	// Should not panic on empty registry
	reg.Unregister("anything")

	if reg.Count() != 0 {
		t.Fatalf("expected count 0, got %d", reg.Count())
	}
}

// --- UpdateMemberCount Tests ---

func TestUpdateMemberCount_ExistingRoom(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{
		RoomID:      "room-1",
		KeyEncoded:  "key",
		Title:       "Room 1",
		MemberCount: 1,
	})

	reg.UpdateMemberCount("room-1", 5)

	result := reg.List(ListOptions{})
	if len(result.Rooms) != 1 {
		t.Fatalf("expected 1 room, got %d", len(result.Rooms))
	}
	if result.Rooms[0].MemberCount != 5 {
		t.Fatalf("expected member count 5, got %d", result.Rooms[0].MemberCount)
	}
}

func TestUpdateMemberCount_NonExistentRoom_NoOp(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{
		RoomID:      "room-1",
		KeyEncoded:  "key",
		Title:       "Room 1",
		MemberCount: 1,
	})

	// Should not panic or affect existing rooms
	reg.UpdateMemberCount("non-existent", 10)

	result := reg.List(ListOptions{})
	if result.Rooms[0].MemberCount != 1 {
		t.Fatalf("expected member count unchanged at 1, got %d", result.Rooms[0].MemberCount)
	}
}

// --- List Tests ---

func TestList_EmptyRegistry(t *testing.T) {
	reg := NewHubRegistry(10)

	result := reg.List(ListOptions{})

	if len(result.Rooms) != 0 {
		t.Fatalf("expected 0 rooms, got %d", len(result.Rooms))
	}
	if result.Total != 0 {
		t.Fatalf("expected total 0, got %d", result.Total)
	}
	if result.Limit != 50 {
		t.Fatalf("expected default limit 50, got %d", result.Limit)
	}
	if result.Offset != 0 {
		t.Fatalf("expected offset 0, got %d", result.Offset)
	}
}

func TestList_FilterByTag_CaseInsensitive(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Go Room", Tags: []string{"Golang", "ama"}})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "React Room", Tags: []string{"react"}})
	reg.Register(&RoomListing{RoomID: "r3", KeyEncoded: "k", Title: "Another Go", Tags: []string{"GOLANG"}})

	// Filter with lowercase "golang" should match both "Golang" and "GOLANG"
	result := reg.List(ListOptions{Tag: "golang"})

	if result.Total != 2 {
		t.Fatalf("expected 2 rooms matching tag 'golang', got %d", result.Total)
	}
}

func TestList_FilterByTag_NoMatch(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Go Room", Tags: []string{"golang"}})

	result := reg.List(ListOptions{Tag: "python"})

	if result.Total != 0 {
		t.Fatalf("expected 0 rooms, got %d", result.Total)
	}
	if len(result.Rooms) != 0 {
		t.Fatalf("expected empty rooms slice, got %d", len(result.Rooms))
	}
}

func TestList_FilterByQuery_TitleMatch(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Golang Discussion", Description: "General chat"})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "React Help", Description: "Ask anything"})

	result := reg.List(ListOptions{Query: "golang"})

	if result.Total != 1 {
		t.Fatalf("expected 1 room matching query 'golang', got %d", result.Total)
	}
	if result.Rooms[0].RoomID != "r1" {
		t.Fatalf("expected room r1, got %s", result.Rooms[0].RoomID)
	}
}

func TestList_FilterByQuery_DescriptionMatch(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "General Chat", Description: "Talk about anything including golang"})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "Music", Description: "Discuss music"})

	result := reg.List(ListOptions{Query: "golang"})

	if result.Total != 1 {
		t.Fatalf("expected 1 room matching query in description, got %d", result.Total)
	}
	if result.Rooms[0].RoomID != "r1" {
		t.Fatalf("expected room r1, got %s", result.Rooms[0].RoomID)
	}
}

func TestList_FilterByQuery_CaseInsensitive(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "GOLANG Room", Description: ""})

	result := reg.List(ListOptions{Query: "golang"})

	if result.Total != 1 {
		t.Fatalf("expected 1 room for case-insensitive query, got %d", result.Total)
	}
}

func TestList_CombinedTagAndQuery(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Go AMA", Tags: []string{"golang", "ama"}})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "Go Help", Tags: []string{"golang"}})
	reg.Register(&RoomListing{RoomID: "r3", KeyEncoded: "k", Title: "React AMA", Tags: []string{"react", "ama"}})

	// Both tag=ama AND query=go must match
	result := reg.List(ListOptions{Tag: "ama", Query: "go"})

	if result.Total != 1 {
		t.Fatalf("expected 1 room matching both tag and query, got %d", result.Total)
	}
	if result.Rooms[0].RoomID != "r1" {
		t.Fatalf("expected room r1, got %s", result.Rooms[0].RoomID)
	}
}

func TestList_SortByMemberCountDesc(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Low", MemberCount: 2, CreatedAt: 100})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "High", MemberCount: 10, CreatedAt: 100})
	reg.Register(&RoomListing{RoomID: "r3", KeyEncoded: "k", Title: "Mid", MemberCount: 5, CreatedAt: 100})

	result := reg.List(ListOptions{})

	if len(result.Rooms) != 3 {
		t.Fatalf("expected 3 rooms, got %d", len(result.Rooms))
	}
	if result.Rooms[0].RoomID != "r2" {
		t.Fatalf("expected first room to be r2 (highest members), got %s", result.Rooms[0].RoomID)
	}
	if result.Rooms[1].RoomID != "r3" {
		t.Fatalf("expected second room to be r3, got %s", result.Rooms[1].RoomID)
	}
	if result.Rooms[2].RoomID != "r1" {
		t.Fatalf("expected third room to be r1 (lowest members), got %s", result.Rooms[2].RoomID)
	}
}

func TestList_SortByCreatedAtDesc_ForTies(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Older", MemberCount: 5, CreatedAt: 1000})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "Newer", MemberCount: 5, CreatedAt: 2000})
	reg.Register(&RoomListing{RoomID: "r3", KeyEncoded: "k", Title: "Newest", MemberCount: 5, CreatedAt: 3000})

	result := reg.List(ListOptions{})

	if result.Rooms[0].RoomID != "r3" {
		t.Fatalf("expected first room to be r3 (newest), got %s", result.Rooms[0].RoomID)
	}
	if result.Rooms[1].RoomID != "r2" {
		t.Fatalf("expected second room to be r2, got %s", result.Rooms[1].RoomID)
	}
	if result.Rooms[2].RoomID != "r1" {
		t.Fatalf("expected third room to be r1 (oldest), got %s", result.Rooms[2].RoomID)
	}
}

func TestList_Pagination_Offset(t *testing.T) {
	reg := NewHubRegistry(10)

	for i := 0; i < 5; i++ {
		reg.Register(&RoomListing{
			RoomID:      "r" + string(rune('0'+i)),
			KeyEncoded:  "k",
			Title:       "Room",
			MemberCount: 10 - i, // descending member count for deterministic sort
			CreatedAt:   int64(100 + i),
		})
	}

	result := reg.List(ListOptions{Offset: 2, Limit: 2})

	if result.Total != 5 {
		t.Fatalf("expected total 5, got %d", result.Total)
	}
	if len(result.Rooms) != 2 {
		t.Fatalf("expected 2 rooms in page, got %d", len(result.Rooms))
	}
	if result.Offset != 2 {
		t.Fatalf("expected offset 2, got %d", result.Offset)
	}
}

func TestList_Pagination_Limit(t *testing.T) {
	reg := NewHubRegistry(10)

	for i := 0; i < 5; i++ {
		reg.Register(&RoomListing{
			RoomID:      "r" + string(rune('0'+i)),
			KeyEncoded:  "k",
			Title:       "Room",
			MemberCount: i,
		})
	}

	result := reg.List(ListOptions{Limit: 3})

	if len(result.Rooms) != 3 {
		t.Fatalf("expected 3 rooms (limited), got %d", len(result.Rooms))
	}
	if result.Limit != 3 {
		t.Fatalf("expected limit 3, got %d", result.Limit)
	}
	if result.Total != 5 {
		t.Fatalf("expected total 5, got %d", result.Total)
	}
}

func TestList_Pagination_OffsetBeyondTotal(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room 1"})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "Room 2"})

	result := reg.List(ListOptions{Offset: 100})

	if len(result.Rooms) != 0 {
		t.Fatalf("expected 0 rooms when offset beyond total, got %d", len(result.Rooms))
	}
	if result.Total != 2 {
		t.Fatalf("expected total 2, got %d", result.Total)
	}
}

func TestList_DefaultLimit(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room"})

	result := reg.List(ListOptions{})

	if result.Limit != 50 {
		t.Fatalf("expected default limit 50, got %d", result.Limit)
	}
}

func TestList_LimitCappedAt100(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room"})

	result := reg.List(ListOptions{Limit: 200})

	if result.Limit != 100 {
		t.Fatalf("expected limit capped at 100, got %d", result.Limit)
	}
}

func TestList_NegativeOffset_TreatedAsZero(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room"})

	result := reg.List(ListOptions{Offset: -5})

	if result.Offset != 0 {
		t.Fatalf("expected negative offset corrected to 0, got %d", result.Offset)
	}
	if len(result.Rooms) != 1 {
		t.Fatalf("expected 1 room, got %d", len(result.Rooms))
	}
}

func TestList_EmptyQuery_ReturnsAll(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room A"})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "Room B"})

	result := reg.List(ListOptions{Query: "", Tag: ""})

	if result.Total != 2 {
		t.Fatalf("expected all 2 rooms with empty query, got %d", result.Total)
	}
}

// --- Count Tests ---

func TestCount_EmptyRegistry(t *testing.T) {
	reg := NewHubRegistry(10)

	if reg.Count() != 0 {
		t.Fatalf("expected count 0, got %d", reg.Count())
	}
}

func TestCount_AfterRegister(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room 1"})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "Room 2"})

	if reg.Count() != 2 {
		t.Fatalf("expected count 2, got %d", reg.Count())
	}
}

func TestCount_AfterUnregister(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room 1"})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "Room 2"})

	reg.Unregister("r1")

	if reg.Count() != 1 {
		t.Fatalf("expected count 1 after unregister, got %d", reg.Count())
	}
}

func TestCount_AfterRegisterAndFullUnregister(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room 1"})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "Room 2"})

	reg.Unregister("r1")
	reg.Unregister("r2")

	if reg.Count() != 0 {
		t.Fatalf("expected count 0 after unregistering all, got %d", reg.Count())
	}
}

// --- Register after Unregister frees capacity ---

func TestRegister_AfterUnregister_FreesCapacity(t *testing.T) {
	reg := NewHubRegistry(2)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room 1"})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "Room 2"})

	// At capacity now
	err := reg.Register(&RoomListing{RoomID: "r3", KeyEncoded: "k", Title: "Room 3"})
	if err != ErrHubFull {
		t.Fatalf("expected ErrHubFull, got %v", err)
	}

	// Unregister one room
	reg.Unregister("r1")

	// Should now be able to register again
	err = reg.Register(&RoomListing{RoomID: "r3", KeyEncoded: "k", Title: "Room 3"})
	if err != nil {
		t.Fatalf("expected successful registration after unregister, got %v", err)
	}

	if reg.Count() != 2 {
		t.Fatalf("expected count 2, got %d", reg.Count())
	}
}
