package room

import (
	"sync"
	"testing"
)

func TestNewRoom(t *testing.T) {
	r := NewRoom("test-room", "", 0, 0, 0)
	if r == nil {
		t.Fatal("NewRoom returned nil")
	}
	if r.ID != "test-room" {
		t.Errorf("expected ID 'test-room', got '%s'", r.ID)
	}
	if r.MemberCount() != 0 {
		t.Errorf("expected 0 members, got %d", r.MemberCount())
	}
}

func TestNewRoom_WithPasswordAndEphemeral(t *testing.T) {
	r := NewRoom("secure-room", "abc123hash", 30, 0, 0)
	if r == nil {
		t.Fatal("NewRoom returned nil")
	}
	if r.ID != "secure-room" {
		t.Errorf("expected ID 'secure-room', got '%s'", r.ID)
	}
	if r.PasswordHash != "abc123hash" {
		t.Errorf("expected PasswordHash 'abc123hash', got '%s'", r.PasswordHash)
	}
	if r.Ephemeral != 30 {
		t.Errorf("expected Ephemeral 30, got %d", r.Ephemeral)
	}
}

func TestAddMember(t *testing.T) {
	r := NewRoom("room-1", "", 0, 0, 0)

	err := r.AddMember(&Member{ID: "m1", Name: "Alice", Color: "#ff0000"})
	if err != nil {
		t.Fatalf("AddMember returned unexpected error: %v", err)
	}
	if r.MemberCount() != 1 {
		t.Errorf("expected 1 member, got %d", r.MemberCount())
	}
}

func TestAddMember_Full(t *testing.T) {
	r := NewRoom("room-full", "", 0, 0, 0)

	// Fill the room to capacity
	for i := range DefaultMaxMembers {
		err := r.AddMember(&Member{ID: idFromInt(i), Name: "User"})
		if err != nil {
			t.Fatalf("AddMember failed at member %d: %v", i, err)
		}
	}

	if !r.IsFull() {
		t.Error("expected room to be full")
	}

	// Adding one more should fail
	err := r.AddMember(&Member{ID: "overflow", Name: "Extra"})
	if err != ErrRoomFull {
		t.Errorf("expected ErrRoomFull, got %v", err)
	}
	if r.MemberCount() != DefaultMaxMembers {
		t.Errorf("expected %d members, got %d", DefaultMaxMembers, r.MemberCount())
	}
}

func TestRemoveMember(t *testing.T) {
	r := NewRoom("room-2", "", 0, 0, 0)
	r.AddMember(&Member{ID: "m1", Name: "Alice"})
	r.AddMember(&Member{ID: "m2", Name: "Bob"})

	remaining := r.RemoveMember("m1")
	if remaining != 1 {
		t.Errorf("expected 1 remaining, got %d", remaining)
	}
	if r.MemberCount() != 1 {
		t.Errorf("expected 1 member, got %d", r.MemberCount())
	}

	// Verify the correct member was removed
	if r.GetMember("m1") != nil {
		t.Error("expected m1 to be removed")
	}
	if r.GetMember("m2") == nil {
		t.Error("expected m2 to still exist")
	}
}

func TestRemoveMember_Nonexistent(t *testing.T) {
	r := NewRoom("room-3", "", 0, 0, 0)
	r.AddMember(&Member{ID: "m1", Name: "Alice"})

	remaining := r.RemoveMember("nonexistent")
	if remaining != 1 {
		t.Errorf("expected 1 remaining, got %d", remaining)
	}
}

func TestGetMember(t *testing.T) {
	r := NewRoom("room-4", "", 0, 0, 0)
	r.AddMember(&Member{ID: "m1", Name: "Alice", Color: "#aaa"})

	m := r.GetMember("m1")
	if m == nil {
		t.Fatal("GetMember returned nil for existing member")
	}
	if m.ID != "m1" || m.Name != "Alice" || m.Color != "#aaa" {
		t.Errorf("unexpected member data: %+v", m)
	}
}

func TestGetMember_NotFound(t *testing.T) {
	r := NewRoom("room-5", "", 0, 0, 0)

	m := r.GetMember("nonexistent")
	if m != nil {
		t.Error("GetMember should return nil for nonexistent member")
	}
}

func TestGetMembers(t *testing.T) {
	r := NewRoom("room-6", "", 0, 0, 0)
	r.AddMember(&Member{ID: "m1", Name: "Alice"})
	r.AddMember(&Member{ID: "m2", Name: "Bob"})
	r.AddMember(&Member{ID: "m3", Name: "Charlie"})

	members := r.GetMembers()
	if len(members) != 3 {
		t.Fatalf("expected 3 members, got %d", len(members))
	}

	// Verify all members are present
	ids := make(map[string]bool)
	for _, m := range members {
		ids[m.ID] = true
	}
	for _, id := range []string{"m1", "m2", "m3"} {
		if !ids[id] {
			t.Errorf("expected member %s in result", id)
		}
	}
}

func TestGetMembers_Empty(t *testing.T) {
	r := NewRoom("room-7", "", 0, 0, 0)

	members := r.GetMembers()
	if len(members) != 0 {
		t.Errorf("expected 0 members, got %d", len(members))
	}
}

func TestBroadcast(t *testing.T) {
	r := NewRoom("room-8", "", 0, 0, 0)

	var received1, received2 [][]byte

	r.AddMember(&Member{
		ID:   "sender",
		Name: "Sender",
		SendFunc: func(data []byte) {
			// Sender should NOT receive their own broadcast
			t.Error("sender received their own broadcast")
		},
	})
	r.AddMember(&Member{
		ID:   "receiver1",
		Name: "Receiver1",
		SendFunc: func(data []byte) {
			received1 = append(received1, data)
		},
	})
	r.AddMember(&Member{
		ID:   "receiver2",
		Name: "Receiver2",
		SendFunc: func(data []byte) {
			received2 = append(received2, data)
		},
	})

	msg := []byte("hello encrypted data")
	r.Broadcast("sender", msg)

	if len(received1) != 1 {
		t.Fatalf("receiver1 expected 1 message, got %d", len(received1))
	}
	if string(received1[0]) != "hello encrypted data" {
		t.Errorf("receiver1 got unexpected data: %s", received1[0])
	}

	if len(received2) != 1 {
		t.Fatalf("receiver2 expected 1 message, got %d", len(received2))
	}
	if string(received2[0]) != "hello encrypted data" {
		t.Errorf("receiver2 got unexpected data: %s", received2[0])
	}
}

func TestBroadcast_NilSendFunc(t *testing.T) {
	r := NewRoom("room-9", "", 0, 0, 0)

	var received [][]byte

	// Member without SendFunc should be skipped without panic
	r.AddMember(&Member{ID: "no-send", Name: "NoSend"})
	r.AddMember(&Member{
		ID:   "with-send",
		Name: "WithSend",
		SendFunc: func(data []byte) {
			received = append(received, data)
		},
	})

	// Should not panic
	r.Broadcast("no-send", []byte("test"))

	if len(received) != 1 {
		t.Errorf("expected 1 message received, got %d", len(received))
	}
}

func TestBroadcast_EmptyRoom(t *testing.T) {
	r := NewRoom("room-10", "", 0, 0, 0)

	// Should not panic on empty room
	r.Broadcast("nobody", []byte("test"))
}

func TestConcurrentRoomAccess(t *testing.T) {
	r := NewRoom("room-concurrent", "", 0, 0, 0)
	var wg sync.WaitGroup

	// Concurrently add members
	for i := range 20 {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			r.AddMember(&Member{ID: idFromInt(id), Name: "User"})
		}(i)
	}
	wg.Wait()

	if r.MemberCount() != 20 {
		t.Errorf("expected 20 members, got %d", r.MemberCount())
	}

	// Concurrently read, broadcast, and remove
	for i := range 20 {
		wg.Add(3)
		go func(id int) {
			defer wg.Done()
			r.GetMember(idFromInt(id))
		}(i)
		go func(id int) {
			defer wg.Done()
			r.Broadcast(idFromInt(id), []byte("data"))
		}(i)
		go func(id int) {
			defer wg.Done()
			r.RemoveMember(idFromInt(id))
		}(i)
	}
	wg.Wait()
}

func idFromInt(i int) string {
	return "member-" + itoa(i)
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	s := ""
	for i > 0 {
		s = string(rune('0'+i%10)) + s
		i /= 10
	}
	return s
}
