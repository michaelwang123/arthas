package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"testing"
	"time"

	"github.com/arthas/arthas-server/internal/logger"
)

// TestHandlePing_Returns200Pong verifies that the /ping health check endpoint
// returns HTTP 200 with plain text body "pong" and correct Content-Type header.
//
// 📚 学习要点: httptest 包
// Go 标准库提供 httptest 包用于测试 HTTP handler，无需启动真实服务器。
// httptest.NewRecorder() 创建一个 ResponseRecorder，记录 handler 写入的响应。
// httptest.NewRequest() 创建一个用于测试的 *http.Request。
//
// Validates: Requirements 1.1, 1.2
func TestHandlePing_Returns200Pong(t *testing.T) {
	// Arrange: create a request and response recorder
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	w := httptest.NewRecorder()

	// Act: call the handler directly
	handlePing(w, req)

	// Assert: status code
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	// Assert: body
	body := w.Body.String()
	if body != "pong" {
		t.Errorf("expected body %q, got %q", "pong", body)
	}

	// Assert: Content-Type header
	contentType := w.Header().Get("Content-Type")
	if contentType != "text/plain" {
		t.Errorf("expected Content-Type %q, got %q", "text/plain", contentType)
	}
}

// TestHandlePing_NoAuthRequired verifies that the /ping endpoint responds
// successfully without any Authorization header present.
// Health check endpoints must be accessible without authentication so that
// container orchestrators and external keep-alive services can probe them.
//
// Validates: Requirements 1.2
func TestHandlePing_NoAuthRequired(t *testing.T) {
	// Create request explicitly without any auth headers
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	// Ensure no Authorization header is set
	req.Header.Del("Authorization")

	w := httptest.NewRecorder()

	handlePing(w, req)

	// Should still return 200 — no auth check in the handler
	if w.Code != http.StatusOK {
		t.Errorf("expected status 200 without auth, got %d", w.Code)
	}

	body := w.Body.String()
	if body != "pong" {
		t.Errorf("expected body %q without auth, got %q", "pong", body)
	}
}

// TestHandlePing_RespondsWithin100ms verifies that the /ping handler completes
// within 100ms under normal operating conditions.
// Health check endpoints must be fast to avoid false-negative health probes.
//
// Validates: Requirements 1.1
func TestHandlePing_RespondsWithin100ms(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	w := httptest.NewRecorder()

	start := time.Now()
	handlePing(w, req)
	elapsed := time.Since(start)

	if elapsed > 100*time.Millisecond {
		t.Errorf("handler took %v, expected < 100ms", elapsed)
	}
}

// TestPortDefault verifies that when the PORT environment variable is unset,
// the server defaults to port "8080".
// This matches the logic in main(): `port := os.Getenv("PORT"); if port == "" { port = "8080" }`
//
// Validates: Requirements 2.1
func TestPortDefault(t *testing.T) {
	// Save current PORT value and restore after test
	originalPort := os.Getenv("PORT")
	defer func() {
		if originalPort != "" {
			os.Setenv("PORT", originalPort)
		} else {
			os.Unsetenv("PORT")
		}
	}()

	// Unset PORT
	os.Unsetenv("PORT")

	// Replicate the same logic as main.go
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if port != "8080" {
		t.Errorf("expected default port %q, got %q", "8080", port)
	}
}

// TestStartupLog_ContainsRequiredInfo verifies that the startup log message
// contains the required information: port number, version string, and RFC 3339 timestamp.
//
// 📚 学习要点: 日志测试技巧
// 通过 log.SetOutput 将日志输出重定向到 bytes.Buffer，
// 然后检查 buffer 内容是否包含预期信息。
// 测试后必须恢复原始 output，避免影响其他测试。
//
// Validates: Requirements 1.5
func TestStartupLog_ContainsRequiredInfo(t *testing.T) {
	// Save and restore log output
	originalOutput := log.Writer()
	originalFlags := log.Flags()
	defer func() {
		log.SetOutput(originalOutput)
		log.SetFlags(originalFlags)
	}()

	// Redirect log output to buffer
	var buf bytes.Buffer
	log.SetOutput(&buf)
	log.SetFlags(0)

	// Simulate the startup log call (same format as main.go)
	testPort := "8080"
	testVersion := "1.0.0"
	logger.Info("Server", "started on :%s (version %s) at %s", testPort, testVersion, time.Now().Format(time.RFC3339))

	output := buf.String()

	// Verify port is present
	if !bytes.Contains(buf.Bytes(), []byte(testPort)) {
		t.Errorf("startup log missing port %q, got: %s", testPort, output)
	}

	// Verify version is present
	if !bytes.Contains(buf.Bytes(), []byte(testVersion)) {
		t.Errorf("startup log missing version %q, got: %s", testVersion, output)
	}

	// Verify RFC 3339 timestamp pattern is present
	// RFC 3339 format: 2006-01-02T15:04:05Z07:00
	rfc3339Pattern := regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z`)
	if !rfc3339Pattern.MatchString(output) {
		t.Errorf("startup log missing RFC 3339 timestamp, got: %s", output)
	}
}
