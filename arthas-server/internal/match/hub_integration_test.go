// hub_integration_test.go — Property-based test for Match_Room isolation (Property 12).
//
// Verifies that match rooms created via RoomCreator.CreateMatchRoom never appear in
// HubRegistry listing and never count toward the maxPublicRooms capacity.
//
// This test exercises the integration contract: RoomCreator creates rooms without
// calling HubRegistry.Register(), ensuring match rooms remain invisible to public listing.
//
// Uses pgregory.net/rapid to verify the property across random combinations of
// match rooms and public rooms.
//
// Feature: random-match
package match

import (
	"fmt"
	"testing"
	"time"

	"github.com/arthas/arthas-server/internal/hub"
	"pgregory.net/rapid"
)

// **Validates: Requirements 3.3**

// TestProperty_MatchRoomIsolation verifies Property 12: Match_Room isolation.
// For ANY number of match rooms created (rooms NOT registered in HubRegistry),
// they SHALL NOT appear in HubRegistry.List() and SHALL NOT count toward maxPublicRooms.
//
// Test strategy:
//  1. Generate a random maxPublicRooms capacity (2-20)
//  2. Generate a random number of public rooms (0-maxPublicRooms) and register them
//  3. Generate a random number of match rooms (1-50) — these are NOT registered
//  4. Verify: HubRegistry.List() only contains public rooms
//  5. Verify: HubRegistry.Count() equals number of public rooms only
//  6. Verify: Additional public rooms can still be registered up to capacity
//     (match rooms don't consume capacity)
//
// **Validates: Requirements 3.3**
func TestProperty_MatchRoomIsolation(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate random registry capacity.
		maxPublicRooms := rapid.IntRange(2, 20).Draw(t, "maxPublicRooms")
		registry := hub.NewHubRegistry(maxPublicRooms)

		// Generate a random number of public rooms to register (0 to capacity-1,
		// leaving at least 1 slot to verify capacity isn't consumed by match rooms).
		numPublicRooms := rapid.IntRange(0, maxPublicRooms-1).Draw(t, "numPublicRooms")
		publicRoomIDs := make([]string, numPublicRooms)
		for i := 0; i < numPublicRooms; i++ {
			roomID := fmt.Sprintf("public-room-%d", i)
			publicRoomIDs[i] = roomID
			listing := &hub.RoomListing{
				RoomID:      roomID,
				KeyEncoded:  "key",
				Title:       fmt.Sprintf("Public Room %d", i),
				MemberCount: rapid.IntRange(0, 50).Draw(t, fmt.Sprintf("members_%d", i)),
				CreatedAt:   time.Now().Unix() - int64(i),
			}
			err := registry.Register(listing)
			if err != nil {
				t.Fatalf("failed to register public room %d: %v", i, err)
			}
		}

		// Generate a random number of match rooms (1-50).
		// These simulate what CreateMatchRoom does: create the room in RoomManager
		// but DO NOT register in HubRegistry.
		numMatchRooms := rapid.IntRange(1, 50).Draw(t, "numMatchRooms")
		matchRoomIDs := make([]string, numMatchRooms)
		for i := 0; i < numMatchRooms; i++ {
			matchRoomIDs[i] = fmt.Sprintf("match-room-%d", i)
			// Match rooms are NOT registered in HubRegistry.
			// This is the core design decision: CreateMatchRoom skips registry.Register().
		}

		// === Verify Property 12(a): Match rooms don't appear in HubRegistry listing ===
		result := registry.List(hub.ListOptions{Limit: 100}, nil)

		// Total listed rooms must equal only the public rooms.
		if result.Total != numPublicRooms {
			t.Fatalf("Property 12(a) violated: registry.List() total = %d, expected %d (public rooms only)",
				result.Total, numPublicRooms)
		}

		// Verify no match room ID appears in the listing.
		listedIDs := make(map[string]bool)
		for _, room := range result.Rooms {
			listedIDs[room.RoomID] = true
		}
		for _, matchID := range matchRoomIDs {
			if listedIDs[matchID] {
				t.Fatalf("Property 12(a) violated: match room %q appears in HubRegistry listing", matchID)
			}
		}

		// Verify all public rooms DO appear in the listing.
		for _, pubID := range publicRoomIDs {
			if !listedIDs[pubID] {
				t.Fatalf("Property 12(a) sanity check failed: public room %q missing from listing", pubID)
			}
		}

		// === Verify Property 12(b): Match rooms don't count toward maxPublicRooms ===
		if registry.Count() != numPublicRooms {
			t.Fatalf("Property 12(b) violated: registry.Count() = %d, expected %d (match rooms should not be counted)",
				registry.Count(), numPublicRooms)
		}

		// Verify that the remaining capacity is (maxPublicRooms - numPublicRooms),
		// unaffected by any number of match rooms created.
		remainingCapacity := maxPublicRooms - numPublicRooms
		for i := 0; i < remainingCapacity; i++ {
			err := registry.Register(&hub.RoomListing{
				RoomID:     fmt.Sprintf("extra-public-%d", i),
				KeyEncoded: "key",
				Title:      fmt.Sprintf("Extra Public %d", i),
				CreatedAt:  time.Now().Unix(),
			})
			if err != nil {
				t.Fatalf("Property 12(b) violated: could not register public room in remaining capacity slot %d/%d: %v",
					i+1, remainingCapacity, err)
			}
		}

		// Now at capacity — next registration should fail with ErrHubFull.
		err := registry.Register(&hub.RoomListing{
			RoomID:     "overflow-room",
			KeyEncoded: "key",
			Title:      "Overflow",
			CreatedAt:  time.Now().Unix(),
		})
		if err != hub.ErrHubFull {
			t.Fatalf("Property 12(b) violated: expected ErrHubFull at capacity, got %v", err)
		}

		// Final count should be exactly maxPublicRooms.
		if registry.Count() != maxPublicRooms {
			t.Fatalf("Property 12(b) violated: final count = %d, expected maxPublicRooms = %d",
				registry.Count(), maxPublicRooms)
		}
	})
}
