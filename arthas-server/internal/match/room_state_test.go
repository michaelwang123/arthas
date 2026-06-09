package match

import (
	"fmt"
	"testing"
	"time"

	"pgregory.net/rapid"
)

func TestNewMatchRoomStateStore(t *testing.T) {
	store := NewMatchRoomStateStore(3)
	if store == nil {
		t.Fatal("expected non-nil store")
	}
	if store.maxExtensions != 3 {
		t.Fatalf("expected maxExtensions=3, got %d", store.maxExtensions)
	}
}

func TestAddAndGet(t *testing.T) {
	store := NewMatchRoomStateStore(3)

	state := &MatchRoomState{
		RoomID:    "room-1",
		ClientAID: "alice",
		ClientBID: "bob",
		CreatedAt: time.Now(),
	}
	store.Add(state)

	got := store.Get("room-1")
	if got == nil {
		t.Fatal("expected to get room state")
	}
	if got.RoomID != "room-1" {
		t.Fatalf("expected RoomID=room-1, got %s", got.RoomID)
	}
	if got.ClientAID != "alice" {
		t.Fatalf("expected ClientAID=alice, got %s", got.ClientAID)
	}
	if got.PendingExtend == nil {
		t.Fatal("expected PendingExtend to be initialized")
	}
}

func TestGetNotFound(t *testing.T) {
	store := NewMatchRoomStateStore(3)
	got := store.Get("nonexistent")
	if got != nil {
		t.Fatal("expected nil for nonexistent room")
	}
}

func TestRemove(t *testing.T) {
	store := NewMatchRoomStateStore(3)

	store.Add(&MatchRoomState{
		RoomID:    "room-1",
		ClientAID: "alice",
		ClientBID: "bob",
		CreatedAt: time.Now(),
	})

	store.Remove("room-1")

	got := store.Get("room-1")
	if got != nil {
		t.Fatal("expected nil after remove")
	}
}

func TestProposeExtend_RoomNotFound(t *testing.T) {
	store := NewMatchRoomStateStore(3)

	agreed, err := store.ProposeExtend("nonexistent", "alice")
	if err != ErrRoomNotFound {
		t.Fatalf("expected ErrRoomNotFound, got %v", err)
	}
	if agreed {
		t.Fatal("expected agreed=false")
	}
}

func TestProposeExtend_ClientNotInRoom(t *testing.T) {
	store := NewMatchRoomStateStore(3)
	store.Add(&MatchRoomState{
		RoomID:    "room-1",
		ClientAID: "alice",
		ClientBID: "bob",
		CreatedAt: time.Now(),
	})

	agreed, err := store.ProposeExtend("room-1", "charlie")
	if err != ErrClientNotInRoom {
		t.Fatalf("expected ErrClientNotInRoom, got %v", err)
	}
	if agreed {
		t.Fatal("expected agreed=false")
	}
}

func TestProposeExtend_SingleProposal(t *testing.T) {
	store := NewMatchRoomStateStore(3)
	store.Add(&MatchRoomState{
		RoomID:    "room-1",
		ClientAID: "alice",
		ClientBID: "bob",
		CreatedAt: time.Now(),
	})

	agreed, err := store.ProposeExtend("room-1", "alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if agreed {
		t.Fatal("expected agreed=false for single proposal")
	}
}

func TestProposeExtend_MutualConsent(t *testing.T) {
	store := NewMatchRoomStateStore(3)
	store.Add(&MatchRoomState{
		RoomID:    "room-1",
		ClientAID: "alice",
		ClientBID: "bob",
		CreatedAt: time.Now(),
	})

	// Alice proposes
	agreed, err := store.ProposeExtend("room-1", "alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if agreed {
		t.Fatal("expected agreed=false after first proposal")
	}

	// Bob proposes — mutual consent
	agreed, err = store.ProposeExtend("room-1", "bob")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !agreed {
		t.Fatal("expected agreed=true when both propose")
	}

	// Verify extension count incremented and proposals cleared
	state := store.Get("room-1")
	if state.ExtensionCount != 1 {
		t.Fatalf("expected ExtensionCount=1, got %d", state.ExtensionCount)
	}
	if len(state.PendingExtend) != 0 {
		t.Fatalf("expected PendingExtend cleared, got %d entries", len(state.PendingExtend))
	}
}

func TestProposeExtend_MaxExtensionsReached(t *testing.T) {
	store := NewMatchRoomStateStore(3)
	store.Add(&MatchRoomState{
		RoomID:         "room-1",
		ClientAID:      "alice",
		ClientBID:      "bob",
		ExtensionCount: 3,
		CreatedAt:      time.Now(),
	})

	agreed, err := store.ProposeExtend("room-1", "alice")
	if err != ErrExtendMaxReached {
		t.Fatalf("expected ErrExtendMaxReached, got %v", err)
	}
	if agreed {
		t.Fatal("expected agreed=false")
	}
}

func TestProposeExtend_MultipleExtensions(t *testing.T) {
	store := NewMatchRoomStateStore(3)
	store.Add(&MatchRoomState{
		RoomID:    "room-1",
		ClientAID: "alice",
		ClientBID: "bob",
		CreatedAt: time.Now(),
	})

	// Complete 3 extensions successfully
	for i := 0; i < 3; i++ {
		agreed, err := store.ProposeExtend("room-1", "alice")
		if err != nil {
			t.Fatalf("extension %d alice: unexpected error: %v", i+1, err)
		}
		if agreed {
			t.Fatalf("extension %d alice: expected agreed=false", i+1)
		}

		agreed, err = store.ProposeExtend("room-1", "bob")
		if err != nil {
			t.Fatalf("extension %d bob: unexpected error: %v", i+1, err)
		}
		if !agreed {
			t.Fatalf("extension %d bob: expected agreed=true", i+1)
		}
	}

	// 4th attempt should fail
	agreed, err := store.ProposeExtend("room-1", "alice")
	if err != ErrExtendMaxReached {
		t.Fatalf("expected ErrExtendMaxReached, got %v", err)
	}
	if agreed {
		t.Fatal("expected agreed=false after max reached")
	}
}

func TestCleanExpiredProposals(t *testing.T) {
	store := NewMatchRoomStateStore(3)
	store.Add(&MatchRoomState{
		RoomID:    "room-1",
		ClientAID: "alice",
		ClientBID: "bob",
		PendingExtend: map[string]time.Time{
			"alice": time.Now().Add(-61 * time.Second), // expired
		},
		CreatedAt: time.Now(),
	})
	store.Add(&MatchRoomState{
		RoomID:    "room-2",
		ClientAID: "charlie",
		ClientBID: "dave",
		PendingExtend: map[string]time.Time{
			"charlie": time.Now(), // still valid
		},
		CreatedAt: time.Now(),
	})

	store.CleanExpiredProposals()

	// room-1: alice's expired proposal should be removed
	state1 := store.Get("room-1")
	if len(state1.PendingExtend) != 0 {
		t.Fatalf("expected room-1 proposals cleared, got %d", len(state1.PendingExtend))
	}

	// room-2: charlie's valid proposal should remain
	state2 := store.Get("room-2")
	if len(state2.PendingExtend) != 1 {
		t.Fatalf("expected room-2 to keep 1 proposal, got %d", len(state2.PendingExtend))
	}
}

func TestProposeExtend_ExpiredPartnerProposal(t *testing.T) {
	store := NewMatchRoomStateStore(3)

	// Alice proposed 61 seconds ago (expired)
	store.Add(&MatchRoomState{
		RoomID:    "room-1",
		ClientAID: "alice",
		ClientBID: "bob",
		PendingExtend: map[string]time.Time{
			"alice": time.Now().Add(-61 * time.Second),
		},
		CreatedAt: time.Now(),
	})

	// Bob proposes now — Alice's proposal is expired, should NOT agree
	agreed, err := store.ProposeExtend("room-1", "bob")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if agreed {
		t.Fatal("expected agreed=false because alice's proposal is expired")
	}
}

func TestProposeExtend_OrderDoesNotMatter(t *testing.T) {
	store := NewMatchRoomStateStore(3)
	store.Add(&MatchRoomState{
		RoomID:    "room-1",
		ClientAID: "alice",
		ClientBID: "bob",
		CreatedAt: time.Now(),
	})

	// Bob proposes first
	agreed, err := store.ProposeExtend("room-1", "bob")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if agreed {
		t.Fatal("expected agreed=false")
	}

	// Alice proposes second — mutual consent
	agreed, err = store.ProposeExtend("room-1", "alice")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !agreed {
		t.Fatal("expected agreed=true regardless of proposal order")
	}
}

// --- Property-Based Tests ---

// TestProperty_ExtensionCountLimit verifies Property 10: Extension count limit.
// For ANY maxExtensions value and ANY sequence of successful mutual-consent extensions,
// the ExtensionCount NEVER exceeds maxExtensions. After reaching the limit, all
// subsequent proposals return ErrExtendMaxReached.
//
// **Validates: Requirements 13.4**
func TestProperty_ExtensionCountLimit(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate a random maxExtensions value (1-10).
		maxExtensions := rapid.IntRange(1, 10).Draw(t, "maxExtensions")

		store := NewMatchRoomStateStore(maxExtensions)

		// Create a room with two participants.
		store.Add(&MatchRoomState{
			RoomID:    "room-prop",
			ClientAID: "alice",
			ClientBID: "bob",
			CreatedAt: time.Now(),
		})

		// Attempt more extensions than allowed (maxExtensions + extra attempts).
		extraAttempts := rapid.IntRange(1, 5).Draw(t, "extraAttempts")
		totalAttempts := maxExtensions + extraAttempts

		successfulExtensions := 0

		for i := 0; i < totalAttempts; i++ {
			// Alice proposes
			agreed, err := store.ProposeExtend("room-prop", "alice")
			if err == ErrExtendMaxReached {
				// After max is reached, all proposals should be rejected.
				if agreed {
					t.Fatalf("iteration %d: agreed should be false when ErrExtendMaxReached", i)
				}
				// Verify extension count never exceeded maxExtensions.
				if successfulExtensions > maxExtensions {
					t.Fatalf("successfulExtensions (%d) exceeded maxExtensions (%d)", successfulExtensions, maxExtensions)
				}
				continue
			}
			if err != nil {
				t.Fatalf("iteration %d alice: unexpected error: %v", i, err)
			}
			if agreed {
				t.Fatalf("iteration %d alice: single proposal should not result in agreement", i)
			}

			// Bob proposes to complete mutual consent
			agreed, err = store.ProposeExtend("room-prop", "bob")
			if err == ErrExtendMaxReached {
				// Edge case: Alice's proposal went through but Bob's was rejected
				// because the limit was already reached (shouldn't happen since we
				// check before recording, but defensively handle it).
				if agreed {
					t.Fatalf("iteration %d: agreed should be false when ErrExtendMaxReached", i)
				}
				continue
			}
			if err != nil {
				t.Fatalf("iteration %d bob: unexpected error: %v", i, err)
			}
			if agreed {
				successfulExtensions++
			}
		}

		// Verify the invariant: successful extensions never exceed maxExtensions.
		if successfulExtensions > maxExtensions {
			t.Fatalf("successfulExtensions (%d) exceeded maxExtensions (%d)", successfulExtensions, maxExtensions)
		}

		// Verify that exactly maxExtensions were completed.
		if successfulExtensions != maxExtensions {
			t.Fatalf("expected exactly %d successful extensions, got %d", maxExtensions, successfulExtensions)
		}

		// Verify that the room state reflects the limit.
		state := store.Get("room-prop")
		if state.ExtensionCount != maxExtensions {
			t.Fatalf("expected ExtensionCount=%d, got %d", maxExtensions, state.ExtensionCount)
		}

		// Verify that any further proposals are always rejected.
		furtherAttempts := rapid.IntRange(1, 5).Draw(t, "furtherAttempts")
		for i := 0; i < furtherAttempts; i++ {
			// Try with either alice or bob randomly.
			client := rapid.SampledFrom([]string{"alice", "bob"}).Draw(t, "postLimitClient")
			agreed, err := store.ProposeExtend("room-prop", client)
			if err != ErrExtendMaxReached {
				t.Fatalf("post-limit attempt %d by %s: expected ErrExtendMaxReached, got %v", i, client, err)
			}
			if agreed {
				t.Fatalf("post-limit attempt %d by %s: agreed should be false", i, client)
			}
		}
	})
}

// --- Property-Based Tests ---

// TestProperty_RoomExtensionMutualConsent verifies Property 9: Room extension mutual consent.
// For ANY match room, extension only happens when BOTH clientA and clientB have active
// (non-expired) proposals. A single proposal alone never triggers extension.
//
// **Validates: Requirements 13.3**
func TestProperty_RoomExtensionMutualConsent(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate random room participants.
		clientA := fmt.Sprintf("client-a-%d", rapid.IntRange(1, 10000).Draw(t, "clientA"))
		clientB := fmt.Sprintf("client-b-%d", rapid.IntRange(1, 10000).Draw(t, "clientB"))
		roomID := fmt.Sprintf("room-%d", rapid.IntRange(1, 10000).Draw(t, "roomID"))
		maxExtensions := rapid.IntRange(1, 10).Draw(t, "maxExtensions")

		store := NewMatchRoomStateStore(maxExtensions)
		store.Add(&MatchRoomState{
			RoomID:    roomID,
			ClientAID: clientA,
			ClientBID: clientB,
			CreatedAt: time.Now(),
		})

		// Generate a random sequence of proposals from clientA and/or clientB.
		// Each action is: 0 = clientA proposes, 1 = clientB proposes.
		numActions := rapid.IntRange(1, 20).Draw(t, "numActions")

		proposedA := false // tracks if clientA has a pending proposal
		proposedB := false // tracks if clientB has a pending proposal
		extensionsBefore := 0

		for i := range numActions {
			who := rapid.IntRange(0, 1).Draw(t, fmt.Sprintf("action_%d", i))
			var clientID string
			if who == 0 {
				clientID = clientA
			} else {
				clientID = clientB
			}

			agreed, err := store.ProposeExtend(roomID, clientID)

			// If max extensions reached, skip the rest of the test.
			if err == ErrExtendMaxReached {
				break
			}
			if err != nil {
				t.Fatalf("unexpected error on action %d: %v", i, err)
			}

			// Update local tracking of who has proposed.
			if who == 0 {
				proposedA = true
			} else {
				proposedB = true
			}

			if agreed {
				// Property: extension ONLY happens when BOTH have proposed.
				if !proposedA || !proposedB {
					t.Fatalf("extension triggered without mutual consent at action %d: proposedA=%v, proposedB=%v",
						i, proposedA, proposedB)
				}
				// After extension, proposals are cleared.
				proposedA = false
				proposedB = false
				extensionsBefore++
			} else {
				// Property: single proposal alone does NOT extend.
				// When only one side has proposed (not both), agreed must be false.
				// This is automatically satisfied by reaching this branch.
			}
		}

		// Verify: after all actions, extension count matches the number of mutual agreements.
		state := store.Get(roomID)
		if state.ExtensionCount != extensionsBefore {
			t.Fatalf("expected ExtensionCount=%d, got %d", extensionsBefore, state.ExtensionCount)
		}
	})
}

// TestProperty_RoomExtensionSingleProposalNeverExtends verifies that a single user
// proposing repeatedly (without the other user) never triggers an extension.
// This is a focused sub-property of Property 9 testing the "single proposal alone
// SHALL NOT extend" invariant more directly.
//
// **Validates: Requirements 13.3**
func TestProperty_RoomExtensionSingleProposalNeverExtends(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		clientA := fmt.Sprintf("client-a-%d", rapid.IntRange(1, 10000).Draw(t, "clientA"))
		clientB := fmt.Sprintf("client-b-%d", rapid.IntRange(1, 10000).Draw(t, "clientB"))
		roomID := fmt.Sprintf("room-%d", rapid.IntRange(1, 10000).Draw(t, "roomID"))

		store := NewMatchRoomStateStore(3)
		store.Add(&MatchRoomState{
			RoomID:    roomID,
			ClientAID: clientA,
			ClientBID: clientB,
			CreatedAt: time.Now(),
		})

		// Only one user proposes repeatedly — extension must never trigger.
		singleClient := clientA
		if rapid.Bool().Draw(t, "pickClientB") {
			singleClient = clientB
		}

		numProposals := rapid.IntRange(1, 15).Draw(t, "numProposals")
		for i := range numProposals {
			agreed, err := store.ProposeExtend(roomID, singleClient)
			if err != nil {
				t.Fatalf("unexpected error on proposal %d: %v", i, err)
			}
			if agreed {
				t.Fatalf("extension triggered with only %s proposing (proposal %d)", singleClient, i)
			}
		}

		// Verify extension count is still 0.
		state := store.Get(roomID)
		if state.ExtensionCount != 0 {
			t.Fatalf("expected ExtensionCount=0 with single proposer, got %d", state.ExtensionCount)
		}
	})
}
