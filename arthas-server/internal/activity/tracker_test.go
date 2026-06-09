package activity

import (
	"testing"
	"time"
)

func TestTracker_IncrementOnce(t *testing.T) {
	tr := New(5*time.Minute, 10000)

	tr.Increment("room-1")

	got := tr.GetCount("room-1")
	if got != 1 {
		t.Errorf("GetCount after single Increment: got %d, want 1", got)
	}
}

func TestTracker_TimeAdvanceCausesExpiry(t *testing.T) {
	now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	tr := New(5*time.Minute, 10000).WithNowFunc(func() time.Time { return now })

	// Record some events at t=0
	tr.Increment("room-1")
	tr.Increment("room-1")
	tr.Increment("room-1")

	// Sanity check: count is 3 within window
	if got := tr.GetCount("room-1"); got != 3 {
		t.Fatalf("GetCount before time advance: got %d, want 3", got)
	}

	// Advance time past the 5-minute window
	now = now.Add(5*time.Minute + time.Second)
	tr.WithNowFunc(func() time.Time { return now })

	got := tr.GetCount("room-1")
	if got != 0 {
		t.Errorf("GetCount after time advance past window: got %d, want 0", got)
	}
}

func TestTracker_RemoveNonExistentRoom(t *testing.T) {
	tr := New(5*time.Minute, 10000)

	// Should not panic when removing a room that was never tracked
	tr.Remove("nonexistent-room")
}

func TestTracker_RingBufferEviction(t *testing.T) {
	const cap = 10000
	now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
	tr := New(5*time.Minute, cap).WithNowFunc(func() time.Time { return now })

	// Increment 10,001 times (one more than cap)
	for i := 0; i < cap+1; i++ {
		tr.Increment("room-1")
	}

	got := tr.GetCount("room-1")
	if got != cap {
		t.Errorf("GetCount after %d increments (cap=%d): got %d, want %d", cap+1, cap, got, cap)
	}
}

func TestTracker_CleanupEmpty(t *testing.T) {
	tr := New(5*time.Minute, 10000)

	// Should not panic when cleaning up an empty tracker
	tr.Cleanup()
}

func TestTracker_GetCountUnknownRoom(t *testing.T) {
	tr := New(5*time.Minute, 10000)

	got := tr.GetCount("unknown-room")
	if got != 0 {
		t.Errorf("GetCount for unknown room: got %d, want 0", got)
	}
}
