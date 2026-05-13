// Package main 是 Arthas WebSocket 中继服务器的入口点。
//
// 本文件负责服务器的完整生命周期管理：
//   - 初始化日志、CORS 控制、Hub 等核心组件
//   - 配置 HTTP 路由（/ping 健康检查 + /ws WebSocket 升级）
//   - 启动 HTTP 服务器并监听指定端口
//   - 等待关闭信号（Task 8.2 将实现信号处理和优雅关闭）
//
// 📚 学习要点: Go 程序的入口点
// Go 程序从 main 包的 main() 函数开始执行。
// 与 C/Java 不同，Go 的 main() 没有参数和返回值。
// 程序退出码通过 os.Exit() 设置（而非 return）。
// 当 main() 返回时，所有 goroutine 会被强制终止（不会等待它们完成）。
// 这就是为什么我们需要在 main() 中阻塞，直到收到关闭信号。
//
// 📚 学习要点: 服务器启动顺序的重要性
// 初始化顺序必须严格遵守：
// 1. 日志初始化（后续所有组件都依赖日志）
// 2. 配置加载（CORS 等安全配置必须在接受连接前就绪）
// 3. 业务组件初始化（Hub）
// 4. 路由注册
// 5. 启动监听
// 如果顺序错误（如先启动监听再配置 CORS），会有短暂的安全窗口期。
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/arthas/arthas-server/internal/logger"
	"github.com/arthas/arthas-server/internal/network"
)

// Version 是服务器版本号，可在编译时通过 ldflags 注入。
//
// 📚 学习要点: Go 的 ldflags 机制
// 使用 `go build -ldflags "-X main.Version=v2.0.0"` 可以在编译时覆盖此变量的值。
// 这是 Go 程序实现「构建时配置」的标准方式：
//   - CI/CD 流水线注入 git tag 或 commit hash 作为版本号
//   - 无需配置文件或环境变量，版本信息直接编译进二进制文件
//   - 运行时零开销（编译时已确定值）
//
// 典型用法（在 Dockerfile 或 CI 脚本中）：
//
//	go build -ldflags "-s -w -X main.Version=$(git describe --tags)" ./cmd/server
//
// -s: 去除符号表（减小二进制体积）
// -w: 去除 DWARF 调试信息（进一步减小体积）
// -X: 设置包级变量的值
var Version = "1.0.0"

// main 是服务器入口函数，负责初始化所有组件并启动 HTTP 服务器。
//
// 执行流程：
// 1. 初始化结构化日志（必须最先执行，后续组件依赖日志输出）
// 2. 读取 ALLOWED_ORIGINS 环境变量，初始化 CORS Origin 控制
// 3. 创建 Hub 并启动事件循环（在独立 goroutine 中）
// 4. 注册 HTTP 路由（/ping + /ws）
// 5. 读取 PORT 环境变量，创建 http.Server
// 6. 在 goroutine 中启动 ListenAndServe
// 7. 输出启动日志
// 8. 阻塞等待（Task 8.2 将替换为信号处理）
func main() {
	// ─── Step 1: 初始化结构化日志 ───────────────────────────────────────────
	//
	// 📚 学习要点: 日志初始化必须在所有 goroutine 启动之前完成。
	// log.SetFlags() 和 log.SetOutput() 修改全局 logger 的内部状态，
	// 这些操作本身不是并发安全的（写操作）。
	// 但一旦配置完成，后续的 log.Printf() 调用是并发安全的（内部有 mutex 保护）。
	// 因此：Init() 在 main 中最先调用，确保后续所有日志调用都是安全的。
	logger.Init()

	// ─── Step 2: 初始化 CORS Origin 控制 ────────────────────────────────────
	//
	// 📚 学习要点: 安全配置必须在接受连接之前完成
	// 如果先启动服务器再配置 CORS，会有一个短暂的时间窗口，
	// 在此期间任何 Origin 的连接都会被接受（安全漏洞）。
	// 正确做法：先完成所有安全配置，再开始监听端口。
	//
	// ALLOWED_ORIGINS 环境变量格式：逗号分隔的域名列表
	// 示例：ALLOWED_ORIGINS=https://arthas.vercel.app,https://arthas.dev
	// 空值或未设置：允许所有来源（开发模式，向后兼容）
	network.InitOriginControl(os.Getenv("ALLOWED_ORIGINS"))

	// ─── Step 3: 创建 Hub 并启动事件循环 ────────────────────────────────────
	//
	// 📚 学习要点: Hub 在独立 goroutine 中运行事件循环
	// 这是 Go 中常见的「actor 模型」实现：
	// - 一个 goroutine 独占状态（clients map）
	// - 其他 goroutine 通过 channel 发送消息来请求状态变更
	// - 消除了对共享状态的竞态条件，无需复杂的锁策略
	//
	// Hub.Run() 是一个无限循环，通过 select 多路复用处理：
	// - 客户端注册（register channel）
	// - 客户端注销（unregister channel）
	// - 关闭信号（done channel）
	hub := network.NewHub()
	go hub.Run()

	// ─── Step 4: 注册 HTTP 路由 ─────────────────────────────────────────────
	//
	// 📚 学习要点: 为什么使用 http.NewServeMux() 而非 http.DefaultServeMux？
	//
	// http.DefaultServeMux 是一个全局变量（包级别的 *http.ServeMux）。
	// 使用全局变量的问题：
	// 1. 测试隔离性差 — 多个测试并行运行时会互相干扰（路由注册是全局的）
	// 2. 隐式依赖 — 任何包都可以通过 http.Handle() 注册路由，难以追踪
	// 3. 安全风险 — 第三方库可能偷偷注册调试路由（如 /debug/pprof）
	//
	// 显式创建 ServeMux 的优势：
	// 1. 可测试 — 每个测试可以创建独立的 mux，互不影响
	// 2. 可审计 — 所有路由在一个地方注册，一目了然
	// 3. 可组合 — 可以为不同端口创建不同的 mux（如管理端口 vs 业务端口）
	mux := http.NewServeMux()

	// /ping — 健康检查端点
	// 用途：容器编排器（Docker HEALTHCHECK、K8s liveness probe）和
	// 外部保活服务（cron-job.org）通过此端点验证服务存活。
	mux.HandleFunc("/ping", handlePing)

	// /ws — WebSocket 升级端点
	// 所有客户端通过此端点建立 WebSocket 连接。
	// ServeWs 内部处理：Origin 验证 → HTTP Upgrade → 创建 Client → 启动读写 goroutine
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		network.ServeWs(hub, w, r)
	})

	// ─── Step 5: 读取 PORT 环境变量 ─────────────────────────────────────────
	//
	// 📚 学习要点: 环境变量 vs 命令行参数 vs 配置文件
	// 三种配置方式各有适用场景：
	// - 环境变量：适合容器化部署（Docker/K8s 原生支持），12-Factor App 推荐
	// - 命令行参数：适合 CLI 工具，支持 --help 自文档化
	// - 配置文件：适合复杂配置（多层嵌套），支持注释和版本控制
	//
	// Arthas 选择环境变量，因为：
	// 1. 部署目标是容器平台（HF Spaces、Railway），环境变量是标准配置方式
	// 2. 配置项很少（PORT、ALLOWED_ORIGINS），不需要配置文件的复杂性
	// 3. 避免在容器镜像中包含敏感配置文件
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// ─── Step 6: 创建 http.Server ───────────────────────────────────────────
	//
	// 📚 学习要点: http.Server 结构体 vs http.ListenAndServe 便捷函数
	//
	// http.ListenAndServe(addr, handler) 内部创建一个默认配置的 Server：
	//   srv := &http.Server{Addr: addr, Handler: handler}
	//   return srv.ListenAndServe()
	//
	// 直接使用 http.Server 结构体可以：
	// - 设置安全超时参数（ReadHeaderTimeout 防止 slowloris 攻击）
	// - 调用 Shutdown() 实现优雅关闭（Task 8.2）
	// - 在测试中使用 httptest.NewServer 替换
	// - 设置 TLS 配置（如果需要直接终止 TLS）
	//
	// 📚 学习要点: ReadHeaderTimeout 与 Slowloris 攻击
	// Slowloris 是一种 DoS 攻击：攻击者发送 HTTP 请求但极慢地发送头部，
	// 每隔几秒发送一个字节，保持连接打开但不完成请求。
	// 如果没有超时限制，服务器的连接池会被这些「僵尸连接」耗尽。
	//
	// ReadHeaderTimeout 设置读取请求头的最大时间：
	// - 10 秒对正常客户端绰绰有余（即使在高延迟网络下）
	// - 但会切断 slowloris 攻击者的慢速连接
	// - 注意：这只保护 HTTP 层，WebSocket 连接升级后不受此限制
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// ─── Step 7: 在 goroutine 中启动服务器 ──────────────────────────────────
	//
	// 📚 学习要点: 为什么在 goroutine 中启动 ListenAndServe？
	// srv.ListenAndServe() 是阻塞调用：
	// - 它会一直运行，处理传入的 HTTP 请求
	// - 只有在出错或 Shutdown() 被调用时才会返回
	//
	// 如果在 main goroutine 中直接调用，后续代码（信号监听、日志输出）永远不会执行。
	// 放在 goroutine 中让 main 函数可以继续执行后续逻辑。
	//
	// 📚 学习要点: http.ErrServerClosed 的语义
	// 当 srv.Shutdown() 被调用时，ListenAndServe 返回 http.ErrServerClosed。
	// 这是正常的关闭流程，不应视为错误。
	// 只有其他错误（如端口被占用、权限不足）才需要报告并退出。
	go func() {
		if err := srv.ListenAndServe(); err != http.ErrServerClosed {
			logger.Error("Server", "listen failed: %v", err)
			os.Exit(1)
		}
	}()

	// ─── Step 8: 输出启动日志 ───────────────────────────────────────────────
	//
	// 📚 学习要点: 启动日志的作用
	// 启动日志是运维的第一道防线：
	// - 确认服务已成功启动（而非卡在初始化阶段）
	// - 记录关键配置（端口、版本），便于排查「部署了错误版本」的问题
	// - 时间戳帮助计算启动耗时和确认部署时间
	//
	// 在容器平台中，启动日志通常是判断容器是否健康的第一个信号。
	// 如果容器启动后没有输出此日志，说明初始化过程中出了问题。
	logger.Info("Server", "started on :%s (version %s) at %s", port, Version, time.Now().Format(time.RFC3339))

	// ─── Step 9: 等待关闭信号 ──────────────────────────────────────────────
	//
	// 📚 学习要点: os/signal 包的信号处理
	// signal.Notify 将操作系统信号转发到 Go channel。
	// 缓冲区大小为 1：即使 main goroutine 暂时没有读取，信号也不会丢失。
	// 如果缓冲区为 0（无缓冲 channel），信号到达时如果没有 goroutine 在等待接收，
	// 信号会被丢弃。缓冲区为 1 确保至少能存储一个待处理的信号。
	//
	// SIGTERM: 容器编排器（Docker/K8s）发送的优雅停止信号
	//   - Docker: `docker stop` 先发 SIGTERM，等待 grace period 后发 SIGKILL
	//   - K8s: Pod 终止时先发 SIGTERM，默认 30 秒后发 SIGKILL
	// SIGINT: 用户按 Ctrl+C 时发送（开发环境常用）
	//
	// 📚 学习要点: 为什么不监听 SIGKILL？
	// SIGKILL (kill -9) 无法被捕获或忽略，操作系统直接终止进程。
	// 这是设计上的安全机制：确保任何进程都可以被强制终止。
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	logger.Info("Server", "shutting down...")

	// ─── Step 10: 两阶段优雅关闭 ──────────────────────────────────────────
	//
	// 📚 学习要点: context.WithTimeout 创建带截止时间的 context
	// context 是 Go 中传递「取消信号」和「截止时间」的标准机制。
	// WithTimeout 返回一个新的 context，它会在指定时间后自动取消。
	// 5 秒后 context 的 Done() channel 会被关闭，所有监听它的操作都会收到通知。
	//
	// 📚 学习要点: defer cancel() 的重要性
	// 即使 context 超时后会自动取消，defer cancel() 仍然是必须的。
	// 原因：WithTimeout 内部启动了一个 timer goroutine，
	// 如果不调用 cancel()，这个 goroutine 会一直存活直到超时，造成资源泄漏。
	// defer cancel() 确保函数返回时立即释放 timer 资源。
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Phase 1: 停止接受新连接，等待活跃 HTTP 请求完成
	//
	// 📚 学习要点: Server.Shutdown 的行为
	// Shutdown 执行以下操作（按顺序）：
	// 1. 关闭所有 listener（不再接受新的 TCP 连接）
	// 2. 关闭所有空闲连接（keep-alive 但无活跃请求的连接）
	// 3. 等待所有活跃的 HTTP 请求完成（或 context 超时）
	// 4. 返回 nil（成功）或 context.DeadlineExceeded（超时）
	//
	// 重要限制：Shutdown 不会等待 WebSocket 连接！
	// 原因：WebSocket 连接通过 HTTP Hijack 脱离了 http.Server 的管理。
	// Hijack 后，底层 TCP 连接的所有权转移给了应用代码（我们的 Client）。
	// http.Server 不再跟踪这些连接，Shutdown() 对它们完全无感知。
	// 这就是为什么我们需要 Phase 2 来主动关闭 WebSocket 连接。
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("Server", "HTTP shutdown error: %v", err)
	}

	// Phase 2: 关闭所有 WebSocket 连接
	//
	// 📚 学习要点: 为什么需要 Phase 2？
	// WebSocket 连接通过 HTTP Hijack 脱离了 http.Server 的管理。
	// Shutdown() 对它们无感知，必须由 Hub 主动关闭。
	//
	// Hub.Stop() 的内部行为：
	// 1. close(done) — 通知 Hub.Run() 退出事件循环
	// 2. 遍历所有 client，close(client.send) — 通知 writePump 退出
	// 3. writePump 退出时发送 WebSocket Close 帧，然后关闭底层连接
	// 4. 底层连接关闭后，readPump 的 ReadMessage() 返回错误，readPump 退出
	//
	// 这个级联关闭确保每个客户端都能收到 Close 帧（如果网络允许），
	// 实现了「优雅断开」而非「粗暴切断」。
	hub.Stop()

	// Phase 3: 等待所有客户端 goroutine 退出（带超时保护）
	//
	// 📚 学习要点: WaitGroup + select 实现「等待或超时」模式
	// 这是 Go 中处理「最多等 N 秒」的标准模式：
	// - 在 goroutine 中调用阻塞操作（hub.Wait()）
	// - 阻塞操作完成时关闭一个 channel（done）
	// - 在 select 中同时等待 done 和 context 超时
	//
	// 为什么不直接 hub.Wait()？
	// 如果某个客户端的 goroutine 因为网络问题卡住（如 TCP FIN 未收到 ACK），
	// Wait() 会永久阻塞，导致进程无法退出。
	// 加上超时保护确保进程在 5 秒内一定退出（满足容器编排器的要求）。
	done := make(chan struct{})
	go func() {
		hub.Wait()
		close(done)
	}()

	select {
	case <-done:
		logger.Info("Server", "all connections closed gracefully")
	case <-shutdownCtx.Done():
		logger.Warn("Server", "shutdown timeout, forcing exit")
	}

	os.Exit(0)
}

// handlePing 是健康检查端点的处理函数。
//
// 用途：
//   - 容器编排器（Docker HEALTHCHECK、K8s liveness/readiness probe）
//   - 外部保活服务（cron-job.org 每 10 分钟 GET /ping）
//   - 运维手动验证服务存活（curl https://backend/ping）
//
// 设计要求：
//   - 无状态：不依赖任何外部资源（数据库、缓存等）
//   - 无认证：任何人都可以访问（健康检查不应有认证门槛）
//   - 极低延迟：< 1ms 响应时间（仅返回固定字符串）
//   - 幂等：多次调用结果相同，无副作用
//
// 📚 学习要点: HTTP Handler 的签名
// Go 的 HTTP handler 有两种形式：
// 1. http.Handler 接口：实现 ServeHTTP(w, r) 方法的结构体
// 2. http.HandlerFunc 类型：func(w, r) 签名的普通函数
//
// HandleFunc 接受第二种形式，内部将其适配为 Handler 接口。
// 对于简单的端点（如 /ping），直接使用函数更简洁。
// 对于需要依赖注入的复杂端点，使用结构体实现 Handler 接口更合适。
//
// 📚 学习要点: ResponseWriter 的写入顺序
// HTTP 响应的写入必须按以下顺序：
// 1. 设置响应头（Header().Set(...)）
// 2. 写入状态码（WriteHeader(...)）
// 3. 写入响应体（Write(...)）
//
// 如果先调用 Write() 再设置 Header，头部修改会被忽略，
// 因为 Write() 会隐式调用 WriteHeader(200) 并发送头部。
func handlePing(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("pong"))
}
