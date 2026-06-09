package match

import "sync"

const maxRecentPairs = 5

// RecentPairsTracker maintains server-side records of recent match pairings.
// Used to prevent session loop from re-matching users with recent partners
// (server does not trust client-submitted recentPartners).
//
// Thread-safe: protected by sync.Mutex for concurrent access from
// Hub.Run() goroutine and MatchServer.Run() goroutine.
type RecentPairsTracker struct {
	mu    sync.Mutex
	pairs map[string][]string // clientID → []recentPartnerIDs (last 5, ring buffer)
}

// NewRecentPairsTracker creates a new empty RecentPairsTracker.
func NewRecentPairsTracker() *RecentPairsTracker {
	return &RecentPairsTracker{
		pairs: make(map[string][]string),
	}
}

// RecordPair records a successful pairing bidirectionally (A→B and B→A).
// Each client's partner list is capped at maxRecentPairs (5); when full,
// the oldest entry is dropped (ring buffer behavior).
func (t *RecentPairsTracker) RecordPair(idA, idB string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.addPartner(idA, idB)
	t.addPartner(idB, idA)
}

// IsRecentPair reports whether idA and idB were recently paired.
// Checks both directions for robustness (A's list for B, or B's list for A).
func (t *RecentPairsTracker) IsRecentPair(idA, idB string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.containsPartner(idA, idB) {
		return true
	}
	return t.containsPartner(idB, idA)
}

// Remove cleans up all traces of a disconnected client:
// 1. Removes the client's own entry from the map.
// 2. Removes the client's ID from all other clients' partner lists.
func (t *RecentPairsTracker) Remove(clientID string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	// Remove the client's own partner list.
	delete(t.pairs, clientID)

	// Remove clientID from other clients' lists.
	for id, partners := range t.pairs {
		filtered := partners[:0]
		for _, p := range partners {
			if p != clientID {
				filtered = append(filtered, p)
			}
		}
		if len(filtered) == 0 {
			delete(t.pairs, id)
		} else {
			t.pairs[id] = filtered
		}
	}
}

// addPartner appends partnerID to clientID's partner list, maintaining the
// ring buffer invariant (max 5 entries, oldest dropped first).
// Caller must hold t.mu.
func (t *RecentPairsTracker) addPartner(clientID, partnerID string) {
	partners := t.pairs[clientID]
	if len(partners) >= maxRecentPairs {
		// Drop oldest (index 0), shift left.
		partners = partners[1:]
	}
	t.pairs[clientID] = append(partners, partnerID)
}

// containsPartner checks if partnerID exists in clientID's partner list.
// Caller must hold t.mu.
func (t *RecentPairsTracker) containsPartner(clientID, partnerID string) bool {
	for _, p := range t.pairs[clientID] {
		if p == partnerID {
			return true
		}
	}
	return false
}
