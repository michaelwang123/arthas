package hub

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
)

// NewHubHandler creates the HTTP handler for the Hub directory API.
// It handles GET /api/hub with query params: tag, q, limit, offset.
// CORS headers are set based on allowedOrigins. Rate limiting is enforced per IP.
func NewHubHandler(registry *HubRegistry, rateLimiter *RateLimiter, allowedOrigins string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set CORS headers before any other response logic
		if allowedOrigins != "" {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigins)
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
		if !rateLimiter.Allow(ip) {
			retryAfter := rateLimiter.SecondsUntilReset(ip)
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			w.Header().Set("Content-Type", "application/json")
			http.Error(w, `{"error":"rate limited, try again later"}`, http.StatusTooManyRequests)
			return
		}

		// Parse query params
		query := r.URL.Query()
		tag := query.Get("tag")
		q := query.Get("q")

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
			Limit:  limit,
			Offset: offset,
		}
		result := registry.List(opts)

		// JSON response
		w.Header().Set("Content-Type", "application/json")
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
