// registry_property_test.go — Property-based tests for HubRegistry sort logic
// and Copy-on-Enrichment safety.
//
// Uses pgregory.net/rapid to verify correctness properties of the registry's
// List() method: sort ordering invariants across all modes, activity count
// consistency with ActivityGetter, and concurrent safety via shallow copies.
//
// All tests run with -race flag to detect data races.
//
// Feature: room-activity-ranking
package hub

import (
	"sync"
	"testing"

	"pgregory.net/rapid"
)

// **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6, 2.7**

// NOTE: mockActivityGetter is defined in registry_test.go (same package).
// We reuse it here without redeclaration.

// genRoomListing generates a random RoomListing with arbitrary field values.
func genRoomListing(t *rapid.T, id string) *RoomListing {
	return &RoomListing{
		RoomID:      id,
		KeyEncoded:  "key",
		Title:       rapid.StringMatching(`[A-Za-z ]{1,20}`).Draw(t, "title"),
		MemberCount: rapid.IntRange(0, 500).Draw(t, "memberCount"),
		CreatedAt:   int64(rapid.IntRange(1000000, 9999999).Draw(t, "createdAt")),
	}
}

// TestProperty4_SortOrderingInvariant verifies that for any set of room listings
// with arbitrary messageCount5min, memberCount, and createdAt values, the output
// is correctly ordered for each sort mode.
//
// Property 4: Sort ordering invariant
//   - active: output ordered by messageCount5min DESC, ties by memberCount DESC
//   - people: output ordered by memberCount DESC, ties by messageCount5min DESC
//   - newest: output ordered by createdAt DESC
//   - default (including unrecognized strings): output ordered by memberCount DESC,
//     ties by createdAt DESC
//
// **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7**
func TestProperty4_SortOrderingInvariant(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		numRooms := rapid.IntRange(2, 30).Draw(t, "numRooms")

		reg := NewHubRegistry(200)
		activityCounts := make(map[string]int)

		for i := 0; i < numRooms; i++ {
			roomID := rapid.StringMatching(`room-[a-z0-9]{4,8}`).Draw(t, "roomID")
			listing := genRoomListing(t, roomID)
			reg.Register(listing)
			activityCounts[roomID] = rapid.IntRange(0, 1000).Draw(t, "activityCount")
		}

		ag := &mockActivityGetter{counts: activityCounts}

		// Pick a sort mode (including unrecognized strings for default behavior).
		sortModes := []string{"active", "people", "newest", "", "invalid", "ACTIVE"}
		sortMode := rapid.SampledFrom(sortModes).Draw(t, "sortMode")

		result := reg.List(ListOptions{Sort: sortMode, Limit: 100}, ag)
		rooms := result.Rooms

		if len(rooms) < 2 {
			return // nothing to verify ordering on
		}

		// Verify ordering for each sort mode.
		for i := 0; i < len(rooms)-1; i++ {
			a := rooms[i]
			b := rooms[i+1]

			switch sortMode {
			case "active":
				// Primary: messageCount5min DESC, Tiebreaker: memberCount DESC
				if a.MessageCount5min < b.MessageCount5min {
					t.Fatalf("sort=active: room[%d].MessageCount5min (%d) < room[%d].MessageCount5min (%d)",
						i, a.MessageCount5min, i+1, b.MessageCount5min)
				}
				if a.MessageCount5min == b.MessageCount5min && a.MemberCount < b.MemberCount {
					t.Fatalf("sort=active tie: room[%d].MemberCount (%d) < room[%d].MemberCount (%d)",
						i, a.MemberCount, i+1, b.MemberCount)
				}

			case "people":
				// Primary: memberCount DESC, Tiebreaker: messageCount5min DESC
				if a.MemberCount < b.MemberCount {
					t.Fatalf("sort=people: room[%d].MemberCount (%d) < room[%d].MemberCount (%d)",
						i, a.MemberCount, i+1, b.MemberCount)
				}
				if a.MemberCount == b.MemberCount && a.MessageCount5min < b.MessageCount5min {
					t.Fatalf("sort=people tie: room[%d].MessageCount5min (%d) < room[%d].MessageCount5min (%d)",
						i, a.MessageCount5min, i+1, b.MessageCount5min)
				}

			case "newest":
				// Primary: createdAt DESC
				if a.CreatedAt < b.CreatedAt {
					t.Fatalf("sort=newest: room[%d].CreatedAt (%d) < room[%d].CreatedAt (%d)",
						i, a.CreatedAt, i+1, b.CreatedAt)
				}

			default:
				// Default (empty or unrecognized): memberCount DESC, createdAt DESC
				if a.MemberCount < b.MemberCount {
					t.Fatalf("sort=default: room[%d].MemberCount (%d) < room[%d].MemberCount (%d)",
						i, a.MemberCount, i+1, b.MemberCount)
				}
				if a.MemberCount == b.MemberCount && a.CreatedAt < b.CreatedAt {
					t.Fatalf("sort=default tie: room[%d].CreatedAt (%d) < room[%d].CreatedAt (%d)",
						i, a.CreatedAt, i+1, b.CreatedAt)
				}
			}
		}
	})
}

// TestProperty6_ActivityCountConsistency verifies that for any room registered in
// the HubRegistry, the messageCount5min field in the List result equals the value
// returned by ActivityGetter.GetCount(roomID) at query time.
//
// Property 6: Activity count consistency
// For any room registered in the HubRegistry, the messageCount5min field in the
// List result SHALL equal the value returned by ActivityGetter.GetCount(roomID)
// at query time.
//
// **Validates: Requirements 2.1**
func TestProperty6_ActivityCountConsistency(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		numRooms := rapid.IntRange(1, 20).Draw(t, "numRooms")

		reg := NewHubRegistry(200)
		activityCounts := make(map[string]int)
		roomIDs := make([]string, 0, numRooms)

		for i := 0; i < numRooms; i++ {
			roomID := rapid.StringMatching(`room-[a-z0-9]{4,8}`).Draw(t, "roomID")
			listing := &RoomListing{
				RoomID:     roomID,
				KeyEncoded: "key",
				Title:      "Room",
			}
			reg.Register(listing)
			count := rapid.IntRange(0, 5000).Draw(t, "count")
			activityCounts[roomID] = count
			roomIDs = append(roomIDs, roomID)
		}

		ag := &mockActivityGetter{counts: activityCounts}

		result := reg.List(ListOptions{Limit: 100}, ag)

		// Verify each returned room's messageCount5min matches the mock getter.
		for _, room := range result.Rooms {
			expected := ag.GetCount(room.RoomID)
			if room.MessageCount5min != expected {
				t.Fatalf("room %s: MessageCount5min = %d, want %d (from ActivityGetter)",
					room.RoomID, room.MessageCount5min, expected)
			}
		}
	})
}

// TestProperty8_ConcurrentSafetyCopyOnEnrichment verifies that parallel List()
// calls return independent RoomListing copies. Mutations to MessageCount5min on
// one result do NOT affect listings in the internal registry or in other concurrent
// results.
//
// Property 8: Concurrent safety (Copy-on-Enrichment)
// For any number of concurrent List() calls, each call SHALL return independent
// RoomListing copies. Mutations to MessageCount5min on one result SHALL NOT affect
// listings in the internal registry or in other concurrent results.
//
// **Validates: Requirements 2.1, 2.3**
func TestProperty8_ConcurrentSafetyCopyOnEnrichment(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		numRooms := rapid.IntRange(2, 10).Draw(t, "numRooms")
		numGoroutines := rapid.IntRange(4, 12).Draw(t, "numGoroutines")

		reg := NewHubRegistry(200)
		activityCounts := make(map[string]int)
		roomIDs := make([]string, 0, numRooms)

		for i := 0; i < numRooms; i++ {
			roomID := rapid.StringMatching(`room-[a-z0-9]{4,8}`).Draw(t, "roomID")
			listing := &RoomListing{
				RoomID:      roomID,
				KeyEncoded:  "key",
				Title:       "Room",
				MemberCount: rapid.IntRange(1, 100).Draw(t, "memberCount"),
			}
			reg.Register(listing)
			activityCounts[roomID] = rapid.IntRange(0, 500).Draw(t, "activityCount")
			roomIDs = append(roomIDs, roomID)
		}

		ag := &mockActivityGetter{counts: activityCounts}

		// Spawn goroutines that all call List() and then mutate results.
		type listResultEntry struct {
			rooms []*RoomListing
		}
		results := make([]listResultEntry, numGoroutines)
		var wg sync.WaitGroup
		wg.Add(numGoroutines)

		for g := 0; g < numGoroutines; g++ {
			go func(idx int) {
				defer wg.Done()
				res := reg.List(ListOptions{Limit: 100}, ag)
				results[idx] = listResultEntry{rooms: res.Rooms}

				// Mutate the returned copies (this should NOT affect other results).
				for _, room := range res.Rooms {
					room.MessageCount5min = 999999
					room.MemberCount = -1
				}
			}(g)
		}

		wg.Wait()

		// Verify: internal registry listings are NOT affected by mutations.
		for _, roomID := range roomIDs {
			internal := reg.GetListing(roomID)
			if internal == nil {
				continue
			}
			if internal.MessageCount5min == 999999 {
				t.Fatalf("internal registry for room %s was mutated (MessageCount5min = 999999)", roomID)
			}
			if internal.MemberCount == -1 {
				t.Fatalf("internal registry for room %s was mutated (MemberCount = -1)", roomID)
			}
		}

		// Verify: a fresh List() call still returns correct data (not mutated).
		freshResult := reg.List(ListOptions{Limit: 100}, ag)
		for _, room := range freshResult.Rooms {
			if room.MessageCount5min == 999999 {
				t.Fatalf("fresh List() for room %s shows mutated MessageCount5min = 999999", room.RoomID)
			}
			if room.MemberCount == -1 {
				t.Fatalf("fresh List() for room %s shows mutated MemberCount = -1", room.RoomID)
			}
			// Also verify activity count consistency on fresh result.
			expected := ag.GetCount(room.RoomID)
			if room.MessageCount5min != expected {
				t.Fatalf("fresh List() room %s: MessageCount5min = %d, want %d",
					room.RoomID, room.MessageCount5min, expected)
			}
		}
	})
}
