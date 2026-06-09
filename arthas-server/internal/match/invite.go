package match

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sync"
	"time"
)

// InviteLink represents a single-use invite link token for the cold-start mechanism.
// A creator generates a link; the first person to open it gets paired with the creator.
type InviteLink struct {
	Token     string    // crypto-random URL-safe token (16 bytes, base64url)
	CreatorID string    // client ID of the link creator
	CreatedAt time.Time // when the link was created
	ExpiresAt time.Time // CreatedAt + TTL
	Used      bool      // single-use flag — true after successful use
}

// InviteLinkStore manages invite link tokens with thread-safe access.
// Each creator can have at most one active link — creating a new one replaces the old.
type InviteLinkStore struct {
	mu        sync.Mutex
	byToken   map[string]*InviteLink // token → InviteLink
	byCreator map[string]string      // creatorID → token (one active link per creator)
	ttl       time.Duration
}

// Sentinel errors for invite link operations.
var (
	ErrInviteNotFound = errors.New("match: invite token not found")
	ErrInviteUsed     = errors.New("match: invite token already used")
	ErrInviteExpired  = errors.New("match: invite token expired")
)

// NewInviteLinkStore creates a new InviteLinkStore with the given TTL for links.
func NewInviteLinkStore(ttl time.Duration) *InviteLinkStore {
	return &InviteLinkStore{
		byToken:   make(map[string]*InviteLink),
		byCreator: make(map[string]string),
		ttl:       ttl,
	}
}

// Create generates a new invite link for the given creator.
// If the creator already has an active link, it is replaced.
// Uses crypto/rand for token generation (16 bytes, base64url-encoded, no padding).
func (s *InviteLinkStore) Create(creatorID string) *InviteLink {
	token := generateCryptoToken()
	now := time.Now()

	link := &InviteLink{
		Token:     token,
		CreatorID: creatorID,
		CreatedAt: now,
		ExpiresAt: now.Add(s.ttl),
		Used:      false,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// If creator already has an active link, remove it.
	if oldToken, exists := s.byCreator[creatorID]; exists {
		delete(s.byToken, oldToken)
	}

	s.byToken[token] = link
	s.byCreator[creatorID] = token
	return link
}

// Use validates and consumes an invite link token.
// Returns the InviteLink on success, or an error if the token is invalid, used, or expired.
// On success, the link is marked as used (single-use semantics).
func (s *InviteLinkStore) Use(token string) (*InviteLink, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	link, exists := s.byToken[token]
	if !exists {
		return nil, ErrInviteNotFound
	}

	if link.Used {
		return nil, ErrInviteUsed
	}

	if time.Now().After(link.ExpiresAt) {
		return nil, ErrInviteExpired
	}

	link.Used = true
	return link, nil
}

// GetByCreator returns the creator's active (non-expired, non-used) link, or nil.
func (s *InviteLinkStore) GetByCreator(creatorID string) *InviteLink {
	s.mu.Lock()
	defer s.mu.Unlock()

	token, exists := s.byCreator[creatorID]
	if !exists {
		return nil
	}

	link := s.byToken[token]
	if link == nil {
		// Stale index entry — clean up.
		delete(s.byCreator, creatorID)
		return nil
	}

	// Return nil if expired or already used.
	if link.Used || time.Now().After(link.ExpiresAt) {
		return nil
	}

	return link
}

// CleanExpired removes all expired or used links from both maps.
func (s *InviteLinkStore) CleanExpired() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	for token, link := range s.byToken {
		if link.Used || now.After(link.ExpiresAt) {
			delete(s.byToken, token)
			// Clean creator index if it still points to this token.
			if s.byCreator[link.CreatorID] == token {
				delete(s.byCreator, link.CreatorID)
			}
		}
	}
}

// generateCryptoToken produces a 16-byte crypto-random token encoded as
// base64url without padding. This produces a 22-character URL-safe string.
func generateCryptoToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand.Read should never fail on supported platforms.
		// If it does, the system is in an unrecoverable state.
		panic("match: crypto/rand.Read failed: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
