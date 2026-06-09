package hub

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func setupTestHandler() (http.Handler, *HubRegistry, *RateLimiter) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)
	handler := NewHubHandler(HubHandlerConfig{
		Registry:       registry,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: nil,
		OnlineCountFn:  nil,
	})
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
	handler := NewHubHandler(HubHandlerConfig{
		Registry:       registry,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "https://example.com",
		ActivityGetter: nil,
		OnlineCountFn:  nil,
	})

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
	handler := NewHubHandler(HubHandlerConfig{
		Registry:       registry,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "",
		ActivityGetter: nil,
		OnlineCountFn:  nil,
	})

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
	handler := NewHubHandler(HubHandlerConfig{
		Registry:       registry,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: nil,
		OnlineCountFn:  nil,
	})

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

// --- Activity Ranking Tests (Task 4.2) ---

// apiMockActivityGetter is a simple mock implementing ActivityGetter for API tests.
type apiMockActivityGetter struct {
	counts map[string]int
}

func (m *apiMockActivityGetter) GetCount(roomID string) int {
	if m.counts == nil {
		return 0
	}
	return m.counts[roomID]
}

func TestAPI_SortActive(t *testing.T) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)

	ag := &apiMockActivityGetter{counts: map[string]int{
		"room-low":    2,
		"room-high":   50,
		"room-medium": 10,
	}}

	handler := NewHubHandler(HubHandlerConfig{
		Registry:       registry,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: ag,
		OnlineCountFn:  nil,
	})

	registry.Register(&RoomListing{RoomID: "room-low", KeyEncoded: "k1", Title: "Low Activity", MemberCount: 1, CreatedAt: 1})
	registry.Register(&RoomListing{RoomID: "room-high", KeyEncoded: "k2", Title: "High Activity", MemberCount: 3, CreatedAt: 2})
	registry.Register(&RoomListing{RoomID: "room-medium", KeyEncoded: "k3", Title: "Medium Activity", MemberCount: 2, CreatedAt: 3})

	req := httptest.NewRequest(http.MethodGet, "/api/hub?sort=active", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result ListResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(result.Rooms) != 3 {
		t.Fatalf("expected 3 rooms, got %d", len(result.Rooms))
	}

	// Verify sorted by messageCount5min DESC
	if result.Rooms[0].RoomID != "room-high" {
		t.Errorf("expected first room 'room-high', got %q", result.Rooms[0].RoomID)
	}
	if result.Rooms[1].RoomID != "room-medium" {
		t.Errorf("expected second room 'room-medium', got %q", result.Rooms[1].RoomID)
	}
	if result.Rooms[2].RoomID != "room-low" {
		t.Errorf("expected third room 'room-low', got %q", result.Rooms[2].RoomID)
	}

	// Verify messageCount5min values are populated
	if result.Rooms[0].MessageCount5min != 50 {
		t.Errorf("expected messageCount5min=50 for room-high, got %d", result.Rooms[0].MessageCount5min)
	}
	if result.Rooms[1].MessageCount5min != 10 {
		t.Errorf("expected messageCount5min=10 for room-medium, got %d", result.Rooms[1].MessageCount5min)
	}
	if result.Rooms[2].MessageCount5min != 2 {
		t.Errorf("expected messageCount5min=2 for room-low, got %d", result.Rooms[2].MessageCount5min)
	}
}

func TestAPI_InvalidSortParam(t *testing.T) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)

	handler := NewHubHandler(HubHandlerConfig{
		Registry:       registry,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: nil,
		OnlineCountFn:  nil,
	})

	// Register rooms with different memberCounts (default sort = memberCount DESC)
	registry.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k1", Title: "Small", MemberCount: 2, CreatedAt: 100})
	registry.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k2", Title: "Big", MemberCount: 10, CreatedAt: 200})
	registry.Register(&RoomListing{RoomID: "r3", KeyEncoded: "k3", Title: "Medium", MemberCount: 5, CreatedAt: 300})

	req := httptest.NewRequest(http.MethodGet, "/api/hub?sort=INVALID", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result ListResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if len(result.Rooms) != 3 {
		t.Fatalf("expected 3 rooms, got %d", len(result.Rooms))
	}

	// Default sort: memberCount DESC, tiebreaker createdAt DESC
	if result.Rooms[0].RoomID != "r2" {
		t.Errorf("expected first room 'r2' (memberCount=10), got %q", result.Rooms[0].RoomID)
	}
	if result.Rooms[1].RoomID != "r3" {
		t.Errorf("expected second room 'r3' (memberCount=5), got %q", result.Rooms[1].RoomID)
	}
	if result.Rooms[2].RoomID != "r1" {
		t.Errorf("expected third room 'r1' (memberCount=2), got %q", result.Rooms[2].RoomID)
	}
}

func TestAPI_TotalOnline(t *testing.T) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)

	handler := NewHubHandler(HubHandlerConfig{
		Registry:       registry,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: nil,
		OnlineCountFn:  func() int { return 42 },
	})

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

	if result.TotalOnline != 42 {
		t.Errorf("expected totalOnline=42, got %d", result.TotalOnline)
	}
}

func TestAPI_EmptyRegistrySortParam(t *testing.T) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)

	handler := NewHubHandler(HubHandlerConfig{
		Registry:       registry,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: &apiMockActivityGetter{counts: map[string]int{}},
		OnlineCountFn:  nil,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/hub?sort=active", nil)
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
	if result.Rooms == nil {
		t.Error("expected non-nil rooms slice (empty array), got nil")
	}
	if len(result.Rooms) != 0 {
		t.Errorf("expected 0 rooms, got %d", len(result.Rooms))
	}
}

func TestAPI_NilActivityGetter(t *testing.T) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(30, time.Minute)

	handler := NewHubHandler(HubHandlerConfig{
		Registry:       registry,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: nil, // explicitly nil
		OnlineCountFn:  nil,
	})

	registry.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k1", Title: "Room One", MemberCount: 5, CreatedAt: 100})
	registry.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k2", Title: "Room Two", MemberCount: 3, CreatedAt: 200})

	req := httptest.NewRequest(http.MethodGet, "/api/hub?sort=active", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var result ListResult
	if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// With nil ActivityGetter, all messageCount5min should be 0
	for _, room := range result.Rooms {
		if room.MessageCount5min != 0 {
			t.Errorf("expected messageCount5min=0 for room %s with nil ActivityGetter, got %d", room.RoomID, room.MessageCount5min)
		}
	}
}

func TestAPI_ConcurrentRequests(t *testing.T) {
	registry := NewHubRegistry(200)
	rateLimiter := NewRateLimiter(1000, time.Minute) // High limit to avoid rate limiting in this test

	ag := &apiMockActivityGetter{counts: map[string]int{
		"r1": 10,
		"r2": 20,
		"r3": 5,
	}}

	handler := NewHubHandler(HubHandlerConfig{
		Registry:       registry,
		RateLimiter:    rateLimiter,
		AllowedOrigins: "*",
		ActivityGetter: ag,
		OnlineCountFn:  func() int { return 7 },
	})

	registry.Register(&RoomListing{RoomID: "r1", KeyEncoded: "k1", Title: "Room 1", MemberCount: 3, CreatedAt: 1})
	registry.Register(&RoomListing{RoomID: "r2", KeyEncoded: "k2", Title: "Room 2", MemberCount: 5, CreatedAt: 2})
	registry.Register(&RoomListing{RoomID: "r3", KeyEncoded: "k3", Title: "Room 3", MemberCount: 1, CreatedAt: 3})

	const numGoroutines = 20
	errs := make(chan error, numGoroutines)

	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func() {
			defer wg.Done()

			req := httptest.NewRequest(http.MethodGet, "/api/hub?sort=active", nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)

			if w.Code != http.StatusOK {
				errs <- fmt.Errorf("expected 200, got %d", w.Code)
				return
			}

			var result ListResult
			if err := json.NewDecoder(w.Body).Decode(&result); err != nil {
				errs <- fmt.Errorf("failed to decode: %v", err)
				return
			}

			if len(result.Rooms) != 3 {
				errs <- fmt.Errorf("expected 3 rooms, got %d", len(result.Rooms))
				return
			}

			if result.TotalOnline != 7 {
				errs <- fmt.Errorf("expected totalOnline=7, got %d", result.TotalOnline)
				return
			}
		}()
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		t.Error(err)
	}
}
