package match

import (
	"testing"
	"time"

	"pgregory.net/rapid"
)

func TestNewInviteLinkStore(t *testing.T) {
	ttl := 5 * time.Minute
	store := NewInviteLinkStore(ttl)
	if store == nil {
		t.Fatal("expected non-nil store")
	}
	if store.ttl != ttl {
		t.Errorf("expected ttl=%v, got %v", ttl, store.ttl)
	}
}

func TestCreate_GeneratesValidToken(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)
	link := store.Create("creator-1")

	if link == nil {
		t.Fatal("expected non-nil link")
	}
	if link.Token == "" {
		t.Error("expected non-empty token")
	}
	if link.CreatorID != "creator-1" {
		t.Errorf("expected creatorID=creator-1, got %s", link.CreatorID)
	}
	if link.Used {
		t.Error("expected Used=false for new link")
	}
	// Token should be 22 chars (16 bytes base64url without padding)
	if len(link.Token) != 22 {
		t.Errorf("expected token length 22, got %d", len(link.Token))
	}
	// ExpiresAt should be ~5min after CreatedAt
	diff := link.ExpiresAt.Sub(link.CreatedAt)
	if diff != 5*time.Minute {
		t.Errorf("expected TTL 5m, got %v", diff)
	}
}

func TestCreate_ReplacesExistingLink(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)

	link1 := store.Create("creator-1")
	link2 := store.Create("creator-1")

	if link1.Token == link2.Token {
		t.Error("expected different tokens for successive creates")
	}

	// Old token should be gone
	_, err := store.Use(link1.Token)
	if err != ErrInviteNotFound {
		t.Errorf("expected ErrInviteNotFound for old token, got %v", err)
	}

	// New token should work
	result, err := store.Use(link2.Token)
	if err != nil {
		t.Errorf("expected no error for new token, got %v", err)
	}
	if result.Token != link2.Token {
		t.Error("expected to get the new link back")
	}
}

func TestCreate_UniquenessAcrossCreators(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)

	tokens := make(map[string]bool)
	for i := 0; i < 100; i++ {
		link := store.Create("creator-" + string(rune('A'+i)))
		if tokens[link.Token] {
			t.Fatalf("duplicate token generated: %s", link.Token)
		}
		tokens[link.Token] = true
	}
}

func TestUse_Success(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)
	link := store.Create("creator-1")

	result, err := store.Use(link.Token)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !result.Used {
		t.Error("expected Used=true after Use()")
	}
	if result.CreatorID != "creator-1" {
		t.Errorf("expected creatorID=creator-1, got %s", result.CreatorID)
	}
}

func TestUse_SingleUse(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)
	link := store.Create("creator-1")

	// First use succeeds
	_, err := store.Use(link.Token)
	if err != nil {
		t.Fatalf("first use should succeed, got %v", err)
	}

	// Second use fails
	_, err = store.Use(link.Token)
	if err != ErrInviteUsed {
		t.Errorf("expected ErrInviteUsed on second use, got %v", err)
	}
}

func TestUse_NotFound(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)

	_, err := store.Use("nonexistent-token")
	if err != ErrInviteNotFound {
		t.Errorf("expected ErrInviteNotFound, got %v", err)
	}
}

func TestUse_Expired(t *testing.T) {
	// Use a very short TTL to test expiry
	store := NewInviteLinkStore(1 * time.Millisecond)
	link := store.Create("creator-1")

	// Wait for expiry
	time.Sleep(5 * time.Millisecond)

	_, err := store.Use(link.Token)
	if err != ErrInviteExpired {
		t.Errorf("expected ErrInviteExpired, got %v", err)
	}
}

func TestGetByCreator_ActiveLink(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)
	link := store.Create("creator-1")

	result := store.GetByCreator("creator-1")
	if result == nil {
		t.Fatal("expected non-nil result")
	}
	if result.Token != link.Token {
		t.Errorf("expected token=%s, got %s", link.Token, result.Token)
	}
}

func TestGetByCreator_NoLink(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)

	result := store.GetByCreator("unknown")
	if result != nil {
		t.Error("expected nil for unknown creator")
	}
}

func TestGetByCreator_ExpiredLink(t *testing.T) {
	store := NewInviteLinkStore(1 * time.Millisecond)
	store.Create("creator-1")

	time.Sleep(5 * time.Millisecond)

	result := store.GetByCreator("creator-1")
	if result != nil {
		t.Error("expected nil for expired link")
	}
}

func TestGetByCreator_UsedLink(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)
	link := store.Create("creator-1")

	_, _ = store.Use(link.Token)

	result := store.GetByCreator("creator-1")
	if result != nil {
		t.Error("expected nil for used link")
	}
}

func TestCleanExpired_RemovesExpiredLinks(t *testing.T) {
	store := NewInviteLinkStore(1 * time.Millisecond)
	store.Create("creator-1")
	store.Create("creator-2")

	time.Sleep(5 * time.Millisecond)

	// Create a fresh link that should survive cleanup
	store.Create("creator-3")

	store.CleanExpired()

	// Expired links should be gone
	store.mu.Lock()
	tokenCount := len(store.byToken)
	creatorCount := len(store.byCreator)
	store.mu.Unlock()

	if tokenCount != 1 {
		t.Errorf("expected 1 token remaining, got %d", tokenCount)
	}
	if creatorCount != 1 {
		t.Errorf("expected 1 creator remaining, got %d", creatorCount)
	}
}

func TestCleanExpired_RemovesUsedLinks(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)
	link := store.Create("creator-1")
	store.Create("creator-2")

	// Use one link
	_, _ = store.Use(link.Token)

	store.CleanExpired()

	// Used link should be gone, unused link remains
	store.mu.Lock()
	tokenCount := len(store.byToken)
	creatorCount := len(store.byCreator)
	store.mu.Unlock()

	if tokenCount != 1 {
		t.Errorf("expected 1 token remaining, got %d", tokenCount)
	}
	if creatorCount != 1 {
		t.Errorf("expected 1 creator remaining, got %d", creatorCount)
	}
}

func TestCleanExpired_EmptyStore(t *testing.T) {
	store := NewInviteLinkStore(5 * time.Minute)

	// Should not panic on empty store
	store.CleanExpired()
}

// --- Property-Based Tests ---

// TestProperty_InviteLinkSingleUse verifies Property 8 (single-use aspect):
// For ANY created invite link, after Use() succeeds once, all subsequent
// Use() calls fail with ErrInviteUsed.
//
// **Validates: Requirements 11.4, 11.5**
func TestProperty_InviteLinkSingleUse(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate a random creator ID
		creatorID := rapid.StringMatching(`[a-zA-Z0-9]{4,20}`).Draw(t, "creatorID")

		// Use a long TTL so expiry doesn't interfere with single-use testing
		store := NewInviteLinkStore(10 * time.Minute)

		// Create an invite link
		link := store.Create(creatorID)
		token := link.Token

		// First Use() must succeed
		result, err := store.Use(token)
		if err != nil {
			t.Fatalf("first Use() should succeed, got error: %v", err)
		}
		if !result.Used {
			t.Fatal("result.Used should be true after successful Use()")
		}
		if result.CreatorID != creatorID {
			t.Fatalf("expected creatorID=%s, got %s", creatorID, result.CreatorID)
		}

		// Generate a random number of subsequent Use() attempts (1-10)
		attempts := rapid.IntRange(1, 10).Draw(t, "subsequentAttempts")
		for i := 0; i < attempts; i++ {
			_, err := store.Use(token)
			if err != ErrInviteUsed {
				t.Fatalf("Use() attempt %d after first use: expected ErrInviteUsed, got %v", i+1, err)
			}
		}
	})
}

// TestProperty_InviteLinkExpiry verifies Property 8 (expiry aspect):
// For ANY created invite link with a past ExpiresAt, Use() fails with ErrInviteExpired.
//
// **Validates: Requirements 11.4, 11.5**
func TestProperty_InviteLinkExpiry(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate a random creator ID
		creatorID := rapid.StringMatching(`[a-zA-Z0-9]{4,20}`).Draw(t, "creatorID")

		// Use a very short TTL (1ms) to ensure quick expiry
		store := NewInviteLinkStore(1 * time.Millisecond)

		// Create an invite link
		link := store.Create(creatorID)
		token := link.Token

		// Wait for the link to expire
		time.Sleep(5 * time.Millisecond)

		// After expiry, Use() must fail with ErrInviteExpired
		_, err := store.Use(token)
		if err != ErrInviteExpired {
			t.Fatalf("Use() after expiry: expected ErrInviteExpired, got %v", err)
		}

		// Multiple attempts after expiry should all fail with ErrInviteExpired
		attempts := rapid.IntRange(1, 5).Draw(t, "subsequentAttempts")
		for i := 0; i < attempts; i++ {
			_, err := store.Use(token)
			if err != ErrInviteExpired {
				t.Fatalf("Use() attempt %d after expiry: expected ErrInviteExpired, got %v", i+1, err)
			}
		}
	})
}
