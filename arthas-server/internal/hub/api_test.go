package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func setupTestHandler() (http.Handler, *HubRegistry, *RateLimiter) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)
	handler := NewHubHandler(registry, rateLimiter, "*")
	return handler, registry, rateLimiter
}

func TestNewHubHandler_EmptyRegistry(t *testing.T) {
	handler, _, _ := setupTestHandler()

	req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result ListResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if result.Total != 0 {
		t.Errorf("expected total=0, got %d", result.Total)
	}
	if len(result.Rooms) != 0 {
		t.Errorf("expected empty rooms, got %d", len(result.Rooms))
	}
	if result.Limit != 50 {
		t.Errorf("expected default limit=50, got %d", result.Limit)
	}
	if result.Offset != 0 {
		t.Errorf("expected default offset=0, got %d", result.Offset)
	}
}

func TestNewHubHandler_WithRooms(t *testing.T) {
	handler, registry, _ := setupTestHandler()

	registry.Register(&RoomListing{
		RoomID:      "room1",
		KeyEncoded:  "key1",
		Title:       "Golang Chat",
		Description: "Talk about Go",
		Tags:        []string{"golang", "programming"},
		MemberCount: 5,
		CreatedAt:   1700000000,
		ExpiresAt:   1700003600,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result ListResult
	json.NewDecoder(w.Body).Decode(&result)

	if result.Total != 1 {
		t.Errorf("expected total=1, got %d", result.Total)
	}
	if len(result.Rooms) != 1 {
		t.Errorf("expected 1 room, got %d", len(result.Rooms))
	}
	if result.Rooms[0].Title != "Golang Chat" {
		t.Errorf("expected title 'Golang Chat', got %q", result.Rooms[0].Title)
	}
}

func TestNewHubHandler_TagFilter(t *testing.T) {
	handler, registry, _ := setupTestHandler()

	registry.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k1", Title: "Go Room", Tags: []string{"golang"}, CreatedAt: 1})
	registry.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k2", Title: "React Room", Tags: []string{"react"}, CreatedAt: 2})

	req := httptest.NewRequest(http.MethodGet, "/api/hub?tag=golang", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var result ListResult
	json.NewDecoder(w.Body).Decode(&result)

	if result.Total != 1 {
		t.Errorf("expected total=1, got %d", result.Total)
	}
	if result.Rooms[0].RoomID != "r1" {
		t.Errorf("expected room r1, got %s", result.Rooms[0].RoomID)
	}
}

func TestNewHubHandler_SearchQuery(t *testing.T) {
	handler, registry, _ := setupTestHandler()

	registry.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k1", Title: "Golang AMA", Description: "Ask anything", CreatedAt: 1})
	registry.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k2", Title: "React Help", Description: "UI questions", CreatedAt: 2})

	req := httptest.NewRequest(http.MethodGet, "/api/hub?q=golang", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var result ListResult
	json.NewDecoder(w.Body).Decode(&result)

	if result.Total != 1 {
		t.Errorf("expected total=1, got %d", result.Total)
	}
}

func TestNewHubHandler_Pagination(t *testing.T) {
	handler, registry, _ := setupTestHandler()

	for i := 0; i < 10; i++ {
		registry.Register(&RoomListing{
			RoomID:     "r" + string(rune('a'+i)),
			KeyEncoded: "k",
			Title:      "Room",
			CreatedAt:  int64(i),
		})
	}

	req := httptest.NewRequest(http.MethodGet, "/api/hub?limit=3&offset=2", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var result ListResult
	json.NewDecoder(w.Body).Decode(&result)

	if result.Total != 10 {
		t.Errorf("expected total=10, got %d", result.Total)
	}
	if result.Limit != 3 {
		t.Errorf("expected limit=3, got %d", result.Limit)
	}
	if result.Offset != 2 {
		t.Errorf("expected offset=2, got %d", result.Offset)
	}
	if len(result.Rooms) != 3 {
		t.Errorf("expected 3 rooms, got %d", len(result.Rooms))
	}
}

func TestNewHubHandler_InvalidLimit(t *testing.T) {
	handler, _, _ := setupTestHandler()

	tests := []struct {
		name string
		url  string
	}{
		{"negative limit", "/api/hub?limit=-1"},
		{"limit over 100", "/api/hub?limit=101"},
		{"non-numeric limit", "/api/hub?limit=abc"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d", w.Code)
			}
		})
	}
}

func TestNewHubHandler_InvalidOffset(t *testing.T) {
	handler, _, _ := setupTestHandler()

	tests := []struct {
		name string
		url  string
	}{
		{"negative offset", "/api/hub?offset=-1"},
		{"non-numeric offset", "/api/hub?offset=xyz"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d", w.Code)
			}
		})
	}
}

func TestNewHubHandler_MethodNotAllowed(t *testing.T) {
	handler, _, _ := setupTestHandler()

	req := httptest.NewRequest(http.MethodPost, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Code)
	}
}

func TestNewHubHandler_OptionsPreflightCORS(t *testing.T) {
	handler, _, _ := setupTestHandler()

	req := httptest.NewRequest(http.MethodOptions, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", w.Code)
	}

	origin := w.Header().Get("Access-Control-Allow-Origin")
	if origin != "*" {
		t.Errorf("expected CORS origin '*', got %q", origin)
	}
}

func TestNewHubHandler_CORSHeaders(t *testing.T) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)
	handler := NewHubHandler(registry, rateLimiter, "https://example.com")

	req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	origin := w.Header().Get("Access-Control-Allow-Origin")
	if origin != "https://example.com" {
		t.Errorf("expected CORS origin 'https://example.com', got %q", origin)
	}
	methods := w.Header().Get("Access-Control-Allow-Methods")
	if methods != "GET, OPTIONS" {
		t.Errorf("expected 'GET, OPTIONS', got %q", methods)
	}
}

func TestNewHubHandler_NoCORSWhenEmpty(t *testing.T) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)
	handler := NewHubHandler(registry, rateLimiter, "")

	req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	origin := w.Header().Get("Access-Control-Allow-Origin")
	if origin != "" {
		t.Errorf("expected no CORS origin, got %q", origin)
	}
}

func TestNewHubHandler_RateLimiting(t *testing.T) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(3, time.Minute) // Low limit for testing
	handler := NewHubHandler(registry, rateLimiter, "*")

	// Exhaust the rate limit
	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
		req.RemoteAddr = "192.168.1.1:12345"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, w.Code)
		}
	}

	// Next request should be rate limited
	req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", w.Code)
	}

	retryAfter := w.Header().Get("Retry-After")
	if retryAfter == "" {
		t.Error("expected Retry-After header to be set")
	}
}

func TestNewHubHandler_ContentTypeJSON(t *testing.T) {
	handler, _, _ := setupTestHandler()

	req := httptest.NewRequest(http.MethodGet, "/api/hub", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("expected Content-Type 'application/json', got %q", ct)
	}
}

func TestExtractIP_RemoteAddr(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.168.1.100:54321"

	ip := extractIP(req)
	if ip != "192.168.1.100" {
		t.Errorf("expected 192.168.1.100, got %s", ip)
	}
}

func TestExtractIP_XForwardedFor(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:12345"
	req.Header.Set("X-Forwarded-For", "203.0.113.50")

	ip := extractIP(req)
	if ip != "203.0.113.50" {
		t.Errorf("expected 203.0.113.50, got %s", ip)
	}
}

func TestExtractIP_XForwardedForChain(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:12345"
	req.Header.Set("X-Forwarded-For", "203.0.113.50, 70.41.3.18, 150.172.238.178")

	ip := extractIP(req)
	if ip != "203.0.113.50" {
		t.Errorf("expected 203.0.113.50, got %s", ip)
	}
}

func TestExtractIP_InvalidForwarded(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:12345"
	req.Header.Set("X-Forwarded-For", "not-an-ip")

	ip := extractIP(req)
	if ip != "10.0.0.1" {
		t.Errorf("expected fallback to 10.0.0.1, got %s", ip)
	}
}
