package match

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/vmihailenco/msgpack/v5"
	"pgregory.net/rapid"
)

// testClient implements ClientRef for server_test.go property tests.
type testClient struct {
	id       string
	roomID   string
	remoteIP string
	sent     [][]byte
	mu       sync.Mutex
}

func newTestClient(id string) *testClient {
	return &testClient{id: id, remoteIP: "127.0.0.1"}
}

func (c *testClient) GetID() string       { return c.id }
func (c *testClient) GetRoomID() string   { return c.roomID }
func (c *testClient) GetRemoteIP() string { return c.remoteIP }
func (c *testClient) Send(data []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sent = append(c.sent, data)
}

// TestProperty_DisconnectionCleanup verifies Property 11: Disconnection cleanup.
// For ANY client that disconnects, it is removed from: (a) MatchQueue, (b) PendingMatchStore
// (with partner re-queued and notified via MsgMatchPartnerLeft), (c) RecentPairsTracker.
// The system contains NO stale references to disconnected clients.
//
// Test strategy: Generate random clients placed in various states (in queue, in pending match,
// has recent pairs), call HandleDisconnect for a randomly chosen client, verify all traces removed.
//
// **Validates: Requirements 10.1, 10.2**
func TestProperty_DisconnectionCleanup(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Create a MatchServer with nil RoomCreator (room creation not tested here).
		config := DefaultConfig()
		ms := NewMatchServer(config, nil)

		// Generate a random number of clients (3-15).
		numClients := rapid.IntRange(3, 15).Draw(t, "numClients")
		clients := make([]*testClient, numClients)
		for i := 0; i < numClients; i++ {
			clients[i] = newTestClient(fmt.Sprintf("client-%d", i))
		}

		// Randomly place some clients in the queue (at least 1).
		numInQueue := rapid.IntRange(1, numClients).Draw(t, "numInQueue")
		inQueueIndices := rapid.SliceOfNDistinct(rapid.IntRange(0, numClients-1), numInQueue, numInQueue, func(i int) int { return i }).Draw(t, "inQueueIndices")
		for _, idx := range inQueueIndices {
			entry := &MatchEntry{
				ClientRef:  clients[idx],
				Tags:       nil,
				EnqueuedAt: time.Now(),
			}
			_ = ms.queue.Enqueue(entry)
		}

		// Randomly create pending matches (0-2 pairs) from non-queued clients or queued clients.
		// First remove clients that will be in pending matches from queue to simulate server state.
		numPending := rapid.IntRange(0, min(numClients/2, 3)).Draw(t, "numPending")
		type pendingPair struct {
			clientAIdx int
			clientBIdx int
		}
		var pendingPairs []pendingPair
		usedInPending := make(map[int]bool)

		for i := 0; i < numPending; i++ {
			// Pick two distinct clients not already used in a pending match.
			var idxA, idxB int
			found := false
			for attempt := 0; attempt < 20; attempt++ {
				a := rapid.IntRange(0, numClients-1).Draw(t, fmt.Sprintf("pendingA_%d_%d", i, attempt))
				b := rapid.IntRange(0, numClients-1).Draw(t, fmt.Sprintf("pendingB_%d_%d", i, attempt))
				if a != b && !usedInPending[a] && !usedInPending[b] {
					idxA, idxB = a, b
					found = true
					break
				}
			}
			if !found {
				break
			}

			usedInPending[idxA] = true
			usedInPending[idxB] = true

			// Remove from queue if present (clients in pending match are not in queue).
			ms.queue.Remove(clients[idxA].GetID())
			ms.queue.Remove(clients[idxB].GetID())

			pm := &PendingMatch{
				ClientA:   clients[idxA],
				ClientB:   clients[idxB],
				CreatedAt: time.Now(),
			}
			ms.pending.Add(pm)
			pendingPairs = append(pendingPairs, pendingPair{clientAIdx: idxA, clientBIdx: idxB})
		}

		// Randomly record some recent pairs.
		numRecentPairs := rapid.IntRange(0, min(numClients/2, 5)).Draw(t, "numRecentPairs")
		type recentPairRecord struct {
			idxA int
			idxB int
		}
		var recentPairRecords []recentPairRecord
		for i := 0; i < numRecentPairs; i++ {
			a := rapid.IntRange(0, numClients-1).Draw(t, fmt.Sprintf("recentA_%d", i))
			b := rapid.IntRange(0, numClients-1).Draw(t, fmt.Sprintf("recentB_%d", i))
			if a == b {
				continue
			}
			ms.recentPairs.RecordPair(clients[a].GetID(), clients[b].GetID())
			recentPairRecords = append(recentPairRecords, recentPairRecord{idxA: a, idxB: b})
		}

		// Pick a random client to disconnect.
		disconnectIdx := rapid.IntRange(0, numClients-1).Draw(t, "disconnectIdx")
		disconnectedID := clients[disconnectIdx].GetID()

		// Record pre-disconnect state for verification.
		wasInQueue := ms.queue.Contains(disconnectedID)
		pendingMatch := ms.pending.GetByClient(disconnectedID)

		// Identify recent pair partners of the disconnected client.
		var recentPartners []string
		for _, rp := range recentPairRecords {
			if rp.idxA == disconnectIdx {
				recentPartners = append(recentPartners, clients[rp.idxB].GetID())
			} else if rp.idxB == disconnectIdx {
				recentPartners = append(recentPartners, clients[rp.idxA].GetID())
			}
		}

		// === Execute HandleDisconnect ===
		ms.HandleDisconnect(disconnectedID)

		// === Verify Property 11(a): Client removed from MatchQueue ===
		if ms.queue.Contains(disconnectedID) {
			t.Fatalf("Property 11(a) violated: disconnected client %q still in queue (wasInQueue=%v)",
				disconnectedID, wasInQueue)
		}

		// === Verify Property 11(b): Client removed from PendingMatchStore ===
		if ms.pending.GetByClient(disconnectedID) != nil {
			t.Fatalf("Property 11(b) violated: disconnected client %q still in pending match store",
				disconnectedID)
		}

		// If client was in a pending match, verify partner was re-queued and notified.
		if pendingMatch != nil {
			var partner ClientRef
			if pendingMatch.ClientA.GetID() == disconnectedID {
				partner = pendingMatch.ClientB
			} else {
				partner = pendingMatch.ClientA
			}
			partnerID := partner.GetID()

			// Partner should be re-queued.
			if !ms.queue.Contains(partnerID) {
				t.Fatalf("Property 11(b) violated: partner %q was not re-queued after %q disconnected during pending match",
					partnerID, disconnectedID)
			}

			// Partner should have received MsgMatchPartnerLeft notification.
			tc := partner.(*testClient)
			tc.mu.Lock()
			sentMsgs := tc.sent
			tc.mu.Unlock()

			foundPartnerLeftMsg := false
			for _, msg := range sentMsgs {
				if msgType, _, _ := decodeMatchMsg(msg); msgType == MsgMatchPartnerLeft {
					foundPartnerLeftMsg = true
					break
				}
			}
			if !foundPartnerLeftMsg {
				t.Fatalf("Property 11(b) violated: partner %q did not receive MsgMatchPartnerLeft after %q disconnected",
					partnerID, disconnectedID)
			}
		}

		// === Verify Property 11(c): Client removed from RecentPairsTracker ===
		// The disconnected client's own entry should be gone, and it should not appear
		// in any other client's recent partners list.
		for _, partnerID := range recentPartners {
			if ms.recentPairs.IsRecentPair(disconnectedID, partnerID) {
				t.Fatalf("Property 11(c) violated: disconnected client %q still appears as recent pair with %q",
					disconnectedID, partnerID)
			}
		}

		// Also verify no stale references: check all clients against disconnected client.
		for i := 0; i < numClients; i++ {
			if i == disconnectIdx {
				continue
			}
			if ms.recentPairs.IsRecentPair(disconnectedID, clients[i].GetID()) {
				t.Fatalf("Property 11(c) violated: stale recent pair reference found between disconnected %q and %q",
					disconnectedID, clients[i].GetID())
			}
		}
	})
}

// TestProperty_KeyExchangeTimeout verifies Property 14: Key exchange timeout.
// For ANY set of pending matches, if CreatedAt + KeyExchangeTimeout < now,
// ExpireAll removes them. The returned expired matches can then be re-queued.
//
// Verification:
//  1. ExpireAll correctly identifies expired ones (created > timeout ago)
//  2. Non-expired ones remain accessible via GetByClient
//  3. Expired users can be successfully re-queued
//
// **Validates: Requirements 3.6**
func TestProperty_KeyExchangeTimeout(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		store := NewPendingMatchStore()
		queue := NewMatchQueue(200)

		// Use a fixed "now" reference point for deterministic time calculations.
		now := time.Now()

		// Generate a configurable KeyExchangeTimeout (1s-10s).
		timeoutSec := rapid.IntRange(1, 10).Draw(t, "timeoutSec")
		timeout := time.Duration(timeoutSec) * time.Second

		// Generate a random number of pending matches (1-20).
		numPending := rapid.IntRange(1, 20).Draw(t, "numPending")

		// Track which pending matches should be expired vs alive.
		type pendingRecord struct {
			clientAID string
			clientBID string
			createdAt time.Time
			expired   bool // expected: should be expired by ExpireAll
		}
		records := make([]pendingRecord, numPending)

		for i := 0; i < numPending; i++ {
			clientAID := fmt.Sprintf("clientA-%d", i)
			clientBID := fmt.Sprintf("clientB-%d", i)

			// Randomly decide if this pending match is expired or not.
			// expired = createdAt is more than timeout ago from now.
			isExpired := rapid.Bool().Draw(t, fmt.Sprintf("isExpired_%d", i))

			var createdAt time.Time
			if isExpired {
				// Created well before the timeout cutoff (timeout+1s to timeout+60s ago).
				extraSec := rapid.IntRange(1, 60).Draw(t, fmt.Sprintf("extraSec_%d", i))
				createdAt = now.Add(-timeout - time.Duration(extraSec)*time.Second)
			} else {
				// Created recently â€?within the timeout window (0 to timeout-1s ago).
				// Ensure it's strictly within: use at most timeout-1 second ago.
				maxAgeMilli := int(timeout.Milliseconds()) - 100 // leave 100ms margin
				if maxAgeMilli < 1 {
					maxAgeMilli = 1
				}
				ageMilli := rapid.IntRange(0, maxAgeMilli).Draw(t, fmt.Sprintf("ageMilli_%d", i))
				createdAt = now.Add(-time.Duration(ageMilli) * time.Millisecond)
			}

			clientA := newTestClient(clientAID)
			clientB := newTestClient(clientBID)

			pm := &PendingMatch{
				ClientA:   clientA,
				ClientB:   clientB,
				CreatedAt: createdAt,
			}
			store.Add(pm)

			records[i] = pendingRecord{
				clientAID: clientAID,
				clientBID: clientBID,
				createdAt: createdAt,
				expired:   isExpired,
			}
		}

		// Count expected expired and alive.
		expectedExpiredCount := 0
		expectedAliveCount := 0
		for _, r := range records {
			if r.expired {
				expectedExpiredCount++
			} else {
				expectedAliveCount++
			}
		}

		// Call ExpireAll with the timeout. Internally it uses time.Now() for the cutoff,
		// but our expired entries are created well before now-timeout so they should expire.
		expired := store.ExpireAll(timeout)

		// Property 1: ExpireAll returns exactly the expected number of expired matches.
		if len(expired) != expectedExpiredCount {
			t.Fatalf("expected %d expired pending matches, got %d (timeout=%v, numPending=%d)",
				expectedExpiredCount, len(expired), timeout, numPending)
		}

		// Property 2: Non-expired pending matches remain accessible via GetByClient.
		for _, r := range records {
			if !r.expired {
				pmA := store.GetByClient(r.clientAID)
				if pmA == nil {
					t.Fatalf("non-expired pending match for %q should still be accessible via Client A ID", r.clientAID)
				}
				pmB := store.GetByClient(r.clientBID)
				if pmB == nil {
					t.Fatalf("non-expired pending match for %q should still be accessible via Client B ID", r.clientBID)
				}
			}
		}

		// Property 2b: Expired pending matches are no longer accessible.
		for _, r := range records {
			if r.expired {
				pmA := store.GetByClient(r.clientAID)
				if pmA != nil {
					t.Fatalf("expired pending match for %q should NOT be accessible after ExpireAll", r.clientAID)
				}
				pmB := store.GetByClient(r.clientBID)
				if pmB != nil {
					t.Fatalf("expired pending match for %q should NOT be accessible after ExpireAll", r.clientBID)
				}
			}
		}

		// Property 3: Expired users can be successfully re-queued.
		// Both ClientA and ClientB from expired pending matches should be re-enqueueable.
		for _, expiredPM := range expired {
			entryA := &MatchEntry{
				ClientRef:  expiredPM.ClientA,
				Tags:       []string{},
				EnqueuedAt: now,
			}
			errA := queue.Enqueue(entryA)
			if errA != nil {
				t.Fatalf("failed to re-queue expired Client A %q: %v",
					expiredPM.ClientA.GetID(), errA)
			}

			entryB := &MatchEntry{
				ClientRef:  expiredPM.ClientB,
				Tags:       []string{},
				EnqueuedAt: now,
			}
			errB := queue.Enqueue(entryB)
			if errB != nil {
				t.Fatalf("failed to re-queue expired Client B %q: %v",
					expiredPM.ClientB.GetID(), errB)
			}
		}

		// Verify re-queued users are actually in the queue.
		for _, expiredPM := range expired {
			if !queue.Contains(expiredPM.ClientA.GetID()) {
				t.Fatalf("re-queued Client A %q not found in queue", expiredPM.ClientA.GetID())
			}
			if !queue.Contains(expiredPM.ClientB.GetID()) {
				t.Fatalf("re-queued Client B %q not found in queue", expiredPM.ClientB.GetID())
			}
		}

		// Final invariant: queue size equals 2 * number of expired pending matches.
		expectedQueueSize := 2 * expectedExpiredCount
		if queue.Size() != expectedQueueSize {
			t.Fatalf("expected queue size %d after re-queuing expired users, got %d",
				expectedQueueSize, queue.Size())
		}
	})
}

// mockRoomCreator implements RoomCreator for testing key relay handler.
type mockRoomCreator struct {
	createErr error
	joinErr   error
	roomID    string
}

func (m *mockRoomCreator) CreateMatchRoom(expiresAt int64, ephemeral int) (string, error) {
	if m.createErr != nil {
		return "", m.createErr
	}
	return m.roomID, nil
}

func (m *mockRoomCreator) JoinClientToRoom(client ClientRef, roomId string, name string) error {
	return m.joinErr
}

func (m *mockRoomCreator) ExtendMatchRoom(roomId string, newExpiresAt int64) bool {
	return true
}

func (m *mockRoomCreator) LeaveMatchRoom(client ClientRef) error {
	return nil
}

// TestHandleMatchKeyRelay_HappyPath verifies the full key relay â†?room creation â†?MatchFound flow.
func TestHandleMatchKeyRelay_HappyPath(t *testing.T) {
	creator := &mockRoomCreator{roomID: "room-abc123"}
	config := DefaultConfig()
	ms := NewMatchServer(config, creator)

	clientA := newTestClient("alice")
	clientB := newTestClient("bob")

	// Set up pending match (Client A is the key generator).
	pm := &PendingMatch{
		ClientA:   clientA,
		ClientB:   clientB,
		CreatedAt: time.Now(),
	}
	ms.pending.Add(pm)

	// Simulate Client A sending MatchKeyRelay with a key.
	keyRelayData := MatchKeyRelayData{Key: "dGVzdC1rZXktYmFzZTY0dXJs"}
	payload, err := msgpack.Marshal(keyRelayData)
	if err != nil {
		t.Fatalf("failed to marshal key relay data: %v", err)
	}

	ms.handleMatchKeyRelay(clientA, payload)

	// Verify pending match was removed.
	if ms.pending.GetByClient("alice") != nil {
		t.Fatal("pending match should be removed after successful key relay")
	}

	// Verify MatchRoomState was created.
	state := ms.roomStates.Get("room-abc123")
	if state == nil {
		t.Fatal("MatchRoomState should exist after key relay")
	}
	if state.ClientAID != "alice" || state.ClientBID != "bob" {
		t.Fatalf("MatchRoomState has wrong client IDs: A=%q, B=%q", state.ClientAID, state.ClientBID)
	}

	// Verify Client A received MatchFound (without key).
	clientA.mu.Lock()
	aMsgs := clientA.sent
	clientA.mu.Unlock()
	if len(aMsgs) == 0 {
		t.Fatal("Client A should have received a message")
	}
	lastMsgA := aMsgs[len(aMsgs)-1]
	if lastMsgA[0] != MsgMatchFound {
		t.Fatalf("Client A should receive MsgMatchFound (0x%02x), got 0x%02x", MsgMatchFound, lastMsgA[0])
	}
	var foundDataA MatchFoundData
	if err := msgpack.Unmarshal(lastMsgA[1:], &foundDataA); err != nil {
		t.Fatalf("failed to unmarshal Client A MatchFound: %v", err)
	}
	if foundDataA.RoomID != "room-abc123" {
		t.Fatalf("Client A got wrong room ID: %q", foundDataA.RoomID)
	}
	if foundDataA.Key != "" {
		t.Fatalf("Client A should NOT receive the key, got %q", foundDataA.Key)
	}

	// Verify Client B received MatchFound (WITH key).
	clientB.mu.Lock()
	bMsgs := clientB.sent
	clientB.mu.Unlock()
	if len(bMsgs) == 0 {
		t.Fatal("Client B should have received a message")
	}
	lastMsgB := bMsgs[len(bMsgs)-1]
	if lastMsgB[0] != MsgMatchFound {
		t.Fatalf("Client B should receive MsgMatchFound (0x%02x), got 0x%02x", MsgMatchFound, lastMsgB[0])
	}
	var foundDataB MatchFoundData
	if err := msgpack.Unmarshal(lastMsgB[1:], &foundDataB); err != nil {
		t.Fatalf("failed to unmarshal Client B MatchFound: %v", err)
	}
	if foundDataB.RoomID != "room-abc123" {
		t.Fatalf("Client B got wrong room ID: %q", foundDataB.RoomID)
	}
	if foundDataB.Key != "dGVzdC1rZXktYmFzZTY0dXJs" {
		t.Fatalf("Client B should receive the key, got %q", foundDataB.Key)
	}
}

// TestHandleMatchKeyRelay_NoPendingMatch verifies error when client has no pending match.
func TestHandleMatchKeyRelay_NoPendingMatch(t *testing.T) {
	creator := &mockRoomCreator{roomID: "room-xyz"}
	config := DefaultConfig()
	ms := NewMatchServer(config, creator)

	client := newTestClient("orphan")

	keyRelayData := MatchKeyRelayData{Key: "some-key"}
	payload, _ := msgpack.Marshal(keyRelayData)

	ms.handleMatchKeyRelay(client, payload)

	// Verify client received an error.
	client.mu.Lock()
	msgs := client.sent
	client.mu.Unlock()
	if len(msgs) == 0 {
		t.Fatal("client should receive an error message")
	}
	if msgs[0][0] != MsgMatchError {
		t.Fatalf("expected MsgMatchError (0x%02x), got 0x%02x", MsgMatchError, msgs[0][0])
	}
}

// TestHandleMatchKeyRelay_NotClientA verifies error when Client B tries to relay the key.
func TestHandleMatchKeyRelay_NotClientA(t *testing.T) {
	creator := &mockRoomCreator{roomID: "room-xyz"}
	config := DefaultConfig()
	ms := NewMatchServer(config, creator)

	clientA := newTestClient("alice")
	clientB := newTestClient("bob")

	pm := &PendingMatch{
		ClientA:   clientA,
		ClientB:   clientB,
		CreatedAt: time.Now(),
	}
	ms.pending.Add(pm)

	keyRelayData := MatchKeyRelayData{Key: "some-key"}
	payload, _ := msgpack.Marshal(keyRelayData)

	// Client B tries to relay â€?should be rejected.
	ms.handleMatchKeyRelay(clientB, payload)

	// Verify Client B received an error.
	clientB.mu.Lock()
	msgs := clientB.sent
	clientB.mu.Unlock()
	if len(msgs) == 0 {
		t.Fatal("Client B should receive an error when trying to relay key")
	}
	if msgs[0][0] != MsgMatchError {
		t.Fatalf("expected MsgMatchError (0x%02x), got 0x%02x", MsgMatchError, msgs[0][0])
	}

	// Pending match should still exist.
	if ms.pending.GetByClient("alice") == nil {
		t.Fatal("pending match should still exist after rejected key relay from Client B")
	}
}

// TestHandleMatchKeyRelay_RoomCreationFailure verifies both clients are notified and re-queued on room creation error.
func TestHandleMatchKeyRelay_RoomCreationFailure(t *testing.T) {
	creator := &mockRoomCreator{createErr: fmt.Errorf("room creation failed")}
	config := DefaultConfig()
	ms := NewMatchServer(config, creator)

	clientA := newTestClient("alice")
	clientB := newTestClient("bob")

	pm := &PendingMatch{
		ClientA:   clientA,
		ClientB:   clientB,
		CreatedAt: time.Now(),
	}
	ms.pending.Add(pm)

	keyRelayData := MatchKeyRelayData{Key: "some-key"}
	payload, _ := msgpack.Marshal(keyRelayData)

	ms.handleMatchKeyRelay(clientA, payload)

	// Pending match should be removed.
	if ms.pending.GetByClient("alice") != nil {
		t.Fatal("pending match should be removed after room creation failure")
	}

	// Both clients should be re-queued.
	if !ms.queue.Contains("alice") {
		t.Fatal("Client A should be re-queued after room creation failure")
	}
	if !ms.queue.Contains("bob") {
		t.Fatal("Client B should be re-queued after room creation failure")
	}

	// Both should have received error messages.
	clientA.mu.Lock()
	aMsgs := clientA.sent
	clientA.mu.Unlock()
	if len(aMsgs) == 0 || aMsgs[0][0] != MsgMatchError {
		t.Fatal("Client A should receive error on room creation failure")
	}

	clientB.mu.Lock()
	bMsgs := clientB.sent
	clientB.mu.Unlock()
	if len(bMsgs) == 0 || bMsgs[0][0] != MsgMatchError {
		t.Fatal("Client B should receive error on room creation failure")
	}
}

// --- Unit tests for handleInviteJoin and handleNext (task 10.5) ---

func TestHandleInviteJoin_Success(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	// Creator creates an invite and enters the queue.
	creator := newTestClient("creator-1")
	inviteLink := ms.invites.Create(creator.GetID())
	entry := &MatchEntry{ClientRef: creator, Tags: []string{"tech"}, EnqueuedAt: time.Now()}
	if err := ms.queue.Enqueue(entry); err != nil {
		t.Fatalf("failed to enqueue creator: %v", err)
	}

	// Invitee joins via token.
	invitee := newTestClient("invitee-1")
	payload := mustMarshal(t, MatchInviteJoinData{Token: inviteLink.Token})
	ms.handleInviteJoin(invitee, payload)

	// Creator should be removed from queue.
	if ms.queue.Contains(creator.GetID()) {
		t.Fatal("creator should be removed from queue after invite join")
	}

	// A pending match should exist with creator as ClientA, invitee as ClientB.
	pm := ms.pending.GetByClient(creator.GetID())
	if pm == nil {
		t.Fatal("pending match should exist after invite join")
	}
	if pm.ClientA.GetID() != creator.GetID() {
		t.Fatalf("expected ClientA=%q, got %q", creator.GetID(), pm.ClientA.GetID())
	}
	if pm.ClientB.GetID() != invitee.GetID() {
		t.Fatalf("expected ClientB=%q, got %q", invitee.GetID(), pm.ClientB.GetID())
	}

	// Recent pairs should be recorded.
	if !ms.recentPairs.IsRecentPair(creator.GetID(), invitee.GetID()) {
		t.Fatal("creator and invitee should be recorded as recent pair")
	}

	// Creator should have received MsgMatchGenerateKey.
	creator.mu.Lock()
	msgs := creator.sent
	creator.mu.Unlock()

	found := false
	for _, msg := range msgs {
		if msgType, _, _ := decodeMatchMsg(msg); msgType == MsgMatchGenerateKey {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("creator should have received MsgMatchGenerateKey")
	}
}

func TestHandleInviteJoin_InvalidToken(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	invitee := newTestClient("invitee-1")
	payload := mustMarshal(t, MatchInviteJoinData{Token: "nonexistent-token"})
	ms.handleInviteJoin(invitee, payload)

	// Invitee should receive an error with M010.
	assertClientReceivedError(t, invitee, ErrCodeInviteInvalid)
}

func TestHandleInviteJoin_UsedToken(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	creator := newTestClient("creator-1")
	inviteLink := ms.invites.Create(creator.GetID())
	entry := &MatchEntry{ClientRef: creator, Tags: nil, EnqueuedAt: time.Now()}
	_ = ms.queue.Enqueue(entry)

	// First use succeeds.
	invitee1 := newTestClient("invitee-1")
	payload := mustMarshal(t, MatchInviteJoinData{Token: inviteLink.Token})
	ms.handleInviteJoin(invitee1, payload)

	// Second use fails â€?token already used.
	invitee2 := newTestClient("invitee-2")
	ms.handleInviteJoin(invitee2, payload)
	assertClientReceivedError(t, invitee2, ErrCodeInviteInvalid)
}

func TestHandleInviteJoin_CreatorLeftQueue(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	creator := newTestClient("creator-1")
	inviteLink := ms.invites.Create(creator.GetID())
	// Creator does NOT enter the queue (simulates leaving before invitee arrives).

	invitee := newTestClient("invitee-1")
	payload := mustMarshal(t, MatchInviteJoinData{Token: inviteLink.Token})
	ms.handleInviteJoin(invitee, payload)

	// Should receive M009 "link creator no longer waiting".
	assertClientReceivedError(t, invitee, ErrCodeInviteExpired)
}

func TestHandleNext_Success(t *testing.T) {
	config := DefaultConfig()
	config.CooldownPeriod = 0 // Disable cooldown for this test.
	ms := NewMatchServer(config, nil)

	client := newTestClient("client-1")
	payload := mustMarshal(t, MatchNextData{Tags: []string{"music", "gaming"}})
	ms.handleNext(client, payload)

	// Client should be in the queue.
	if !ms.queue.Contains(client.GetID()) {
		t.Fatal("client should be in queue after handleNext")
	}
}

func TestHandleNext_InvalidTags(t *testing.T) {
	config := DefaultConfig()
	config.CooldownPeriod = 0
	ms := NewMatchServer(config, nil)

	client := newTestClient("client-1")
	payload := mustMarshal(t, MatchNextData{Tags: []string{"invalid-tag"}})
	ms.handleNext(client, payload)

	assertClientReceivedError(t, client, ErrCodeInvalidTags)
	if ms.queue.Contains(client.GetID()) {
		t.Fatal("client should NOT be in queue after invalid tags")
	}
}

func TestHandleNext_Cooldown(t *testing.T) {
	config := DefaultConfig()
	config.CooldownPeriod = 10 * time.Second
	ms := NewMatchServer(config, nil)

	client := newTestClient("client-1")

	// Record a recent request to trigger cooldown.
	ms.rateLimiter.RecordRequest(client.GetID())

	payload := mustMarshal(t, MatchNextData{Tags: []string{"tech"}})
	ms.handleNext(client, payload)

	assertClientReceivedError(t, client, ErrCodeCooldown)
	if ms.queue.Contains(client.GetID()) {
		t.Fatal("client should NOT be in queue during cooldown")
	}
}

func TestHandleNext_HourlyLimit(t *testing.T) {
	config := DefaultConfig()
	config.CooldownPeriod = 0
	config.HourlyRateLimit = 2
	ms := NewMatchServer(config, nil)

	client := newTestClient("client-1")
	client.remoteIP = "10.0.0.1"

	// Exhaust the hourly limit.
	ms.rateLimiter.RecordHourlyRequest(client.GetRemoteIP())
	ms.rateLimiter.RecordHourlyRequest(client.GetRemoteIP())

	payload := mustMarshal(t, MatchNextData{Tags: []string{"tech"}})
	ms.handleNext(client, payload)

	assertClientReceivedError(t, client, ErrCodeRateLimit)
}

func TestHandleNext_IPBlocked(t *testing.T) {
	config := DefaultConfig()
	config.CooldownPeriod = 0
	ms := NewMatchServer(config, nil)

	client := newTestClient("client-1")
	client.remoteIP = "10.0.0.2"

	// Trigger IP block by accumulating reports.
	ms.rateLimiter.RecordReport(client.GetRemoteIP())
	ms.rateLimiter.RecordReport(client.GetRemoteIP())
	ms.rateLimiter.RecordReport(client.GetRemoteIP())

	payload := mustMarshal(t, MatchNextData{Tags: []string{"tech"}})
	ms.handleNext(client, payload)

	assertClientReceivedError(t, client, ErrCodeIPBlocked)
}

func TestHandleNext_QueueFull(t *testing.T) {
	config := DefaultConfig()
	config.CooldownPeriod = 0
	config.MaxQueueSize = 1
	ms := NewMatchServer(config, nil)

	// Fill the queue with another client.
	other := newTestClient("other-1")
	_ = ms.queue.Enqueue(&MatchEntry{ClientRef: other, Tags: nil, EnqueuedAt: time.Now()})

	client := newTestClient("client-1")
	payload := mustMarshal(t, MatchNextData{Tags: []string{"tech"}})
	ms.handleNext(client, payload)

	assertClientReceivedError(t, client, ErrCodeQueueFull)
}

func TestHandleNext_AlreadyInQueue(t *testing.T) {
	config := DefaultConfig()
	config.CooldownPeriod = 0
	ms := NewMatchServer(config, nil)

	client := newTestClient("client-1")
	_ = ms.queue.Enqueue(&MatchEntry{ClientRef: client, Tags: nil, EnqueuedAt: time.Now()})

	payload := mustMarshal(t, MatchNextData{Tags: []string{"tech"}})
	ms.handleNext(client, payload)

	assertClientReceivedError(t, client, ErrCodeAlreadyInQueue)
}

// --- Test helpers ---

func mustMarshal(t *testing.T, v any) []byte {
	t.Helper()
	data, err := msgpack.Marshal(v)
	if err != nil {
		t.Fatalf("msgpack.Marshal failed: %v", err)
	}
	return data
}

// matchMsgEnvelope is used by test helpers to decode the {type, data} msgpack envelope
// that sendMessage now produces (matching Hub's wire format).
type matchMsgEnvelope struct {
	Type uint8       `msgpack:"type"`
	Data interface{} `msgpack:"data"`
}

// decodeMatchMsg extracts the message type and re-marshals the data field for
// further deserialization into specific data structs.
func decodeMatchMsg(raw []byte) (uint8, []byte, error) {
	var env matchMsgEnvelope
	if err := msgpack.Unmarshal(raw, &env); err != nil {
		return 0, nil, err
	}
	data, err := msgpack.Marshal(env.Data)
	if err != nil {
		return env.Type, nil, err
	}
	return env.Type, data, nil
}

func assertClientReceivedError(t *testing.T, client *testClient, expectedCode string) {
	t.Helper()
	client.mu.Lock()
	msgs := client.sent
	client.mu.Unlock()

	for _, msg := range msgs {
		msgType, data, err := decodeMatchMsg(msg)
		if err != nil {
			continue
		}
		if msgType == MsgMatchError {
			var errData MatchErrorData
			if err := msgpack.Unmarshal(data, &errData); err == nil {
				if errData.Code == expectedCode {
					return
				}
			}
		}
	}
	t.Fatalf("expected client %q to receive error code %q, but did not", client.GetID(), expectedCode)
}

// --- Unit tests for handleReport (task 10.6) ---

func TestHandleReport_ValidReason(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	reporter := newTestClient("reporter")
	reporter.remoteIP = "1.1.1.1"
	partner := newTestClient("partner")
	partner.remoteIP = "2.2.2.2"

	// Set up a room state with both clients.
	ms.roomStates.Add(&MatchRoomState{
		RoomID:     "room-1",
		ClientAID:  reporter.GetID(),
		ClientBID:  partner.GetID(),
		ClientAIP:  reporter.GetRemoteIP(),
		ClientBIP:  partner.GetRemoteIP(),
		ClientARef: reporter,
		ClientBRef: partner,
		CreatedAt:  time.Now(),
	})

	payload := mustMarshal(t, MatchReportData{Reason: "harassment"})
	ms.handleReport(reporter, payload)

	// Verify the partner's IP has a report recorded.
	// After 3 reports, the IP should be blocked.
	// With just 1 report, not yet blocked.
	if ms.rateLimiter.IsBlocked(partner.GetRemoteIP()) {
		t.Fatal("partner IP should not be blocked after 1 report")
	}

	// Reporter should NOT receive any feedback message (silent operation).
	reporter.mu.Lock()
	msgs := reporter.sent
	reporter.mu.Unlock()
	if len(msgs) != 0 {
		t.Fatalf("reporter should not receive any feedback, got %d messages", len(msgs))
	}
}

func TestHandleReport_AllValidReasons(t *testing.T) {
	validReasons := []string{"harassment", "spam", "inappropriate", "other"}

	for _, reason := range validReasons {
		t.Run(reason, func(t *testing.T) {
			config := DefaultConfig()
			ms := NewMatchServer(config, nil)

			reporter := newTestClient("reporter")
			reporter.remoteIP = "1.1.1.1"
			partner := newTestClient("partner")
			partner.remoteIP = "3.3.3.3"

			ms.roomStates.Add(&MatchRoomState{
				RoomID:     "room-1",
				ClientAID:  reporter.GetID(),
				ClientBID:  partner.GetID(),
				ClientAIP:  reporter.GetRemoteIP(),
				ClientBIP:  partner.GetRemoteIP(),
				ClientARef: reporter,
				ClientBRef: partner,
				CreatedAt:  time.Now(),
			})

			payload := mustMarshal(t, MatchReportData{Reason: reason})
			ms.handleReport(reporter, payload)

			// Should not produce errors (no messages sent to reporter).
			reporter.mu.Lock()
			msgs := reporter.sent
			reporter.mu.Unlock()
			if len(msgs) != 0 {
				t.Fatalf("reporter should not receive feedback for valid reason %q", reason)
			}
		})
	}
}

func TestHandleReport_InvalidReason(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	reporter := newTestClient("reporter")
	reporter.remoteIP = "1.1.1.1"
	partner := newTestClient("partner")
	partner.remoteIP = "2.2.2.2"

	ms.roomStates.Add(&MatchRoomState{
		RoomID:     "room-1",
		ClientAID:  reporter.GetID(),
		ClientBID:  partner.GetID(),
		ClientAIP:  reporter.GetRemoteIP(),
		ClientBIP:  partner.GetRemoteIP(),
		ClientARef: reporter,
		ClientBRef: partner,
		CreatedAt:  time.Now(),
	})

	payload := mustMarshal(t, MatchReportData{Reason: "invalid-reason"})
	ms.handleReport(reporter, payload)

	// Should silently ignore â€?no messages to reporter.
	reporter.mu.Lock()
	msgs := reporter.sent
	reporter.mu.Unlock()
	if len(msgs) != 0 {
		t.Fatal("reporter should not receive any feedback for invalid reason")
	}
}

func TestHandleReport_NotInRoom(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	reporter := newTestClient("reporter")

	payload := mustMarshal(t, MatchReportData{Reason: "spam"})
	ms.handleReport(reporter, payload)

	// Should silently ignore â€?no messages.
	reporter.mu.Lock()
	msgs := reporter.sent
	reporter.mu.Unlock()
	if len(msgs) != 0 {
		t.Fatal("reporter not in room should not receive any feedback")
	}
}

func TestHandleReport_ThresholdBlocksIP(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	partner := newTestClient("partner")
	partner.remoteIP = "5.5.5.5"

	// Simulate 3 reports from different reporters against the same partner.
	for i := 0; i < 3; i++ {
		reporter := newTestClient(fmt.Sprintf("reporter-%d", i))
		reporter.remoteIP = fmt.Sprintf("10.0.0.%d", i+1)

		ms.roomStates.Add(&MatchRoomState{
			RoomID:     fmt.Sprintf("room-%d", i),
			ClientAID:  reporter.GetID(),
			ClientBID:  partner.GetID(),
			ClientAIP:  reporter.GetRemoteIP(),
			ClientBIP:  partner.GetRemoteIP(),
			ClientARef: reporter,
			ClientBRef: partner,
			CreatedAt:  time.Now(),
		})

		payload := mustMarshal(t, MatchReportData{Reason: "harassment"})
		ms.handleReport(reporter, payload)
	}

	// After 3 reports, the partner's IP should be blocked.
	if !ms.rateLimiter.IsBlocked(partner.GetRemoteIP()) {
		t.Fatal("partner IP should be blocked after 3 reports within 24h")
	}
}

func TestHandleReport_ReportFromClientB(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	clientA := newTestClient("clientA")
	clientA.remoteIP = "1.1.1.1"
	clientB := newTestClient("clientB")
	clientB.remoteIP = "2.2.2.2"

	ms.roomStates.Add(&MatchRoomState{
		RoomID:     "room-1",
		ClientAID:  clientA.GetID(),
		ClientBID:  clientB.GetID(),
		ClientAIP:  clientA.GetRemoteIP(),
		ClientBIP:  clientB.GetRemoteIP(),
		ClientARef: clientA,
		ClientBRef: clientB,
		CreatedAt:  time.Now(),
	})

	// Client B reports Client A.
	payload := mustMarshal(t, MatchReportData{Reason: "spam"})
	ms.handleReport(clientB, payload)

	// Should record report against Client A's IP.
	// After 3 such reports, Client A's IP would be blocked.
	// For now, just verify no error messages and it doesn't panic.
	clientB.mu.Lock()
	msgs := clientB.sent
	clientB.mu.Unlock()
	if len(msgs) != 0 {
		t.Fatal("reporter (clientB) should not receive feedback")
	}
}

// --- Unit tests for handleExtendRequest (task 10.6) ---

func TestHandleExtendRequest_NotInRoom(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	client := newTestClient("orphan")
	payload := mustMarshal(t, struct{}{})
	ms.handleExtendRequest(client, payload)

	// Should silently ignore â€?no messages.
	client.mu.Lock()
	msgs := client.sent
	client.mu.Unlock()
	if len(msgs) != 0 {
		t.Fatal("client not in room should not receive any messages")
	}
}

func TestHandleExtendRequest_SingleProposal(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	clientA := newTestClient("clientA")
	clientB := newTestClient("clientB")

	ms.roomStates.Add(&MatchRoomState{
		RoomID:     "room-1",
		ClientAID:  clientA.GetID(),
		ClientBID:  clientB.GetID(),
		ClientAIP:  "1.1.1.1",
		ClientBIP:  "2.2.2.2",
		ClientARef: clientA,
		ClientBRef: clientB,
		CreatedAt:  time.Now(),
	})

	payload := mustMarshal(t, struct{}{})
	ms.handleExtendRequest(clientA, payload)

	// Client A should NOT receive MsgMatchExtended (only one proposal so far).
	clientA.mu.Lock()
	aMsgs := clientA.sent
	clientA.mu.Unlock()
	if len(aMsgs) != 0 {
		t.Fatalf("client A should not receive messages for single proposal, got %d", len(aMsgs))
	}

	// Client B should receive MsgMatchExtendReq (notification that partner proposed).
	clientB.mu.Lock()
	bMsgs := clientB.sent
	clientB.mu.Unlock()
	if len(bMsgs) != 1 {
		t.Fatalf("client B should receive exactly 1 message (extend req), got %d", len(bMsgs))
	}
	if bMsgs[0][0] != MsgMatchExtendReq {
		t.Fatalf("expected MsgMatchExtendReq (0x%02x), got 0x%02x", MsgMatchExtendReq, bMsgs[0][0])
	}
}

func TestHandleExtendRequest_MutualConsent(t *testing.T) {
	config := DefaultConfig()
	ms := NewMatchServer(config, nil)

	clientA := newTestClient("clientA")
	clientB := newTestClient("clientB")

	ms.roomStates.Add(&MatchRoomState{
		RoomID:     "room-1",
		ClientAID:  clientA.GetID(),
		ClientBID:  clientB.GetID(),
		ClientAIP:  "1.1.1.1",
		ClientBIP:  "2.2.2.2",
		ClientARef: clientA,
		ClientBRef: clientB,
		CreatedAt:  time.Now(),
	})

	payload := mustMarshal(t, struct{}{})

	// Client A proposes.
	ms.handleExtendRequest(clientA, payload)

	// Client B proposes (mutual consent).
	ms.handleExtendRequest(clientB, payload)

	// Both should receive MsgMatchExtended.
	clientA.mu.Lock()
	aMsgs := clientA.sent
	clientA.mu.Unlock()

	// Client A: no message from first proposal; but gets MsgMatchExtended when B also proposes.
	// Actually, when B proposes, both get MsgMatchExtended. But the sendMessage goes to
	// the caller (clientB) and partner (clientA).
	foundExtendedA := false
	for _, msg := range aMsgs {
		if msgType, _, _ := decodeMatchMsg(msg); msgType == MsgMatchExtended {
			foundExtendedA = true
			var data MatchExtendedData
			if err := msgpack.Unmarshal(msg[1:], &data); err == nil {
				if data.ExtensionsLeft != config.MaxExtensions-1 {
					t.Fatalf("expected extensionsLeft=%d, got %d", config.MaxExtensions-1, data.ExtensionsLeft)
				}
				if data.NewExpiresAt == 0 {
					t.Fatal("newExpiresAt should be non-zero")
				}
			}
			break
		}
	}
	if !foundExtendedA {
		t.Fatal("Client A should receive MsgMatchExtended after mutual consent")
	}

	clientB.mu.Lock()
	bMsgs := clientB.sent
	clientB.mu.Unlock()
	foundExtendedB := false
	for _, msg := range bMsgs {
		if msgType, _, _ := decodeMatchMsg(msg); msgType == MsgMatchExtended {
			foundExtendedB = true
			break
		}
	}
	if !foundExtendedB {
		t.Fatal("Client B should receive MsgMatchExtended after mutual consent")
	}
}

func TestHandleExtendRequest_MaxExtensionsReached(t *testing.T) {
	config := DefaultConfig()
	config.MaxExtensions = 1
	ms := NewMatchServer(config, nil)

	clientA := newTestClient("clientA")
	clientB := newTestClient("clientB")

	ms.roomStates.Add(&MatchRoomState{
		RoomID:         "room-1",
		ClientAID:      clientA.GetID(),
		ClientBID:      clientB.GetID(),
		ClientAIP:      "1.1.1.1",
		ClientBIP:      "2.2.2.2",
		ClientARef:     clientA,
		ClientBRef:     clientB,
		ExtensionCount: 1, // Already used the max
		CreatedAt:      time.Now(),
	})

	payload := mustMarshal(t, struct{}{})
	ms.handleExtendRequest(clientA, payload)

	// Client A should receive M011 error.
	assertClientReceivedError(t, clientA, ErrCodeExtendMaxReached)
}
