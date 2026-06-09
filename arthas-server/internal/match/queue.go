package match

import (
	"errors"
	"sync"
	"time"
)

// ClientRef is the minimal interface that Match_Server uses to reference a client connection.
// Hub's Client struct implements this interface, decoupling Match from Hub internals.
type ClientRef interface {
	GetID() string
	GetRoomID() string
	GetRemoteIP() string
	Send(data []byte)
}

// MatchEntry represents a single record in the match queue.
type MatchEntry struct {
	ClientRef   ClientRef // WebSocket connection reference
	Tags        []string  // 0-3 interest tags
	EnqueuedAt  time.Time // Time when the entry was added to the queue
	InviteToken string    // Associated invite link token (empty = no invite)
}

// MatchQueue is a thread-safe match queue ordered by enqueue time.
// All public methods acquire the mutex for safe concurrent access from
// both Hub.Run() goroutine and MatchServer.Run() goroutine.
type MatchQueue struct {
	mu       sync.Mutex
	entries  []*MatchEntry          // Ordered queue (by enqueue time)
	byClient map[string]*MatchEntry // clientID → entry for O(1) lookup
	maxSize  int
}

// Sentinel errors for queue operations.
var (
	ErrQueueFull      = errors.New("match: queue is full")
	ErrAlreadyInQueue = errors.New("match: client already in queue")
)

// NewMatchQueue creates a new MatchQueue with the given maximum capacity.
func NewMatchQueue(maxSize int) *MatchQueue {
	return &MatchQueue{
		entries:  make([]*MatchEntry, 0),
		byClient: make(map[string]*MatchEntry),
		maxSize:  maxSize,
	}
}

// Enqueue adds an entry to the queue. Returns ErrAlreadyInQueue if the client
// is already queued, or ErrQueueFull if the queue has reached maxSize.
func (q *MatchQueue) Enqueue(entry *MatchEntry) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	clientID := entry.ClientRef.GetID()

	if _, exists := q.byClient[clientID]; exists {
		return ErrAlreadyInQueue
	}
	if len(q.entries) >= q.maxSize {
		return ErrQueueFull
	}

	q.entries = append(q.entries, entry)
	q.byClient[clientID] = entry
	return nil
}

// Remove removes and returns the entry for the given clientID.
// Returns nil if the client is not in the queue.
func (q *MatchQueue) Remove(clientID string) *MatchEntry {
	q.mu.Lock()
	defer q.mu.Unlock()

	entry, exists := q.byClient[clientID]
	if !exists {
		return nil
	}

	delete(q.byClient, clientID)
	q.removeFromSlice(clientID)
	return entry
}

// DequeuePair atomically removes both entries identified by idA and idB.
// If either ID is not found, it is silently skipped.
func (q *MatchQueue) DequeuePair(idA, idB string) {
	q.mu.Lock()
	defer q.mu.Unlock()

	delete(q.byClient, idA)
	delete(q.byClient, idB)

	// Remove both from slice in a single pass for efficiency.
	filtered := q.entries[:0]
	for _, e := range q.entries {
		id := e.ClientRef.GetID()
		if id != idA && id != idB {
			filtered = append(filtered, e)
		}
	}
	// Nil out removed tail entries to allow GC of old ClientRef pointers.
	for i := len(filtered); i < len(q.entries); i++ {
		q.entries[i] = nil
	}
	q.entries = filtered
}

// Size returns the current number of entries in the queue.
func (q *MatchQueue) Size() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.entries)
}

// Contains reports whether the given clientID is currently in the queue.
func (q *MatchQueue) Contains(clientID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	_, exists := q.byClient[clientID]
	return exists
}

// ExpireEntries removes all entries that have been in the queue longer than
// the given timeout duration. Returns the removed entries (may be empty).
func (q *MatchQueue) ExpireEntries(timeout time.Duration) []*MatchEntry {
	q.mu.Lock()
	defer q.mu.Unlock()

	cutoff := time.Now().Add(-timeout)
	var expired []*MatchEntry
	var remaining []*MatchEntry

	for _, e := range q.entries {
		if e.EnqueuedAt.Before(cutoff) {
			expired = append(expired, e)
			delete(q.byClient, e.ClientRef.GetID())
		} else {
			remaining = append(remaining, e)
		}
	}

	q.entries = remaining
	return expired
}

// FindMatch scans the queue for the best match partner for the first eligible user.
// Priority: tag overlap > FIFO (after TagFallbackDelay).
// Exclusions: skip recent pairs (from RecentPairsTracker), skip self.
// Returns (entryA, entryB) on match, or (nil, nil) if no match available.
func (q *MatchQueue) FindMatch(recentPairs *RecentPairsTracker, now time.Time, tagFallback time.Duration) (*MatchEntry, *MatchEntry) {
	q.mu.Lock()
	defer q.mu.Unlock()

	return q.findMatchLocked(recentPairs, now, tagFallback)
}

// FindAllMatches returns all possible pairs in a single call (batch matching).
// Loops FindMatch until no more pairs found.
func (q *MatchQueue) FindAllMatches(recentPairs *RecentPairsTracker, now time.Time, tagFallback time.Duration) [][2]*MatchEntry {
	q.mu.Lock()
	defer q.mu.Unlock()

	var pairs [][2]*MatchEntry
	for {
		a, b := q.findMatchLocked(recentPairs, now, tagFallback)
		if a == nil {
			break
		}
		pairs = append(pairs, [2]*MatchEntry{a, b})
	}
	return pairs
}

// findMatchLocked performs the matching algorithm without acquiring the lock.
// Caller must hold q.mu.
//
// Algorithm:
//  1. If queue size < 2, return nil.
//  2. For each entry A (FIFO order, earliest first):
//     a. For each entry B after A:
//     - Skip if IsRecentPair(A, B)
//     - Calculate tag overlap (intersection count)
//     b. Pick best match for A:
//     - If A waited < tagFallback: only accept matches with tag overlap > 0
//     - If A waited >= tagFallback: accept any match, but still prefer tag overlap
//     c. If match found: remove pair from queue, return (A, B)
//  3. If no match: return nil, nil
func (q *MatchQueue) findMatchLocked(recentPairs *RecentPairsTracker, now time.Time, tagFallback time.Duration) (*MatchEntry, *MatchEntry) {
	if len(q.entries) < 2 {
		return nil, nil
	}

	for i, entryA := range q.entries {
		idA := entryA.ClientRef.GetID()
		waitedA := now.Sub(entryA.EnqueuedAt)
		fallbackEligible := waitedA >= tagFallback

		var bestMatch *MatchEntry
		bestOverlap := 0

		for j := i + 1; j < len(q.entries); j++ {
			entryB := q.entries[j]
			idB := entryB.ClientRef.GetID()

			// Skip self (should never happen, but defensive).
			if idA == idB {
				continue
			}

			// Skip recent pairs. IsRecentPair acquires its own mutex,
			// which is safe since it's a different lock from q.mu.
			if recentPairs != nil && recentPairs.IsRecentPair(idA, idB) {
				continue
			}

			overlap := tagOverlap(entryA.Tags, entryB.Tags)

			if !fallbackEligible {
				// Only accept matches with tag overlap > 0.
				if overlap > 0 && overlap > bestOverlap {
					bestOverlap = overlap
					bestMatch = entryB
				}
			} else {
				// Accept any match, but prefer tag overlap.
				if bestMatch == nil || overlap > bestOverlap {
					bestOverlap = overlap
					bestMatch = entryB
				}
			}
		}

		if bestMatch != nil {
			// Remove both entries from the queue.
			q.dequeuePairLocked(idA, bestMatch.ClientRef.GetID())
			return entryA, bestMatch
		}
	}

	return nil, nil
}

// dequeuePairLocked removes both entries identified by idA and idB.
// Caller must hold q.mu.
func (q *MatchQueue) dequeuePairLocked(idA, idB string) {
	delete(q.byClient, idA)
	delete(q.byClient, idB)

	filtered := q.entries[:0]
	for _, e := range q.entries {
		id := e.ClientRef.GetID()
		if id != idA && id != idB {
			filtered = append(filtered, e)
		}
	}
	// Nil out removed tail entries to allow GC of old ClientRef pointers.
	for i := len(filtered); i < len(q.entries); i++ {
		q.entries[i] = nil
	}
	q.entries = filtered
}

// tagOverlap returns the number of common tags between two tag slices.
func tagOverlap(tagsA, tagsB []string) int {
	if len(tagsA) == 0 || len(tagsB) == 0 {
		return 0
	}
	count := 0
	for _, a := range tagsA {
		for _, b := range tagsB {
			if a == b {
				count++
				break
			}
		}
	}
	return count
}

// removeFromSlice removes the entry with the given clientID from the entries slice.
// Caller must hold q.mu.
func (q *MatchQueue) removeFromSlice(clientID string) {
	for i, e := range q.entries {
		if e.ClientRef.GetID() == clientID {
			// Preserve order (queue is ordered by enqueue time).
			q.entries = append(q.entries[:i], q.entries[i+1:]...)
			return
		}
	}
}
