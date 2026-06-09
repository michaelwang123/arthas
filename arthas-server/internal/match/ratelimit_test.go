package match

import (
	"testing"
	"time"

	"pgregory.net/rapid"
)

func newTestRateLimiter() *MatchRateLimiter {
	cfg := &Config{
		CooldownPeriod:  10 * time.Second,
		HourlyRateLimit: 20,
		BlockDuration:   24 * time.Hour,
	}
	return NewMatchRateLimiter(cfg)
}

func TestCheckCooldown_NoPriorRequest(t *testing.T) {
	rl := newTestRateLimiter()

	remaining, onCooldown := rl.CheckCooldown("client-1")
	if onCooldown {
		t.Errorf("expected no cooldown for new client, got remaining=%v", remaining)
	}
}

func TestCheckCooldown_WithinPeriod(t *testing.T) {
	rl := newTestRateLimiter()

	rl.RecordRequest("client-1")
	remaining, onCooldown := rl.CheckCooldown("client-1")
	if !onCooldown {
		t.Error("expected cooldown to be active immediately after recording request")
	}
	if remaining <= 0 || remaining > 10*time.Second {
		t.Errorf("expected remaining in (0, 10s], got %v", remaining)
	}
}

func TestCheckCooldown_AfterPeriod(t *testing.T) {
	cfg := &Config{
		CooldownPeriod:  1 * time.Millisecond,
		HourlyRateLimit: 20,
		BlockDuration:   24 * time.Hour,
	}
	rl := NewMatchRateLimiter(cfg)

	rl.RecordRequest("client-1")
	time.Sleep(2 * time.Millisecond)

	_, onCooldown := rl.CheckCooldown("client-1")
	if onCooldown {
		t.Error("expected cooldown to have expired")
	}
}

func TestCheckHourlyLimit_UnderLimit(t *testing.T) {
	cfg := &Config{
		CooldownPeriod:  10 * time.Second,
		HourlyRateLimit: 3,
		BlockDuration:   24 * time.Hour,
	}
	rl := NewMatchRateLimiter(cfg)

	for i := 0; i < 2; i++ {
		rl.RecordHourlyRequest("192.168.1.1")
	}

	_, limited := rl.CheckHourlyLimit("192.168.1.1")
	if limited {
		t.Error("expected not to be rate limited under the threshold")
	}
}

func TestCheckHourlyLimit_AtLimit(t *testing.T) {
	cfg := &Config{
		CooldownPeriod:  10 * time.Second,
		HourlyRateLimit: 3,
		BlockDuration:   24 * time.Hour,
	}
	rl := NewMatchRateLimiter(cfg)

	for i := 0; i < 3; i++ {
		rl.RecordHourlyRequest("192.168.1.1")
	}

	retryAfter, limited := rl.CheckHourlyLimit("192.168.1.1")
	if !limited {
		t.Error("expected to be rate limited at the threshold")
	}
	if retryAfter < 1 {
		t.Errorf("expected retryAfter >= 1, got %d", retryAfter)
	}
}

func TestIsBlocked_NotBlocked(t *testing.T) {
	rl := newTestRateLimiter()

	if rl.IsBlocked("10.0.0.1") {
		t.Error("expected unknown IP to not be blocked")
	}
}

func TestRecordReport_BelowThreshold(t *testing.T) {
	rl := newTestRateLimiter()

	rl.RecordReport("10.0.0.1")
	rl.RecordReport("10.0.0.1")

	if rl.IsBlocked("10.0.0.1") {
		t.Error("expected IP to not be blocked with only 2 reports")
	}
}

func TestRecordReport_AtThreshold(t *testing.T) {
	rl := newTestRateLimiter()

	rl.RecordReport("10.0.0.1")
	rl.RecordReport("10.0.0.1")
	rl.RecordReport("10.0.0.1")

	if !rl.IsBlocked("10.0.0.1") {
		t.Error("expected IP to be blocked after 3 reports")
	}
}

func TestRecordReport_ExceedsThreshold(t *testing.T) {
	rl := newTestRateLimiter()

	for i := 0; i < 5; i++ {
		rl.RecordReport("10.0.0.1")
	}

	if !rl.IsBlocked("10.0.0.1") {
		t.Error("expected IP to be blocked after 5 reports")
	}
}

func TestIsBlocked_ExpiredBlock(t *testing.T) {
	cfg := &Config{
		CooldownPeriod:  10 * time.Second,
		HourlyRateLimit: 20,
		BlockDuration:   1 * time.Millisecond,
	}
	rl := NewMatchRateLimiter(cfg)

	rl.RecordReport("10.0.0.1")
	rl.RecordReport("10.0.0.1")
	rl.RecordReport("10.0.0.1")

	time.Sleep(2 * time.Millisecond)

	if rl.IsBlocked("10.0.0.1") {
		t.Error("expected block to have expired")
	}
}

func TestCleanExpired_RemovesExpiredBlocks(t *testing.T) {
	cfg := &Config{
		CooldownPeriod:  1 * time.Millisecond,
		HourlyRateLimit: 20,
		BlockDuration:   1 * time.Millisecond,
	}
	rl := NewMatchRateLimiter(cfg)

	// Add a block manually
	rl.mu.Lock()
	rl.blocks["10.0.0.1"] = time.Now().Add(-1 * time.Second) // already expired
	rl.mu.Unlock()

	rl.CleanExpired()

	rl.mu.Lock()
	_, exists := rl.blocks["10.0.0.1"]
	rl.mu.Unlock()

	if exists {
		t.Error("expected expired block to be cleaned up")
	}
}

func TestCleanExpired_RemovesOldHourlyTimestamps(t *testing.T) {
	cfg := &Config{
		CooldownPeriod:  1 * time.Millisecond,
		HourlyRateLimit: 20,
		BlockDuration:   24 * time.Hour,
	}
	rl := NewMatchRateLimiter(cfg)

	// Add old timestamps
	rl.mu.Lock()
	rl.hourlyReqs["10.0.0.1"] = []time.Time{
		time.Now().Add(-2 * time.Hour), // old, should be removed
	}
	rl.mu.Unlock()

	rl.CleanExpired()

	rl.mu.Lock()
	_, exists := rl.hourlyReqs["10.0.0.1"]
	rl.mu.Unlock()

	if exists {
		t.Error("expected empty hourly entry to be removed")
	}
}

func TestCleanExpired_RemovesOldReports(t *testing.T) {
	cfg := &Config{
		CooldownPeriod:  1 * time.Millisecond,
		HourlyRateLimit: 20,
		BlockDuration:   24 * time.Hour,
	}
	rl := NewMatchRateLimiter(cfg)

	// Add old report timestamps
	rl.mu.Lock()
	rl.reports["10.0.0.1"] = []time.Time{
		time.Now().Add(-25 * time.Hour), // old, should be removed
	}
	rl.mu.Unlock()

	rl.CleanExpired()

	rl.mu.Lock()
	_, exists := rl.reports["10.0.0.1"]
	rl.mu.Unlock()

	if exists {
		t.Error("expected empty report entry to be removed")
	}
}

func TestCleanExpired_RemovesExpiredCooldowns(t *testing.T) {
	cfg := &Config{
		CooldownPeriod:  1 * time.Millisecond,
		HourlyRateLimit: 20,
		BlockDuration:   24 * time.Hour,
	}
	rl := NewMatchRateLimiter(cfg)

	rl.mu.Lock()
	rl.cooldowns["client-1"] = time.Now().Add(-1 * time.Second) // expired
	rl.mu.Unlock()

	rl.CleanExpired()

	rl.mu.Lock()
	_, exists := rl.cooldowns["client-1"]
	rl.mu.Unlock()

	if exists {
		t.Error("expected expired cooldown to be cleaned up")
	}
}

func TestCleanExpired_RetainsActiveEntries(t *testing.T) {
	rl := newTestRateLimiter()

	// Record recent activity
	rl.RecordRequest("client-1")
	rl.RecordHourlyRequest("10.0.0.1")
	rl.RecordReport("10.0.0.2")

	rl.CleanExpired()

	rl.mu.Lock()
	_, cooldownExists := rl.cooldowns["client-1"]
	_, hourlyExists := rl.hourlyReqs["10.0.0.1"]
	_, reportsExists := rl.reports["10.0.0.2"]
	rl.mu.Unlock()

	if !cooldownExists {
		t.Error("expected active cooldown to be retained")
	}
	if !hourlyExists {
		t.Error("expected active hourly entry to be retained")
	}
	if !reportsExists {
		t.Error("expected active report entry to be retained")
	}
}

// --- Property-Based Tests ---

// TestProperty_CooldownEnforcement verifies Property 7 (cooldown part):
// For ANY client sending N requests within the cooldown period, requests after
// the first SHALL be rejected (CheckCooldown returns onCooldown=true).
//
// **Validates: Requirements 7.1, 7.2**
func TestProperty_CooldownEnforcement(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Use a generous cooldown so all requests within the test are "within the period"
		cooldownMs := rapid.IntRange(100, 5000).Draw(t, "cooldownMs")
		cooldownPeriod := time.Duration(cooldownMs) * time.Millisecond

		cfg := &Config{
			CooldownPeriod:  cooldownPeriod,
			HourlyRateLimit: 1000, // high so hourly limit doesn't interfere
			BlockDuration:   24 * time.Hour,
		}
		rl := NewMatchRateLimiter(cfg)

		// Generate a random client ID
		clientID := rapid.StringMatching(`[a-z0-9]{4,16}`).Draw(t, "clientID")

		// First request: should NOT be on cooldown (no prior request)
		_, onCooldown := rl.CheckCooldown(clientID)
		if onCooldown {
			t.Fatal("first request should not be on cooldown")
		}

		// Record the first request
		rl.RecordRequest(clientID)

		// Generate a random number of subsequent requests (1-10)
		numSubsequent := rapid.IntRange(1, 10).Draw(t, "numSubsequent")

		for i := 0; i < numSubsequent; i++ {
			// All subsequent checks (immediately after) should be on cooldown
			remaining, onCooldown := rl.CheckCooldown(clientID)
			if !onCooldown {
				t.Fatalf("request %d should be on cooldown (within %v)", i+1, cooldownPeriod)
			}
			if remaining <= 0 || remaining > cooldownPeriod {
				t.Fatalf("remaining %v should be in (0, %v]", remaining, cooldownPeriod)
			}
		}
	})
}

// TestProperty_HourlyLimitEnforcement verifies Property 7 (hourly limit part):
// For ANY IP sending M requests within one hour, requests after the HourlyRateLimit
// SHALL be rejected (CheckHourlyLimit returns limited=true).
//
// **Validates: Requirements 7.3, 7.4**
func TestProperty_HourlyLimitEnforcement(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate a random hourly limit between 1 and 20
		hourlyLimit := rapid.IntRange(1, 20).Draw(t, "hourlyLimit")

		cfg := &Config{
			CooldownPeriod:  10 * time.Second,
			HourlyRateLimit: hourlyLimit,
			BlockDuration:   24 * time.Hour,
		}
		rl := NewMatchRateLimiter(cfg)

		// Generate a random IP
		ip := rapid.StringMatching(`[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}`).Draw(t, "ip")

		// Send requests up to the limit — none should be rejected
		for i := 0; i < hourlyLimit; i++ {
			_, limited := rl.CheckHourlyLimit(ip)
			if limited {
				t.Fatalf("request %d should NOT be limited (limit=%d)", i+1, hourlyLimit)
			}
			rl.RecordHourlyRequest(ip)
		}

		// Any request after the limit should be rejected
		numOverLimit := rapid.IntRange(1, 10).Draw(t, "numOverLimit")
		for i := 0; i < numOverLimit; i++ {
			retryAfter, limited := rl.CheckHourlyLimit(ip)
			if !limited {
				t.Fatalf("request %d over limit should be rejected (limit=%d)", i+1, hourlyLimit)
			}
			if retryAfter < 1 {
				t.Fatalf("retryAfter should be >= 1, got %d", retryAfter)
			}
		}
	})
}

// TestProperty_CooldownResetsAfterPeriod verifies that cooldown correctly
// allows requests once the cooldown period has elapsed. This ensures the
// rate limiter does not permanently block a client.
//
// **Validates: Requirements 7.1, 7.2**
func TestProperty_CooldownResetsAfterPeriod(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Use a very short cooldown so the test can verify expiry quickly
		cooldownMs := rapid.IntRange(1, 5).Draw(t, "cooldownMs")
		cooldownPeriod := time.Duration(cooldownMs) * time.Millisecond

		cfg := &Config{
			CooldownPeriod:  cooldownPeriod,
			HourlyRateLimit: 1000,
			BlockDuration:   24 * time.Hour,
		}
		rl := NewMatchRateLimiter(cfg)

		clientID := rapid.StringMatching(`[a-z0-9]{4,16}`).Draw(t, "clientID")

		// Record a request, then wait for cooldown to expire
		rl.RecordRequest(clientID)

		// Wait for cooldown period to elapse
		time.Sleep(cooldownPeriod + time.Millisecond)

		// After cooldown expires, the client should be allowed again
		_, onCooldown := rl.CheckCooldown(clientID)
		if onCooldown {
			t.Fatal("client should not be on cooldown after period expires")
		}
	})
}

// TestProperty_IndependentClientCooldowns verifies that cooldowns are per-connection:
// one client's cooldown does not affect another client.
//
// **Validates: Requirements 7.1, 7.2**
func TestProperty_IndependentClientCooldowns(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		cfg := &Config{
			CooldownPeriod:  10 * time.Second,
			HourlyRateLimit: 1000,
			BlockDuration:   24 * time.Hour,
		}
		rl := NewMatchRateLimiter(cfg)

		// Generate two distinct client IDs
		clientA := rapid.StringMatching(`client-[a-z]{3,8}`).Draw(t, "clientA")
		clientB := rapid.StringMatching(`user-[a-z]{3,8}`).Draw(t, "clientB")

		// Record request for client A
		rl.RecordRequest(clientA)

		// Client A should be on cooldown
		_, onCooldownA := rl.CheckCooldown(clientA)
		if !onCooldownA {
			t.Fatal("clientA should be on cooldown")
		}

		// Client B should NOT be affected
		_, onCooldownB := rl.CheckCooldown(clientB)
		if onCooldownB {
			t.Fatal("clientB should not be on cooldown (independent of clientA)")
		}
	})
}

// TestProperty_IndependentIPHourlyLimits verifies that hourly limits are per-IP:
// one IP reaching its limit does not affect a different IP.
//
// **Validates: Requirements 7.3, 7.4**
func TestProperty_IndependentIPHourlyLimits(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		hourlyLimit := rapid.IntRange(1, 10).Draw(t, "hourlyLimit")

		cfg := &Config{
			CooldownPeriod:  10 * time.Second,
			HourlyRateLimit: hourlyLimit,
			BlockDuration:   24 * time.Hour,
		}
		rl := NewMatchRateLimiter(cfg)

		ipA := rapid.StringMatching(`10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}`).Draw(t, "ipA")
		ipB := rapid.StringMatching(`192\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}`).Draw(t, "ipB")

		// Exhaust hourly limit for IP A
		for i := 0; i < hourlyLimit; i++ {
			rl.RecordHourlyRequest(ipA)
		}

		// IP A should be limited
		_, limitedA := rl.CheckHourlyLimit(ipA)
		if !limitedA {
			t.Fatal("ipA should be rate limited after exhausting hourly limit")
		}

		// IP B should NOT be affected
		_, limitedB := rl.CheckHourlyLimit(ipB)
		if limitedB {
			t.Fatal("ipB should not be rate limited (independent of ipA)")
		}
	})
}
