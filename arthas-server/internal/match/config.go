package match

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all configurable parameters for the random match feature.
// Use DefaultConfig() for production defaults, and Validate() before use.
type Config struct {
	Enabled            bool          // Feature toggle (disabled via DISABLE_RANDOM_MATCH=true)
	MatchTimeout       time.Duration // Queue wait timeout before giving up (default: 60s)
	KeyExchangeTimeout time.Duration // Time allowed for Client A to relay AES key (default: 5s)
	RoomExpiry         time.Duration // Match room lifetime (default: 30min)
	EphemeralSeconds   int           // Burn-after-read timer in seconds (default: 60)
	MaxQueueSize       int           // Maximum entries in match queue (default: 100)
	CooldownPeriod     time.Duration // Minimum interval between match requests (default: 10s)
	HourlyRateLimit    int           // Max match requests per IP per hour (default: 20)
	BlockDuration      time.Duration // IP block duration after excessive reports (default: 24h)
	MaxExtensions      int           // Max room extensions per match (default: 3)
	TagFallbackDelay   time.Duration // Wait before ignoring tag preferences (default: 10s)
	InviteLinkTTL      time.Duration // Invite link expiry (default: 5min)
	CleanupInterval    time.Duration // Memory cleanup ticker interval (default: 30s)
}

// DefaultConfig returns a Config with sensible production defaults.
func DefaultConfig() *Config {
	return &Config{
		Enabled:            true,
		MatchTimeout:       60 * time.Second,
		KeyExchangeTimeout: 5 * time.Second,
		RoomExpiry:         30 * time.Minute,
		EphemeralSeconds:   60,
		MaxQueueSize:       100,
		CooldownPeriod:     10 * time.Second,
		HourlyRateLimit:    20,
		BlockDuration:      24 * time.Hour,
		MaxExtensions:      3,
		TagFallbackDelay:   10 * time.Second,
		InviteLinkTTL:      5 * time.Minute,
		CleanupInterval:    30 * time.Second,
	}
}

// Validate checks all configuration parameters for correctness.
// Returns a descriptive error on the first invalid parameter found (fail-fast).
func (c *Config) Validate() error {
	if c.MatchTimeout <= 0 {
		return fmt.Errorf("match: MatchTimeout must be positive, got %v", c.MatchTimeout)
	}
	if c.KeyExchangeTimeout <= 0 {
		return fmt.Errorf("match: KeyExchangeTimeout must be positive, got %v", c.KeyExchangeTimeout)
	}
	if c.RoomExpiry <= 0 {
		return fmt.Errorf("match: RoomExpiry must be positive, got %v", c.RoomExpiry)
	}
	if c.EphemeralSeconds < 0 {
		return fmt.Errorf("match: EphemeralSeconds must be non-negative, got %d", c.EphemeralSeconds)
	}
	if c.MaxQueueSize <= 0 {
		return fmt.Errorf("match: MaxQueueSize must be positive, got %d", c.MaxQueueSize)
	}
	if c.CooldownPeriod < 0 {
		return fmt.Errorf("match: CooldownPeriod must be non-negative, got %v", c.CooldownPeriod)
	}
	if c.HourlyRateLimit <= 0 {
		return fmt.Errorf("match: HourlyRateLimit must be positive, got %d", c.HourlyRateLimit)
	}
	if c.BlockDuration <= 0 {
		return fmt.Errorf("match: BlockDuration must be positive, got %v", c.BlockDuration)
	}
	if c.MaxExtensions < 0 {
		return fmt.Errorf("match: MaxExtensions must be non-negative, got %d", c.MaxExtensions)
	}
	if c.TagFallbackDelay < 0 {
		return fmt.Errorf("match: TagFallbackDelay must be non-negative, got %v", c.TagFallbackDelay)
	}
	if c.InviteLinkTTL <= 0 {
		return fmt.Errorf("match: InviteLinkTTL must be positive, got %v", c.InviteLinkTTL)
	}
	if c.CleanupInterval <= 0 {
		return fmt.Errorf("match: CleanupInterval must be positive, got %v", c.CleanupInterval)
	}
	return nil
}

// ParseEnv reads environment variables into a Config, starting from DefaultConfig.
// Only set variables override defaults. Returns an error if a variable is set but
// contains an unparseable value.
//
// Environment variables:
//   - DISABLE_RANDOM_MATCH: "true" or "1" disables the feature (default: enabled)
//   - MATCH_TIMEOUT: duration string (e.g. "60s", "1m")
//   - KEY_EXCHANGE_TIMEOUT: duration string (e.g. "5s")
//   - MATCH_ROOM_EXPIRY: duration string (e.g. "30m")
//   - MATCH_EPHEMERAL_SECONDS: integer seconds (e.g. "60")
//   - MATCH_MAX_QUEUE_SIZE: integer (e.g. "100")
//   - MATCH_COOLDOWN_PERIOD: duration string (e.g. "10s")
//   - MATCH_HOURLY_RATE_LIMIT: integer (e.g. "20")
//   - MATCH_BLOCK_DURATION: duration string (e.g. "24h")
//   - MATCH_MAX_EXTENSIONS: integer (e.g. "3")
//   - MATCH_TAG_FALLBACK_DELAY: duration string (e.g. "10s")
//   - MATCH_INVITE_LINK_TTL: duration string (e.g. "5m")
//   - MATCH_CLEANUP_INTERVAL: duration string (e.g. "30s")
func ParseEnv() (*Config, error) {
	cfg := DefaultConfig()

	if v := os.Getenv("DISABLE_RANDOM_MATCH"); v != "" {
		cfg.Enabled = !isTruthy(v)
	}

	if v := os.Getenv("MATCH_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_TIMEOUT %q: %w", v, err)
		}
		cfg.MatchTimeout = d
	}

	if v := os.Getenv("KEY_EXCHANGE_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid KEY_EXCHANGE_TIMEOUT %q: %w", v, err)
		}
		cfg.KeyExchangeTimeout = d
	}

	if v := os.Getenv("MATCH_ROOM_EXPIRY"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_ROOM_EXPIRY %q: %w", v, err)
		}
		cfg.RoomExpiry = d
	}

	if v := os.Getenv("MATCH_EPHEMERAL_SECONDS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_EPHEMERAL_SECONDS %q: %w", v, err)
		}
		cfg.EphemeralSeconds = n
	}

	if v := os.Getenv("MATCH_MAX_QUEUE_SIZE"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_MAX_QUEUE_SIZE %q: %w", v, err)
		}
		cfg.MaxQueueSize = n
	}

	if v := os.Getenv("MATCH_COOLDOWN_PERIOD"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_COOLDOWN_PERIOD %q: %w", v, err)
		}
		cfg.CooldownPeriod = d
	}

	if v := os.Getenv("MATCH_HOURLY_RATE_LIMIT"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_HOURLY_RATE_LIMIT %q: %w", v, err)
		}
		cfg.HourlyRateLimit = n
	}

	if v := os.Getenv("MATCH_BLOCK_DURATION"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_BLOCK_DURATION %q: %w", v, err)
		}
		cfg.BlockDuration = d
	}

	if v := os.Getenv("MATCH_MAX_EXTENSIONS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_MAX_EXTENSIONS %q: %w", v, err)
		}
		cfg.MaxExtensions = n
	}

	if v := os.Getenv("MATCH_TAG_FALLBACK_DELAY"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_TAG_FALLBACK_DELAY %q: %w", v, err)
		}
		cfg.TagFallbackDelay = d
	}

	if v := os.Getenv("MATCH_INVITE_LINK_TTL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_INVITE_LINK_TTL %q: %w", v, err)
		}
		cfg.InviteLinkTTL = d
	}

	if v := os.Getenv("MATCH_CLEANUP_INTERVAL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("match: invalid MATCH_CLEANUP_INTERVAL %q: %w", v, err)
		}
		cfg.CleanupInterval = d
	}

	return cfg, nil
}

// isTruthy returns true for common "enabled" values: "true", "1", "yes".
func isTruthy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "1", "yes":
		return true
	default:
		return false
	}
}
