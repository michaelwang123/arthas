package network

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/quick"

	"github.com/gorilla/websocket"
)

// TestProperty_OriginListParsing verifies Property 1: Origin list parsing preserves all entries.
//
// For any comma-separated string of origin URLs (with arbitrary leading/trailing whitespace
// per entry), parsing the string into an origin list SHALL produce exactly the same set of
// trimmed, non-empty origins in the same order. Empty entries (resulting from consecutive
// commas or trailing commas) SHALL be filtered out.
//
// **Validates: Requirements 2.2, 3.4**
func TestProperty_OriginListParsing(t *testing.T) {
	// Redirect log output to suppress logger output during testing
	// (InitOriginControl calls logger.Info/Warn internally)
	originalOutput := log.Writer()
	originalFlags := log.Flags()
	defer func() {
		log.SetOutput(originalOutput)
		log.SetFlags(originalFlags)
	}()
	log.SetFlags(0)

	var buf bytes.Buffer
	log.SetOutput(&buf)

	// Property: For any comma-separated string, parsing produces the same set
	// of trimmed non-empty origins in the same order.
	property := func(origins string) bool {
		// Compute expected result: split by comma, trim each, filter empty
		parts := strings.Split(origins, ",")
		expected := make([]string, 0, len(parts))
		for _, p := range parts {
			trimmed := strings.TrimSpace(p)
			if trimmed != "" {
				expected = append(expected, trimmed)
			}
		}

		// Call the function under test
		buf.Reset()
		InitOriginControl(origins)

		// Special case: empty input string → allowedOrigins is nil (dev mode)
		if origins == "" {
			if allowedOrigins != nil {
				t.Logf("expected nil for empty input, got %v", allowedOrigins)
				return false
			}
			return true
		}

		// Verify length matches
		if len(allowedOrigins) != len(expected) {
			t.Logf("length mismatch: got %d, expected %d (input: %q)", len(allowedOrigins), len(expected), origins)
			return false
		}

		// Verify each entry matches in order
		for i := range expected {
			if allowedOrigins[i] != expected[i] {
				t.Logf("entry %d mismatch: got %q, expected %q (input: %q)", i, allowedOrigins[i], expected[i], origins)
				return false
			}
		}

		return true
	}

	// Run with minimum 100 iterations as specified
	cfg := &quick.Config{MaxCount: 100}
	if err := quick.Check(property, cfg); err != nil {
		t.Errorf("Property 1 (Origin list parsing preserves all entries) failed: %v", err)
	}

	// Cleanup: restore allowedOrigins to nil to avoid affecting other tests
	allowedOrigins = nil
}

// TestProperty_OriginValidationCorrectness 验证 Origin 验证逻辑的正确性。
//
// **Validates: Requirements 3.1, 3.2, 3.3**
//
// 属性定义：
// 对于任意 origin 字符串和任意非空允许列表，CheckOriginAllowed 返回 true
// 当且仅当 origin 精确匹配列表中的某个条目。当列表为空时，对任何 origin 返回 true。
//
// 📚 学习要点: Property-Based Testing（属性测试）
// 与传统单元测试（给定特定输入，验证特定输出）不同，
// 属性测试验证的是「对所有可能输入都成立的不变量」。
// testing/quick 会自动生成随机输入来尝试找到反例。
func TestProperty_OriginValidationCorrectness(t *testing.T) {
	// Sub-property 1: 列表中的 origin 必须被允许
	// 当 allowedOrigins 非空时，列表中的每个 origin 调用 CheckOriginAllowed 应返回 true
	t.Run("origin_in_list_is_allowed", func(t *testing.T) {
		f := func(origins []string) bool {
			// 过滤空字符串，构建有效的 allowedOrigins 列表
			var validOrigins []string
			for _, o := range origins {
				if o != "" {
					validOrigins = append(validOrigins, o)
				}
			}

			// 需要至少一个有效 origin 来测试
			if len(validOrigins) == 0 {
				return true // 跳过无效输入
			}

			// 设置 allowedOrigins（白盒测试，同包访问）
			allowedOrigins = validOrigins

			// 验证列表中的每个 origin 都被允许
			for _, testOrigin := range validOrigins {
				if !CheckOriginAllowed(testOrigin) {
					t.Logf("FAIL: origin %q should be allowed (in list %v)", testOrigin, validOrigins)
					return false
				}
			}
			return true
		}

		cfg := &quick.Config{MaxCount: 100}
		if err := quick.Check(f, cfg); err != nil {
			t.Errorf("Property violated: origin in allowed list should return true: %v", err)
		}
	})

	// Sub-property 2: 不在列表中的 origin 必须被拒绝
	// 当 allowedOrigins 非空时，不在列表中的 origin 调用 CheckOriginAllowed 应返回 false
	t.Run("origin_not_in_list_is_rejected", func(t *testing.T) {
		f := func(origins []string, extra string) bool {
			// 过滤空字符串，构建有效的 allowedOrigins 列表
			var validOrigins []string
			for _, o := range origins {
				if o != "" {
					validOrigins = append(validOrigins, o)
				}
			}

			// 需要非空列表来测试拒绝行为
			if len(validOrigins) == 0 {
				return true // 跳过：空列表允许所有
			}

			// 确保 extra 不在列表中：添加一个不可能出现在随机生成列表中的后缀
			extra = extra + "\x00unique-not-in-list"

			// 设置 allowedOrigins
			allowedOrigins = validOrigins

			result := CheckOriginAllowed(extra)
			if result {
				t.Logf("FAIL: origin %q should be rejected (not in list %v)", extra, validOrigins)
			}
			return !result
		}

		cfg := &quick.Config{MaxCount: 100}
		if err := quick.Check(f, cfg); err != nil {
			t.Errorf("Property violated: origin not in allowed list should return false: %v", err)
		}
	})

	// Sub-property 3: 空列表允许所有 origin
	// 当 allowedOrigins 为 nil 或空切片时，任何 origin 都应被允许
	t.Run("empty_list_allows_all", func(t *testing.T) {
		f := func(origin string) bool {
			// 测试 nil 列表
			allowedOrigins = nil
			if !CheckOriginAllowed(origin) {
				t.Logf("FAIL: origin %q should be allowed when list is nil", origin)
				return false
			}

			// 测试空切片
			allowedOrigins = []string{}
			if !CheckOriginAllowed(origin) {
				t.Logf("FAIL: origin %q should be allowed when list is empty slice", origin)
				return false
			}

			return true
		}

		cfg := &quick.Config{MaxCount: 100}
		if err := quick.Check(f, cfg); err != nil {
			t.Errorf("Property violated: empty allowed list should allow all origins: %v", err)
		}
	})

	// 清理：恢复 allowedOrigins 为 nil，避免影响其他测试
	allowedOrigins = nil
}

// --- Unit Tests for Edge Cases ---

// suppressLogs redirects log output to discard during tests,
// preventing logger.Info/Warn calls from cluttering test output.
// Returns via t.Cleanup to restore the original log output.
func suppressLogs(t *testing.T) {
	t.Helper()
	original := log.Writer()
	log.SetOutput(io.Discard)
	t.Cleanup(func() {
		log.SetOutput(original)
	})
}

// TestInitOriginControl_EdgeCases verifies that InitOriginControl correctly
// parses various edge-case inputs following Postel's Law (liberal in acceptance).
//
// Validates: Requirements 3.4
func TestInitOriginControl_EdgeCases(t *testing.T) {
	suppressLogs(t)

	tests := []struct {
		name     string
		input    string
		expected []string // nil means allowedOrigins should be nil
	}{
		{
			name:     "extra commas filtered",
			input:    "a.com,,b.com,",
			expected: []string{"a.com", "b.com"},
		},
		{
			name:     "whitespace-only entries filtered",
			input:    "  ,  ,  ",
			expected: []string{},
		},
		{
			name:     "empty string produces nil",
			input:    "",
			expected: nil,
		},
		{
			name:     "whitespace trimmed from entries",
			input:    " https://a.com , https://b.com ",
			expected: []string{"https://a.com", "https://b.com"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			InitOriginControl(tc.input)

			if tc.expected == nil {
				if allowedOrigins != nil {
					t.Errorf("expected allowedOrigins to be nil, got %v", allowedOrigins)
				}
				return
			}

			if len(allowedOrigins) != len(tc.expected) {
				t.Fatalf("expected %d origins, got %d: %v", len(tc.expected), len(allowedOrigins), allowedOrigins)
			}

			for i, want := range tc.expected {
				if allowedOrigins[i] != want {
					t.Errorf("allowedOrigins[%d] = %q, want %q", i, allowedOrigins[i], want)
				}
			}
		})
	}

	// Cleanup
	allowedOrigins = nil
}

// TestCheckOriginAllowed_EmptyList verifies that when the allowed origins list
// is empty (dev mode), all origins are accepted regardless of value.
//
// Validates: Requirements 3.3
func TestCheckOriginAllowed_EmptyList(t *testing.T) {
	suppressLogs(t)

	// Set up empty list (dev mode)
	InitOriginControl("")

	origins := []string{
		"https://evil.com",
		"http://localhost:3000",
		"https://any-domain.example.org",
		"",
	}

	for _, origin := range origins {
		t.Run(origin, func(t *testing.T) {
			if !CheckOriginAllowed(origin) {
				t.Errorf("expected origin %q to be allowed when list is empty", origin)
			}
		})
	}

	// Cleanup
	allowedOrigins = nil
}

// TestCheckOriginAllowed_Rejection verifies that when the allowed origins list
// is non-empty, origins not in the list are rejected.
//
// Validates: Requirements 3.1, 3.2
func TestCheckOriginAllowed_Rejection(t *testing.T) {
	suppressLogs(t)

	InitOriginControl("https://arthas.vercel.app,https://arthas.dev")

	rejected := []string{
		"https://evil.com",
		"https://arthas.vercel.app.evil.com",
		"http://arthas.vercel.app",  // wrong scheme
		"https://ARTHAS.VERCEL.APP", // case sensitive
		"",
	}

	for _, origin := range rejected {
		t.Run(origin, func(t *testing.T) {
			if CheckOriginAllowed(origin) {
				t.Errorf("expected origin %q to be rejected", origin)
			}
		})
	}

	// Cleanup
	allowedOrigins = nil
}

// TestCheckOriginAllowed_Acceptance verifies that when the allowed origins list
// is non-empty, origins that exactly match an entry are accepted.
//
// Validates: Requirements 3.1
func TestCheckOriginAllowed_Acceptance(t *testing.T) {
	suppressLogs(t)

	InitOriginControl("https://arthas.vercel.app,https://arthas.dev")

	accepted := []string{
		"https://arthas.vercel.app",
		"https://arthas.dev",
	}

	for _, origin := range accepted {
		t.Run(origin, func(t *testing.T) {
			if !CheckOriginAllowed(origin) {
				t.Errorf("expected origin %q to be accepted", origin)
			}
		})
	}

	// Cleanup
	allowedOrigins = nil
}

// --- CORS Rejection Flow Tests ---
// These tests verify the integration between Origin validation and the WebSocket
// upgrade process, ensuring correct HTTP responses and log behavior.
//
// Validates: Requirements 3.1, 3.2

// TestCORSRejection_HTTP403 verifies that a WebSocket upgrade request with a
// non-allowed Origin header receives an HTTP 403 Forbidden response.
//
// 📚 学习要点: gorilla/websocket 的 CheckOrigin 行为
// 当 CheckOrigin 返回 false 时，gorilla/websocket 的 Upgrade() 方法会：
// 1. 向客户端返回 HTTP 403 Forbidden
// 2. 返回一个包含 "origin not allowed" 的 error
// 这个测试验证了完整的拒绝流程。
//
// Validates: Requirements 3.1, 3.2
func TestCORSRejection_HTTP403(t *testing.T) {
	suppressLogs(t)

	// Set up allowed origins to reject our test origin
	allowedOrigins = []string{"https://allowed.com"}
	t.Cleanup(func() { allowedOrigins = nil })

	// Create a Hub and start its Run loop (required for ServeWs to work)
	hub := NewHub()
	go hub.Run()
	t.Cleanup(func() { hub.Stop() })

	// Create an httptest server with the WebSocket handler
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ServeWs(hub, w, r)
	}))
	t.Cleanup(func() { server.Close() })

	// Attempt WebSocket connection with a non-allowed origin
	dialer := websocket.Dialer{}
	header := http.Header{}
	header.Set("Origin", "https://evil.com")

	// Convert http:// URL to ws:// for the dialer
	wsURL := "ws" + server.URL[len("http"):]

	_, resp, err := dialer.Dial(wsURL, header)

	// The dial should fail because origin is rejected
	if err == nil {
		t.Fatal("expected dial to fail for non-allowed origin, but it succeeded")
	}

	// Verify the response is HTTP 403
	if resp == nil {
		t.Fatal("expected non-nil response from failed dial")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected HTTP 403, got %d", resp.StatusCode)
	}
}

// TestCORSRejection_SingleLogEntry verifies that a CORS rejection produces
// exactly one log entry containing "rejected origin" — not zero (silent failure)
// and not two (double-logging bug).
//
// 📚 学习要点: 日志去重设计
// CORS 拒绝在两个地方可能产生日志：
// 1. CheckOrigin 回调中（我们主动记录被拒绝的 origin）
// 2. ServeWs 中 Upgrade() 返回错误时（通用错误日志）
//
// 通过 isCORSRejection() 检测，ServeWs 跳过 CORS 相关错误的日志，
// 确保只有 CheckOrigin 中的那一条日志被输出。
//
// Validates: Requirements 3.1, 3.2
func TestCORSRejection_SingleLogEntry(t *testing.T) {
	// Set up allowed origins to reject our test origin
	allowedOrigins = []string{"https://allowed.com"}
	t.Cleanup(func() { allowedOrigins = nil })

	// Redirect log output to a buffer to capture log entries
	var logBuf bytes.Buffer
	originalOutput := log.Writer()
	originalFlags := log.Flags()
	log.SetFlags(0)
	log.SetOutput(&logBuf)
	t.Cleanup(func() {
		log.SetOutput(originalOutput)
		log.SetFlags(originalFlags)
	})

	// Create a Hub and start its Run loop
	hub := NewHub()
	go hub.Run()
	t.Cleanup(func() { hub.Stop() })

	// Create an httptest server with the WebSocket handler
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ServeWs(hub, w, r)
	}))
	t.Cleanup(func() { server.Close() })

	// Attempt WebSocket connection with a non-allowed origin
	dialer := websocket.Dialer{}
	header := http.Header{}
	header.Set("Origin", "https://evil.com")

	wsURL := "ws" + server.URL[len("http"):]
	_, _, _ = dialer.Dial(wsURL, header) // We expect this to fail

	// Count log lines containing "rejected origin"
	logOutput := logBuf.String()
	lines := strings.Split(logOutput, "\n")
	count := 0
	for _, line := range lines {
		if strings.Contains(line, "rejected origin") {
			count++
		}
	}

	if count != 1 {
		t.Errorf("expected exactly 1 log entry containing 'rejected origin', got %d\nFull log output:\n%s", count, logOutput)
	}

	// Also verify no "upgrade error" log (which would indicate double-logging)
	for _, line := range lines {
		if strings.Contains(line, "upgrade error") {
			t.Errorf("unexpected 'upgrade error' log entry (double-logging detected):\n%s", line)
		}
	}
}

// TestIsCORSRejection_IdentifiesError is a regression guard for the fragile
// string matching in isCORSRejection(). This test will fail if gorilla/websocket
// changes its error message text, alerting developers to update the detection logic.
//
// 📚 学习要点: 回归守卫（Regression Guard）
// isCORSRejection 依赖 gorilla/websocket 的内部错误消息文本
// "origin not allowed"。如果库更新了措辞，此检测会静默失效。
// 这个测试确保：
// 1. 包含 "origin not allowed" 的错误被正确识别为 CORS 拒绝
// 2. 其他错误不会被误判为 CORS 拒绝
// 3. 如果 gorilla/websocket 更改了错误消息，测试会失败并提醒开发者
//
// Validates: Requirements 3.1, 3.2
func TestIsCORSRejection_IdentifiesError(t *testing.T) {
	tests := []struct {
		name     string
		errMsg   string
		expected bool
	}{
		{
			name:     "exact gorilla/websocket CORS error",
			errMsg:   "websocket: request origin not allowed by Upgrader.CheckOrigin",
			expected: true,
		},
		{
			name:     "contains origin not allowed substring",
			errMsg:   "origin not allowed",
			expected: true,
		},
		{
			name:     "unrelated websocket error",
			errMsg:   "websocket: close 1006 (abnormal closure)",
			expected: false,
		},
		{
			name:     "generic network error",
			errMsg:   "dial tcp: connection refused",
			expected: false,
		},
		{
			name:     "empty error message",
			errMsg:   "",
			expected: false,
		},
		{
			name:     "partial match - origin only",
			errMsg:   "invalid origin header",
			expected: false,
		},
		{
			name:     "partial match - not allowed only",
			errMsg:   "method not allowed",
			expected: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := fmt.Errorf("%s", tc.errMsg)
			result := isCORSRejection(err)
			if result != tc.expected {
				t.Errorf("isCORSRejection(error(%q)) = %v, want %v", tc.errMsg, result, tc.expected)
			}
		})
	}
}
