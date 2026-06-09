package match

import (
	"os"
	"testing"
	"time"

	"pgregory.net/rapid"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if !cfg.Enabled {
		t.Error("Enabled should default to true")
	}
	if cfg.MatchTimeout != 60*time.Second {
		t.Errorf("MatchTimeout = %v, want 60s", cfg.MatchTimeout)
	}
	if cfg.KeyExchangeTimeout != 5*time.Second {
		t.Errorf("KeyExchangeTimeout = %v, want 5s", cfg.KeyExchangeTimeout)
	}
	if cfg.RoomExpiry != 30*time.Minute {
		t.Errorf("RoomExpiry = %v, want 30m", cfg.RoomExpiry)
	}
	if cfg.EphemeralSeconds != 60 {
		t.Errorf("EphemeralSeconds = %d, want 60", cfg.EphemeralSeconds)
	}
	if cfg.MaxQueueSize != 100 {
		t.Errorf("MaxQueueSize = %d, want 100", cfg.MaxQueueSize)
	}
	if cfg.CooldownPeriod != 10*time.Second {
		t.Errorf("CooldownPeriod = %v, want 10s", cfg.CooldownPeriod)
	}
	if cfg.HourlyRateLimit != 20 {
		t.Errorf("HourlyRateLimit = %d, want 20", cfg.HourlyRateLimit)
	}
	if cfg.BlockDuration != 24*time.Hour {
		t.Errorf("BlockDuration = %v, want 24h", cfg.BlockDuration)
	}
	if cfg.MaxExtensions != 3 {
		t.Errorf("MaxExtensions = %d, want 3", cfg.MaxExtensions)
	}
	if cfg.TagFallbackDelay != 10*time.Second {
		t.Errorf("TagFallbackDelay = %v, want 10s", cfg.TagFallbackDelay)
	}
	if cfg.InviteLinkTTL != 5*time.Minute {
		t.Errorf("InviteLinkTTL = %v, want 5m", cfg.InviteLinkTTL)
	}
	if cfg.CleanupInterval != 30*time.Second {
		t.Errorf("CleanupInterval = %v, want 30s", cfg.CleanupInterval)
	}
}

func TestDefaultConfigValidates(t *testing.T) {
	cfg := DefaultConfig()
	if err := cfg.Validate(); err != nil {
		t.Errorf("DefaultConfig().Validate() returned error: %v", err)
	}
}

func TestValidate_RejectsInvalidConfigs(t *testing.T) {
	tests := []struct {
		name   string
		modify func(*Config)
		errMsg string
	}{
		{
			name:   "negative MatchTimeout",
			modify: func(c *Config) { c.MatchTimeout = -1 * time.Second },
			errMsg: "MatchTimeout must be positive",
		},
		{
			name:   "zero MatchTimeout",
			modify: func(c *Config) { c.MatchTimeout = 0 },
			errMsg: "MatchTimeout must be positive",
		},
		{
			name:   "negative KeyExchangeTimeout",
			modify: func(c *Config) { c.KeyExchangeTimeout = -1 * time.Second },
			errMsg: "KeyExchangeTimeout must be positive",
		},
		{
			name:   "negative RoomExpiry",
			modify: func(c *Config) { c.RoomExpiry = -1 * time.Minute },
			errMsg: "RoomExpiry must be positive",
		},
		{
			name:   "negative EphemeralSeconds",
			modify: func(c *Config) { c.EphemeralSeconds = -1 },
			errMsg: "EphemeralSeconds must be non-negative",
		},
		{
			name:   "zero MaxQueueSize",
			modify: func(c *Config) { c.MaxQueueSize = 0 },
			errMsg: "MaxQueueSize must be positive",
		},
		{
			name:   "negative MaxQueueSize",
			modify: func(c *Config) { c.MaxQueueSize = -5 },
			errMsg: "MaxQueueSize must be positive",
		},
		{
			name:   "negative CooldownPeriod",
			modify: func(c *Config) { c.CooldownPeriod = -1 * time.Second },
			errMsg: "CooldownPeriod must be non-negative",
		},
		{
			name:   "zero HourlyRateLimit",
			modify: func(c *Config) { c.HourlyRateLimit = 0 },
			errMsg: "HourlyRateLimit must be positive",
		},
		{
			name:   "negative BlockDuration",
			modify: func(c *Config) { c.BlockDuration = -1 * time.Hour },
			errMsg: "BlockDuration must be positive",
		},
		{
			name:   "negative MaxExtensions",
			modify: func(c *Config) { c.MaxExtensions = -1 },
			errMsg: "MaxExtensions must be non-negative",
		},
		{
			name:   "negative TagFallbackDelay",
			modify: func(c *Config) { c.TagFallbackDelay = -1 * time.Second },
			errMsg: "TagFallbackDelay must be non-negative",
		},
		{
			name:   "zero InviteLinkTTL",
			modify: func(c *Config) { c.InviteLinkTTL = 0 },
			errMsg: "InviteLinkTTL must be positive",
		},
		{
			name:   "zero CleanupInterval",
			modify: func(c *Config) { c.CleanupInterval = 0 },
			errMsg: "CleanupInterval must be positive",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			tt.modify(cfg)
			err := cfg.Validate()
			if err == nil {
				t.Fatal("expected Validate() to return an error")
			}
			if !contains(err.Error(), tt.errMsg) {
				t.Errorf("error %q does not contain %q", err.Error(), tt.errMsg)
			}
		})
	}
}

func TestValidate_AcceptsEdgeCases(t *testing.T) {
	tests := []struct {
		name   string
		modify func(*Config)
	}{
		{
			name:   "zero EphemeralSeconds (no burn-after-read)",
			modify: func(c *Config) { c.EphemeralSeconds = 0 },
		},
		{
			name:   "zero CooldownPeriod (no cooldown)",
			modify: func(c *Config) { c.CooldownPeriod = 0 },
		},
		{
			name:   "zero MaxExtensions (no extensions allowed)",
			modify: func(c *Config) { c.MaxExtensions = 0 },
		},
		{
			name:   "zero TagFallbackDelay (immediate FIFO fallback)",
			modify: func(c *Config) { c.TagFallbackDelay = 0 },
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			tt.modify(cfg)
			if err := cfg.Validate(); err != nil {
				t.Errorf("expected Validate() to pass, got: %v", err)
			}
		})
	}
}

func TestParseEnv_Defaults(t *testing.T) {
	// Clear all match-related env vars
	clearMatchEnvVars(t)

	cfg, err := ParseEnv()
	if err != nil {
		t.Fatalf("ParseEnv() returned error: %v", err)
	}
	if !cfg.Enabled {
		t.Error("Enabled should default to true when DISABLE_RANDOM_MATCH is unset")
	}
	if cfg.MatchTimeout != 60*time.Second {
		t.Errorf("MatchTimeout = %v, want 60s", cfg.MatchTimeout)
	}
}

func TestParseEnv_DisableRandomMatch(t *testing.T) {
	clearMatchEnvVars(t)

	tests := []struct {
		value    string
		expected bool // cfg.Enabled
	}{
		{"true", false},
		{"TRUE", false},
		{"True", false},
		{"1", false},
		{"yes", false},
		{"false", true},
		{"0", true},
		{"no", true},
		{"", true}, // not set (handled by clearMatchEnvVars)
	}

	for _, tt := range tests {
		t.Run("DISABLE_RANDOM_MATCH="+tt.value, func(t *testing.T) {
			clearMatchEnvVars(t)
			if tt.value != "" {
				t.Setenv("DISABLE_RANDOM_MATCH", tt.value)
			}
			cfg, err := ParseEnv()
			if err != nil {
				t.Fatalf("ParseEnv() error: %v", err)
			}
			if cfg.Enabled != tt.expected {
				t.Errorf("Enabled = %v, want %v", cfg.Enabled, tt.expected)
			}
		})
	}
}

func TestParseEnv_DurationOverrides(t *testing.T) {
	clearMatchEnvVars(t)
	t.Setenv("MATCH_TIMEOUT", "120s")
	t.Setenv("KEY_EXCHANGE_TIMEOUT", "10s")
	t.Setenv("MATCH_ROOM_EXPIRY", "1h")
	t.Setenv("MATCH_COOLDOWN_PERIOD", "30s")
	t.Setenv("MATCH_BLOCK_DURATION", "48h")
	t.Setenv("MATCH_TAG_FALLBACK_DELAY", "15s")
	t.Setenv("MATCH_INVITE_LINK_TTL", "10m")
	t.Setenv("MATCH_CLEANUP_INTERVAL", "1m")

	cfg, err := ParseEnv()
	if err != nil {
		t.Fatalf("ParseEnv() error: %v", err)
	}

	if cfg.MatchTimeout != 120*time.Second {
		t.Errorf("MatchTimeout = %v, want 120s", cfg.MatchTimeout)
	}
	if cfg.KeyExchangeTimeout != 10*time.Second {
		t.Errorf("KeyExchangeTimeout = %v, want 10s", cfg.KeyExchangeTimeout)
	}
	if cfg.RoomExpiry != 1*time.Hour {
		t.Errorf("RoomExpiry = %v, want 1h", cfg.RoomExpiry)
	}
	if cfg.CooldownPeriod != 30*time.Second {
		t.Errorf("CooldownPeriod = %v, want 30s", cfg.CooldownPeriod)
	}
	if cfg.BlockDuration != 48*time.Hour {
		t.Errorf("BlockDuration = %v, want 48h", cfg.BlockDuration)
	}
	if cfg.TagFallbackDelay != 15*time.Second {
		t.Errorf("TagFallbackDelay = %v, want 15s", cfg.TagFallbackDelay)
	}
	if cfg.InviteLinkTTL != 10*time.Minute {
		t.Errorf("InviteLinkTTL = %v, want 10m", cfg.InviteLinkTTL)
	}
	if cfg.CleanupInterval != 1*time.Minute {
		t.Errorf("CleanupInterval = %v, want 1m", cfg.CleanupInterval)
	}
}

func TestParseEnv_IntegerOverrides(t *testing.T) {
	clearMatchEnvVars(t)
	t.Setenv("MATCH_EPHEMERAL_SECONDS", "120")
	t.Setenv("MATCH_MAX_QUEUE_SIZE", "200")
	t.Setenv("MATCH_HOURLY_RATE_LIMIT", "50")
	t.Setenv("MATCH_MAX_EXTENSIONS", "5")

	cfg, err := ParseEnv()
	if err != nil {
		t.Fatalf("ParseEnv() error: %v", err)
	}

	if cfg.EphemeralSeconds != 120 {
		t.Errorf("EphemeralSeconds = %d, want 120", cfg.EphemeralSeconds)
	}
	if cfg.MaxQueueSize != 200 {
		t.Errorf("MaxQueueSize = %d, want 200", cfg.MaxQueueSize)
	}
	if cfg.HourlyRateLimit != 50 {
		t.Errorf("HourlyRateLimit = %d, want 50", cfg.HourlyRateLimit)
	}
	if cfg.MaxExtensions != 5 {
		t.Errorf("MaxExtensions = %d, want 5", cfg.MaxExtensions)
	}
}

func TestParseEnv_InvalidDuration(t *testing.T) {
	clearMatchEnvVars(t)
	t.Setenv("MATCH_TIMEOUT", "not-a-duration")

	_, err := ParseEnv()
	if err == nil {
		t.Fatal("expected ParseEnv() to return an error for invalid duration")
	}
	if !contains(err.Error(), "MATCH_TIMEOUT") {
		t.Errorf("error %q should mention MATCH_TIMEOUT", err.Error())
	}
}

func TestParseEnv_InvalidInteger(t *testing.T) {
	clearMatchEnvVars(t)
	t.Setenv("MATCH_MAX_QUEUE_SIZE", "abc")

	_, err := ParseEnv()
	if err == nil {
		t.Fatal("expected ParseEnv() to return an error for invalid integer")
	}
	if !contains(err.Error(), "MATCH_MAX_QUEUE_SIZE") {
		t.Errorf("error %q should mention MATCH_MAX_QUEUE_SIZE", err.Error())
	}
}

// --- helpers ---

func clearMatchEnvVars(t *testing.T) {
	t.Helper()
	envVars := []string{
		"DISABLE_RANDOM_MATCH",
		"MATCH_TIMEOUT",
		"KEY_EXCHANGE_TIMEOUT",
		"MATCH_ROOM_EXPIRY",
		"MATCH_EPHEMERAL_SECONDS",
		"MATCH_MAX_QUEUE_SIZE",
		"MATCH_COOLDOWN_PERIOD",
		"MATCH_HOURLY_RATE_LIMIT",
		"MATCH_BLOCK_DURATION",
		"MATCH_MAX_EXTENSIONS",
		"MATCH_TAG_FALLBACK_DELAY",
		"MATCH_INVITE_LINK_TTL",
		"MATCH_CLEANUP_INTERVAL",
	}
	for _, env := range envVars {
		os.Unsetenv(env)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// --- Property-Based Tests ---

// TestProperty_ConfigValidation verifies Property 13: Configuration validation.
// For ANY randomly generated Config, Validate() returns error iff any parameter is invalid.
// Valid configurations pass validation; invalid ones fail with appropriate error.
//
// **Validates: Requirements 14.5**
func TestProperty_ConfigValidation(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Generate a random Config with mix of valid and invalid values.
		// Durations that must be > 0: MatchTimeout, KeyExchangeTimeout, RoomExpiry,
		//   BlockDuration, InviteLinkTTL, CleanupInterval
		// Durations that must be >= 0: CooldownPeriod, TagFallbackDelay
		// Ints that must be > 0: MaxQueueSize, HourlyRateLimit
		// Ints that must be >= 0: EphemeralSeconds, MaxExtensions

		cfg := &Config{
			Enabled:            rapid.Bool().Draw(t, "Enabled"),
			MatchTimeout:       time.Duration(rapid.IntRange(-1_000_000_000, 5_000_000_000).Draw(t, "MatchTimeout")),
			KeyExchangeTimeout: time.Duration(rapid.IntRange(-1_000_000_000, 5_000_000_000).Draw(t, "KeyExchangeTimeout")),
			RoomExpiry:         time.Duration(rapid.IntRange(-1_000_000_000, 5_000_000_000).Draw(t, "RoomExpiry")),
			EphemeralSeconds:   rapid.IntRange(-10, 200).Draw(t, "EphemeralSeconds"),
			MaxQueueSize:       rapid.IntRange(-10, 500).Draw(t, "MaxQueueSize"),
			CooldownPeriod:     time.Duration(rapid.IntRange(-1_000_000_000, 5_000_000_000).Draw(t, "CooldownPeriod")),
			HourlyRateLimit:    rapid.IntRange(-10, 100).Draw(t, "HourlyRateLimit"),
			BlockDuration:      time.Duration(rapid.IntRange(-1_000_000_000, 5_000_000_000).Draw(t, "BlockDuration")),
			MaxExtensions:      rapid.IntRange(-10, 20).Draw(t, "MaxExtensions"),
			TagFallbackDelay:   time.Duration(rapid.IntRange(-1_000_000_000, 5_000_000_000).Draw(t, "TagFallbackDelay")),
			InviteLinkTTL:      time.Duration(rapid.IntRange(-1_000_000_000, 5_000_000_000).Draw(t, "InviteLinkTTL")),
			CleanupInterval:    time.Duration(rapid.IntRange(-1_000_000_000, 5_000_000_000).Draw(t, "CleanupInterval")),
		}

		// Determine expected validity based on the same rules as Validate()
		expectValid := isConfigValid(cfg)

		err := cfg.Validate()
		if expectValid && err != nil {
			t.Fatalf("expected valid config to pass Validate(), got error: %v\nConfig: %+v", err, cfg)
		}
		if !expectValid && err == nil {
			t.Fatalf("expected invalid config to fail Validate(), but it passed\nConfig: %+v", cfg)
		}
	})
}

// isConfigValid mirrors the validation logic to independently determine if a Config is valid.
func isConfigValid(c *Config) bool {
	if c.MatchTimeout <= 0 {
		return false
	}
	if c.KeyExchangeTimeout <= 0 {
		return false
	}
	if c.RoomExpiry <= 0 {
		return false
	}
	if c.EphemeralSeconds < 0 {
		return false
	}
	if c.MaxQueueSize <= 0 {
		return false
	}
	if c.CooldownPeriod < 0 {
		return false
	}
	if c.HourlyRateLimit <= 0 {
		return false
	}
	if c.BlockDuration <= 0 {
		return false
	}
	if c.MaxExtensions < 0 {
		return false
	}
	if c.TagFallbackDelay < 0 {
		return false
	}
	if c.InviteLinkTTL <= 0 {
		return false
	}
	if c.CleanupInterval <= 0 {
		return false
	}
	return true
}
