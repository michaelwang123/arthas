package room

import (
	"errors"
	"sync"
)

const (
	// MaxMembers is the maximum number of members allowed in a single room.
	MaxMembers = 50
)

// Errors returned by Room methods.
var (
	ErrRoomFull = errors.New("room is full")
)

// Member represents a participant in a chat room.
type Member struct {
	ID       string
	Name     string
	Color    string
	SendFunc func([]byte) // Called by Broadcast to deliver data to this member.
}

// Room represents a single chat room with its members.
type Room struct {
	ID           string
	PasswordHash string // SHA-256 hash of room password; empty string means no password.
	Ephemeral    int    // Ephemeral message duration in seconds; 0 means disabled.
	mu           sync.RWMutex
	members      map[string]*Member
}

// NewRoom creates a new Room with the given ID, optional password hash, and ephemeral duration.
func NewRoom(id, passwordHash string, ephemeral int) *Room {
	return &Room{
		ID:           id,
		PasswordHash: passwordHash,
		Ephemeral:    ephemeral,
		members:      make(map[string]*Member),
	}
}

// MemberCount returns the current number of members in the room.
func (r *Room) MemberCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.members)
}

// IsFull returns true if the room has reached its capacity limit.
func (r *Room) IsFull() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.members) >= MaxMembers
}

// AddMember adds a member to the room. Returns ErrRoomFull if the room
// has reached MaxMembers capacity.
func (r *Room) AddMember(member *Member) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if len(r.members) >= MaxMembers {
		return ErrRoomFull
	}

	r.members[member.ID] = member
	return nil
}

// RemoveMember removes a member by ID and returns the remaining member count.
func (r *Room) RemoveMember(id string) int {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.members, id)
	return len(r.members)
}

// GetMember returns the member with the given ID, or nil if not found.
func (r *Room) GetMember(id string) *Member {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.members[id]
}

// GetMembers returns a copy of all members currently in the room.
func (r *Room) GetMembers() []*Member {
	r.mu.RLock()
	defer r.mu.RUnlock()

	members := make([]*Member, 0, len(r.members))
	for _, m := range r.members {
		members = append(members, m)
	}
	return members
}

// Broadcast sends data to all members in the room except the sender.
// It calls each member's SendFunc if set. Members without a SendFunc are skipped.
func (r *Room) Broadcast(senderId string, data []byte) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for id, m := range r.members {
		if id == senderId {
			continue
		}
		if m.SendFunc != nil {
			m.SendFunc(data)
		}
	}
}
