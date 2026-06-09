package hub

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
)

// HubHandlerConfig holds all dependencies for the Hub API handler.
// Using a config struct avoids breaking changes when adding new dependencies.
type HubHandlerConfig struct {
	Registry       *HubRegistry
	RateLimiter    *RateLimiter
	AllowedOrigins string
	ActivityGetter ActivityGetter // nil means all counts are 0 (graceful degradation)
	OnlineCountFn  func() int     // returns Hub.ClientCount(); nil-safe (defaults to 0)
}

// NewHubHandler creates the HTTP handler for the Hub directory API.
// It handles GET /api/hub with query params: tag, q, sort, limit, offset.
// CORS headers are set based on cfg.AllowedOrigins. Rate limiting is enforced per IP.
func NewHubHandler(cfg HubHandlerConfig) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers before any other response logic
		if cfg.AllowedOrigins != "" {
			w.Header().Set("Access-Control-Allow-Origin", cfg.AllowedOrigins)
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}

		// Handle preflight OPTIONS request
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// Only GET is allowed
		if r.Method != http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		// Rate limit check by IP
		ip := extractIP(r)
		if !cfg.RateLimiter.Allow(ip) {
			retryAfter := cfg.RateLimiter.SecondsUntilReset(ip)
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"rate limited, try again later"}`, http.StatusTooManyRequests)
			return
		}

		// Parse query params
		query := r.URL.Query()
		tag := query.Get("tag")
		q := query.Get("q")
		sortParam := query.Get("sort")
		isDailyTopicStr := query.Get("isDailyTopic")

		limitStr := query.Get("limit")
		offsetStr := query.Get("offset")

		limit := 50
		if limitStr != "" {
			parsed, err := strconv.Atoi(limitStr)
			if err != nil || parsed < 0 {
				w.Header().Set("Content-Type", "application/json")
				http.Error(w, `{"error":"invalid limit parameter"}`, http.StatusBadRequest)
				return
			}
			if parsed > 100 {
				w.Header().Set("Content-Type", "application/json")
				http.Error(w, `{"error":"limit must not exceed 100"}`, http.StatusBadRequest)
				return
			}
			limit = parsed
		}

		offset := 0
		if offsetStr != "" {
			parsed, err := strconv.Atoi(offsetStr)
			if err != nil || parsed < 0 {
				w.Header().Set("Content-Type", "application/json")
				http.Error(w, `{"error":"invalid offset parameter"}`, http.StatusBadRequest)
				return
			}
			offset = parsed
		}

		// Query the registry
		opts := ListOptions{
			Tag:    tag,
			Query:  q,
			Sort:   sortParam,
			Limit:  limit,
			Offset: offset,
		}

		// Apply isDailyTopic filter when explicitly specified
		if isDailyTopicStr == "true" {
			v := true
			opts.IsDailyTopic = &v
		} else if isDailyTopicStr == "false" {
			v := false
			opts.IsDailyTopic = &v
		}

		result := cfg.Registry.List(opts, cfg.ActivityGetter)

		// Set totalOnline from OnlineCountFn (nil-safe, default 0)
		if cfg.OnlineCountFn != nil {
			result.TotalOnline = cfg.OnlineCountFn()
		}

		// JSON response
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		json.NewEncoder(w).Encode(result)
	})
}

// extractIP extracts the client IP from the request, handling X-Forwarded-For.
func extractIP(r *http.Request) string {
	// Check X-Forwarded-For first (for reverse proxy setups)
	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded != "" {
		// Take the first IP in the comma-separated chain
		parts := strings.SplitN(forwarded, ",", 2)
		ip := strings.TrimSpace(parts[0])
		if net.ParseIP(ip) != nil {
			return ip
		}
	}

	// Fall back to RemoteAddr
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
