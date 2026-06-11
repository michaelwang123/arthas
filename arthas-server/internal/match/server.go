package match

import (
	"errors"
	"time"

	"github.com/arthas/arthas-server/internal/logger"
	"github.com/vmihailenco/msgpack/v5"
)

// RoomCreator defines the minimal interface that MatchServer uses to create rooms.
// Hub implements this interface, decoupling MatchServer from Hub internals.
type RoomCreator interface {
	// CreateMatchRoom creates a temporary match room and returns the roomId.
	// The room is NOT registered in HubRegistry, maxMembers=2.
	CreateMatchRoom(expiresAt int64, ephemeral int) (string, error)
	// JoinClientToRoom joins a client into the specified room.
	JoinClientToRoom(client ClientRef, roomId string, name string) error
	// ExtendMatchRoom updates the room's expiration timestamp.
	// Returns false if the room does not exist.
	ExtendMatchRoom(roomId string, newExpiresAt int64) bool
	// LeaveMatchRoom removes a client from their current room.
	// Handles member removal and room cleanup.
	LeaveMatchRoom(client ClientRef) error
}

// MatchServer manages the match queue, pairing logic, invite links, and rate limiting.
// It runs as an independent component with its own ticker goroutine, interacting
// with the Hub via the RoomCreator interface.
//
// Concurrency model:
// - Run() goroutine: owns match ticker, timeout scan, memory cleanup
// - HandleMessage/HandleDisconnect: called by Hub.Run() goroutine
// - All shared state is protected by sync.Mutex in each sub-component
type MatchServer struct {
	config      *Config
	queue       *MatchQueue
	invites     *InviteLinkStore
	rateLimiter *MatchRateLimiter
	roomCreator RoomCreator
	pending     *PendingMatchStore
	roomStates  *MatchRoomStateStore
	recentPairs *RecentPairsTracker
	done        chan struct{}
}

// NewMatchServer creates a new MatchServer with all sub-components initialized.
func NewMatchServer(config *Config, roomCreator RoomCreator) *MatchServer {
	return &MatchServer{
		config:      config,
		queue:       NewMatchQueue(config.MaxQueueSize),
		invites:     NewInviteLinkStore(config.InviteLinkTTL),
		rateLimiter: NewMatchRateLimiter(config),
		roomCreator: roomCreator,
		pending:     NewPendingMatchStore(),
		roomStates:  NewMatchRoomStateStore(config.MaxExtensions),
		recentPairs: NewRecentPairsTracker(),
		done:        make(chan struct{}),
	}
}

// Run starts the match server goroutine with three tickers:
//   - matchTicker (1s): executes batch matching via FindAllMatches
//   - cleanupTicker (config.CleanupInterval): cleans expired invites, rate limit entries, proposals
//   - timeoutTicker (5s): expires queue entries and pending key exchanges
func (ms *MatchServer) Run() {
	go ms.run()
}

// Stop signals the match server goroutine to exit.
func (ms *MatchServer) Stop() {
	close(ms.done)
}

// run is the internal goroutine loop managing all tickers.
func (ms *MatchServer) run() {
	matchTicker := time.NewTicker(1 * time.Second)
	defer matchTicker.Stop()

	cleanupTicker := time.NewTicker(ms.config.CleanupInterval)
	defer cleanupTicker.Stop()

	timeoutTicker := time.NewTicker(5 * time.Second)
	defer timeoutTicker.Stop()

	for {
		select {
		case <-ms.done:
			return

		case <-matchTicker.C:
			ms.processMatches()

		case <-cleanupTicker.C:
			ms.processCleanup()

		case <-timeoutTicker.C:
			ms.processTimeouts()
		}
	}
}

// processMatches executes batch matching: finds all valid pairs and initiates key exchange.
func (ms *MatchServer) processMatches() {
	// Early return if queue has fewer than 2 entries (avoids unnecessary lock acquisition).
	if ms.queue.Size() < 2 {
		return
	}

	now := time.Now()
	pairs := ms.queue.FindAllMatches(ms.recentPairs, now, ms.config.TagFallbackDelay)

	for _, pair := range pairs {
		entryA := pair[0]
		entryB := pair[1]

		// Create a PendingMatch for the key exchange phase.
		// Preserve original tags for re-queue on timeout.
		pm := &PendingMatch{
			ClientA:   entryA.ClientRef,
			ClientB:   entryB.ClientRef,
			TagsA:     entryA.Tags,
			TagsB:     entryB.Tags,
			CreatedAt: time.Now(),
		}
		ms.pending.Add(pm)

		// Record the pairing in recent pairs tracker.
		ms.recentPairs.RecordPair(entryA.ClientRef.GetID(), entryB.ClientRef.GetID())

		// Instruct Client A to generate the AES-256 key.
		ms.sendMessage(entryA.ClientRef, MsgMatchGenerateKey, MatchGenerateKeyData{
			PartnerID: entryB.ClientRef.GetID(),
		})

		// Auto-generate an invite link for Client B (cold-start fallback not needed here,
		// but Client A gets one while waiting — see handleMatchRequest).

		logger.Info("Match", "paired %s with %s, awaiting key exchange",
			entryA.ClientRef.GetID(), entryB.ClientRef.GetID())
	}
}

// processCleanup runs periodic memory cleanup for expired data.
func (ms *MatchServer) processCleanup() {
	ms.invites.CleanExpired()
	ms.rateLimiter.CleanExpired()
	ms.roomStates.CleanExpiredProposals()
}

// processTimeouts handles queue entry expiry and key exchange timeouts.
func (ms *MatchServer) processTimeouts() {
	// 1. Expire queue entries that exceeded MatchTimeout.
	expired := ms.queue.ExpireEntries(ms.config.MatchTimeout)
	for _, entry := range expired {
		waited := int(time.Since(entry.EnqueuedAt).Seconds())
		ms.sendMessage(entry.ClientRef, MsgMatchTimeout, MatchTimeoutData{
			WaitedSeconds: waited,
		})
		logger.Info("Match", "client %s timed out after %ds in queue",
			entry.ClientRef.GetID(), waited)
	}

	// 2. Expire pending key exchanges that exceeded KeyExchangeTimeout.
	expiredPending := ms.pending.ExpireAll(ms.config.KeyExchangeTimeout)
	for _, pm := range expiredPending {
		// Notify both clients about the timeout.
		ms.sendError(pm.ClientA, ErrCodeKeyExchangeTimeout, "key exchange timeout")
		ms.sendError(pm.ClientB, ErrCodeKeyExchangeTimeout, "partner unresponsive, key exchange timeout")

		// Re-queue both users with their original tags preserved.
		ms.requeueClientWithTags(pm.ClientA, pm.TagsA)
		ms.requeueClientWithTags(pm.ClientB, pm.TagsB)

		logger.Info("Match", "key exchange timeout between %s and %s, re-queued both",
			pm.ClientA.GetID(), pm.ClientB.GetID())
	}
}

// requeueClient re-adds a client to the match queue with no tags (best-effort recovery).
func (ms *MatchServer) requeueClient(client ClientRef) {
	ms.requeueClientWithTags(client, nil)
}

// requeueClientWithTags re-adds a client to the match queue preserving their tag preferences.
func (ms *MatchServer) requeueClientWithTags(client ClientRef, tags []string) {
	entry := &MatchEntry{
		ClientRef:  client,
		Tags:       tags,
		EnqueuedAt: time.Now(),
	}
	// Ignore error — client may have disconnected or already be in queue.
	_ = ms.queue.Enqueue(entry)
}

// HandleMessage routes match messages to specific handlers based on message type.
// Called by Hub.Run() goroutine when a message in the 0x20-0x2F range is received.
func (ms *MatchServer) HandleMessage(client ClientRef, msgType uint8, data []byte) {
	// Feature disabled check.
	if !ms.config.Enabled {
		ms.sendError(client, ErrCodeMatchDisabled, "random match is disabled")
		return
	}

	switch msgType {
	case MsgMatchRequest:
		ms.handleMatchRequest(client, data)
	case MsgMatchCancel:
		ms.handleMatchCancel(client)
	case MsgMatchKeyRelay:
		ms.handleMatchKeyRelay(client, data)
	case MsgMatchInviteJoin:
		ms.handleInviteJoin(client, data)
	case MsgMatchReport:
		ms.handleReport(client, data)
	case MsgMatchExtend:
		ms.handleExtendRequest(client, data)
	case MsgMatchNext:
		ms.handleNext(client, data)
	default:
		logger.Warn("Match", "unknown match message type 0x%02x from client %s", msgType, client.GetID())
	}
}

// HandleDisconnect handles client disconnection. Called by Hub on unregister.
// Checks three states: queue (remove), pending match (cancel + re-queue partner),
// room state (notify partner).
func (ms *MatchServer) HandleDisconnect(clientID string) {
	// 1. Check if client is in the match queue → remove.
	ms.queue.Remove(clientID)

	// 2. Check if client is in a pending key exchange → cancel and re-queue partner.
	pm := ms.pending.GetByClient(clientID)
	if pm != nil {
		// Determine which client is the partner.
		var partner ClientRef
		if pm.ClientA.GetID() == clientID {
			partner = pm.ClientB
		} else {
			partner = pm.ClientA
		}

		// Remove the pending match.
		ms.pending.Remove(pm.ClientA.GetID())

		// Notify partner and re-queue them.
		ms.sendMessage(partner, MsgMatchPartnerLeft, nil)
		ms.requeueClient(partner)

		logger.Info("Match", "client %s disconnected during key exchange, re-queued partner %s",
			clientID, partner.GetID())
	}

	// 3. Check if client is in a match room → notify partner via room state.
	ms.handleRoomDisconnect(clientID)

	// 4. Clean up recent pairs tracking for this client.
	ms.recentPairs.Remove(clientID)
}

// handleRoomDisconnect checks room states for the disconnected client
// and cleans up the room state if found.
func (ms *MatchServer) handleRoomDisconnect(clientID string) {
	state := ms.roomStates.FindByClientID(clientID)
	if state == nil {
		return
	}

	var partnerID string
	if state.ClientAID == clientID {
		partnerID = state.ClientBID
	} else {
		partnerID = state.ClientAID
	}

	ms.roomStates.Remove(state.RoomID)
	logger.Info("Match", "client %s disconnected from match room %s, partner %s notified via room infrastructure",
		clientID, state.RoomID, partnerID)
}

// --- Handler stubs (implemented in tasks 10.3-10.6) ---

func (ms *MatchServer) handleMatchRequest(client ClientRef, data []byte) {
	// 1. Deserialize request data.
	var req MatchRequestData
	if err := msgpack.Unmarshal(data, &req); err != nil {
		ms.sendError(client, ErrCodeInvalidTags, "invalid request data")
		return
	}

	// 2. Validate tags.
	if err := ValidateTagSet(req.Tags); err != nil {
		ms.sendError(client, ErrCodeInvalidTags, err.Error())
		return
	}

	// 3. Check IP block list.
	if ms.rateLimiter.IsBlocked(client.GetRemoteIP()) {
		ms.sendError(client, ErrCodeIPBlocked, "IP temporarily blocked due to reports")
		return
	}

	// 4. Check per-connection cooldown.
	if remaining, onCooldown := ms.rateLimiter.CheckCooldown(client.GetID()); onCooldown {
		retryAfter := int(remaining.Seconds()) + 1 // round up
		ms.sendMessage(client, MsgMatchError, MatchErrorData{
			Code:       ErrCodeCooldown,
			Msg:        "please wait before requesting another match",
			RetryAfter: retryAfter,
		})
		return
	}

	// 5. Check per-IP hourly rate limit.
	if retryAfter, limited := ms.rateLimiter.CheckHourlyLimit(client.GetRemoteIP()); limited {
		ms.sendMessage(client, MsgMatchError, MatchErrorData{
			Code:       ErrCodeRateLimit,
			Msg:        "hourly match request limit exceeded",
			RetryAfter: retryAfter,
		})
		return
	}

	// 6. Check if already in queue.
	if ms.queue.Contains(client.GetID()) {
		ms.sendError(client, ErrCodeAlreadyInQueue, "already in match queue")
		return
	}

	// 7. Check if already in a room.
	if client.GetRoomID() != "" {
		ms.sendError(client, ErrCodeAlreadyInRoom, "leave current room before matching")
		return
	}

	// 8. Check if in a pending key exchange.
	if ms.pending.GetByClient(client.GetID()) != nil {
		ms.sendError(client, ErrCodeAlreadyInQueue, "already in a pending match")
		return
	}

	// 9. Enqueue the client.
	entry := &MatchEntry{
		ClientRef:  client,
		Tags:       req.Tags,
		EnqueuedAt: time.Now(),
	}
	if err := ms.queue.Enqueue(entry); err != nil {
		if errors.Is(err, ErrQueueFull) {
			ms.sendError(client, ErrCodeQueueFull, "match queue is full, try again later")
			return
		}
		// ErrAlreadyInQueue — shouldn't happen since we checked above, but handle defensively.
		ms.sendError(client, ErrCodeAlreadyInQueue, "already in match queue")
		return
	}

	// 10. Record request for cooldown tracking.
	ms.rateLimiter.RecordRequest(client.GetID())

	// 11. Record request for hourly rate limit tracking.
	ms.rateLimiter.RecordHourlyRequest(client.GetRemoteIP())

	// 12. Auto-generate invite link for this user (cold-start mechanism).
	// The invite link is created proactively so the user can share it while waiting.
	inviteLink := ms.invites.Create(client.GetID())
	baseURL := "" // Client constructs full URL from token
	ms.sendMessage(client, MsgMatchInviteCreated, MatchInviteCreatedData{
		Token:     inviteLink.Token,
		ExpiresAt: inviteLink.ExpiresAt.Unix(),
		Link:      baseURL + "/match/" + inviteLink.Token,
	})

	logger.Info("Match", "client %s entered queue with tags %v", client.GetID(), req.Tags)
}

func (ms *MatchServer) handleMatchCancel(client ClientRef) {
	// Idempotent: remove from queue if present, no error if absent.
	removed := ms.queue.Remove(client.GetID())
	if removed != nil {
		logger.Info("Match", "client %s cancelled match", client.GetID())
	}
}

func (ms *MatchServer) handleMatchKeyRelay(client ClientRef, data []byte) {
	// 1. Deserialize data as MatchKeyRelayData (msgpack).
	var keyData MatchKeyRelayData
	if err := msgpack.Unmarshal(data, &keyData); err != nil {
		ms.sendError(client, ErrCodeInvalidTags, "invalid key relay data")
		logger.Warn("Match", "failed to unmarshal MatchKeyRelay from client %s: %v", client.GetID(), err)
		return
	}

	// 2. Look up pending match by this client's ID.
	pm := ms.pending.GetByClient(client.GetID())
	if pm == nil {
		ms.sendError(client, ErrCodeKeyExchangeTimeout, "no pending match found for this client")
		logger.Warn("Match", "client %s sent MatchKeyRelay but has no pending match", client.GetID())
		return
	}

	// 3. Verify this client is Client A (the key generator).
	if pm.ClientA.GetID() != client.GetID() {
		ms.sendError(client, ErrCodeKeyExchangeTimeout, "only the key generator can relay the key")
		logger.Warn("Match", "client %s attempted key relay but is not Client A", client.GetID())
		return
	}

	// 4. Mark key as received.
	pm.KeyReceived = true

	// 5. Create match room.
	expiresAt := time.Now().Add(ms.config.RoomExpiry).Unix()
	roomId, err := ms.roomCreator.CreateMatchRoom(expiresAt, ms.config.EphemeralSeconds)
	if err != nil {
		logger.Error("Match", "failed to create match room for pair %s/%s: %v",
			pm.ClientA.GetID(), pm.ClientB.GetID(), err)
		ms.sendError(pm.ClientA, ErrCodeKeyExchangeTimeout, "failed to create room, please try again")
		ms.sendError(pm.ClientB, ErrCodeKeyExchangeTimeout, "failed to create room, please try again")
		ms.pending.Remove(pm.ClientA.GetID())
		ms.requeueClientWithTags(pm.ClientA, pm.TagsA)
		ms.requeueClientWithTags(pm.ClientB, pm.TagsB)
		return
	}

	// 6. Join both clients to the room with deterministic generated names.
	nameA := GenerateMatchName(roomId, 0)
	nameB := GenerateMatchName(roomId, 1)
	if err := ms.roomCreator.JoinClientToRoom(pm.ClientA, roomId, nameA); err != nil {
		logger.Error("Match", "failed to join Client A %s to room %s: %v",
			pm.ClientA.GetID(), roomId, err)
		ms.sendError(pm.ClientA, ErrCodeKeyExchangeTimeout, "failed to join room")
		ms.sendError(pm.ClientB, ErrCodeKeyExchangeTimeout, "failed to join room")
		ms.pending.Remove(pm.ClientA.GetID())
		ms.requeueClientWithTags(pm.ClientA, pm.TagsA)
		ms.requeueClientWithTags(pm.ClientB, pm.TagsB)
		return
	}
	if err := ms.roomCreator.JoinClientToRoom(pm.ClientB, roomId, nameB); err != nil {
		logger.Error("Match", "failed to join Client B %s to room %s: %v",
			pm.ClientB.GetID(), roomId, err)
		// Rollback: remove Client A from the room since Client B couldn't join.
		_ = ms.roomCreator.LeaveMatchRoom(pm.ClientA)
		ms.sendError(pm.ClientA, ErrCodeKeyExchangeTimeout, "failed to join room")
		ms.sendError(pm.ClientB, ErrCodeKeyExchangeTimeout, "failed to join room")
		ms.pending.Remove(pm.ClientA.GetID())
		ms.requeueClientWithTags(pm.ClientA, pm.TagsA)
		ms.requeueClientWithTags(pm.ClientB, pm.TagsB)
		return
	}

	// 7. Create MatchRoomState for extension tracking.
	ms.roomStates.Add(&MatchRoomState{
		RoomID:     roomId,
		ClientAID:  pm.ClientA.GetID(),
		ClientBID:  pm.ClientB.GetID(),
		ClientAIP:  pm.ClientA.GetRemoteIP(),
		ClientBIP:  pm.ClientB.GetRemoteIP(),
		ClientARef: pm.ClientA,
		ClientBRef: pm.ClientB,
		CreatedAt:  time.Now(),
	})

	// 8. Send MatchFound to Client A (without key).
	ms.sendMessage(pm.ClientA, MsgMatchFound, MatchFoundData{
		RoomID:    roomId,
		ExpiresAt: expiresAt,
		Ephemeral: ms.config.EphemeralSeconds,
	})

	// 9. Send MatchFound to Client B (WITH key).
	ms.sendMessage(pm.ClientB, MsgMatchFound, MatchFoundData{
		RoomID:    roomId,
		ExpiresAt: expiresAt,
		Ephemeral: ms.config.EphemeralSeconds,
		Key:       keyData.Key,
	})

	// 10. Remove pending match (key exchange complete).
	ms.pending.Remove(pm.ClientA.GetID())

	// 11. Log success.
	logger.Info("Match", "match complete: %s and %s joined room %s (expires %d)",
		pm.ClientA.GetID(), pm.ClientB.GetID(), roomId, expiresAt)
}

func (ms *MatchServer) handleInviteJoin(client ClientRef, data []byte) {
	// 1. Deserialize data as MatchInviteJoinData → get Token.
	var req MatchInviteJoinData
	if err := msgpack.Unmarshal(data, &req); err != nil {
		ms.sendError(client, ErrCodeInviteInvalid, "invalid invite join payload")
		return
	}

	// 2. Validate and consume the invite token.
	inviteLink, err := ms.invites.Use(req.Token)
	if err != nil {
		switch err {
		case ErrInviteNotFound:
			ms.sendError(client, ErrCodeInviteInvalid, "invalid invite token")
		case ErrInviteUsed:
			ms.sendError(client, ErrCodeInviteInvalid, "invite link already used")
		case ErrInviteExpired:
			ms.sendError(client, ErrCodeInviteExpired, "invite link expired")
		default:
			ms.sendError(client, ErrCodeInviteInvalid, "invite validation failed")
		}
		return
	}

	// 3. Find the creator in the queue by their ID.
	creatorEntry := ms.queue.Remove(inviteLink.CreatorID)
	if creatorEntry == nil {
		ms.sendError(client, ErrCodeInviteExpired, "link creator no longer waiting")
		return
	}

	// 4. Create PendingMatch: creator is Client A (key generator), invitee is Client B.
	pm := &PendingMatch{
		ClientA:   creatorEntry.ClientRef,
		ClientB:   client,
		CreatedAt: time.Now(),
	}
	ms.pending.Add(pm)

	// 5. Record recent pairs to prevent re-matching in session loop.
	ms.recentPairs.RecordPair(creatorEntry.ClientRef.GetID(), client.GetID())

	// 6. Send MsgMatchGenerateKey to creator (Client A) to generate the AES-256 key.
	ms.sendMessage(creatorEntry.ClientRef, MsgMatchGenerateKey, MatchGenerateKeyData{
		PartnerID: client.GetID(),
	})

	logger.Info("Match", "invite join: paired creator %s with invitee %s via token",
		creatorEntry.ClientRef.GetID(), client.GetID())
}

func (ms *MatchServer) handleReport(client ClientRef, data []byte) {
	// 1. Deserialize data as MatchReportData → get Reason.
	var reportData MatchReportData
	if err := msgpack.Unmarshal(data, &reportData); err != nil {
		// Don't give feedback on malformed reports — silently ignore.
		return
	}

	// 2. Validate reason is one of the allowed categories.
	// Silently ignore invalid reasons to avoid giving feedback that could help abusers.
	if !isValidReportReason(reportData.Reason) {
		return
	}

	// 3. Find the room state where this client is a participant.
	state := ms.roomStates.FindByClientID(client.GetID())
	if state == nil {
		// Client is not in a match room — ignore.
		return
	}

	// 4. Determine the partner's IP from the room state.
	var partnerIP string
	if state.ClientAID == client.GetID() {
		partnerIP = state.ClientBIP
	} else {
		partnerIP = state.ClientAIP
	}

	if partnerIP == "" {
		// Safety: if IP was not recorded, can't track report.
		return
	}

	// 5. Record report against the partner's IP.
	// RecordReport internally checks threshold and blocks if >= 3 reports in 24h.
	ms.rateLimiter.RecordReport(partnerIP)
	// Note: Report details intentionally NOT logged to protect user privacy.
}

// isValidReportReason checks if a report reason is one of the accepted categories.
func isValidReportReason(reason string) bool {
	switch reason {
	case "harassment", "spam", "inappropriate", "other":
		return true
	default:
		return false
	}
}

func (ms *MatchServer) handleExtendRequest(client ClientRef, data []byte) {
	// 1. Find the room that client is in.
	state := ms.roomStates.FindByClientID(client.GetID())
	if state == nil {
		// Client is not in a match room — ignore.
		return
	}

	// 2. Call ProposeExtend.
	bothAgreed, err := ms.roomStates.ProposeExtend(state.RoomID, client.GetID())
	if err != nil {
		switch err {
		case ErrExtendMaxReached:
			ms.sendError(client, ErrCodeExtendMaxReached, "maximum extensions reached")
		case ErrRoomNotFound, ErrClientNotInRoom:
			// Ignore — race condition or stale state.
		}
		return
	}

	// Determine partner's ClientRef.
	var partnerRef ClientRef
	if state.ClientAID == client.GetID() {
		partnerRef = state.ClientBRef
	} else {
		partnerRef = state.ClientARef
	}

	if bothAgreed {
		// 3. Both agreed — extend the room.
		newExpiresAt := time.Now().Add(ms.config.RoomExpiry).Unix()
		extensionsLeft := ms.config.MaxExtensions - state.ExtensionCount

		// Actually extend the room's expiry in RoomManager.
		if ms.roomCreator != nil {
			ms.roomCreator.ExtendMatchRoom(state.RoomID, newExpiresAt)
		}

		extendedData := MatchExtendedData{
			NewExpiresAt:   newExpiresAt,
			ExtensionsLeft: extensionsLeft,
		}

		// Send MsgMatchExtended to both clients.
		ms.sendMessage(client, MsgMatchExtended, extendedData)
		if partnerRef != nil {
			ms.sendMessage(partnerRef, MsgMatchExtended, extendedData)
		}

		logger.Info("Match", "room %s extended by mutual consent (extensions left: %d)",
			state.RoomID, extensionsLeft)
	} else {
		// 4. Waiting for partner — notify the partner that an extension was proposed.
		if partnerRef != nil {
			ms.sendMessage(partnerRef, MsgMatchExtendReq, nil)
		}
	}
}

func (ms *MatchServer) handleNext(client ClientRef, data []byte) {
	// 1. Deserialize data as MatchNextData (same struct as MatchRequestData) → get Tags.
	var req MatchNextData
	if err := msgpack.Unmarshal(data, &req); err != nil {
		ms.sendError(client, ErrCodeInvalidTags, "invalid next match payload")
		return
	}

	// 2. Validate tags.
	if err := ValidateTagSet(req.Tags); err != nil {
		ms.sendError(client, ErrCodeInvalidTags, err.Error())
		return
	}

	// 3. Check cooldown.
	if remaining, onCooldown := ms.rateLimiter.CheckCooldown(client.GetID()); onCooldown {
		retryAfter := int(remaining.Seconds()) + 1
		ms.sendMessage(client, MsgMatchError, MatchErrorData{
			Code:       ErrCodeCooldown,
			Msg:        "cooldown active, please wait",
			RetryAfter: retryAfter,
		})
		return
	}

	// 4. Check hourly rate limit.
	if retryAfter, limited := ms.rateLimiter.CheckHourlyLimit(client.GetRemoteIP()); limited {
		ms.sendMessage(client, MsgMatchError, MatchErrorData{
			Code:       ErrCodeRateLimit,
			Msg:        "hourly match limit exceeded",
			RetryAfter: retryAfter,
		})
		return
	}

	// 5. Check if IP is blocked.
	if ms.rateLimiter.IsBlocked(client.GetRemoteIP()) {
		ms.sendError(client, ErrCodeIPBlocked, "temporarily blocked due to reports")
		return
	}

	// 6. Leave current match room: clean up MatchRoomState and notify partner.
	state := ms.roomStates.FindByClientID(client.GetID())
	if state != nil {
		// Notify partner that this user left.
		var partnerRef ClientRef
		if state.ClientAID == client.GetID() {
			partnerRef = state.ClientBRef
		} else {
			partnerRef = state.ClientARef
		}
		if partnerRef != nil {
			ms.sendMessage(partnerRef, MsgMatchPartnerLeft, nil)
		}
		ms.roomStates.Remove(state.RoomID)
	}

	// 7. Leave the actual room via RoomCreator.
	if ms.roomCreator != nil {
		_ = ms.roomCreator.LeaveMatchRoom(client)
	}

	// 8. Enqueue client with the provided tags.
	entry := &MatchEntry{
		ClientRef:  client,
		Tags:       req.Tags,
		EnqueuedAt: time.Now(),
	}
	if err := ms.queue.Enqueue(entry); err != nil {
		switch err {
		case ErrQueueFull:
			ms.sendError(client, ErrCodeQueueFull, "match queue is full, try again later")
		case ErrAlreadyInQueue:
			ms.sendError(client, ErrCodeAlreadyInQueue, "already in match queue")
		default:
			ms.sendError(client, ErrCodeQueueFull, "failed to enter queue")
		}
		return
	}

	// 9. Record request for cooldown tracking.
	ms.rateLimiter.RecordRequest(client.GetID())

	// 10. Record hourly request for rate limit tracking.
	ms.rateLimiter.RecordHourlyRequest(client.GetRemoteIP())

	logger.Info("Match", "client %s re-entered queue via Next with tags %v",
		client.GetID(), req.Tags)
}

// --- Helper functions ---

// sendMessage serializes data with msgpack, prepends the msgType byte, and sends to client.
func (ms *MatchServer) sendMessage(client ClientRef, msgType uint8, data any) {
	// Use the same {type, data} envelope format as Hub messages.
	// The client's websocket.ts decodes ALL messages with msgpack as {type, data},
	// so match messages must use the same wire format for consistency.
	envelope := struct {
		Type uint8 `msgpack:"type"`
		Data any   `msgpack:"data"`
	}{
		Type: msgType,
		Data: data,
	}

	encoded, err := msgpack.Marshal(envelope)
	if err != nil {
		logger.Error("Match", "failed to marshal message type 0x%02x: %v", msgType, err)
		return
	}

	client.Send(encoded)
}

// QueueSize returns the current number of entries in the match queue.
// Safe for concurrent use.
func (ms *MatchServer) QueueSize() int {
	return ms.queue.Size()
}

// IsEnabled returns whether the match feature is enabled.
func (ms *MatchServer) IsEnabled() bool {
	return ms.config.Enabled
}

// sendError sends a MsgMatchError message to the client with the given code and message.
func (ms *MatchServer) sendError(client ClientRef, code, msg string) {
	ms.sendMessage(client, MsgMatchError, MatchErrorData{
		Code: code,
		Msg:  msg,
	})
}
