package match

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"pgregory.net/rapid"
)

// mockClient implements ClientRef for testing purposes.
type mockClient struct {
	id       string
	roomID   string
	remoteIP string
	sent     [][]byte
	mu       sync.Mutex
}

func newMockClient(id string) *mockClient {
	return &mockClient{id: id, remoteIP: "127.0.0.1"}
}

func (m *mockClient) GetID() string       { return m.id }
func (m *mockClient) GetRoomID() string   { return m.roomID }
func (m *mockClient) GetRemoteIP() string { return m.remoteIP }
func (m *mockClient) Send(data []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, data)
}

func TestNewMatchQueue(t *testing.T) {
	q := NewMatchQueue(50)
	if q.Size() != 0 {
		t.Errorf("new queue should be empty, got size %d", q.Size())
	}
}

func TestEnqueue_Success(t *testing.T) {
	q := NewMatchQueue(10)
	entry := &MatchEntry{
		ClientRef:  newMockClient("client-1"),
		Tags:       []string{"tech"},
		EnqueuedAt: time.Now(),
	}

	err := q.Enqueue(entry)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if q.Size() != 1 {
		t.Errorf("expected size 1, got %d", q.Size())
	}
}

func TestEnqueue_RejectDuplicate(t *testing.T) {
	q := NewMatchQueue(10)
	client := newMockClient("client-1")

	entry1 := &MatchEntry{ClientRef: client, EnqueuedAt: time.Now()}
	entry2 := &MatchEntry{ClientRef: client, EnqueuedAt: time.Now()}

	if err := q.Enqueue(entry1); err != nil {
		t.Fatalf("first enqueue should succeed: %v", err)
	}

	err := q.Enqueue(entry2)
	if err != ErrAlreadyInQueue {
		t.Errorf("expected ErrAlreadyInQueue, got %v", err)
	}
	if q.Size() != 1 {
		t.Errorf("queue should still have 1 entry, got %d", q.Size())
	}
}

func TestEnqueue_RejectWhenFull(t *testing.T) {
	q := NewMatchQueue(2)

	e1 := &MatchEntry{ClientRef: newMockClient("c1"), EnqueuedAt: time.Now()}
	e2 := &MatchEntry{ClientRef: newMockClient("c2"), EnqueuedAt: time.Now()}
	e3 := &MatchEntry{ClientRef: newMockClient("c3"), EnqueuedAt: time.Now()}

	_ = q.Enqueue(e1)
	_ = q.Enqueue(e2)

	err := q.Enqueue(e3)
	if err != ErrQueueFull {
		t.Errorf("expected ErrQueueFull, got %v", err)
	}
	if q.Size() != 2 {
		t.Errorf("expected size 2, got %d", q.Size())
	}
}

func TestRemove_Existing(t *testing.T) {
	q := NewMatchQueue(10)
	client := newMockClient("client-1")
	entry := &MatchEntry{ClientRef: client, Tags: []string{"music"}, EnqueuedAt: time.Now()}
	_ = q.Enqueue(entry)

	removed := q.Remove("client-1")
	if removed == nil {
		t.Fatal("expected entry to be returned")
	}
	if removed.ClientRef.GetID() != "client-1" {
		t.Errorf("expected client-1, got %s", removed.ClientRef.GetID())
	}
	if q.Size() != 0 {
		t.Errorf("expected empty queue, got size %d", q.Size())
	}
	if q.Contains("client-1") {
		t.Error("queue should not contain removed client")
	}
}

func TestRemove_NotFound(t *testing.T) {
	q := NewMatchQueue(10)
	removed := q.Remove("nonexistent")
	if removed != nil {
		t.Errorf("expected nil for nonexistent client, got %v", removed)
	}
}

func TestDequeuePair(t *testing.T) {
	q := NewMatchQueue(10)
	e1 := &MatchEntry{ClientRef: newMockClient("c1"), EnqueuedAt: time.Now()}
	e2 := &MatchEntry{ClientRef: newMockClient("c2"), EnqueuedAt: time.Now()}
	e3 := &MatchEntry{ClientRef: newMockClient("c3"), EnqueuedAt: time.Now()}

	_ = q.Enqueue(e1)
	_ = q.Enqueue(e2)
	_ = q.Enqueue(e3)

	q.DequeuePair("c1", "c3")

	if q.Size() != 1 {
		t.Errorf("expected 1 remaining, got %d", q.Size())
	}
	if !q.Contains("c2") {
		t.Error("c2 should still be in queue")
	}
	if q.Contains("c1") {
		t.Error("c1 should be removed")
	}
	if q.Contains("c3") {
		t.Error("c3 should be removed")
	}
}

func TestDequeuePair_MissingIDs(t *testing.T) {
	q := NewMatchQueue(10)
	e1 := &MatchEntry{ClientRef: newMockClient("c1"), EnqueuedAt: time.Now()}
	_ = q.Enqueue(e1)

	// Should not panic when one or both IDs are missing.
	q.DequeuePair("c1", "nonexistent")

	if q.Size() != 0 {
		t.Errorf("expected 0 remaining, got %d", q.Size())
	}
}

func TestContains(t *testing.T) {
	q := NewMatchQueue(10)
	entry := &MatchEntry{ClientRef: newMockClient("c1"), EnqueuedAt: time.Now()}
	_ = q.Enqueue(entry)

	if !q.Contains("c1") {
		t.Error("expected Contains to return true for queued client")
	}
	if q.Contains("c2") {
		t.Error("expected Contains to return false for non-queued client")
	}
}

func TestExpireEntries(t *testing.T) {
	q := NewMatchQueue(10)

	now := time.Now()
	old := &MatchEntry{ClientRef: newMockClient("old"), EnqueuedAt: now.Add(-2 * time.Minute)}
	recent := &MatchEntry{ClientRef: newMockClient("recent"), EnqueuedAt: now.Add(-10 * time.Second)}

	_ = q.Enqueue(old)
	_ = q.Enqueue(recent)

	expired := q.ExpireEntries(60 * time.Second)

	if len(expired) != 1 {
		t.Fatalf("expected 1 expired entry, got %d", len(expired))
	}
	if expired[0].ClientRef.GetID() != "old" {
		t.Errorf("expected 'old' to be expired, got %s", expired[0].ClientRef.GetID())
	}
	if q.Size() != 1 {
		t.Errorf("expected 1 remaining, got %d", q.Size())
	}
	if !q.Contains("recent") {
		t.Error("recent entry should remain in queue")
	}
}

func TestExpireEntries_NoneExpired(t *testing.T) {
	q := NewMatchQueue(10)
	entry := &MatchEntry{ClientRef: newMockClient("fresh"), EnqueuedAt: time.Now()}
	_ = q.Enqueue(entry)

	expired := q.ExpireEntries(60 * time.Second)
	if len(expired) != 0 {
		t.Errorf("expected 0 expired, got %d", len(expired))
	}
	if q.Size() != 1 {
		t.Errorf("expected 1 remaining, got %d", q.Size())
	}
}

func TestConcurrentAccess(t *testing.T) {
	q := NewMatchQueue(1000)
	var wg sync.WaitGroup

	// Concurrent enqueues.
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			client := newMockClient(time.Now().String() + string(rune(id)))
			entry := &MatchEntry{ClientRef: client, EnqueuedAt: time.Now()}
			_ = q.Enqueue(entry)
		}(i)
	}

	wg.Wait()

	// Size should be consistent.
	size := q.Size()
	if size < 1 || size > 100 {
		t.Errorf("unexpected queue size after concurrent enqueues: %d", size)
	}
}

// --- Property-Based Tests ---

// TestProperty_QueueUniqueness verifies Property 1: Queue uniqueness.
// For ANY sequence of Enqueue and Remove operations with various client IDs,
// a client ID appears at most once in the queue at any point in time.
//
// **Validates: Requirements 1.3, 2.5**
func TestProperty_QueueUniqueness(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		q := NewMatchQueue(100)

		// Track which client IDs are currently in the queue (our model).
		inQueue := make(map[string]bool)

		// Generate a random number of operations.
		numOps := rapid.IntRange(1, 50).Draw(t, "numOps")

		for i := 0; i < numOps; i++ {
			// Randomly pick an operation: enqueue (70%) or remove (30%).
			op := rapid.IntRange(0, 9).Draw(t, fmt.Sprintf("op_%d", i))
			clientID := rapid.StringMatching(`^client-[a-z0-9]{1,8}$`).Draw(t, fmt.Sprintf("clientID_%d", i))

			if op < 7 {
				// Enqueue operation.
				entry := &MatchEntry{
					ClientRef:  newMockClient(clientID),
					Tags:       []string{},
					EnqueuedAt: time.Now(),
				}
				err := q.Enqueue(entry)

				if inQueue[clientID] {
					// Client already in queue — Enqueue must reject.
					if err != ErrAlreadyInQueue {
						t.Fatalf("expected ErrAlreadyInQueue for duplicate client %q, got %v", clientID, err)
					}
				} else if err == nil {
					// Successfully enqueued.
					inQueue[clientID] = true
				}
				// err == ErrQueueFull is also acceptable; model stays unchanged.
			} else {
				// Remove operation.
				removed := q.Remove(clientID)
				if inQueue[clientID] {
					if removed == nil {
						t.Fatalf("expected Remove(%q) to return entry, got nil", clientID)
					}
					delete(inQueue, clientID)
				} else {
					if removed != nil {
						t.Fatalf("expected Remove(%q) to return nil (not in queue), got entry", clientID)
					}
				}
			}

			// Invariant check: verify uniqueness at every step.
			// Walk the internal queue and check no client ID appears more than once.
			q.mu.Lock()
			seen := make(map[string]bool)
			for _, entry := range q.entries {
				id := entry.ClientRef.GetID()
				if seen[id] {
					t.Fatalf("uniqueness violated: client %q appears more than once in queue", id)
				}
				seen[id] = true
			}

			// Also verify the byClient map is consistent with entries slice.
			if len(q.byClient) != len(q.entries) {
				t.Fatalf("byClient map size (%d) != entries slice length (%d)", len(q.byClient), len(q.entries))
			}
			q.mu.Unlock()
		}
	})
}

// TestProperty_BatchMatchingCompleteness verifies Property 15: Batch matching completeness.
// For ANY N users in the queue with NO recent pair exclusions, FindAllMatches returns
// exactly floor(N/2) pairs in a single call.
//
// **Validates: Requirements 2.4**
func TestProperty_BatchMatchingCompleteness(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate N unique users (2-20).
		n := rapid.IntRange(2, 20).Draw(t, "numUsers")

		q := NewMatchQueue(n + 10)
		now := time.Now()

		// Enqueue N users with distinct client IDs and no tags.
		// All users enqueued in the past so they all have positive wait times.
		for i := 0; i < n; i++ {
			clientID := fmt.Sprintf("user-%d", i)
			entry := &MatchEntry{
				ClientRef:  newMockClient(clientID),
				Tags:       []string{},
				EnqueuedAt: now.Add(-time.Duration(n-i) * time.Millisecond), // all in the past
			}
			if err := q.Enqueue(entry); err != nil {
				t.Fatalf("failed to enqueue %s: %v", clientID, err)
			}
		}

		// Use an empty RecentPairsTracker (no exclusions).
		recentPairs := NewRecentPairsTracker()

		// Call FindAllMatches with tagFallback=0 so all entries are fallback-eligible
		// (FIFO matching, no tag preference needed).
		pairs := q.FindAllMatches(recentPairs, now, 0)

		// Property: FindAllMatches returns exactly floor(N/2) pairs.
		expectedPairs := n / 2
		if len(pairs) != expectedPairs {
			t.Fatalf("expected %d pairs for %d users, got %d", expectedPairs, n, len(pairs))
		}

		// Additional invariant: queue should have N - 2*floor(N/2) entries remaining.
		expectedRemaining := n - 2*expectedPairs
		if q.Size() != expectedRemaining {
			t.Fatalf("expected %d remaining in queue after matching %d users, got %d",
				expectedRemaining, n, q.Size())
		}

		// Additional invariant: all paired entries should have distinct client IDs.
		seen := make(map[string]bool)
		for _, pair := range pairs {
			idA := pair[0].ClientRef.GetID()
			idB := pair[1].ClientRef.GetID()
			if idA == idB {
				t.Fatalf("self-match detected: %s paired with itself", idA)
			}
			if seen[idA] {
				t.Fatalf("client %s appears in multiple pairs", idA)
			}
			if seen[idB] {
				t.Fatalf("client %s appears in multiple pairs", idB)
			}
			seen[idA] = true
			seen[idB] = true
		}
	})
}

// --- Property-Based Tests ---

// TestProperty_AtomicPairRemoval verifies Property 2: Atomic pair removal.
// For ANY queue state and ANY pair of client IDs, after DequeuePair(idA, idB),
// neither idA nor idB exists in the queue, and all other entries remain unchanged.
// Size decreases by the correct amount (0, 1, or 2 depending on which IDs were in queue).
//
// **Validates: Requirements 2.6**
func TestProperty_AtomicPairRemoval(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate a random number of entries to enqueue (1-20).
		numEntries := rapid.IntRange(1, 20).Draw(t, "numEntries")

		// Generate unique client IDs for the queue.
		clientIDs := make([]string, numEntries)
		for i := range numEntries {
			clientIDs[i] = fmt.Sprintf("client-%d", i)
		}

		// Create and populate the queue.
		q := NewMatchQueue(numEntries + 10)
		for _, id := range clientIDs {
			entry := &MatchEntry{
				ClientRef:  newMockClient(id),
				Tags:       []string{},
				EnqueuedAt: time.Now(),
			}
			if err := q.Enqueue(entry); err != nil {
				t.Fatalf("failed to enqueue %s: %v", id, err)
			}
		}

		// Generate the pair to dequeue. They may or may not be in the queue.
		// Use a wider ID range so some draws produce IDs not in the queue.
		maxID := numEntries + 5
		idxA := rapid.IntRange(0, maxID-1).Draw(t, "idxA")
		idxB := rapid.IntRange(0, maxID-1).Draw(t, "idxB")
		idA := fmt.Sprintf("client-%d", idxA)
		idB := fmt.Sprintf("client-%d", idxB)

		// Record pre-state: which IDs are in the queue before DequeuePair.
		aInQueue := q.Contains(idA)
		bInQueue := q.Contains(idB)
		sizeBefore := q.Size()

		// Calculate expected size decrease.
		expectedRemoved := 0
		if aInQueue {
			expectedRemoved++
		}
		// Only count B as removed if it's different from A and is in the queue.
		if bInQueue && idA != idB {
			expectedRemoved++
		}

		// Perform the atomic pair removal.
		q.DequeuePair(idA, idB)

		// Property: neither idA nor idB exists in the queue after removal.
		if q.Contains(idA) {
			t.Fatalf("idA=%q still in queue after DequeuePair", idA)
		}
		if q.Contains(idB) {
			t.Fatalf("idB=%q still in queue after DequeuePair", idB)
		}

		// Property: size decreased by exactly the number of IDs that were present.
		sizeAfter := q.Size()
		if sizeAfter != sizeBefore-expectedRemoved {
			t.Fatalf("size mismatch: before=%d, after=%d, expectedRemoved=%d (idA=%q inQueue=%v, idB=%q inQueue=%v)",
				sizeBefore, sizeAfter, expectedRemoved, idA, aInQueue, idB, bInQueue)
		}

		// Property: all other entries remain in the queue.
		for _, id := range clientIDs {
			if id == idA || id == idB {
				continue
			}
			if !q.Contains(id) {
				t.Fatalf("entry %q was unexpectedly removed from queue after DequeuePair(%q, %q)", id, idA, idB)
			}
		}
	})
}

// TestProperty_FIFOFallbackOrdering verifies Property 4: FIFO fallback ordering.
// When NO tag overlap exists between any queued users (or after TagFallbackDelay),
// the earliest-enqueued user is matched first.
//
// **Validates: Requirements 2.2, 2.3**
func TestProperty_FIFOFallbackOrdering(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate a random number of users to enqueue (3-20).
		// Need at least 3: one "anchor" (earliest) and at least 2 others to verify ordering.
		numUsers := rapid.IntRange(3, 20).Draw(t, "numUsers")

		q := NewMatchQueue(numUsers + 10)
		recentPairs := NewRecentPairsTracker()

		// Use tagFallback=0 so FIFO kicks in immediately (no tag preference wait).
		tagFallback := time.Duration(0)

		// Enqueue users with non-overlapping tags (empty tags = no overlap possible).
		// Use incrementing timestamps to establish clear FIFO order.
		baseTime := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
		entries := make([]*MatchEntry, numUsers)

		for i := range numUsers {
			clientID := fmt.Sprintf("fifo-client-%d", i)
			entries[i] = &MatchEntry{
				ClientRef:  newMockClient(clientID),
				Tags:       []string{}, // Empty tags = no overlap with anyone.
				EnqueuedAt: baseTime.Add(time.Duration(i) * time.Second),
			}
			err := q.Enqueue(entries[i])
			if err != nil {
				t.Fatalf("failed to enqueue %s: %v", clientID, err)
			}
		}

		// Perform matching. With tagFallback=0 and no tag overlap,
		// the algorithm should match in FIFO order: entries[0] paired first.
		now := baseTime.Add(time.Duration(numUsers) * time.Second)
		a, b := q.FindMatch(recentPairs, now, tagFallback)

		// With at least 3 users and no restrictions, a match must be found.
		if a == nil || b == nil {
			t.Fatal("expected a match to be found with 3+ users and no tag restriction")
		}

		// Property: The earliest-enqueued user (entries[0]) must be entryA (the first to be matched).
		if a.ClientRef.GetID() != entries[0].ClientRef.GetID() {
			t.Fatalf("FIFO violated: expected earliest user %q to be matched first, got %q",
				entries[0].ClientRef.GetID(), a.ClientRef.GetID())
		}

		// Property: The partner should be the next earliest user (entries[1]) since
		// with no tag overlap and FIFO, the algorithm picks the first eligible candidate
		// after the anchor in queue order.
		if b.ClientRef.GetID() != entries[1].ClientRef.GetID() {
			t.Fatalf("FIFO violated: expected second-earliest user %q as partner, got %q",
				entries[1].ClientRef.GetID(), b.ClientRef.GetID())
		}
	})
}
