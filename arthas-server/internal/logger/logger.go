// Package logger 提供结构化日志输出，封装标准库 log 包。
//
// 设计目标：
//   - 统一格式：所有日志自动包含 RFC 3339 时间戳、级别、模块标识
//   - 单一修改点：未来切换到 JSON 格式或第三方库（如 slog），只需修改此包
//   - 语义清晰：logger.Warn("CORS", ...) 比 log.Printf("[WARN] [CORS] ...") 更易读
//   - 零依赖：仅使用 Go 标准库，不引入 zap/logrus 等第三方日志库
//
// 📚 学习要点: 为什么封装标准库 log？
// Go 标准库的 log 包功能简单但足够可靠。封装它而非直接使用有三个好处：
// 1. 格式一致性 — 避免每个调用点手动拼接时间戳和级别
// 2. 可替换性 — 如果未来需要 JSON 日志或采样，只改这一个文件
// 3. 编译时安全 — 通过函数签名约束调用方式，减少格式错误
//
// 线程安全性：
//   - Init() 必须在所有 goroutine 启动前调用（非并发安全的配置操作）
//   - Info/Warn/Error 可以从任意 goroutine 并发调用（底层 log.Printf 内部有 mutex 保护）
//
// 📚 学习要点: Go 的 log 包线程安全机制
// 标准库 log.Logger 内部使用 sync.Mutex 保护输出操作。
// 这意味着多个 goroutine 同时调用 log.Printf 时：
//   - 不会出现日志行交错（每次 Printf 是原子写入）
//   - 但会有锁竞争开销（高 QPS 场景下可能成为瓶颈）
//
// 对于 Arthas 的连接规模（< 1000 并发），标准库完全够用。
package logger

import (
	"fmt"
	"log"
	"os"
	"time"
)

// 日志级别常量。
// 使用字符串常量而非 iota 枚举，因为这些值直接出现在日志输出中，
// 字符串形式更直观，且避免了 int → string 的转换开销。
const (
	// INFO 表示正常运行事件（连接、断开、房间创建等）。
	INFO = "INFO"

	// WARN 表示异常但可恢复的事件（CORS 拒绝、频率限制等）。
	WARN = "WARN"

	// ERROR 表示严重错误，可能影响服务可用性（监听失败、序列化错误等）。
	ERROR = "ERROR"
)

// Init 初始化日志配置：禁用默认时间前缀，输出到 stdout。
//
// 调用时机：必须在 main() 函数中、启动任何 goroutine 之前调用。
// 原因：log.SetFlags() 和 log.SetOutput() 修改全局 logger 的内部状态，
// 这些操作本身不是并发安全的（写操作）。但一旦配置完成，
// 后续的 log.Printf() 调用是并发安全的（读操作 + mutex 保护的写入）。
//
// 📚 学习要点: 为什么输出到 stdout 而非文件？
// 这遵循 12-Factor App 原则的第 XI 条：将日志视为事件流（Treat logs as event streams）。
// 在容器化部署中：
//   - 应用只负责将日志写到 stdout/stderr
//   - 容器运行时（Docker/K8s）负责收集、路由、存储日志
//   - 这种解耦让应用无需关心日志的最终去向（文件、ELK、CloudWatch 等）
//
// 📚 学习要点: log.SetFlags(0) 的作用
// Go 标准库 log 默认会在每行前添加日期时间前缀（如 "2009/01/23 01:23:23"）。
// 设置 flags 为 0 禁用所有默认前缀，让我们完全控制输出格式。
// 这样可以使用 RFC 3339 格式的时间戳，与国际标准一致。
func Init() {
	log.SetFlags(0)          // 禁用默认的日期时间前缀（我们在 emit 中自己格式化）
	log.SetOutput(os.Stdout) // 输出到标准输出，遵循 12-Factor 日志原则
}

// Info 输出 INFO 级别日志。
// 格式：[RFC3339] [INFO] [module] message
//
// 参数：
//   - module: 产生日志的模块名（如 "Hub"、"Server"、"CORS"），用于日志过滤
//   - format: fmt.Sprintf 格式字符串
//   - args: 格式字符串的参数
//
// 使用示例：
//
//	logger.Info("Hub", "client %s connected, total: %d", clientID, count)
//
// 线程安全：可从任意 goroutine 并发调用。
func Info(module, format string, args ...interface{}) {
	emit(INFO, module, format, args...)
}

// Warn 输出 WARN 级别日志。
// 格式：[RFC3339] [WARN] [module] message
//
// 适用场景：异常但可恢复的事件，如 CORS 拒绝、客户端协议错误等。
// 这些事件不影响服务整体可用性，但可能需要运维关注。
//
// 参数：
//   - module: 产生日志的模块名
//   - format: fmt.Sprintf 格式字符串
//   - args: 格式字符串的参数
//
// 使用示例：
//
//	logger.Warn("CORS", "rejected origin: %s from %s", origin, remoteAddr)
//
// 线程安全：可从任意 goroutine 并发调用。
func Warn(module, format string, args ...interface{}) {
	emit(WARN, module, format, args...)
}

// Error 输出 ERROR 级别日志。
// 格式：[RFC3339] [ERROR] [module] message
//
// 适用场景：严重错误，可能影响服务可用性，如监听端口失败、关键组件初始化失败等。
// ERROR 级别的日志通常需要立即处理。
//
// 参数：
//   - module: 产生日志的模块名
//   - format: fmt.Sprintf 格式字符串
//   - args: 格式字符串的参数
//
// 使用示例：
//
//	logger.Error("Server", "listen failed: %v", err)
//
// 线程安全：可从任意 goroutine 并发调用。
func Error(module, format string, args ...interface{}) {
	emit(ERROR, module, format, args...)
}

// emit 是内部日志格式化函数，所有公开方法（Info/Warn/Error）最终调用此函数。
//
// 输出格式：[2006-01-02T15:04:05Z07:00] [LEVEL] [MODULE] message
// 示例输出：[2026-05-13T14:30:00+08:00] [INFO] [Hub] client abc123 connected, total: 5
//
// 📚 学习要点: unexported 函数（小写开头）的封装作用
// Go 使用首字母大小写控制可见性（而非 public/private 关键字）：
//   - 大写开头（Info, Warn, Error）：包外可访问，构成公开 API
//   - 小写开头（emit）：仅包内可访问，是实现细节
//
// 这确保外部调用者只能通过 Info/Warn/Error 三个语义明确的入口使用日志，
// 无法绕过级别约束直接调用 emit。
//
// 📚 学习要点: time.RFC3339 格式
// RFC 3339 是互联网时间戳的标准格式（ISO 8601 的子集）。
// 格式示例：2006-01-02T15:04:05Z07:00
// Go 使用「参考时间」（Mon Jan 2 15:04:05 MST 2006）作为格式模板，
// 这是 Go 独特的时间格式化方式，比 strftime 的 %Y-%m-%d 更直观。
func emit(level, module, format string, args ...interface{}) {
	ts := time.Now().Format(time.RFC3339)
	msg := fmt.Sprintf(format, args...)
	log.Printf("[%s] [%s] [%s] %s", ts, level, module, msg)
}
