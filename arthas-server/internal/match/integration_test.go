package match

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/vmihailenco/msgpack/v5"
)

// --- Integration test mocks ---

// mockIntegrationRoomCreator tracks room creation and client joins for integration testing.
type mockIntegrationRoomCreator struct {
	mu      sync.Mutex
	rooms   map[string]bool
	joined  map[string]string // clientID → roomID
	counter int
}

func newMockIntegrationRoomCreator() *mockIntegrationRoomCreator {
	return &mockIntegrationRoomCreator{
		rooms:  make(map[string]bool),
		joined: make(map[string]string),
	}
}

func (m *mockIntegrationRoomCreator) CreateMatchRoom(expiresAt int64, ephemeral int) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	roomID := fmt.Sprintf("room-%d", m.counter)
	m.counter++
	m.rooms[roomID] = true
	return roomID, nil
}

func (m *mockIntegrationRoomCreator) JoinClientToRoom(client ClientRef, roomId string, name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.joined[client.GetID()] = roomId
	return nil
}

func (m *mockIntegrationRoomCreator) ExtendMatchRoom(roomId string, newExpiresAt int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, exists := m.rooms[roomId]
	return exists
}

func (m *mockIntegrationRoomCreator) LeaveMatchRoom(client ClientRef) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.joined, client.GetID())
	return nil
}

func (m *mockIntegrationRoomCreator) getRoomCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.rooms)
}

func (m *mockIntegrationRoomCreator) getJoinedRoom(clientID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.joined[clientID]
}

// --- Integration tests ---

// TestIntegration_FullMatchFlow tests the complete end-to-end flow:
// Two clients → queue → pair → key exchange → room join.
func TestIntegration_FullMatchFlow(t *testing.T) {
	creator := newMockIntegrationRoomCreator()
	config := DefaultConfig()
	config.CooldownPeriod = 0   // No cooldown for tests
	config.TagFallbackDelay = 0 // Immediate matching without tag preference
	config.KeyExchangeTimeout = 5 * time.Second
	ms := NewMatchServer(config, creator)

	clientA := newTestClient("alice")
	clientB := newTestClient("bob")

	// Step 1: Both clients send MatchRequest with shared tags.
	reqData := MatchRequestData{Tags: []string{"tech"}}
	payloadA, _ := msgpack.Marshal(reqData)
	payloadB, _ := msgpack.Marshal(reqData)

	ms.HandleMessage(clientA, MsgMatchRequest, payloadA)
	ms.HandleMessage(clientB, MsgMatchRequest, payloadB)

	// Verify both are in the queue.
	if !ms.queue.Contains("alice") {
		t.Fatal("Client A should be in queue after MatchRequest")
	}
	if !ms.queue.Contains("bob") {
		t.Fatal("Client B should be in queue after MatchRequest")
	}

	// Step 2: Trigger processMatches to pair them.
	ms.processMatches()

	// Verify both are removed from queue.
	if ms.queue.Contains("alice") {
		t.Fatal("Client A should be removed from queue after pairing")
	}
	if ms.queue.Contains("bob") {
		t.Fatal("Client B should be removed from queue after pairing")
	}

	// Verify pending match exists.
	pm := ms.pending.GetByClient("alice")
	if pm == nil {
		t.Fatal("pending match should exist after processMatches pairs clients")
	}
	if pm.ClientA.GetID() != "alice" || pm.ClientB.GetID() != "bob" {
		t.Fatalf("unexpected pending match clients: A=%q B=%q", pm.ClientA.GetID(), pm.ClientB.GetID())
	}

	// Step 3: Client A should have received MsgMatchGenerateKey.
	clientA.mu.Lock()
	aMsgs := clientA.sent
	clientA.mu.Unlock()

	foundGenKey := false
	for _, msg := range aMsgs {
		if len(msg) > 0 && msg[0] == MsgMatchGenerateKey {
			foundGenKey = true
			break
		}
	}
	if !foundGenKey {
		t.Fatal("Client A should have received MsgMatchGenerateKey")
	}

	// Step 4: Client A sends MatchKeyRelay.
	keyRelayData := MatchKeyRelayData{Key: "dGVzdC1rZXktMTIzNDU2Nzg5MA"}
	keyPayload, _ := msgpack.Marshal(keyRelayData)
	ms.HandleMessage(clientA, MsgMatchKeyRelay, keyPayload)

	// Step 5: Verify both clients received MsgMatchFound.
	clientA.mu.Lock()
	aMsgs = clientA.sent
	clientA.mu.Unlock()

	var foundDataA *MatchFoundData
	for _, msg := range aMsgs {
		if len(msg) > 0 && msg[0] == MsgMatchFound {
			var data MatchFoundData
			if err := msgpack.Unmarshal(msg[1:], &data); err == nil {
				foundDataA = &data
			}
			break
		}
	}
	if foundDataA == nil {
		t.Fatal("Client A should have received MsgMatchFound")
	}
	if foundDataA.Key != "" {
		t.Fatal("Client A should NOT receive the key in MatchFound")
	}

	clientB.mu.Lock()
	bMsgs := clientB.sent
	clientB.mu.Unlock()

	var foundDataB *MatchFoundData
	for _, msg := range bMsgs {
		if len(msg) > 0 && msg[0] == MsgMatchFound {
			var data MatchFoundData
			if err := msgpack.Unmarshal(msg[1:], &data); err == nil {
				foundDataB = &data
			}
			break
		}
	}
	if foundDataB == nil {
		t.Fatal("Client B should have received MsgMatchFound")
	}
	if foundDataB.Key != "dGVzdC1rZXktMTIzNDU2Nzg5MA" {
		t.Fatalf("Client B should receive the key, got %q", foundDataB.Key)
	}

	// Verify both got the same room ID.
	if foundDataA.RoomID != foundDataB.RoomID {
		t.Fatalf("both clients should receive same room ID: A=%q B=%q", foundDataA.RoomID, foundDataB.RoomID)
	}

	// Verify room was actually created and clients joined.
	if creator.getRoomCount() != 1 {
		t.Fatalf("expected 1 room created, got %d", creator.getRoomCount())
	}
	if creator.getJoinedRoom("alice") != foundDataA.RoomID {
		t.Fatal("Client A should be joined to the match room")
	}
	if creator.getJoinedRoom("bob") != foundDataA.RoomID {
		t.Fatal("Client B should be joined to the match room")
	}

	// Verify pending match was cleaned up.
	if ms.pending.GetByClient("alice") != nil {
		t.Fatal("pending match should be removed after successful key exchange")
	}

	// Verify MatchRoomState was created.
	state := ms.roomStates.Get(foundDataA.RoomID)
	if state == nil {
		t.Fatal("MatchRoomState should exist after match completion")
	}
}

// TestIntegration_KeyExchangeTimeout tests that when key relay times out,
// both clients get M012 errors and are re-queued.
func TestIntegration_KeyExchangeTimeout(t *testing.T) {
	creator := newMockIntegrationRoomCreator()
	config := DefaultConfig()
	config.CooldownPeriod = 0
	config.TagFallbackDelay = 0
	config.KeyExchangeTimeout = 1 * time.Second // Short timeout for test
	ms := NewMatchServer(config, creator)

	clientA := newTestClient("alice")
	clientB := newTestClient("bob")

	// Queue both clients and trigger matching.
	reqData := MatchRequestData{Tags: []string{"tech"}}
	payload, _ := msgpack.Marshal(reqData)
	ms.HandleMessage(clientA, MsgMatchRequest, payload)
	ms.HandleMessage(clientB, MsgMatchRequest, payload)
	ms.processMatches()

	// Verify pending match exists.
	if ms.pending.GetByClient("alice") == nil {
		t.Fatal("pending match should exist after pairing")
	}

	// Manipulate CreatedAt to simulate timeout (set to 2 seconds ago).
	pm := ms.pending.GetByClient("alice")
	pm.CreatedAt = time.Now().Add(-2 * time.Second)

	// Do NOT send key relay — trigger timeout processing.
	ms.processTimeouts()

	// Verify pending match is cleaned up.
	if ms.pending.GetByClient("alice") != nil {
		t.Fatal("pending match should be removed after key exchange timeout")
	}

	// Verify both clients received M012 error.
	clientA.mu.Lock()
	aMsgs := clientA.sent
	clientA.mu.Unlock()

	foundErrA := false
	for _, msg := range aMsgs {
		if len(msg) > 0 && msg[0] == MsgMatchError {
			var errData MatchErrorData
			if err := msgpack.Unmarshal(msg[1:], &errData); err == nil {
				if errData.Code == ErrCodeKeyExchangeTimeout {
					foundErrA = true
					break
				}
			}
		}
	}
	if !foundErrA {
		t.Fatal("Client A should have received M012 (key exchange timeout) error")
	}

	clientB.mu.Lock()
	bMsgs := clientB.sent
	clientB.mu.Unlock()

	foundErrB := false
	for _, msg := range bMsgs {
		if len(msg) > 0 && msg[0] == MsgMatchError {
			var errData MatchErrorData
			if err := msgpack.Unmarshal(msg[1:], &errData); err == nil {
				if errData.Code == ErrCodeKeyExchangeTimeout {
					foundErrB = true
					break
				}
			}
		}
	}
	if !foundErrB {
		t.Fatal("Client B should have received M012 (key exchange timeout) error")
	}

	// Verify both clients are re-queued.
	if !ms.queue.Contains("alice") {
		t.Fatal("Client A should be re-queued after key exchange timeout")
	}
	if !ms.queue.Contains("bob") {
		t.Fatal("Client B should be re-queued after key exchange timeout")
	}

	// Verify no room was created.
	if creator.getRoomCount() != 0 {
		t.Fatalf("no room should be created after timeout, got %d", creator.getRoomCount())
	}
}

// TestIntegration_InviteLink tests the invite link flow end-to-end:
// Client A creates invite + queues → Client B joins via token → pairing → key exchange → room.
func TestIntegration_InviteLink(t *testing.T) {
	creator := newMockIntegrationRoomCreator()
	config := DefaultConfig()
	config.CooldownPeriod = 0
	config.TagFallbackDelay = 0
	ms := NewMatchServer(config, creator)

	clientA := newTestClient("creator-1")
	clientB := newTestClient("invitee-1")

	// Step 1: Client A creates an invite link and enters the queue.
	inviteLink := ms.invites.Create(clientA.GetID())
	entry := &MatchEntry{ClientRef: clientA, Tags: []string{"tech"}, EnqueuedAt: time.Now()}
	if err := ms.queue.Enqueue(entry); err != nil {
		t.Fatalf("failed to enqueue creator: %v", err)
	}

	// Step 2: Client B joins via the invite token.
	joinPayload, _ := msgpack.Marshal(MatchInviteJoinData{Token: inviteLink.Token})
	ms.HandleMessage(clientB, MsgMatchInviteJoin, joinPayload)

	// Step 3: Verify pairing occurred — creator removed from queue.
	if ms.queue.Contains(clientA.GetID()) {
		t.Fatal("creator should be removed from queue after invite join")
	}

	// Verify pending match with creator as ClientA, invitee as ClientB.
	pm := ms.pending.GetByClient(clientA.GetID())
	if pm == nil {
		t.Fatal("pending match should exist after invite join")
	}
	if pm.ClientA.GetID() != clientA.GetID() {
		t.Fatalf("expected ClientA=%q, got %q", clientA.GetID(), pm.ClientA.GetID())
	}
	if pm.ClientB.GetID() != clientB.GetID() {
		t.Fatalf("expected ClientB=%q, got %q", clientB.GetID(), pm.ClientB.GetID())
	}

	// Step 4: Creator (Client A) should receive MsgMatchGenerateKey.
	clientA.mu.Lock()
	aMsgs := clientA.sent
	clientA.mu.Unlock()

	foundGenKey := false
	for _, msg := range aMsgs {
		if len(msg) > 0 && msg[0] == MsgMatchGenerateKey {
			foundGenKey = true
			break
		}
	}
	if !foundGenKey {
		t.Fatal("creator should have received MsgMatchGenerateKey after invite pairing")
	}

	// Step 5: Creator relays key.
	keyPayload, _ := msgpack.Marshal(MatchKeyRelayData{Key: "aW52aXRlLWtleS1kYXRh"})
	ms.HandleMessage(clientA, MsgMatchKeyRelay, keyPayload)

	// Step 6: Verify both received MsgMatchFound.
	clientA.mu.Lock()
	aMsgs = clientA.sent
	clientA.mu.Unlock()

	var foundA *MatchFoundData
	for _, msg := range aMsgs {
		if len(msg) > 0 && msg[0] == MsgMatchFound {
			var data MatchFoundData
			if err := msgpack.Unmarshal(msg[1:], &data); err == nil {
				foundA = &data
			}
			break
		}
	}
	if foundA == nil {
		t.Fatal("creator should have received MsgMatchFound")
	}

	clientB.mu.Lock()
	bMsgs := clientB.sent
	clientB.mu.Unlock()

	var foundB *MatchFoundData
	for _, msg := range bMsgs {
		if len(msg) > 0 && msg[0] == MsgMatchFound {
			var data MatchFoundData
			if err := msgpack.Unmarshal(msg[1:], &data); err == nil {
				foundB = &data
			}
			break
		}
	}
	if foundB == nil {
		t.Fatal("invitee should have received MsgMatchFound")
	}

	// Verify same room, key only to invitee (Client B).
	if foundA.RoomID != foundB.RoomID {
		t.Fatalf("room IDs should match: A=%q B=%q", foundA.RoomID, foundB.RoomID)
	}
	if foundA.Key != "" {
		t.Fatal("creator should NOT receive the key")
	}
	if foundB.Key != "aW52aXRlLWtleS1kYXRh" {
		t.Fatalf("invitee should receive the key, got %q", foundB.Key)
	}

	// Verify room created and both joined.
	if creator.getRoomCount() != 1 {
		t.Fatalf("expected 1 room, got %d", creator.getRoomCount())
	}
	if creator.getJoinedRoom(clientA.GetID()) == "" {
		t.Fatal("creator should be joined to room")
	}
	if creator.getJoinedRoom(clientB.GetID()) == "" {
		t.Fatal("invitee should be joined to room")
	}

	// Verify recent pairs recorded.
	if !ms.recentPairs.IsRecentPair(clientA.GetID(), clientB.GetID()) {
		t.Fatal("creator and invitee should be recorded as recent pair")
	}
}

// TestIntegration_SessionLoop tests the "Next" flow: after a match completes,
// Client A sends Next and is re-queued without repeat pairing.
func TestIntegration_SessionLoop(t *testing.T) {
	creator := newMockIntegrationRoomCreator()
	config := DefaultConfig()
	config.CooldownPeriod = 0
	config.TagFallbackDelay = 0
	ms := NewMatchServer(config, creator)

	clientA := newTestClient("alice")
	clientB := newTestClient("bob")
	clientC := newTestClient("charlie")

	// Step 1: Match A and B via direct queue + processMatches.
	reqData := MatchRequestData{Tags: []string{"tech"}}
	payload, _ := msgpack.Marshal(reqData)
	ms.HandleMessage(clientA, MsgMatchRequest, payload)
	ms.HandleMessage(clientB, MsgMatchRequest, payload)
	ms.processMatches()

	// Complete the match with key relay.
	keyPayload, _ := msgpack.Marshal(MatchKeyRelayData{Key: "c2Vzc2lvbi1sb29wLWtleQ"})
	ms.HandleMessage(clientA, MsgMatchKeyRelay, keyPayload)

	// Verify match completed (room created).
	if creator.getRoomCount() != 1 {
		t.Fatalf("expected 1 room after first match, got %d", creator.getRoomCount())
	}

	// Step 2: Client A sends MatchNext to re-enter queue.
	nextPayload, _ := msgpack.Marshal(MatchNextData{Tags: []string{"tech"}})
	ms.HandleMessage(clientA, MsgMatchNext, nextPayload)

	// Verify Client A is back in queue.
	if !ms.queue.Contains("alice") {
		t.Fatal("Client A should be in queue after sending Next")
	}

	// Step 3: Put Client B back in queue (simulate B also pressing Next).
	ms.HandleMessage(clientB, MsgMatchNext, nextPayload)
	if !ms.queue.Contains("bob") {
		t.Fatal("Client B should be in queue after sending Next")
	}

	// Step 4: Also put Client C in queue.
	ms.HandleMessage(clientC, MsgMatchRequest, payload)
	if !ms.queue.Contains("charlie") {
		t.Fatal("Client C should be in queue")
	}

	// Step 5: Process matches — A and B are recent pairs, so they should NOT be re-paired.
	// A should match with C instead.
	ms.processMatches()

	// Verify A is NOT paired with B again.
	pmA := ms.pending.GetByClient("alice")
	if pmA != nil {
		partnerID := pmA.ClientB.GetID()
		if pmA.ClientA.GetID() == "alice" {
			partnerID = pmA.ClientB.GetID()
		} else {
			partnerID = pmA.ClientA.GetID()
		}
		if partnerID == "bob" {
			t.Fatal("Client A should NOT be re-paired with Client B (recent pair)")
		}
	}

	// A should be paired with C (the only non-recent option).
	if pmA == nil {
		// Check if C was paired with A (A might be ClientB).
		pmC := ms.pending.GetByClient("charlie")
		if pmC == nil {
			t.Fatal("A and C should have been paired")
		}
		if pmC.ClientA.GetID() != "alice" && pmC.ClientB.GetID() != "alice" {
			t.Fatal("A should be paired with C")
		}
	} else {
		// A is in a pending match — verify it's with C.
		if pmA.ClientA.GetID() == "alice" {
			if pmA.ClientB.GetID() != "charlie" {
				t.Fatalf("expected A paired with C, got %q", pmA.ClientB.GetID())
			}
		} else {
			if pmA.ClientA.GetID() != "charlie" {
				t.Fatalf("expected A paired with C, got %q", pmA.ClientA.GetID())
			}
		}
	}
}

// TestIntegration_FeatureDisabled tests that when Config.Enabled=false,
// all match messages are rejected with M001 error.
func TestIntegration_FeatureDisabled(t *testing.T) {
	config := DefaultConfig()
	config.Enabled = false
	ms := NewMatchServer(config, nil) // No room creator needed

	client := newTestClient("client-1")

	// Send a MatchRequest.
	reqData := MatchRequestData{Tags: []string{"tech"}}
	payload, _ := msgpack.Marshal(reqData)
	ms.HandleMessage(client, MsgMatchRequest, payload)

	// Verify client received M001 error.
	client.mu.Lock()
	msgs := client.sent
	client.mu.Unlock()

	if len(msgs) == 0 {
		t.Fatal("client should receive a response when feature is disabled")
	}

	foundDisabledErr := false
	for _, msg := range msgs {
		if len(msg) > 0 && msg[0] == MsgMatchError {
			var errData MatchErrorData
			if err := msgpack.Unmarshal(msg[1:], &errData); err == nil {
				if errData.Code == ErrCodeMatchDisabled {
					foundDisabledErr = true
					break
				}
			}
		}
	}
	if !foundDisabledErr {
		t.Fatal("client should receive M001 (match disabled) error")
	}

	// Verify client is NOT in queue.
	if ms.queue.Contains(client.GetID()) {
		t.Fatal("client should NOT be in queue when feature is disabled")
	}

	// Also test other message types are rejected.
	otherMessages := []uint8{
		MsgMatchCancel,
		MsgMatchKeyRelay,
		MsgMatchInviteJoin,
		MsgMatchReport,
		MsgMatchExtend,
		MsgMatchNext,
	}

	for _, msgType := range otherMessages {
		// Reset sent messages.
		client.mu.Lock()
		client.sent = nil
		client.mu.Unlock()

		ms.HandleMessage(client, msgType, payload)

		client.mu.Lock()
		msgs = client.sent
		client.mu.Unlock()

		found := false
		for _, msg := range msgs {
			if len(msg) > 0 && msg[0] == MsgMatchError {
				var errData MatchErrorData
				if err := msgpack.Unmarshal(msg[1:], &errData); err == nil {
					if errData.Code == ErrCodeMatchDisabled {
						found = true
						break
					}
				}
			}
		}
		if !found {
			t.Fatalf("message type 0x%02x should be rejected with M001 when feature is disabled", msgType)
		}
	}
}
