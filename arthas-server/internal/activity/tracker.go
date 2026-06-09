package activity

import (
	"sort"
	"sync"
	"time"
)

// Tracker maintains per-room message event counts within a sliding window.
// It uses a ring buffer of unix millisecond timestamps per room, capped at
// maxEvents entries to ensure bounded memory usage.
//
// Thread safety: all public methods are safe for concurrent use.
// Increment, Remove, and Cleanup acquire a write lock.
// GetCount acquires a read lock (pure read — pruning is deferred to Cleanup).
type Tracker struct {
	mu        sync.RWMutex
	rooms     map[string]*roomActivity
	window    time.Duration
	maxEvents int
	nowFunc   func() time.Time
}

// roomActivity holds the sliding window timestamps for a single room.
type roomActivity struct {
	timestamps []int64 // unix milliseconds, chronologically ordered, max maxEvents entries
}

// New creates a Tracker with the given window duration and per-room event cap.
// The window determines how far back events are counted (typically 5 minutes).
// maxEvents caps the number of stored timestamps per room (typically 10,000).
func New(window time.Duration, maxEvents int) *Tracker {
	return &Tracker{
		rooms:     make(map[string]*roomActivity),
		window:    window,
		maxEvents: maxEvents,
		nowFunc:   time.Now,
	}
}

// WithNowFunc sets a custom time function (for testing). Returns the Tracker for chaining.
func (t *Tracker) WithNowFunc(fn func() time.Time) *Tracker {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.nowFunc = fn
	return t
}

// Increment records a message relay event for the given room.
// O(1) amortized: appends the current timestamp. If the cap is reached,
// the oldest timestamp is evicted via copy to a fresh slice (prevents memory retention).
func (t *Tracker) Increment(roomID string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := t.nowFunc().UnixMilli()

	ra, exists := t.rooms[roomID]
	if !exists {
		ra = &roomActivity{
			timestamps: make([]int64, 0, 64),
		}
		t.rooms[roomID] = ra
	}

	if len(ra.timestamps) >= t.maxEvents {
		// Ring buffer eviction: copy tail to a fresh slice to avoid memory retention.
		// The old backing array becomes eligible for GC.
		newTs := make([]int64, t.maxEvents)
		copy(newTs, ra.timestamps[1:])
		newTs[t.maxEvents-1] = now
		ra.timestamps = newTs
	} else {
		ra.timestamps = append(ra.timestamps, now)
	}
}

// GetCount returns the number of events within the sliding window for a room.
// This is a pure read operation — expired entries are NOT pruned here.
// Pruning is handled by the periodic Cleanup() call (every 60s).
// Returns 0 for unknown rooms (no error).
func (t *Tracker) GetCount(roomID string) int {
	t.mu.RLock()
	defer t.mu.RUnlock()

	ra, exists := t.rooms[roomID]
	if !exists {
		return 0
	}

	cutoff := t.nowFunc().Add(-t.window).UnixMilli()

	// Binary search for the first timestamp >= cutoff.
	// All timestamps are in chronological order (oldest first).
	idx := sort.Search(len(ra.timestamps), func(i int) bool {
		return ra.timestamps[i] >= cutoff
	})

	return len(ra.timestamps) - idx
}

// Remove discards all activity data for a room (called on room destruction).
func (t *Tracker) Remove(roomID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.rooms, roomID)
}

// Cleanup prunes expired entries across all rooms. Called periodically (e.g., 60s ticker).
// Rooms with no remaining valid timestamps are removed from the map entirely.
// Uses compaction (copy to fresh slice) to prevent memory retention from reslicing.
func (t *Tracker) Cleanup() {
	t.mu.Lock()
	defer t.mu.Unlock()

	cutoff := t.nowFunc().Add(-t.window).UnixMilli()

	for roomID, ra := range t.rooms {
		// Binary search for the first valid timestamp.
		idx := sort.Search(len(ra.timestamps), func(i int) bool {
			return ra.timestamps[i] >= cutoff
		})

		if idx >= len(ra.timestamps) {
			// All timestamps expired — remove the room entirely.
			delete(t.rooms, roomID)
		} else if idx > 0 {
			// Compact: copy valid entries to a fresh slice (frees old backing array).
			remaining := ra.timestamps[idx:]
			compacted := make([]int64, len(remaining))
			copy(compacted, remaining)
			ra.timestamps = compacted
		}
	}
}
