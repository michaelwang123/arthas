package hub

import (
	"sync"
	"time"
)

const maxTrackedIPs = 10000

// RateLimiter tracks request counts per IP with fixed-window algorithm.
type RateLimiter struct {
	mu       sync.Mutex
	requests map[string]*ipRecord
	limit    int
	window   time.Duration
}

type ipRecord struct {
	count       int
	windowStart time.Time
}

// NewRateLimiter creates a rate limiter that allows `limit` requests per `window` per IP.
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		requests: make(map[string]*ipRecord),
		limit:    limit,
		window:   window,
	}
}

// Allow checks if the given IP is within rate limits.
// Returns true if the request is allowed, false if rate limited.
// Lazily cleans stale entries and evicts oldest when IP cap is exceeded.
func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()

	record, exists := rl.requests[ip]
	if !exists {
		// Check IP cap before adding new entry
		if len(rl.requests) >= maxTrackedIPs {
			rl.evictOldest()
		}
		rl.requests[ip] = &ipRecord{count: 1, windowStart: now}
		return true
	}

	// Check if current window has expired
	if now.Sub(record.windowStart) > rl.window {
		// Reset window
		record.count = 1
		record.windowStart = now
		return true
	}

	// Within window — check count
	if record.count >= rl.limit {
		return false
	}

	record.count++
	return true
}

// SecondsUntilReset returns the number of seconds until the rate limit window
// resets for a given IP. Used for the Retry-After header.
func (rl *RateLimiter) SecondsUntilReset(ip string) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	record, exists := rl.requests[ip]
	if !exists {
		return 0
	}

	elapsed := time.Since(record.windowStart)
	remaining := rl.window - elapsed
	if remaining <= 0 {
		return 0
	}
	return int(remaining.Seconds()) + 1
}

// evictOldest removes the IP record with the oldest windowStart time.
func (rl *RateLimiter) evictOldest() {
	var oldestIP string
	var oldestTime time.Time
	first := true

	for ip, record := range rl.requests {
		if first || record.windowStart.Before(oldestTime) {
			oldestIP = ip
			oldestTime = record.windowStart
			first = false
		}
	}

	if oldestIP != "" {
		delete(rl.requests, oldestIP)
	}
}
