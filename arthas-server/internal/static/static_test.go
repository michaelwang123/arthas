// 📚 学习要点: 属性测试（Property-Based Testing）
// 传统单元测试验证特定输入的输出是否正确（example-based）。
// 属性测试则验证一个"性质"对所有可能的输入都成立。
// Go 标准库 testing/quick 提供了基础的属性测试支持：
// - 自动生成随机输入（通过 Generate 接口自定义）
// - 运行多次迭代验证性质是否恒成立
// - 失败时报告导致失败的具体输入（反例）
//
// 📚 学习要点: 为什么用属性测试验证静态文件服务？
// 静态文件服务的正确性是一个"对所有文件都必须成立"的性质：
// - 嵌入文件系统中的任何文件，通过 HTTP GET 都能正确返回
// - 返回的内容必须与原始文件内容完全一致
// - Content-Type 必须与文件扩展名匹配
// - HTTP 状态码必须为 200

//go:build !dev

package static

import (
	"io"
	"io/fs"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"testing/quick"
)

// knownFiles 枚举嵌入文件系统中的所有文件路径。
// 📚 学习要点: 为什么要枚举文件？
// testing/quick 生成随机输入，但我们需要从已知文件集中选择。
// 通过 fs.WalkDir 遍历嵌入的 distFS，收集所有文件路径，
// 然后在属性函数中随机选择一个路径进行测试。
func knownFiles(t *testing.T) []string {
	t.Helper()
	subFS, err := fs.Sub(distFS, "dist")
	if err != nil {
		t.Fatalf("failed to create sub filesystem: %v", err)
	}

	var files []string
	err = fs.WalkDir(subFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("failed to walk embedded filesystem: %v", err)
	}
	return files
}

// fileToRequestPath 将嵌入文件路径转换为 HTTP 请求路径。
// 📚 学习要点: Go http.FileServer 的 index.html 重定向行为
// http.FileServer 会将 /index.html 请求 301 重定向到 /（目录路径）。
// 这是 Go 标准库的设计决策：目录的默认文件通过目录路径访问。
// 因此 "index.html" 的正确请求路径是 "/"，
// "subdir/index.html" 的正确请求路径是 "/subdir/"。
func fileToRequestPath(filePath string) string {
	if filePath == "index.html" {
		return "/"
	}
	if strings.HasSuffix(filePath, "/index.html") {
		return "/" + strings.TrimSuffix(filePath, "index.html")
	}
	return "/" + filePath
}

// expectedContentType 根据文件扩展名返回预期的 Content-Type 前缀。
// 📚 学习要点: MIME 类型推断
// Go 的 http.FileServer 使用 mime.TypeByExtension 推断 Content-Type。
// 不同操作系统的 MIME 数据库可能略有差异，因此我们只验证前缀匹配。
// 例如 "text/html" 可能返回 "text/html; charset=utf-8"。
func expectedContentType(path string) string {
	switch {
	case strings.HasSuffix(path, ".html"):
		return "text/html"
	case strings.HasSuffix(path, ".js"):
		return "text/javascript"
	case strings.HasSuffix(path, ".css"):
		return "text/css"
	case strings.HasSuffix(path, ".json"):
		return "application/json"
	case strings.HasSuffix(path, ".png"):
		return "image/png"
	case strings.HasSuffix(path, ".svg"):
		return "image/svg+xml"
	default:
		return "application/octet-stream"
	}
}

// TestProperty1_StaticFileServingCorrectness 验证静态文件服务的正确性属性。
//
// **Validates: Requirements 2 AC2**
//
// 性质定义：
// 对于嵌入 dist/ 文件系统中的任何文件 F（路径为 P），
// GET 请求该文件的正确路径时，SHALL 返回：
//   - HTTP 200 状态码
//   - 正确的 Content-Type（由文件扩展名决定）
//   - 与原始文件内容完全一致的响应体
//
// 📚 学习要点: Property-Based Testing 与 HTTP 测试结合
// 我们使用 httptest.NewRecorder 和 httptest.NewRequest 创建模拟 HTTP 环境，
// 无需启动真实服务器即可测试 Handler 的行为。
// testing/quick 会生成随机的 seed 值，
// 我们将其映射到已知文件列表中的某个文件进行验证。
func TestProperty1_StaticFileServingCorrectness(t *testing.T) {
	handler := Handler()
	files := knownFiles(t)

	if len(files) == 0 {
		t.Fatal("no files found in embedded filesystem")
	}

	// 📚 学习要点: 属性函数的设计
	// testing/quick 的属性函数接收随机生成的参数并返回 bool。
	// 我们使用随机 seed 从已知文件列表中选择，模拟"对任意文件"的属性验证。
	// 虽然嵌入的测试夹具只有 2 个文件，但属性测试框架会多次调用（100 次），
	// 确保每个文件都被充分测试，且测试逻辑对任意数量的文件都成立。
	property := func(seed int64) bool {
		// 使用 seed 从已知文件中随机选择一个
		rng := rand.New(rand.NewSource(seed))
		idx := rng.Intn(len(files))
		filePath := files[idx]

		// 将文件路径转换为 HTTP 请求路径
		requestPath := fileToRequestPath(filePath)

		// 创建 HTTP 请求和响应记录器
		req := httptest.NewRequest(http.MethodGet, requestPath, nil)
		rec := httptest.NewRecorder()

		// 调用 Handler 处理请求
		handler.ServeHTTP(rec, req)

		// 验证 1: HTTP 状态码必须为 200
		if rec.Code != http.StatusOK {
			t.Logf("FAIL: GET %s (file: %s) returned status %d, want 200",
				requestPath, filePath, rec.Code)
			return false
		}

		// 验证 2: Content-Type 必须与文件扩展名匹配
		contentType := rec.Header().Get("Content-Type")
		expected := expectedContentType(filePath)
		if !strings.HasPrefix(contentType, expected) {
			t.Logf("FAIL: GET %s Content-Type = %q, want prefix %q",
				requestPath, contentType, expected)
			return false
		}

		// 验证 3: 响应体内容必须与嵌入文件内容一致
		subFS, _ := fs.Sub(distFS, "dist")
		f, err := subFS.Open(filePath)
		if err != nil {
			t.Logf("FAIL: cannot open embedded file %q: %v", filePath, err)
			return false
		}
		defer f.Close()

		expectedContent, err := io.ReadAll(f)
		if err != nil {
			t.Logf("FAIL: cannot read embedded file %q: %v", filePath, err)
			return false
		}

		actualContent := rec.Body.String()
		if actualContent != string(expectedContent) {
			t.Logf("FAIL: GET %s body mismatch (got %d bytes, want %d bytes)",
				requestPath, len(actualContent), len(expectedContent))
			return false
		}

		return true
	}

	// 📚 学习要点: MaxCount 配置
	// MaxCount: 100 表示 testing/quick 会调用属性函数 100 次。
	// 每次使用不同的随机 seed，从而选择不同的文件进行验证。
	// 这与项目中其他属性测试（如 origin_test.go）保持一致。
	cfg := &quick.Config{MaxCount: 100}
	if err := quick.Check(property, cfg); err != nil {
		t.Errorf("Property violated: static file serving correctness: %v", err)
	}
}

// --- 以下为辅助工具函数和路径生成器（供其他属性测试使用） ---

// 📚 学习要点: 测试用的字符集和路径生成
// 为了生成合法的 URL 路径段，我们限制字符集为 URL 安全字符。
// 这避免了生成无效 URL 导致的误报（false positive）。
var pathSafeChars = []byte("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")

// fileExtensions 是常见的前端资源文件扩展名。
// 用于生成逼真的 /assets/ 路径（如 /assets/app.js, /assets/style.css）。
var fileExtensions = []string{".js", ".css", ".woff2", ".png", ".svg", ".map", ".json"}

// generateAssetPath 生成一个随机的 /assets/ 路径。
// 📚 学习要点: 智能生成器（Smart Generator）
// 属性测试的关键是生成器的质量。好的生成器应该：
// 1. 覆盖输入空间的各种情况（短名、长名、不同扩展名）
// 2. 只生成合法输入（避免无效 URL 字符）
// 3. 包含边界情况（单字符文件名、深层嵌套路径）
func generateAssetPath(r *rand.Rand) string {
	// 生成 1-20 个字符的文件名
	nameLen := r.Intn(20) + 1
	name := make([]byte, nameLen)
	for i := range name {
		name[i] = pathSafeChars[r.Intn(len(pathSafeChars))]
	}

	// 随机选择扩展名
	ext := fileExtensions[r.Intn(len(fileExtensions))]

	return "/assets/" + string(name) + ext
}

// generateSPAPath 生成一个不匹配任何静态文件的路径（触发 SPA fallback）。
// 📚 学习要点: SPA Fallback 触发条件
// 当请求路径不对应 dist/ 中的任何真实文件时，服务器返回 index.html。
// 我们通过生成 /room/xxx、/settings/xxx 等路径来模拟前端路由。
func generateSPAPath(r *rand.Rand) string {
	prefixes := []string{"/room/", "/settings/", "/about/", "/user/", "/chat/", "/invite/"}
	prefix := prefixes[r.Intn(len(prefixes))]

	// 生成 1-15 个字符的路径段
	segLen := r.Intn(15) + 1
	seg := make([]byte, segLen)
	for i := range seg {
		seg[i] = pathSafeChars[r.Intn(len(pathSafeChars))]
	}

	return prefix + string(seg)
}

// containsIndexHTML 检查响应体是否包含 index.html 的特征内容。
// 📚 学习要点: 启发式检测 SPA Fallback
// 我们通过检查响应体是否包含 <div id="root"> 或 DOCTYPE 来判断是否返回了 index.html。
// 这比检查 Content-Type 更可靠，因为 Content-Type 可能因文件扩展名推断而变化。
func containsIndexHTML(body string) bool {
	return len(body) > 0 && (strings.Contains(body, "<div id=\"root\">") || strings.Contains(body, "<!DOCTYPE html>"))
}

// ============================================================================
// Property 2: SPA Fallback Correctness
// ============================================================================

// 📚 学习要点: SPA Fallback 属性测试的设计
// SPA（单页应用）fallback 是现代 Web 应用部署的核心需求。
// 客户端路由（如 React Router）使用 URL 路径表示应用状态，
// 但这些路径在服务器上没有对应的物理文件。
// 服务器必须对所有未知路径返回 index.html，让前端路由器处理。
//
// 这个属性测试验证：对于任意不匹配静态文件的路径，
// 服务器都正确返回 index.html + text/html + no-cache。
// 通过随机生成路径，我们能发现手写测试遗漏的边界情况。

// spaFallbackPath 是一个自定义类型，用于生成不匹配静态文件的 URL 路径。
// 📚 学习要点: testing/quick 的 Generate 接口
// testing/quick 对实现了 quick.Generator 接口的类型会调用其 Generate 方法，
// 而不是使用默认的随机值生成。这让我们可以控制生成的值满足测试前置条件：
// - 路径不匹配 dist/ 中的任何文件
// - 路径不是 /ws 或 /ping（这些由其他路由处理）
type spaFallbackPath struct {
	Path string
}

// spaPathSegments 是用于生成随机 URL 路径段的候选列表。
// 这些模拟了真实 SPA 应用中的客户端路由路径模式。
var spaPathSegments = []string{
	"room", "chat", "settings", "profile", "about",
	"login", "register", "dashboard", "admin", "help",
	"users", "messages", "notifications", "search",
	"abc123", "xyz789", "test-room", "my-chat",
	"deep", "nested", "path", "segment", "invite",
	"join", "create", "edit", "delete", "view",
}

// knownStaticFiles 是嵌入的 dist/ 中已知存在的文件路径。
// 生成器必须排除这些路径，因为它们会被直接服务而非触发 SPA fallback。
var knownStaticFiles = map[string]bool{
	"/index.html":    true,
	"/assets/app.js": true,
}

// Generate 实现 quick.Generator 接口，生成不匹配静态文件的随机 URL 路径。
// 📚 学习要点: 智能生成器的约束策略
// 生成器通过以下方式确保生成的路径会触发 SPA fallback：
// 1. 使用已知不存在于 dist/ 中的路径段组合
// 2. 显式排除已知静态文件路径（/index.html, /assets/app.js）
// 3. 排除特殊端点（/ws, /ping）
// 4. 生成 1-4 段深度的路径，覆盖浅层和深层路由
func (s spaFallbackPath) Generate(rand *rand.Rand, size int) reflect.Value {
	for {
		// 生成 1-4 段的随机路径
		numSegments := rand.Intn(4) + 1
		segments := make([]string, numSegments)
		for i := range segments {
			segments[i] = spaPathSegments[rand.Intn(len(spaPathSegments))]
		}
		path := "/" + strings.Join(segments, "/")

		// 排除已知静态文件路径和特殊端点
		if !knownStaticFiles[path] && path != "/ws" && path != "/ping" {
			return reflect.ValueOf(spaFallbackPath{Path: path})
		}
	}
}

// TestProperty2_SPAFallbackCorrectness 验证 SPA fallback 的正确性属性。
//
// **Validates: Requirements 2 AC3**
//
// 属性定义：对于任何不匹配嵌入 dist/ 文件系统中文件的 URL 路径 P，
// 且 P 不是 /ws 或 /ping，GET /{P} 应返回：
//   - 响应体 = index.html 的内容
//   - Content-Type 包含 text/html
//   - Cache-Control = no-cache
//
// 📚 学习要点: 属性测试 vs 示例测试
// 示例测试：GET /room/abc123 → 返回 index.html ✓
// 属性测试：对于任意路径 P（满足前置条件）→ 返回 index.html ✓
// 属性测试的优势在于覆盖面：100 次随机迭代能探索到手写测试想不到的路径组合。
// 例如：/deep/nested/path/segment 这样的多层路径是否也能正确 fallback？
func TestProperty2_SPAFallbackCorrectness(t *testing.T) {
	handler := Handler()

	// 获取 index.html 的预期内容作为比较基准
	indexContent := getExpectedIndexHTML(t, handler)

	// 📚 学习要点: testing/quick.Config.MaxCount
	// MaxCount: 100 表示生成 100 个随机路径进行验证。
	// 这是性能和覆盖率的平衡：
	// - 100 次足以发现大多数系统性错误（如路径解析 bug）
	// - 运行时间通常 < 1 秒，适合 CI 环境
	// - 如果需要更高置信度，可增加到 1000+（但会变慢）
	config := &quick.Config{MaxCount: 100}

	property := func(input spaFallbackPath) bool {
		path := input.Path

		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		// 验证 1: 响应体应与 index.html 内容一致
		// 📚 学习要点: 为什么比较完整内容而非仅检查特征字符串？
		// 完整内容比较确保服务器返回的是完整的 index.html，
		// 而非截断、损坏或错误的文件。这是最严格的正确性验证。
		body := rec.Body.String()
		if body != indexContent {
			t.Logf("FAIL path=%q: body mismatch (got %d bytes, want %d bytes)",
				path, len(body), len(indexContent))
			return false
		}

		// 验证 2: Content-Type 应包含 text/html
		// 📚 学习要点: 为什么用 Contains 而非精确匹配？
		// Go 的 http.FileServer 返回的 Content-Type 可能包含 charset 参数，
		// 如 "text/html; charset=utf-8"。使用 Contains 确保兼容性。
		contentType := rec.Header().Get("Content-Type")
		if !strings.Contains(contentType, "text/html") {
			t.Logf("FAIL path=%q: Content-Type=%q, want contains 'text/html'",
				path, contentType)
			return false
		}

		// 验证 3: Cache-Control 应为 no-cache
		// 📚 学习要点: 为什么 SPA fallback 必须 no-cache？
		// index.html 是 SPA 的入口文件，引用了带哈希的资源文件。
		// 当应用更新时，index.html 中的资源引用会变化。
		// 如果浏览器缓存了旧的 index.html，用户会加载过期的资源。
		// no-cache 确保浏览器每次都向服务器验证 index.html 是否有更新。
		cacheControl := rec.Header().Get("Cache-Control")
		if cacheControl != "no-cache" {
			t.Logf("FAIL path=%q: Cache-Control=%q, want 'no-cache'",
				path, cacheControl)
			return false
		}

		return true
	}

	if err := quick.Check(func(input spaFallbackPath) bool {
		return property(input)
	}, config); err != nil {
		t.Errorf("SPA fallback correctness property violated: %v", err)
	}
}

// getExpectedIndexHTML 通过请求一个已知会触发 SPA fallback 的路径来获取 index.html 内容。
// 📚 学习要点: 测试辅助函数与 t.Helper()
// t.Helper() 标记此函数为测试辅助函数。当测试失败时，
// Go 会报告调用者的行号（而非辅助函数内部行号），使错误定位更容易。
// 这是 Go 测试的最佳实践：所有非 Test* 的辅助函数都应调用 t.Helper()。
//
// 📚 学习要点: 为什么不直接请求 /index.html？
// Go 的 http.FileServer 会将 /index.html 重定向（301）到 /，
// 因为它将 index.html 视为目录索引文件。
// 我们通过请求一个不存在的路径来触发 SPA fallback，间接获取 index.html 内容。
func getExpectedIndexHTML(t *testing.T, handler http.Handler) string {
	t.Helper()

	// 请求一个确定不存在的路径，触发 SPA fallback 返回 index.html
	req := httptest.NewRequest(http.MethodGet, "/__test_baseline_path__", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("failed to get index.html via SPA fallback: status %d", rec.Code)
	}

	body := rec.Body.String()
	if !strings.Contains(body, "<!DOCTYPE html>") {
		t.Fatalf("SPA fallback did not return HTML content: got %q", body[:min(100, len(body))])
	}

	return body
}

// min 返回两个整数中较小的一个。
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
