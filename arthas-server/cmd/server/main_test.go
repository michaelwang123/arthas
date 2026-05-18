// Package main 的测试文件，验证服务器入口点的核心行为。
//
// 📚 学习要点: 测试 main 包的策略
// main 包中的 main() 函数通常难以直接测试（调用 os.Exit、启动服务器等）。
// 解决方案：
// 1. 将可测试逻辑提取为独立函数（resolvePort、resolveOrigins）→ 直接单元测试
// 2. 对于 --version 等需要进程退出的行为 → 使用 os/exec 启动子进程测试
// 3. 对于 HTTP handler → 使用 httptest 包模拟请求
package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/arthas/arthas-server/internal/logger"
)

// ═══════════════════════════════════════════════════════════════════════════════
// /ping 健康检查端点测试
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// --version flag 测试
// ═══════════════════════════════════════════════════════════════════════════════

// TestVersionFlag_OutputsVersionAndExits verifies that running the binary with
// --version prints the version string to stdout and exits with code 0.
//
// 📚 学习要点: 测试 os.Exit 行为
// main() 中的 --version 逻辑调用 os.Exit(0)，无法在同一进程中测试。
// 解决方案：使用 os/exec 启动子进程运行编译后的二进制文件。
// 步骤：
// 1. `go build` 编译当前包为临时二进制
// 2. 使用 exec.Command 运行该二进制并传入 --version
// 3. 检查 stdout 输出和退出码
//
// 注意：这是集成测试风格（需要编译），但对于测试 CLI 行为是最可靠的方式。
//
// Validates: Requirements 2.7
func TestVersionFlag_OutputsVersionAndExits(t *testing.T) {
	// 📚 学习要点: t.TempDir() 自动清理
	// t.TempDir() 创建一个临时目录，测试结束后自动删除。
	// 比手动 os.MkdirTemp + defer os.RemoveAll 更简洁安全。
	tmpDir := t.TempDir()
	binaryName := "test-server"
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	binaryPath := filepath.Join(tmpDir, binaryName)

	// Build the binary with a known version
	buildCmd := exec.Command("go", "build", "-tags", "dev",
		"-ldflags", "-X main.Version=v1.2.3-test",
		"-o", binaryPath, "./cmd/server")
	buildCmd.Dir = findModuleRoot(t)
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to build binary: %v\n%s", err, output)
	}

	// Run with --version flag
	cmd := exec.Command(binaryPath, "--version")
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	err := cmd.Run()

	// Verify exit code 0
	if err != nil {
		t.Fatalf("--version exited with error: %v", err)
	}

	// Verify output contains the injected version
	output := strings.TrimSpace(stdout.String())
	if output != "v1.2.3-test" {
		t.Errorf("expected version output %q, got %q", "v1.2.3-test", output)
	}
}

// TestVersionFlag_DefaultDevVersion verifies that without ldflags injection,
// the version defaults to "dev".
//
// Validates: Requirements 2.7
func TestVersionFlag_DefaultDevVersion(t *testing.T) {
	tmpDir := t.TempDir()
	binaryName := "test-server"
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	binaryPath := filepath.Join(tmpDir, binaryName)

	// Build without ldflags — Version should be "dev"
	buildCmd := exec.Command("go", "build", "-tags", "dev",
		"-o", binaryPath, "./cmd/server")
	buildCmd.Dir = findModuleRoot(t)
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("failed to build binary: %v\n%s", err, output)
	}

	cmd := exec.Command(binaryPath, "--version")
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	err := cmd.Run()

	if err != nil {
		t.Fatalf("--version exited with error: %v", err)
	}

	output := strings.TrimSpace(stdout.String())
	if output != "dev" {
		t.Errorf("expected default version %q, got %q", "dev", output)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 端口解析优先级测试
// ═══════════════════════════════════════════════════════════════════════════════

// TestResolvePort_FlagTakesHighestPriority verifies that when --port flag is set,
// it takes precedence over both environment variable and default value.
//
// 📚 学习要点: 表驱动测试（Table-Driven Tests）
// Go 社区推荐使用表驱动测试来覆盖多种输入组合。
// 优势：
// - 新增测试用例只需添加一行数据
// - 测试逻辑不重复（DRY）
// - 失败时 t.Run 的子测试名清晰标识哪个用例失败
//
// Validates: Requirements 2.7
func TestResolvePort_FlagTakesHighestPriority(t *testing.T) {
	tests := []struct {
		name       string
		flagVal    int
		envVal     string
		defaultVal string
		want       string
	}{
		{
			name:       "flag set, env set — flag wins",
			flagVal:    9090,
			envVal:     "3000",
			defaultVal: "8080",
			want:       "9090",
		},
		{
			name:       "flag set, env empty — flag wins",
			flagVal:    4000,
			envVal:     "",
			defaultVal: "8080",
			want:       "4000",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolvePort(tt.flagVal, tt.envVal, tt.defaultVal)
			if got != tt.want {
				t.Errorf("resolvePort(%d, %q, %q) = %q, want %q",
					tt.flagVal, tt.envVal, tt.defaultVal, got, tt.want)
			}
		})
	}
}

// TestResolvePort_EnvTakesPriorityOverDefault verifies that when --port flag
// is not set (0), the environment variable takes precedence over the default.
//
// Validates: Requirements 2.7
func TestResolvePort_EnvTakesPriorityOverDefault(t *testing.T) {
	got := resolvePort(0, "3000", "8080")
	if got != "3000" {
		t.Errorf("resolvePort(0, \"3000\", \"8080\") = %q, want %q", got, "3000")
	}
}

// TestResolvePort_DefaultUsedWhenNothingSet verifies that when neither flag
// nor environment variable is set, the default value is used.
//
// Validates: Requirements 2.7
func TestResolvePort_DefaultUsedWhenNothingSet(t *testing.T) {
	got := resolvePort(0, "", "8080")
	if got != "8080" {
		t.Errorf("resolvePort(0, \"\", \"8080\") = %q, want %q", got, "8080")
	}
}

// TestResolvePort_FullPriorityChain is a comprehensive table-driven test
// covering all combinations of the three-tier priority: flag > env > default.
//
// 📚 学习要点: 完整优先级链测试
// 对于 N 层优先级，需要测试 2^N - 1 种有意义的组合（排除全部未设置的情况）。
// 三层优先级有 7 种组合，但最重要的是验证：
// 1. 最高优先级覆盖所有低优先级
// 2. 中间优先级覆盖最低优先级
// 3. 最低优先级在其他都未设置时生效
//
// Validates: Requirements 2.7
func TestResolvePort_FullPriorityChain(t *testing.T) {
	tests := []struct {
		name       string
		flagVal    int
		envVal     string
		defaultVal string
		want       string
	}{
		// Flag set — always wins regardless of env/default
		{"flag=9090 env=3000 default=8080", 9090, "3000", "8080", "9090"},
		{"flag=9090 env='' default=8080", 9090, "", "8080", "9090"},

		// Flag unset, env set — env wins over default
		{"flag=0 env=3000 default=8080", 0, "3000", "8080", "3000"},
		{"flag=0 env=7860 default=8080", 0, "7860", "8080", "7860"},

		// Both flag and env unset — default wins
		{"flag=0 env='' default=8080", 0, "", "8080", "8080"},
		{"flag=0 env='' default=9999", 0, "", "9999", "9999"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolvePort(tt.flagVal, tt.envVal, tt.defaultVal)
			if got != tt.want {
				t.Errorf("resolvePort(%d, %q, %q) = %q, want %q",
					tt.flagVal, tt.envVal, tt.defaultVal, got, tt.want)
			}
		})
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Origins 解析优先级测试
// ═══════════════════════════════════════════════════════════════════════════════

// TestResolveOrigins_FlagTakesHighestPriority verifies that when --allowed-origins
// flag is set, it takes precedence over both environment variable and default.
//
// Validates: Requirements 2.7
func TestResolveOrigins_FlagTakesHighestPriority(t *testing.T) {
	tests := []struct {
		name       string
		flagVal    string
		envVal     string
		defaultVal string
		want       string
	}{
		{
			name:       "flag set, env set — flag wins",
			flagVal:    "https://my-domain.com",
			envVal:     "https://env-domain.com",
			defaultVal: "",
			want:       "https://my-domain.com",
		},
		{
			name:       "flag set, env empty — flag wins",
			flagVal:    "https://flag-only.com",
			envVal:     "",
			defaultVal: "",
			want:       "https://flag-only.com",
		},
		{
			name:       "flag set with wildcard — flag wins",
			flagVal:    "*",
			envVal:     "https://restricted.com",
			defaultVal: "",
			want:       "*",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveOrigins(tt.flagVal, tt.envVal, tt.defaultVal)
			if got != tt.want {
				t.Errorf("resolveOrigins(%q, %q, %q) = %q, want %q",
					tt.flagVal, tt.envVal, tt.defaultVal, got, tt.want)
			}
		})
	}
}

// TestResolveOrigins_EnvTakesPriorityOverDefault verifies that when flag is
// not set, the environment variable takes precedence over the default.
//
// Validates: Requirements 2.7
func TestResolveOrigins_EnvTakesPriorityOverDefault(t *testing.T) {
	got := resolveOrigins("", "https://env-domain.com", "")
	if got != "https://env-domain.com" {
		t.Errorf("resolveOrigins(\"\", \"https://env-domain.com\", \"\") = %q, want %q",
			got, "https://env-domain.com")
	}
}

// TestResolveOrigins_DefaultUsedWhenNothingSet verifies that when neither flag
// nor environment variable is set, the default value is used.
//
// Validates: Requirements 2.7
func TestResolveOrigins_DefaultUsedWhenNothingSet(t *testing.T) {
	got := resolveOrigins("", "", "")
	if got != "" {
		t.Errorf("resolveOrigins(\"\", \"\", \"\") = %q, want %q", got, "")
	}
}

// TestResolveOrigins_FullPriorityChain is a comprehensive table-driven test
// covering all combinations of the three-tier priority for origins.
//
// 📚 学习要点: Origins 的典型配置场景
// - Tier 1 单二进制本地使用：默认空字符串（允许所有来源）
// - Tier 2 Docker 生产部署：环境变量设为 "https://{DOMAIN}"
// - CLI 快速测试：--allowed-origins "*" 覆盖一切
//
// Validates: Requirements 2.7
func TestResolveOrigins_FullPriorityChain(t *testing.T) {
	tests := []struct {
		name       string
		flagVal    string
		envVal     string
		defaultVal string
		want       string
	}{
		// Flag set — always wins
		{"flag=https://a.com env=https://b.com default=''", "https://a.com", "https://b.com", "", "https://a.com"},
		{"flag=* env=https://b.com default=''", "*", "https://b.com", "", "*"},
		{"flag=https://a.com env='' default=''", "https://a.com", "", "", "https://a.com"},

		// Flag unset, env set — env wins
		{"flag='' env=https://b.com default=''", "", "https://b.com", "", "https://b.com"},
		{"flag='' env=* default=''", "", "*", "", "*"},

		// Both unset — default wins
		{"flag='' env='' default=''", "", "", "", ""},
		{"flag='' env='' default=*", "", "", "*", "*"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveOrigins(tt.flagVal, tt.envVal, tt.defaultVal)
			if got != tt.want {
				t.Errorf("resolveOrigins(%q, %q, %q) = %q, want %q",
					tt.flagVal, tt.envVal, tt.defaultVal, got, tt.want)
			}
		})
	}
}

// TestResolveOrigins_MultipleOrigins verifies that comma-separated origins
// are passed through correctly (the function doesn't parse them, just passes
// the string to InitOriginControl which handles splitting).
//
// Validates: Requirements 2.7
func TestResolveOrigins_MultipleOrigins(t *testing.T) {
	multiOrigins := "https://a.com,https://b.com,https://c.com"
	got := resolveOrigins(multiOrigins, "https://env.com", "")
	if got != multiOrigins {
		t.Errorf("expected multi-origin string to pass through, got %q", got)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 启动日志测试
// ═══════════════════════════════════════════════════════════════════════════════

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

// TestPortDefault verifies that when the PORT environment variable is unset,
// the server defaults to port "8080".
// This matches the logic in main(): resolvePort(0, os.Getenv("PORT"), "8080")
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

	// Use the same resolution logic as main.go
	port := resolvePort(0, os.Getenv("PORT"), "8080")

	if port != "8080" {
		t.Errorf("expected default port %q, got %q", "8080", port)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════════════════════

// findModuleRoot 定位 Go 模块根目录（包含 go.mod 的目录）。
//
// 📚 学习要点: 测试中定位项目根目录
// 当测试需要编译二进制文件时，必须从模块根目录执行 `go build`。
// 由于测试的工作目录是测试文件所在目录（cmd/server/），
// 需要向上遍历找到包含 go.mod 的目录。
func findModuleRoot(t *testing.T) string {
	t.Helper()

	// 测试文件在 cmd/server/ 目录下，模块根在两级之上
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to get working directory: %v", err)
	}

	// 向上查找 go.mod
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("could not find go.mod in any parent directory")
		}
		dir = parent
	}
}
