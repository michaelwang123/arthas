package hub

import (
	"encoding/json"
	"net/http"
)

// HubStatsData is the JSON response for the /api/hub/stats endpoint.
// It exposes Hub status information used by the Match_Client to discover
// feature availability and online presence before entering the match queue.
type HubStatsData struct {
	Online         int  `json:"online"`
	MatchEnabled   bool `json:"matchEnabled"`
	MatchQueueSize int  `json:"matchQueueSize"`
}

// HubStatsHandlerConfig holds dependencies for the Hub Stats API handler.
type HubStatsHandlerConfig struct {
	AllowedOrigins   string
	OnlineCountFn    func() int  // returns Hub.ClientCount(); nil-safe (defaults to 0)
	MatchEnabledFn   func() bool // returns whether match feature is enabled; nil-safe (defaults to false)
	MatchQueueSizeFn func() int  // returns current match queue size; nil-safe (defaults to 0)
}

// HubStatsHandler implements http.Handler for the /api/hub/stats endpoint.
type HubStatsHandler struct {
	cfg HubStatsHandlerConfig
}

// NewHubStatsHandler creates the HTTP handler for the Hub Stats API.
// Returns JSON with online count, match enabled status, and match queue size.
// CORS headers are set based on cfg.AllowedOrigins (same as /api/hub).
func NewHubStatsHandler(cfg HubStatsHandlerConfig) *HubStatsHandler {
	return &HubStatsHandler{cfg: cfg}
}

// ServeHTTP handles GET /api/hub/stats requests.
func (h *HubStatsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Set CORS headers (same policy as /api/hub)
	if h.cfg.AllowedOrigins != "" {
		w.Header().Set("Access-Control-Allow-Origin", h.cfg.AllowedOrigins)
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

	// Build response data with nil-safe function calls
	data := HubStatsData{}

	if h.cfg.OnlineCountFn != nil {
		data.Online = h.cfg.OnlineCountFn()
	}

	if h.cfg.MatchEnabledFn != nil {
		data.MatchEnabled = h.cfg.MatchEnabledFn()
	}

	if h.cfg.MatchQueueSizeFn != nil {
		data.MatchQueueSize = h.cfg.MatchQueueSizeFn()
	}

	// JSON response with no-cache (real-time data)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	json.NewEncoder(w).Encode(data)
}
