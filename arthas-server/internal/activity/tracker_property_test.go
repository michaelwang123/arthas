// tracker_property_test.go — Property-based tests for the ActivityTracker module.
//
// Uses pgregory.net/rapid to verify core correctness properties of the sliding window
// counter: increment counting, time-based expiry, removal, ring buffer cap,
// monotonicity under frozen time, and concurrent safety.
//
// All tests run with -race flag to detect data races.
//
// Feature: room-activity-ranking
package activity

import (
	"sync"
	"testing"
	"time"

	"pgregory.net/rapid"
)

// **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 7.3, 8.1, 8.2, 8.4, 8.5**

// TestProperty1_IncrementGrowsCount verifies that N increments within the sliding
// window result in GetCount returning exactly N (for N ≤ cap).
//
// Property 1: Increment grows count
// For any room ID and any sequence of N Increment calls (where N ≤ maxEvents)
// all occurring within the sliding window, GetCount(roomID) SHALL equal N.
//
// **Validates: Requirements 1.1, 7.3**
func TestProperty1_IncrementGrowsCount(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Use a small cap to keep tests fast but still meaningful.
		cap := 100
		window := 5 * time.Minute

		now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
		tracker := New(window, cap).WithNowFunc(func() time.Time { return now })

		roomID := rapid.StringMatching(`room-[a-z0-9]{4,8}`).Draw(t, "roomID")
		n := rapid.IntRange(1, cap).Draw(t, "n")

		for i := 0; i < n; i++ {
			tracker.Increment(roomID)
		}

		got := tracker.GetCount(roomID)
		if got != n {
			t.Fatalf("after %d increments, GetCount = %d, want %d", n, got, n)
		}
	})
}

// TestProperty2_SlidingWindowExpiry verifies that events older than the window
// duration are excluded from the count.
//
// Property 2: Sliding window expiry
// For any room with events at various timestamps, GetCount(roomID) SHALL return
// only the count of events whose timestamps are within the most recent 5 minutes
// relative to the current time.
//
// **Validates: Requirements 1.2, 1.3, 8.1, 8.2**
func TestProperty2_SlidingWindowExpiry(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		cap := 100
		window := 5 * time.Minute

		now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
		currentTime := now
		tracker := New(window, cap).WithNowFunc(func() time.Time { return currentTime })

		roomID := rapid.StringMatching(`room-[a-z0-9]{4,8}`).Draw(t, "roomID")

		// Phase 1: Add some events in the "past" (before the window will slide).
		oldCount := rapid.IntRange(1, 20).Draw(t, "oldCount")
		for i := 0; i < oldCount; i++ {
			tracker.Increment(roomID)
		}

		// Phase 2: Advance time beyond the window so all old events expire.
		currentTime = now.Add(window + time.Second)

		// Phase 3: Add new events that are within the window.
		newCount := rapid.IntRange(0, 20).Draw(t, "newCount")
		for i := 0; i < newCount; i++ {
			tracker.Increment(roomID)
		}

		// Verify: only new events should be counted.
		got := tracker.GetCount(roomID)
		if got != newCount {
			t.Fatalf("after expiry, GetCount = %d, want %d (old=%d expired)", got, newCount, oldCount)
		}
	})
}

// TestProperty3_RemoveDiscardsAllData verifies that after Remove, GetCount returns 0
// regardless of prior activity.
//
// Property 3: Remove discards all data
// For any room ID with any prior activity history, after calling Remove(roomID),
// GetCount(roomID) SHALL return 0.
//
// **Validates: Requirements 1.5**
func TestProperty3_RemoveDiscardsAllData(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		cap := 100
		window := 5 * time.Minute

		now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
		tracker := New(window, cap).WithNowFunc(func() time.Time { return now })

		roomID := rapid.StringMatching(`room-[a-z0-9]{4,8}`).Draw(t, "roomID")
		n := rapid.IntRange(1, cap).Draw(t, "n")

		// Add activity.
		for i := 0; i < n; i++ {
			tracker.Increment(roomID)
		}

		// Confirm activity exists.
		if tracker.GetCount(roomID) == 0 {
			t.Fatal("expected non-zero count before Remove")
		}

		// Remove and verify.
		tracker.Remove(roomID)

		got := tracker.GetCount(roomID)
		if got != 0 {
			t.Fatalf("after Remove, GetCount = %d, want 0", got)
		}
	})
}

// TestProperty5_EventCapRingBuffer verifies ring buffer semantics: when more than
// cap events are recorded within the window, GetCount returns exactly cap and the
// oldest events are evicted.
//
// Property 5: Event cap with ring buffer semantics
// For any room where more than cap Increment calls occur within the sliding window,
// GetCount(roomID) SHALL return exactly cap.
//
// **Validates: Requirements 8.4, 8.5**
func TestProperty5_EventCapRingBuffer(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Use a small cap (100) to make tests fast.
		cap := 100
		window := 5 * time.Minute

		now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
		tracker := New(window, cap).WithNowFunc(func() time.Time { return now })

		roomID := rapid.StringMatching(`room-[a-z0-9]{4,8}`).Draw(t, "roomID")

		// Insert more events than the cap.
		overflow := rapid.IntRange(1, 200).Draw(t, "overflow")
		totalEvents := cap + overflow

		for i := 0; i < totalEvents; i++ {
			tracker.Increment(roomID)
		}

		got := tracker.GetCount(roomID)
		if got != cap {
			t.Fatalf("after %d increments (cap=%d), GetCount = %d, want %d",
				totalEvents, cap, got, cap)
		}
	})
}

// TestProperty7_MonotonicityFrozenTime verifies that under frozen time (nowFunc
// always returns the same instant), the count is monotonically non-decreasing
// after each Increment, up to the cap.
//
// Property 7: Monotonicity within frozen time
// For any room ID and any sequence of Increment calls made at the same timestamp,
// GetCount(roomID) SHALL be monotonically non-decreasing after each Increment,
// up to the cap.
//
// **Validates: Requirements 1.6**
func TestProperty7_MonotonicityFrozenTime(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		cap := 100
		window := 5 * time.Minute

		now := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)
		tracker := New(window, cap).WithNowFunc(func() time.Time { return now })

		roomID := rapid.StringMatching(`room-[a-z0-9]{4,8}`).Draw(t, "roomID")
		n := rapid.IntRange(1, cap+50).Draw(t, "n")

		prevCount := 0
		for i := 0; i < n; i++ {
			tracker.Increment(roomID)
			count := tracker.GetCount(roomID)

			if count < prevCount {
				t.Fatalf("monotonicity violated at iteration %d: prev=%d, current=%d",
					i, prevCount, count)
			}
			prevCount = count
		}

		// Final count should be min(n, cap).
		expected := n
		if expected > cap {
			expected = cap
		}
		if prevCount != expected {
			t.Fatalf("final count = %d, want min(%d, %d) = %d", prevCount, n, cap, expected)
		}
	})
}

// TestProperty9_ConcurrentSafety verifies that concurrent calls to Increment,
// GetCount, Remove, and Cleanup do not cause panics, races, or negative counts.
//
// Property 9: Concurrent safety
// For any combination of concurrent Increment, GetCount, Remove, and Cleanup calls
// across multiple goroutines, the Tracker SHALL never panic, produce negative counts,
// or enter an inconsistent state.
//
// **Validates: Requirements 1.6**
func TestProperty9_ConcurrentSafety(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		cap := 100
		window := 5 * time.Minute
		tracker := New(window, cap)

		numRooms := rapid.IntRange(2, 5).Draw(t, "numRooms")
		rooms := make([]string, numRooms)
		for i := range rooms {
			rooms[i] = rapid.StringMatching(`room-[a-z0-9]{4,8}`).Draw(t, "room")
		}

		numGoroutines := rapid.IntRange(4, 8).Draw(t, "numGoroutines")
		opsPerGoroutine := rapid.IntRange(50, 200).Draw(t, "opsPerGoroutine")

		var wg sync.WaitGroup
		wg.Add(numGoroutines)

		for g := 0; g < numGoroutines; g++ {
			go func(gID int) {
				defer wg.Done()
				for op := 0; op < opsPerGoroutine; op++ {
					roomIdx := (gID + op) % numRooms
					roomID := rooms[roomIdx]

					switch op % 4 {
					case 0:
						tracker.Increment(roomID)
					case 1:
						count := tracker.GetCount(roomID)
						if count < 0 {
							t.Errorf("negative count %d for room %s", count, roomID)
						}
					case 2:
						tracker.Remove(roomID)
					case 3:
						tracker.Cleanup()
					}
				}
			}(g)
		}

		wg.Wait()

		// After all goroutines finish, verify no negative counts.
		for _, roomID := range rooms {
			count := tracker.GetCount(roomID)
			if count < 0 {
				t.Fatalf("negative count %d for room %s after concurrent ops", count, roomID)
			}
		}
	})
}
