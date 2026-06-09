package room

import (
	"fmt"
	"sync"
	"testing"
)

func TestNewRoomManager(t *testing.T) {
	rm := NewRoomManager()
	if rm == nil {
		t.Fatal("NewRoomManager returned nil")
	}
	if rm.RoomCount() != 0 {
		t.Errorf("expected 0 rooms, got %d", rm.RoomCount())
	}
}

func TestCreateRoom(t *testing.T) {
	rm := NewRoomManager()

	room := rm.CreateRoom("room-abc123", "", 0, 0, 0)
	if room == nil {
		t.Fatal("CreateRoom returned nil")
	}
	if room.ID != "room-abc123" {
		t.Errorf("expected room ID 'room-abc123', got '%s'", room.ID)
	}
	if rm.RoomCount() != 1 {
		t.Errorf("expected 1 room, got %d", rm.RoomCount())
	}
}

func TestCreateRoom_DuplicateReturnsExisting(t *testing.T) {
	rm := NewRoomManager()

	room1 := rm.CreateRoom("room-1", "", 0, 0, 0)
	room2 := rm.CreateRoom("room-1", "", 0, 0, 0)

	if room1 != room2 {
		t.Error("CreateRoom with same ID should return the existing room")
	}
	if rm.RoomCount() != 1 {
		t.Errorf("expected 1 room, got %d", rm.RoomCount())
	}
}

func TestGetRoom(t *testing.T) {
	rm := NewRoomManager()

	rm.CreateRoom("room-xyz", "", 0, 0, 0)

	room := rm.GetRoom("room-xyz")
	if room == nil {
		t.Fatal("GetRoom returned nil for existing room")
	}
	if room.ID != "room-xyz" {
		t.Errorf("expected room ID 'room-xyz', got '%s'", room.ID)
	}
}

func TestGetRoom_NotFound(t *testing.T) {
	rm := NewRoomManager()

	room := rm.GetRoom("nonexistent")
	if room != nil {
		t.Error("GetRoom should return nil for nonexistent room")
	}
}

func TestRemoveRoom(t *testing.T) {
	rm := NewRoomManager()

	rm.CreateRoom("room-to-remove", "", 0, 0, 0)
	if rm.RoomCount() != 1 {
		t.Fatalf("expected 1 room, got %d", rm.RoomCount())
	}

	rm.RemoveRoom("room-to-remove")
	if rm.RoomCount() != 0 {
		t.Errorf("expected 0 rooms after removal, got %d", rm.RoomCount())
	}

	// Verify it's actually gone
	room := rm.GetRoom("room-to-remove")
	if room != nil {
		t.Error("GetRoom should return nil after room is removed")
	}
}

func TestRemoveRoom_Nonexistent(t *testing.T) {
	rm := NewRoomManager()

	// Should not panic
	rm.RemoveRoom("does-not-exist")
	if rm.RoomCount() != 0 {
		t.Errorf("expected 0 rooms, got %d", rm.RoomCount())
	}
}

func TestConcurrentAccess(t *testing.T) {
	rm := NewRoomManager()
	var wg sync.WaitGroup

	// Concurrently create rooms
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			rm.CreateRoom(fmt.Sprintf("room-%d", id), "", 0, 0, 0)
		}(i)
	}
	wg.Wait()

	if rm.RoomCount() != 100 {
		t.Errorf("expected 100 rooms, got %d", rm.RoomCount())
	}

	// Concurrently read and remove
	for i := 0; i < 100; i++ {
		wg.Add(2)
		go func(id int) {
			defer wg.Done()
			rm.GetRoom(fmt.Sprintf("room-%d", id))
		}(i)
		go func(id int) {
			defer wg.Done()
			rm.RemoveRoom(fmt.Sprintf("room-%d", id))
		}(i)
	}
	wg.Wait()
}
