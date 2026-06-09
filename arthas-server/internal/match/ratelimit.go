package match

import (
	"sync"
	"time"
)

// MatchRateLimiter provides per-connection cooldown tracking, per-IP hourly
// sliding window rate limiting, and an IP block list with expiry.
// All methods are safe for concurrent use.
type MatchRateLimiter struct {
	mu         sync.Mutex
	cooldowns  map[string]time.Time   // clientID → last match request time
	hourlyReqs map[string][]time.Time // IP → sliding window timestamps
	blocks     map[string]time.Time   // IP → block expiry time
	reports    map[string][]time.Time // IP → report timestamps (24h window)

	cooldownPeriod  time.Duration
	hourlyLimit     int
	blockDuration   time.Duration
	reportThreshold int // reports to trigger block (default: 3)
}

// NewMatchRateLimiter creates a rate limiter using config values.
func NewMatchRateLimiter(config *Config) *MatchRateLimiter {
	return &MatchRateLimiter{
		cooldowns:       make(map[string]time.Time),
		hourlyReqs:      make(map[string][]time.Time),
		blocks:          make(map[string]time.Time),
		reports:         make(map[string][]time.Time),
		cooldownPeriod:  config.CooldownPeriod,
		hourlyLimit:     config.HourlyRateLimit,
		blockDuration:   config.BlockDuration,
		reportThreshold: 3,
	}
}

// CheckCooldown checks whether a client is still within their cooldown period.
// Returns (remaining cooldown duration, true) if on cooldown, or (0, false) if allowed.
func (rl *MatchRateLimiter) CheckCooldown(clientID string) (time.Duration, bool) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	lastReq, exists := rl.cooldowns[clientID]
	if !exists {
		return 0, false
	}

	elapsed := time.Since(lastReq)
	if elapsed >= rl.cooldownPeriod {
		return 0, false
	}

	return rl.cooldownPeriod - elapsed, true
}

// RecordRequest records the current time as the last match request for cooldown tracking.
func (rl *MatchRateLimiter) RecordRequest(clientID string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	rl.cooldowns[clientID] = time.Now()
}

// CheckHourlyLimit checks whether an IP has exceeded the hourly rate limit.
// Returns (seconds until the oldest request in the window expires, true) if limited,
// or (0, false) if allowed.
func (rl *MatchRateLimiter) CheckHourlyLimit(ip string) (int, bool) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	oneHourAgo := now.Add(-1 * time.Hour)

	// Prune expired entries from this IP's window
	timestamps := rl.hourlyReqs[ip]
	pruned := pruneOlderThan(timestamps, oneHourAgo)
	rl.hourlyReqs[ip] = pruned

	if len(pruned) >= rl.hourlyLimit {
		// Calculate retry-after: time until the oldest entry in the window expires
		oldest := pruned[0]
		retryAfter := oldest.Add(time.Hour).Sub(now)
		retrySeconds := int(retryAfter.Seconds()) + 1 // round up
		if retrySeconds < 1 {
			retrySeconds = 1
		}
		return retrySeconds, true
	}

	return 0, false
}

// RecordHourlyRequest records a match request timestamp in the hourly sliding window.
func (rl *MatchRateLimiter) RecordHourlyRequest(ip string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	rl.hourlyReqs[ip] = append(rl.hourlyReqs[ip], time.Now())
}

// IsBlocked checks if an IP is in the block list and the block hasn't expired.
func (rl *MatchRateLimiter) IsBlocked(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	expiry, exists := rl.blocks[ip]
	if !exists {
		return false
	}

	if time.Now().After(expiry) {
		// Block expired, remove it
		delete(rl.blocks, ip)
		return false
	}

	return true
}

// RecordReport increments the report count for an IP within a 24-hour sliding window.
// If the IP accumulates reportThreshold (3) or more reports within 24 hours,
// it is added to the block list for blockDuration.
func (rl *MatchRateLimiter) RecordReport(ip string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	twentyFourHoursAgo := now.Add(-24 * time.Hour)

	// Prune old reports outside the 24h window
	reports := pruneOlderThan(rl.reports[ip], twentyFourHoursAgo)
	reports = append(reports, now)
	rl.reports[ip] = reports

	// Check if threshold reached → block IP
	if len(reports) >= rl.reportThreshold {
		rl.blocks[ip] = now.Add(rl.blockDuration)
	}
}

// CleanExpired removes expired blocks, old hourly timestamps (>1h),
// old report timestamps (>24h), and empty entries from all maps.
func (rl *MatchRateLimiter) CleanExpired() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	oneHourAgo := now.Add(-1 * time.Hour)
	twentyFourHoursAgo := now.Add(-24 * time.Hour)

	// Clean expired blocks
	for ip, expiry := range rl.blocks {
		if now.After(expiry) {
			delete(rl.blocks, ip)
		}
	}

	// Clean hourly request timestamps
	for ip, timestamps := range rl.hourlyReqs {
		pruned := pruneOlderThan(timestamps, oneHourAgo)
		if len(pruned) == 0 {
			delete(rl.hourlyReqs, ip)
		} else {
			rl.hourlyReqs[ip] = pruned
		}
	}

	// Clean report timestamps
	for ip, timestamps := range rl.reports {
		pruned := pruneOlderThan(timestamps, twentyFourHoursAgo)
		if len(pruned) == 0 {
			delete(rl.reports, ip)
		} else {
			rl.reports[ip] = pruned
		}
	}

	// Clean expired cooldowns
	for clientID, lastReq := range rl.cooldowns {
		if now.Sub(lastReq) >= rl.cooldownPeriod {
			delete(rl.cooldowns, clientID)
		}
	}
}

// pruneOlderThan returns only timestamps that are at or after the cutoff.
func pruneOlderThan(timestamps []time.Time, cutoff time.Time) []time.Time {
	result := timestamps[:0] // reuse underlying array
	for _, t := range timestamps {
		if !t.Before(cutoff) {
			result = append(result, t)
		}
	}
	return result
}
