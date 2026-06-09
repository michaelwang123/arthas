package match

import (
	"sync"
	"time"
)

// PendingMatch represents a pair undergoing key exchange (TTL=5s).
// After matching, Client A is instructed to generate an AES-256 key.
// This struct tracks the state until the key is relayed and the room is created.
type PendingMatch struct {
	ClientA     ClientRef
	ClientB     ClientRef
	TagsA       []string // Original tags for Client A (preserved for re-queue on timeout)
	TagsB       []string // Original tags for Client B (preserved for re-queue on timeout)
	CreatedAt   time.Time
	KeyReceived bool // true after Client A sends key
}

// PendingMatchStore manages pending key exchanges with thread-safe access.
// It maintains a primary map keyed by Client A's ID and a bidirectional
// index (byAny) allowing lookup by either client's ID.
type PendingMatchStore struct {
	mu      sync.Mutex
	pending map[string]*PendingMatch // clientA.GetID() → PendingMatch
	byAny   map[string]string        // clientID → clientA.GetID() (A or B → key)
}

// NewPendingMatchStore creates a new PendingMatchStore ready for use.
func NewPendingMatchStore() *PendingMatchStore {
	return &PendingMatchStore{
		pending: make(map[string]*PendingMatch),
		byAny:   make(map[string]string),
	}
}

// Add stores a pending match and indexes both client IDs in byAny.
// The pending match is keyed by Client A's ID.
func (s *PendingMatchStore) Add(pm *PendingMatch) {
	s.mu.Lock()
	defer s.mu.Unlock()

	keyID := pm.ClientA.GetID()
	s.pending[keyID] = pm
	s.byAny[pm.ClientA.GetID()] = keyID
	s.byAny[pm.ClientB.GetID()] = keyID
}

// GetByClient looks up a PendingMatch by either client's ID.
// Returns nil if no pending match involves the given client.
func (s *PendingMatchStore) GetByClient(clientID string) *PendingMatch {
	s.mu.Lock()
	defer s.mu.Unlock()

	keyID, exists := s.byAny[clientID]
	if !exists {
		return nil
	}
	return s.pending[keyID]
}

// Remove removes a pending match by Client A's ID and cleans up both
// byAny index entries. No-op if the clientAID is not found.
func (s *PendingMatchStore) Remove(clientAID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	pm, exists := s.pending[clientAID]
	if !exists {
		return
	}

	delete(s.byAny, pm.ClientA.GetID())
	delete(s.byAny, pm.ClientB.GetID())
	delete(s.pending, clientAID)
}

// ExpireAll returns and removes all pending matches older than the given
// timeout duration. This is called periodically by the timeout ticker
// to detect key exchange timeouts.
func (s *PendingMatchStore) ExpireAll(timeout time.Duration) []*PendingMatch {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().Add(-timeout)
	var expired []*PendingMatch

	for keyID, pm := range s.pending {
		if pm.CreatedAt.Before(cutoff) {
			expired = append(expired, pm)
			delete(s.byAny, pm.ClientA.GetID())
			delete(s.byAny, pm.ClientB.GetID())
			delete(s.pending, keyID)
		}
	}

	return expired
}
