package hub

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHubStatsHandler_GET_ReturnsJSON(t *testing.T) {
	handler := NewHubStatsHandler(HubStatsHandlerConfig{
		AllowedOrigins:   "https://example.com",
		OnlineCountFn:    func() int { return 42 },
		MatchEnabledFn:   func() bool { return true },
		MatchQueueSizeFn: func() int { return 3 },
	})

	req := httptest.NewRequest(http.MethodGet, "/api/hub/stats", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	// Verify Content-Type
	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Fatalf("expected Content-Type application/json, got %q", ct)
	}

	// Verify CORS header
	origin := w.Header().Get("Access-Control-Allow-Origin")
	if origin != "https://example.com" {
		t.Fatalf("expected CORS origin https://example.com, got %q", origin)
	}

	// Verify Cache-Control
	cc := w.Header().Get("Cache-Control")
	if cc != "no-cache, no-store, must-revalidate" {
		t.Fatalf("expected no-cache Cache-Control, got %q", cc)
	}

	// Verify JSON body
	var data HubStatsData
	if err := json.NewDecoder(w.Body).Decode(&data); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if data.Online != 42 {
		t.Errorf("expected online=42, got %d", data.Online)
	}
	if !data.MatchEnabled {
		t.Errorf("expected matchEnabled=true, got false")
	}
	if data.MatchQueueSize != 3 {
		t.Errorf("expected matchQueueSize=3, got %d", data.MatchQueueSize)
	}
}

func TestHubStatsHandler_NilFunctions_DefaultsToZero(t *testing.T) {
	handler := NewHubStatsHandler(HubStatsHandlerConfig{
		AllowedOrigins:   "",
		OnlineCountFn:    nil,
		MatchEnabledFn:   nil,
		MatchQueueSizeFn: nil,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/hub/stats", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var data HubStatsData
	if err := json.NewDecoder(w.Body).Decode(&data); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if data.Online != 0 {
		t.Errorf("expected online=0, got %d", data.Online)
	}
	if data.MatchEnabled {
		t.Errorf("expected matchEnabled=false, got true")
	}
	if data.MatchQueueSize != 0 {
		t.Errorf("expected matchQueueSize=0, got %d", data.MatchQueueSize)
	}

	// No CORS header when AllowedOrigins is empty
	origin := w.Header().Get("Access-Control-Allow-Origin")
	if origin != "" {
		t.Errorf("expected no CORS header, got %q", origin)
	}
}

func TestHubStatsHandler_OPTIONS_Preflight(t *testing.T) {
	handler := NewHubStatsHandler(HubStatsHandlerConfig{
		AllowedOrigins: "https://example.com",
		OnlineCountFn:  func() int { return 10 },
	})

	req := httptest.NewRequest(http.MethodOptions, "/api/hub/stats", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected status 204, got %d", w.Code)
	}

	origin := w.Header().Get("Access-Control-Allow-Origin")
	if origin != "https://example.com" {
		t.Fatalf("expected CORS origin in preflight, got %q", origin)
	}
}

func TestHubStatsHandler_POST_MethodNotAllowed(t *testing.T) {
	handler := NewHubStatsHandler(HubStatsHandlerConfig{
		AllowedOrigins: "",
		OnlineCountFn:  func() int { return 10 },
	})

	req := httptest.NewRequest(http.MethodPost, "/api/hub/stats", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected status 405, got %d", w.Code)
	}
}

func TestHubStatsHandler_MatchDisabled(t *testing.T) {
	handler := NewHubStatsHandler(HubStatsHandlerConfig{
		AllowedOrigins:   "https://example.com",
		OnlineCountFn:    func() int { return 5 },
		MatchEnabledFn:   func() bool { return false },
		MatchQueueSizeFn: func() int { return 0 },
	})

	req := httptest.NewRequest(http.MethodGet, "/api/hub/stats", nil)
	w := httptest.NewRecorder()

	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var data HubStatsData
	if err := json.NewDecoder(w.Body).Decode(&data); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if data.Online != 5 {
		t.Errorf("expected online=5, got %d", data.Online)
	}
	if data.MatchEnabled {
		t.Errorf("expected matchEnabled=false, got true")
	}
	if data.MatchQueueSize != 0 {
		t.Errorf("expected matchQueueSize=0, got %d", data.MatchQueueSize)
	}
}
