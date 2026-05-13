package room

import "sync"

// RoomManager manages the lifecycle of chat rooms.
// It is safe for concurrent use by multiple goroutines.
type RoomManager struct {
	mu    sync.RWMutex
	rooms map[string]*Room
}

// NewRoomManager creates a new RoomManager with an empty room map.
func NewRoomManager() *RoomManager {
	return &RoomManager{
		rooms: make(map[string]*Room),
	}
}

// CreateRoom creates a new room with the given ID and stores it.
// If a room with the same ID already exists, it returns the existing room.
func (rm *RoomManager) CreateRoom(roomId string) *Room {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	if existing, ok := rm.rooms[roomId]; ok {
		return existing
	}

	r := NewRoom(roomId)
	rm.rooms[roomId] = r
	return r
}

// GetRoom returns the room with the given ID, or nil if not found.
func (rm *RoomManager) GetRoom(roomId string) *Room {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return rm.rooms[roomId]
}

// RemoveRoom removes the room with the given ID from the manager.
// This should be called when a room has 0 members.
func (rm *RoomManager) RemoveRoom(roomId string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.rooms, roomId)
}

// RoomCount returns the total number of active rooms.
func (rm *RoomManager) RoomCount() int {
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	return len(rm.rooms)
}
