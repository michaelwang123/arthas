package match

import (
	"fmt"
	"testing"
)

func TestNewRecentPairsTracker(t *testing.T) {
	tracker := NewRecentPairsTracker()
	if tracker == nil {
		t.Fatal("expected non-nil tracker")
	}
	if tracker.pairs == nil {
		t.Fatal("expected non-nil pairs map")
	}
}

func TestRecordPair_Bidirectional(t *testing.T) {
	tracker := NewRecentPairsTracker()
	tracker.RecordPair("alice", "bob")

	if !tracker.IsRecentPair("alice", "bob") {
		t.Error("expected alice-bob to be recent pair")
	}
	if !tracker.IsRecentPair("bob", "alice") {
		t.Error("expected bob-alice to be recent pair (reverse lookup)")
	}
}

func TestIsRecentPair_NotRecorded(t *testing.T) {
	tracker := NewRecentPairsTracker()

	if tracker.IsRecentPair("alice", "bob") {
		t.Error("expected unknown pair to return false")
	}
}

func TestRecordPair_RingBuffer_DropsOldest(t *testing.T) {
	tracker := NewRecentPairsTracker()

	// Record 6 partners for "alice" — the first should be evicted.
	for i := 0; i < 6; i++ {
		tracker.RecordPair("alice", fmt.Sprintf("partner-%d", i))
	}

	// partner-0 was the oldest and should be evicted from alice's list.
	// However, partner-0's list still contains alice, so bidirectional check
	// may still find it via partner-0 → alice direction.
	// Check alice's own list directly.
	tracker.mu.Lock()
	alicePartners := tracker.pairs["alice"]
	tracker.mu.Unlock()

	if len(alicePartners) != 5 {
		t.Fatalf("expected 5 partners for alice, got %d", len(alicePartners))
	}

	// Oldest partner (partner-0) should NOT be in alice's list.
	for _, p := range alicePartners {
		if p == "partner-0" {
			t.Error("expected partner-0 to be evicted from alice's ring buffer")
		}
	}

	// partner-1 through partner-5 should remain.
	for i := 1; i <= 5; i++ {
		found := false
		for _, p := range alicePartners {
			if p == fmt.Sprintf("partner-%d", i) {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected partner-%d to be in alice's list", i)
		}
	}
}

func TestRemove_CleansOwnEntry(t *testing.T) {
	tracker := NewRecentPairsTracker()
	tracker.RecordPair("alice", "bob")
	tracker.RecordPair("alice", "carol")

	tracker.Remove("alice")

	// alice's entry should be gone.
	tracker.mu.Lock()
	_, exists := tracker.pairs["alice"]
	tracker.mu.Unlock()

	if exists {
		t.Error("expected alice's entry to be removed")
	}
}

func TestRemove_CleansFromOtherLists(t *testing.T) {
	tracker := NewRecentPairsTracker()
	tracker.RecordPair("alice", "bob")
	tracker.RecordPair("carol", "alice")

	tracker.Remove("alice")

	// bob's list should no longer contain alice.
	tracker.mu.Lock()
	bobPartners := tracker.pairs["bob"]
	carolPartners := tracker.pairs["carol"]
	tracker.mu.Unlock()

	for _, p := range bobPartners {
		if p == "alice" {
			t.Error("expected alice to be removed from bob's partner list")
		}
	}
	for _, p := range carolPartners {
		if p == "alice" {
			t.Error("expected alice to be removed from carol's partner list")
		}
	}
}

func TestRemove_DeletesEmptyEntries(t *testing.T) {
	tracker := NewRecentPairsTracker()
	tracker.RecordPair("alice", "bob")

	// bob's only partner is alice. After removing alice, bob's list is empty
	// and should be deleted from the map.
	tracker.Remove("alice")

	tracker.mu.Lock()
	_, bobExists := tracker.pairs["bob"]
	tracker.mu.Unlock()

	if bobExists {
		t.Error("expected bob's empty entry to be deleted from map")
	}
}

func TestRemove_NonexistentClient(t *testing.T) {
	tracker := NewRecentPairsTracker()
	tracker.RecordPair("alice", "bob")

	// Removing a non-existent client should not panic or corrupt state.
	tracker.Remove("nobody")

	if !tracker.IsRecentPair("alice", "bob") {
		t.Error("expected existing pairs to remain intact")
	}
}

func TestIsRecentPair_AfterRingBufferEviction(t *testing.T) {
	tracker := NewRecentPairsTracker()

	// Fill alice's buffer with 5 partners, then add a 6th.
	for i := 0; i < 5; i++ {
		tracker.RecordPair("alice", fmt.Sprintf("p%d", i))
	}
	tracker.RecordPair("alice", "p5")

	// p0 was evicted from alice's list, but p0's list still has alice.
	// IsRecentPair checks both directions, so it will still return true
	// via p0 → alice direction (p0's list was never evicted since p0
	// only has 1 partner).
	if !tracker.IsRecentPair("alice", "p0") {
		t.Error("expected IsRecentPair to find pair via reverse direction (p0 → alice)")
	}

	// Verify a truly non-existent pair returns false.
	if tracker.IsRecentPair("alice", "unknown") {
		t.Error("expected false for unknown partner")
	}
}

func TestRecordPair_MultiplePairsForSameClient(t *testing.T) {
	tracker := NewRecentPairsTracker()
	tracker.RecordPair("alice", "bob")
	tracker.RecordPair("alice", "carol")
	tracker.RecordPair("alice", "dave")

	if !tracker.IsRecentPair("alice", "bob") {
		t.Error("expected alice-bob pair")
	}
	if !tracker.IsRecentPair("alice", "carol") {
		t.Error("expected alice-carol pair")
	}
	if !tracker.IsRecentPair("alice", "dave") {
		t.Error("expected alice-dave pair")
	}
}
