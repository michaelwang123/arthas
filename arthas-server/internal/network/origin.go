// Package network 的 origin.go 文件负责 WebSocket 连接的来源（Origin）验证。
//
// 📚 学习要点: 为什么 WebSocket 需要 Origin 验证？
// 浏览器的同源策略（Same-Origin Policy）限制了 XMLHttpRequest 和 fetch 的跨域请求，
// 但 WebSocket 不受此限制！任何网页都可以向任何 WebSocket 服务器发起连接。
// 这意味着恶意网站可以在用户不知情的情况下连接到你的 WebSocket 服务器，
// 发起类似 CSRF 的攻击。Origin 验证是服务端唯一的防线：
//   - 浏览器在 WebSocket 握手时自动附加 Origin 头（不可伪造）
//   - 服务端检查 Origin 是否在允许列表中
//   - 非浏览器客户端（如 curl）可以伪造 Origin，但这不在威胁模型内
//     （攻击者已经有完整的网络访问权限，不需要借助受害者浏览器）
//
// 📚 学习要点: 包级变量的初始化时机与线程安全
// allowedOrigins 在 main() 中通过 InitOriginControl() 写入，
// 之后仅被 CheckOriginAllowed() 读取。由于：
//  1. 写入发生在 main() 中，所有 goroutine 启动之前
//  2. 之后只有读取操作（多个 goroutine 并发读取是安全的）
//
// 因此不需要 sync.Mutex 或 sync.RWMutex 保护。
// 这是 Go 中常见的「初始化一次，之后只读」模式（init-once-read-many）。
// 如果未来需要运行时动态更新允许列表，则需要引入 sync.RWMutex。
package network

import (
	"strings"

	"github.com/arthas/arthas-server/internal/logger"
)

// allowedOrigins 存储解析后的允许来源列表。
//
// 值语义：
//   - nil 或空切片：允许所有来源（开发模式，向后兼容）
//   - 非空切片：仅允许列表中的来源（生产模式）
//
// 📚 学习要点: nil slice vs empty slice
// 在 Go 中，nil slice 和空 slice（[]string{}）行为几乎相同：
//   - len() 都返回 0
//   - range 都不会执行循环体
//   - append() 都能正常工作
//
// 我们利用这一特性：无论 allowedOrigins 是 nil 还是 []string{}，
// CheckOriginAllowed 的逻辑都是一致的（len == 0 → 允许所有）。
var allowedOrigins []string

// InitOriginControl 解析 ALLOWED_ORIGINS 环境变量的值，初始化来源控制列表。
//
// 解析规则（遵循 Postel's Law — 对输入宽容，对输出严格）：
//   - 以逗号分隔多个域名
//   - 每个条目去除前后空白（TrimSpace）
//   - 过滤空条目（连续逗号、尾部逗号产生的空字符串）
//   - 空字符串输入 → nil（允许所有来源，开发模式）
//
// 📚 学习要点: Postel's Law（鲁棒性原则）
// "Be conservative in what you send, be liberal in what you accept"
// （发送时保守，接收时宽容）— RFC 793, Jon Postel
//
// 在配置解析中的应用：
//   - 用户可能输入 "a.com, b.com" （逗号后有空格）
//   - 用户可能输入 "a.com,,b.com," （多余逗号）
//   - 用户可能输入 " a.com , b.com " （前后空格）
//
// 好的解析器应该正确处理这些情况，而不是报错或产生意外行为。
// 这减少了配置错误导致的生产事故。
//
// 调用时机：必须在 main() 中、启动 HTTP 服务器之前调用。
// 之后 allowedOrigins 变为只读，无需同步机制。
//
// 参数：
//   - origins: ALLOWED_ORIGINS 环境变量的原始值（可能为空字符串）
//
// 示例：
//
//	InitOriginControl("")                           → allowedOrigins = nil (allow all)
//	InitOriginControl("https://a.com,https://b.com") → allowedOrigins = ["https://a.com", "https://b.com"]
//	InitOriginControl("a.com,,b.com,")              → allowedOrigins = ["a.com", "b.com"]
//	InitOriginControl("  ,  ,  ")                   → allowedOrigins = [] (warn + allow all)
func InitOriginControl(origins string) {
	// 空字符串表示未设置环境变量 → 开发模式，允许所有来源
	if origins == "" {
		allowedOrigins = nil
		return
	}

	// 按逗号分割，预分配容量避免多次内存分配
	parts := strings.Split(origins, ",")
	result := make([]string, 0, len(parts))

	for _, p := range parts {
		// TrimSpace 去除前后空白（空格、制表符、换行符等）
		trimmed := strings.TrimSpace(p)
		// 过滤空条目：连续逗号 ",," 或尾部逗号 "a.com," 产生的空字符串
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}

	allowedOrigins = result

	// 边界情况：环境变量已设置但解析后无有效条目（如 ",,,"）
	// 这可能是配置错误，记录警告帮助运维排查
	if len(result) == 0 {
		logger.Warn("CORS", "ALLOWED_ORIGINS set but contains no valid entries, allowing all origins")
	} else {
		logger.Info("CORS", "origin control enabled, %d allowed origins", len(result))
	}
}

// CheckOriginAllowed 验证给定的 origin 是否在允许列表中。
//
// 返回值：
//   - true: origin 被允许（匹配列表中的某个条目，或列表为空）
//   - false: origin 被拒绝（列表非空且 origin 不匹配任何条目）
//
// 📚 学习要点: 为什么使用精确字符串匹配（==）而非模式匹配？
// Origin 验证是安全边界，模糊匹配可能引入绕过漏洞：
//
//  1. 通配符风险：如果支持 "*.example.com"，攻击者可以注册
//     "evil-example.com"，用 strings.HasSuffix 实现会错误匹配。
//
//  2. 正则表达式风险：复杂的正则可能有 ReDoS（正则拒绝服务）漏洞，
//     且难以正确编写（容易遗漏转义字符）。
//
//  3. 精确匹配的优势：
//     - 行为完全可预测，无歧义
//     - 不可能被绕过（除非允许列表本身配置错误）
//     - 性能最优（O(n) 线性扫描，n 通常 < 5）
//     - 代码简单，易于审计
//
// 对于需要支持多个子域名的场景，正确做法是在 ALLOWED_ORIGINS 中
// 逐一列出所有子域名，而非使用通配符。
//
// 线程安全：此函数仅读取 allowedOrigins（在初始化后不再修改），
// 可从任意 goroutine 并发调用，无需同步。
func CheckOriginAllowed(origin string) bool {
	// 空列表 = 开发模式：允许所有来源（向后兼容）
	if len(allowedOrigins) == 0 {
		return true
	}

	// 线性扫描匹配（允许列表通常很短，< 5 个条目）
	for _, allowed := range allowedOrigins {
		if origin == allowed {
			return true
		}
	}

	return false
}
