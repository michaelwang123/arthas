package match

import (
	"sync"
	"testing"
	"time"
)

func TestNewPendingMatchStore(t *testing.T) {
	store := NewPendingMatchStore()
	if store == nil {
		t.Fatal("expected non-nil store")
	}
	if len(store.pending) != 0 {
		t.Fatalf("expected empty pending map, got %d entries", len(store.pending))
	}
	if len(store.byAny) != 0 {
		t.Fatalf("expected empty byAny map, got %d entries", len(store.byAny))
	}
}

func TestPendingMatchStore_Add(t *testing.T) {
	store := NewPendingMatchStore()
	clientA := newMockClient("alice")
	clientB := newMockClient("bob")

	pm := &PendingMatch{
		ClientA:   clientA,
		ClientB:   clientB,
		CreatedAt: time.Now(),
	}
	store.Add(pm)

	// Verify stored in pending map by Client A's ID.
	store.mu.Lock()
	if _, exists := store.pending["alice"]; !exists {
		t.Fatal("expected pending match keyed by alice")
	}
	// Verify byAny indexes both IDs.
	if store.byAny["alice"] != "alice" {
		t.Fatalf("expected byAny[alice]=alice, got %s", store.byAny["alice"])
	}
	if store.byAny["bob"] != "alice" {
		t.Fatalf("expected byAny[bob]=alice, got %s", store.byAny["bob"])
	}
	store.mu.Unlock()
}

func TestPendingMatchStore_GetByClient_ClientA(t *testing.T) {
	store := NewPendingMatchStore()
	clientA := newMockClient("alice")
	clientB := newMockClient("bob")

	pm := &PendingMatch{
		ClientA:   clientA,
		ClientB:   clientB,
		CreatedAt: time.Now(),
	}
	store.Add(pm)

	got := store.GetByClient("alice")
	if got == nil {
		t.Fatal("expected to find pending match by Client A's ID")
	}
	if got.ClientA.GetID() != "alice" {
		t.Fatalf("expected ClientA=alice, got %s", got.ClientA.GetID())
	}
	if got.ClientB.GetID() != "bob" {
		t.Fatalf("expected ClientB=bob, got %s", got.ClientB.GetID())
	}
}

func TestPendingMatchStore_GetByClient_ClientB(t *testing.T) {
	store := NewPendingMatchStore()
	clientA := newMockClient("alice")
	clientB := newMockClient("bob")

	pm := &PendingMatch{
		ClientA:   clientA,
		ClientB:   clientB,
		CreatedAt: time.Now(),
	}
	store.Add(pm)

	got := store.GetByClient("bob")
	if got == nil {
		t.Fatal("expected to find pending match by Client B's ID")
	}
	if got.ClientA.GetID() != "alice" {
		t.Fatalf("expected ClientA=alice, got %s", got.ClientA.GetID())
	}
}

func TestPendingMatchStore_GetByClient_NotFound(t *testing.T) {
	store := NewPendingMatchStore()
	got := store.GetByClient("nonexistent")
	if got != nil {
		t.Fatal("expected nil for nonexistent client")
	}
}

func TestPendingMatchStore_Remove(t *testing.T) {
	store := NewPendingMatchStore()
	clientA := newMockClient("alice")
	clientB := newMockClient("bob")

	pm := &PendingMatch{
		ClientA:   clientA,
		ClientB:   clientB,
		CreatedAt: time.Now(),
	}
	store.Add(pm)
	store.Remove("alice")

	// Verify removed from pending map.
	if store.GetByClient("alice") != nil {
		t.Fatal("expected nil after Remove by Client A's ID")
	}
	if store.GetByClient("bob") != nil {
		t.Fatal("expected nil for Client B after removing pending match")
	}

	// Verify byAny cleaned up.
	store.mu.Lock()
	if len(store.byAny) != 0 {
		t.Fatalf("expected empty byAny after Remove, got %d entries", len(store.byAny))
	}
	store.mu.Unlock()
}

func TestPendingMatchStore_Remove_NotFound(t *testing.T) {
	store := NewPendingMatchStore()
	// Should not panic when removing nonexistent ID.
	store.Remove("nonexistent")
}

func TestPendingMatchStore_Remove_DoesNotAffectOthers(t *testing.T) {
	store := NewPendingMatchStore()

	pm1 := &PendingMatch{
		ClientA:   newMockClient("alice"),
		ClientB:   newMockClient("bob"),
		CreatedAt: time.Now(),
	}
	pm2 := &PendingMatch{
		ClientA:   newMockClient("charlie"),
		ClientB:   newMockClient("dave"),
		CreatedAt: time.Now(),
	}
	store.Add(pm1)
	store.Add(pm2)

	store.Remove("alice")

	// pm2 should still be accessible.
	got := store.GetByClient("charlie")
	if got == nil {
		t.Fatal("expected pm2 to still exist after removing pm1")
	}
	got = store.GetByClient("dave")
	if got == nil {
		t.Fatal("expected pm2 to be findable by Client B (dave)")
	}
}

func TestPendingMatchStore_ExpireAll_SomeExpired(t *testing.T) {
	store := NewPendingMatchStore()

	// Old pending match (expired).
	pmOld := &PendingMatch{
		ClientA:   newMockClient("alice"),
		ClientB:   newMockClient("bob"),
		CreatedAt: time.Now().Add(-10 * time.Second),
	}
	// Recent pending match (still valid).
	pmRecent := &PendingMatch{
		ClientA:   newMockClient("charlie"),
		ClientB:   newMockClient("dave"),
		CreatedAt: time.Now(),
	}
	store.Add(pmOld)
	store.Add(pmRecent)

	expired := store.ExpireAll(5 * time.Second)

	if len(expired) != 1 {
		t.Fatalf("expected 1 expired, got %d", len(expired))
	}
	if expired[0].ClientA.GetID() != "alice" {
		t.Fatalf("expected expired match to be alice's, got %s", expired[0].ClientA.GetID())
	}

	// alice/bob should no longer be findable.
	if store.GetByClient("alice") != nil {
		t.Fatal("expected alice to be removed after expiry")
	}
	if store.GetByClient("bob") != nil {
		t.Fatal("expected bob to be removed after expiry")
	}

	// charlie/dave should still exist.
	if store.GetByClient("charlie") == nil {
		t.Fatal("expected charlie to still exist")
	}
	if store.GetByClient("dave") == nil {
		t.Fatal("expected dave to still exist")
	}
}

func TestPendingMatchStore_ExpireAll_NoneExpired(t *testing.T) {
	store := NewPendingMatchStore()

	pm := &PendingMatch{
		ClientA:   newMockClient("alice"),
		ClientB:   newMockClient("bob"),
		CreatedAt: time.Now(),
	}
	store.Add(pm)

	expired := store.ExpireAll(5 * time.Second)
	if len(expired) != 0 {
		t.Fatalf("expected 0 expired, got %d", len(expired))
	}

	// Entry should still be accessible.
	if store.GetByClient("alice") == nil {
		t.Fatal("expected alice to still exist")
	}
}

func TestPendingMatchStore_ExpireAll_AllExpired(t *testing.T) {
	store := NewPendingMatchStore()

	pm1 := &PendingMatch{
		ClientA:   newMockClient("alice"),
		ClientB:   newMockClient("bob"),
		CreatedAt: time.Now().Add(-10 * time.Second),
	}
	pm2 := &PendingMatch{
		ClientA:   newMockClient("charlie"),
		ClientB:   newMockClient("dave"),
		CreatedAt: time.Now().Add(-8 * time.Second),
	}
	store.Add(pm1)
	store.Add(pm2)

	expired := store.ExpireAll(5 * time.Second)
	if len(expired) != 2 {
		t.Fatalf("expected 2 expired, got %d", len(expired))
	}

	// Store should be empty.
	store.mu.Lock()
	if len(store.pending) != 0 {
		t.Fatalf("expected empty pending map, got %d", len(store.pending))
	}
	if len(store.byAny) != 0 {
		t.Fatalf("expected empty byAny map, got %d", len(store.byAny))
	}
	store.mu.Unlock()
}

func TestPendingMatchStore_KeyReceived(t *testing.T) {
	store := NewPendingMatchStore()

	pm := &PendingMatch{
		ClientA:     newMockClient("alice"),
		ClientB:     newMockClient("bob"),
		CreatedAt:   time.Now(),
		KeyReceived: false,
	}
	store.Add(pm)

	// Simulate key relay: mark as received.
	got := store.GetByClient("alice")
	if got == nil {
		t.Fatal("expected to find pending match")
	}
	if got.KeyReceived {
		t.Fatal("expected KeyReceived=false initially")
	}

	// The actual handler would set this; verify field is accessible.
	got.KeyReceived = true

	// Re-fetch via Client B to verify same reference.
	got2 := store.GetByClient("bob")
	if got2 == nil {
		t.Fatal("expected to find pending match via bob")
	}
	if !got2.KeyReceived {
		t.Fatal("expected KeyReceived=true after setting via alice reference")
	}
}

func TestPendingMatchStore_ConcurrentAccess(t *testing.T) {
	store := NewPendingMatchStore()
	var wg sync.WaitGroup

	// Concurrent adds.
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			clientA := newMockClient("a" + string(rune('A'+idx)))
			clientB := newMockClient("b" + string(rune('A'+idx)))
			pm := &PendingMatch{
				ClientA:   clientA,
				ClientB:   clientB,
				CreatedAt: time.Now(),
			}
			store.Add(pm)
		}(i)
	}
	wg.Wait()

	// Concurrent reads and removes.
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func(idx int) {
			defer wg.Done()
			store.GetByClient("a" + string(rune('A'+idx)))
		}(i)
		go func(idx int) {
			defer wg.Done()
			store.Remove("a" + string(rune('A'+idx)))
		}(i)
	}
	wg.Wait()
}

func TestPendingMatchStore_MultiplePairs(t *testing.T) {
	store := NewPendingMatchStore()

	pm1 := &PendingMatch{
		ClientA:   newMockClient("alice"),
		ClientB:   newMockClient("bob"),
		CreatedAt: time.Now(),
	}
	pm2 := &PendingMatch{
		ClientA:   newMockClient("charlie"),
		ClientB:   newMockClient("dave"),
		CreatedAt: time.Now(),
	}
	pm3 := &PendingMatch{
		ClientA:   newMockClient("eve"),
		ClientB:   newMockClient("frank"),
		CreatedAt: time.Now(),
	}

	store.Add(pm1)
	store.Add(pm2)
	store.Add(pm3)

	// All should be retrievable.
	if store.GetByClient("alice") == nil {
		t.Fatal("expected alice findable")
	}
	if store.GetByClient("bob") == nil {
		t.Fatal("expected bob findable")
	}
	if store.GetByClient("charlie") == nil {
		t.Fatal("expected charlie findable")
	}
	if store.GetByClient("dave") == nil {
		t.Fatal("expected dave findable")
	}
	if store.GetByClient("eve") == nil {
		t.Fatal("expected eve findable")
	}
	if store.GetByClient("frank") == nil {
		t.Fatal("expected frank findable")
	}

	// Remove middle pair.
	store.Remove("charlie")
	if store.GetByClient("charlie") != nil {
		t.Fatal("expected charlie removed")
	}
	if store.GetByClient("dave") != nil {
		t.Fatal("expected dave removed with charlie")
	}

	// Others remain.
	if store.GetByClient("alice") == nil {
		t.Fatal("expected alice still findable")
	}
	if store.GetByClient("eve") == nil {
		t.Fatal("expected eve still findable")
	}
}
