package hub

import (
	"fmt"
	"testing"
	"time"
)

func TestRateLimiter_WithinWindow(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)

	for i := 0; i < 5; i++ {
		if !rl.Allow("192.168.1.1") {
			t.Fatalf("request %d should be allowed (within limit)", i+1)
		}
	}
}

func TestRateLimiter_Exceeded(t *testing.T) {
	rl := NewRateLimiter(3, time.Minute)

	for i := 0; i < 3; i++ {
		if !rl.Allow("10.0.0.1") {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}

	// 4th request should be denied
	if rl.Allow("10.0.0.1") {
		t.Fatal("request exceeding limit should be denied")
	}
	// 5th request should also be denied
	if rl.Allow("10.0.0.1") {
		t.Fatal("subsequent requests after limit should still be denied")
	}
}

func TestRateLimiter_WindowReset(t *testing.T) {
	rl := NewRateLimiter(2, 50*time.Millisecond)

	// Exhaust limit
	rl.Allow("10.0.0.1")
	rl.Allow("10.0.0.1")

	if rl.Allow("10.0.0.1") {
		t.Fatal("should be rate limited before window expires")
	}

	// Wait for window to expire
	time.Sleep(60 * time.Millisecond)

	if !rl.Allow("10.0.0.1") {
		t.Fatal("should be allowed after window reset")
	}
}

func TestRateLimiter_DifferentIPs(t *testing.T) {
	rl := NewRateLimiter(2, time.Minute)

	// Exhaust limit for IP A
	rl.Allow("10.0.0.1")
	rl.Allow("10.0.0.1")

	if rl.Allow("10.0.0.1") {
		t.Fatal("IP A should be rate limited")
	}

	// IP B should be unaffected
	if !rl.Allow("10.0.0.2") {
		t.Fatal("IP B should be allowed (independent limit)")
	}
	if !rl.Allow("10.0.0.2") {
		t.Fatal("IP B second request should be allowed")
	}
}

func TestRateLimiter_IPCapEviction(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)

	// Fill up to the cap with unique IPs
	for i := 0; i < maxTrackedIPs; i++ {
		ip := fmt.Sprintf("10.%d.%d.%d", (i>>16)&0xFF, (i>>8)&0xFF, i&0xFF)
		if !rl.Allow(ip) {
			t.Fatalf("request for IP %s should be allowed", ip)
		}
	}

	// Adding one more IP should trigger eviction (not panic or reject)
	if !rl.Allow("192.168.255.1") {
		t.Fatal("new IP after eviction should be allowed")
	}

	// Verify the map didn't grow beyond cap
	rl.mu.Lock()
	count := len(rl.requests)
	rl.mu.Unlock()

	if count > maxTrackedIPs {
		t.Fatalf("tracked IPs (%d) should not exceed cap (%d)", count, maxTrackedIPs)
	}
}

func TestRateLimiter_SecondsUntilReset(t *testing.T) {
	rl := NewRateLimiter(1, 2*time.Second)

	// Exhaust limit
	rl.Allow("10.0.0.1")

	if rl.Allow("10.0.0.1") {
		t.Fatal("should be rate limited")
	}

	seconds := rl.SecondsUntilReset("10.0.0.1")
	if seconds < 1 || seconds > 3 {
		t.Fatalf("SecondsUntilReset should be between 1 and 3, got %d", seconds)
	}
}

func TestRateLimiter_SecondsUntilReset_UnknownIP(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)

	seconds := rl.SecondsUntilReset("unknown-ip")
	if seconds != 0 {
		t.Fatalf("SecondsUntilReset for unknown IP should be 0, got %d", seconds)
	}
}
