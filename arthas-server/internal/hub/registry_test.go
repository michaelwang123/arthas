package hub

import (
	"fmt"
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

	// Unregister a non-existent room - should not panic or change count
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

	result := reg.List(ListOptions{}, nil)
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

	result := reg.List(ListOptions{}, nil)
	if result.Rooms[0].MemberCount != 1 {
		t.Fatalf("expected member count unchanged at 1, got %d", result.Rooms[0].MemberCount)
	}
}

// --- List Tests ---

func TestList_EmptyRegistry(t *testing.T) {
	reg := NewHubRegistry(10)

	result := reg.List(ListOptions{}, nil)

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
	result := reg.List(ListOptions{Tag: "golang"}, nil)

	if result.Total != 2 {
		t.Fatalf("expected 2 rooms matching tag 'golang', got %d", result.Total)
	}
}

func TestList_FilterByTag_NoMatch(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Go Room", Tags: []string{"golang"}})

	result := reg.List(ListOptions{Tag: "python"}, nil)

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

	result := reg.List(ListOptions{Query: "golang"}, nil)

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

	result := reg.List(ListOptions{Query: "golang"}, nil)

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

	result := reg.List(ListOptions{Query: "golang"}, nil)

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
	result := reg.List(ListOptions{Tag: "ama", Query: "go"}, nil)

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

	result := reg.List(ListOptions{}, nil)

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

	result := reg.List(ListOptions{}, nil)

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

	result := reg.List(ListOptions{Offset: 2, Limit: 2}, nil)

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

	result := reg.List(ListOptions{Limit: 3}, nil)

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

	result := reg.List(ListOptions{Offset: 100}, nil)

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

	result := reg.List(ListOptions{}, nil)

	if result.Limit != 50 {
		t.Fatalf("expected default limit 50, got %d", result.Limit)
	}
}

func TestList_LimitCappedAt100(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room"})

	result := reg.List(ListOptions{Limit: 200}, nil)

	if result.Limit != 100 {
		t.Fatalf("expected limit capped at 100, got %d", result.Limit)
	}
}

func TestList_NegativeOffset_TreatedAsZero(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room"})

	result := reg.List(ListOptions{Offset: -5}, nil)

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

	result := reg.List(ListOptions{Query: "", Tag: ""}, nil)

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

// --- List Extension Tests (Validates: Requirements 2.1, 2.8) ---

// mockActivityGetter is a test double that returns preconfigured counts per room.
// Used by both registry_test.go and registry_property_test.go (same package).
type mockActivityGetter struct {
	counts map[string]int
}

func (m *mockActivityGetter) GetCount(roomID string) int {
	return m.counts[roomID]
}

// TestList_ReturnsCopies verifies that mutating a returned RoomListing
// does NOT affect the internal registry state (Copy-on-Enrichment pattern).
func TestList_ReturnsCopies(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{
		RoomID:      "room-copy",
		KeyEncoded:  "k",
		Title:       "Copy Test",
		MemberCount: 3,
	})

	ag := &mockActivityGetter{counts: map[string]int{"room-copy": 42}}

	result := reg.List(ListOptions{}, ag)
	if len(result.Rooms) != 1 {
		t.Fatalf("expected 1 room, got %d", len(result.Rooms))
	}

	// Mutate the returned listing
	result.Rooms[0].MessageCount5min = 999
	result.Rooms[0].MemberCount = 100

	// Verify the internal state is unchanged via GetListing
	internal := reg.GetListing("room-copy")
	if internal == nil {
		t.Fatal("expected internal listing to exist")
	}
	if internal.MessageCount5min != 0 {
		t.Fatalf("expected internal MessageCount5min to be 0 (untouched), got %d", internal.MessageCount5min)
	}
	if internal.MemberCount != 3 {
		t.Fatalf("expected internal MemberCount to remain 3, got %d", internal.MemberCount)
	}

	// Also verify a fresh List call returns the original activity count, not the mutated one
	result2 := reg.List(ListOptions{}, ag)
	if result2.Rooms[0].MessageCount5min != 42 {
		t.Fatalf("expected fresh List to return MessageCount5min=42, got %d", result2.Rooms[0].MessageCount5min)
	}
}

// TestList_PreComputesCountsBeforeSort verifies that activity counts are populated
// on the listing copies before sorting occurs, and the sort order reflects those counts.
func TestList_PreComputesCountsBeforeSort(t *testing.T) {
	reg := NewHubRegistry(10)

	// Register rooms with known IDs and equal member counts to isolate activity sort
	reg.Register(&RoomListing{RoomID: "low", KeyEncoded: "k", Title: "Low Activity", MemberCount: 5, CreatedAt: 100})
	reg.Register(&RoomListing{RoomID: "mid", KeyEncoded: "k", Title: "Mid Activity", MemberCount: 5, CreatedAt: 200})
	reg.Register(&RoomListing{RoomID: "high", KeyEncoded: "k", Title: "High Activity", MemberCount: 5, CreatedAt: 300})

	ag := &mockActivityGetter{counts: map[string]int{
		"low":  2,
		"mid":  10,
		"high": 50,
	}}

	result := reg.List(ListOptions{Sort: "active"}, ag)

	if len(result.Rooms) != 3 {
		t.Fatalf("expected 3 rooms, got %d", len(result.Rooms))
	}

	// Verify sort order: high (50) > mid (10) > low (2)
	expectedOrder := []string{"high", "mid", "low"}
	for i, expected := range expectedOrder {
		if result.Rooms[i].RoomID != expected {
			t.Fatalf("position %d: expected room %q, got %q", i, expected, result.Rooms[i].RoomID)
		}
	}

	// Verify MessageCount5min fields are populated correctly
	expectedCounts := []int{50, 10, 2}
	for i, expected := range expectedCounts {
		if result.Rooms[i].MessageCount5min != expected {
			t.Fatalf("position %d: expected MessageCount5min=%d, got %d", i, expected, result.Rooms[i].MessageCount5min)
		}
	}
}

// TestList_NilActivityGetter verifies that when ag is nil, all MessageCount5min
// values are 0 (graceful degradation per Requirement 2.8).
func TestList_NilActivityGetter(t *testing.T) {
	reg := NewHubRegistry(10)

	reg.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k", Title: "Room 1", MemberCount: 5})
	reg.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k", Title: "Room 2", MemberCount: 3})
	reg.Register(&RoomListing{RoomID: "r3", KeyEncoded: "k", Title: "Room 3", MemberCount: 7})

	// Pass nil ActivityGetter — should not panic and all counts should be 0
	result := reg.List(ListOptions{Sort: "active"}, nil)

	if len(result.Rooms) != 3 {
		t.Fatalf("expected 3 rooms, got %d", len(result.Rooms))
	}

	for i, room := range result.Rooms {
		if room.MessageCount5min != 0 {
			t.Fatalf("room %d (%s): expected MessageCount5min=0 with nil ActivityGetter, got %d",
				i, room.RoomID, room.MessageCount5min)
		}
	}
}

// TestList_ConcurrentCalls verifies that multiple goroutines calling List()
// simultaneously do not cause data races or panics (run with -race flag).
func TestList_ConcurrentCalls(t *testing.T) {
	reg := NewHubRegistry(100)

	// Populate registry with several rooms
	for i := 0; i < 20; i++ {
		reg.Register(&RoomListing{
			RoomID:      fmt.Sprintf("room-%d", i),
			KeyEncoded:  "k",
			Title:       fmt.Sprintf("Room %d", i),
			MemberCount: i * 2,
			CreatedAt:   int64(1000 + i),
		})
	}

	ag := &mockActivityGetter{counts: map[string]int{
		"room-0": 5, "room-1": 15, "room-2": 25, "room-3": 35,
		"room-4": 45, "room-5": 55, "room-6": 10, "room-7": 20,
	}}

	const goroutines = 10
	done := make(chan struct{}, goroutines)
	errs := make(chan error, goroutines)

	for g := 0; g < goroutines; g++ {
		go func(id int) {
			defer func() { done <- struct{}{} }()

			// Alternate between sort modes to exercise different code paths
			sortModes := []string{"active", "people", "newest", ""}
			mode := sortModes[id%len(sortModes)]

			result := reg.List(ListOptions{Sort: mode, Limit: 10}, ag)

			// Basic consistency checks
			if result == nil {
				errs <- fmt.Errorf("goroutine %d: List returned nil", id)
				return
			}
			if len(result.Rooms) == 0 {
				errs <- fmt.Errorf("goroutine %d: List returned 0 rooms", id)
				return
			}
			if result.Total != 20 {
				errs <- fmt.Errorf("goroutine %d: expected total 20, got %d", id, result.Total)
				return
			}
		}(g)
	}

	// Wait for all goroutines to finish
	for i := 0; i < goroutines; i++ {
		<-done
	}
	close(errs)

	for err := range errs {
		t.Fatal(err)
	}
}
