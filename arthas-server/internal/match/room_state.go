package match

import (
	"errors"
	"sync"
	"time"
)

const proposalTTL = 60 * time.Second

// Sentinel errors for room state operations.
var (
	ErrRoomNotFound     = errors.New("match: room not found")
	ErrExtendMaxReached = errors.New("match: max extensions reached")
	ErrClientNotInRoom  = errors.New("match: client is not a participant of this room")
)

// MatchRoomState tracks extension state and participant info for an active match room.
// Independent from Room infrastructure (Room struct does not contain match-related fields).
type MatchRoomState struct {
	RoomID         string
	ClientAID      string
	ClientBID      string
	ClientAIP      string               // IP address of Client A (for report tracking)
	ClientBIP      string               // IP address of Client B (for report tracking)
	ClientARef     ClientRef            // Connection reference for Client A (for sending messages)
	ClientBRef     ClientRef            // Connection reference for Client B (for sending messages)
	ExtensionCount int                  // Number of successful extensions so far
	PendingExtend  map[string]time.Time // clientID → proposal time (TTL=60s)
	CreatedAt      time.Time
}

// MatchRoomStateStore is a thread-safe store for match room states.
// Protected by sync.Mutex for concurrent access from Hub.Run() goroutine
// and MatchServer.Run() goroutine.
type MatchRoomStateStore struct {
	mu            sync.Mutex
	states        map[string]*MatchRoomState // roomID → state
	byClient      map[string]string          // clientID → roomID (O(1) lookup)
	maxExtensions int
}

// NewMatchRoomStateStore creates a new MatchRoomStateStore with the given extension limit.
func NewMatchRoomStateStore(maxExtensions int) *MatchRoomStateStore {
	return &MatchRoomStateStore{
		states:        make(map[string]*MatchRoomState),
		byClient:      make(map[string]string),
		maxExtensions: maxExtensions,
	}
}

// Add registers a new match room state. If a state for the same roomID already exists,
// it is overwritten.
func (s *MatchRoomStateStore) Add(state *MatchRoomState) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if state.PendingExtend == nil {
		state.PendingExtend = make(map[string]time.Time)
	}
	s.states[state.RoomID] = state
	s.byClient[state.ClientAID] = state.RoomID
	s.byClient[state.ClientBID] = state.RoomID
}

// Get returns the room state for the given roomID, or nil if not found.
func (s *MatchRoomStateStore) Get(roomID string) *MatchRoomState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.states[roomID]
}

// Remove deletes the room state for the given roomID (called when room is destroyed).
func (s *MatchRoomStateStore) Remove(roomID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if state, exists := s.states[roomID]; exists {
		delete(s.byClient, state.ClientAID)
		delete(s.byClient, state.ClientBID)
	}
	delete(s.states, roomID)
}

// ProposeExtend records one user's extension proposal for the given room.
// Returns (true, nil) when both users have active (non-expired) proposals — caller
// should extend the room. Returns (false, nil) when waiting for the other user.
// Returns an error if the room is not found, the client is not a participant,
// or max extensions have been reached.
//
// Logic:
//  1. Find room state. If not found → ErrRoomNotFound.
//  2. Validate clientID is a participant (ClientAID or ClientBID).
//  3. If ExtensionCount >= maxExtensions → ErrExtendMaxReached (M011).
//  4. Record clientID → now in PendingExtend.
//  5. Check if both ClientAID and ClientBID have non-expired entries.
//  6. If yes → increment ExtensionCount, clear PendingExtend, return true.
//  7. If no → return false (waiting for other user).
func (s *MatchRoomStateStore) ProposeExtend(roomID, clientID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, exists := s.states[roomID]
	if !exists {
		return false, ErrRoomNotFound
	}

	// Validate that clientID is a participant of this room.
	if clientID != state.ClientAID && clientID != state.ClientBID {
		return false, ErrClientNotInRoom
	}

	// Check extension limit.
	if state.ExtensionCount >= s.maxExtensions {
		return false, ErrExtendMaxReached
	}

	// Record the proposal.
	now := time.Now()
	state.PendingExtend[clientID] = now

	// Check if both participants have non-expired proposals.
	proposalA, hasA := state.PendingExtend[state.ClientAID]
	proposalB, hasB := state.PendingExtend[state.ClientBID]

	if hasA && hasB && now.Sub(proposalA) < proposalTTL && now.Sub(proposalB) < proposalTTL {
		// Both agreed — extend the room.
		state.ExtensionCount++
		state.PendingExtend = make(map[string]time.Time)
		return true, nil
	}

	return false, nil
}

// CleanExpiredProposals iterates all rooms and removes proposals older than 60 seconds.
// Called periodically by the cleanup ticker in MatchServer.Run().
func (s *MatchRoomStateStore) CleanExpiredProposals() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	for _, state := range s.states {
		for clientID, proposalTime := range state.PendingExtend {
			if now.Sub(proposalTime) >= proposalTTL {
				delete(state.PendingExtend, clientID)
			}
		}
	}
}

// FindByClientID returns the room state where the given clientID is a participant.
// Uses byClient index for O(1) lookup. Returns nil if not found.
func (s *MatchRoomStateStore) FindByClientID(clientID string) *MatchRoomState {
	s.mu.Lock()
	defer s.mu.Unlock()

	roomID, exists := s.byClient[clientID]
	if !exists {
		return nil
	}
	return s.states[roomID]
}
