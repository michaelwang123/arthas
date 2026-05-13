# Design Document: Production Deployment

## Overview

This design covers the code changes and configuration files needed to make Arthas production-ready. The scope includes five areas:

1. **Health check & graceful shutdown** — Add `/ping` HTTP endpoint and two-phase SIGTERM-aware shutdown to `main.go`
2. **Production environment configuration** — Environment variable handling, `vercel.json`, and `.env.production.example`
3. **CORS & Origin control** — Validate WebSocket upgrade `Origin` header against `ALLOWED_ORIGINS`
4. **Structured logging** — Replace raw `log.Printf` calls with a consistent `[RFC3339] [LEVEL] [module] message` format
5. **Deployment artifacts** — Optimize the existing Dockerfile and ensure frontend build is self-contained

All changes use Go standard library only (no new backend dependencies). The frontend gains no new runtime dependencies.

## Project Context & Code Standards

### 项目定位

本项目（Arthas）是一个用于**学习 Go 语言 WebSocket 原理**的实践项目。代码不仅要能正确运行，更要作为学习材料，帮助理解以下核心概念：

- Go 的 goroutine 并发模型与 channel 通信
- WebSocket 协议的升级（HTTP Upgrade / Hijack）机制
- 生产级服务器的生命周期管理（启动、运行、优雅关闭）
- 信号处理与进程管理
- 零知识（zero-knowledge）中继架构的安全设计

### 编码规范要求

实现代码时**必须**遵守以下规范：

**1. 详细注释（教学级别）**
- 每个文件顶部必须有 package-level 注释，说明该包的职责和设计思路
- 每个导出函数/方法必须有 GoDoc 格式注释，包含：功能描述、参数说明、返回值说明
- 关键逻辑处必须有行内注释，解释 **WHY**（为什么这样做）而非 WHAT（做了什么）
- 并发相关代码必须注释说明：哪个 goroutine 调用、是否线程安全、锁的持有范围
- Channel 操作必须注释说明：发送方/接收方、阻塞条件、关闭语义

**2. 注释示例风格**
```go
// Hub 是 WebSocket 连接的中央管理器，采用 CSP（Communicating Sequential Processes）模型。
//
// 设计原理：
// - 使用 channel 而非 mutex 来协调并发访问，避免共享状态的复杂性
// - register/unregister 是无缓冲 channel，确保注册操作的顺序性
// - done channel 使用「close 广播」模式：关闭一个 channel 会唤醒所有等待的 goroutine
//
// Goroutine 模型：
// - Hub.Run() 在独立 goroutine 中运行，是唯一修改 clients map 的 goroutine
// - 每个 Client 有 2 个 goroutine：readPump（读取 WebSocket）和 writePump（写入 WebSocket）
//
// 关闭顺序：
// 1. main() 调用 Hub.Stop() → 关闭 done channel
// 2. Run() 检测到 done 关闭 → 退出循环
// 3. Stop() 关闭所有 client.send channel → writePump 退出
// 4. writePump 退出后关闭 conn → readPump 读取失败退出
// 5. WaitGroup 计数归零 → main() 继续退出
type Hub struct { ... }
```

**3. 最佳工程实践**
- 遵循 Go 官方 [Effective Go](https://go.dev/doc/effective_go) 和 [Code Review Comments](https://go.dev/wiki/CodeReviewComments)
- 错误处理：永远不忽略 error，使用 `fmt.Errorf("context: %w", err)` 包装错误
- 命名：使用 Go 惯用命名（短变量名用于局部作用域，描述性名称用于导出标识符）
- 包组织：每个包有单一职责，包名简短且有意义
- 测试：测试函数名使用 `Test<Function>_<Scenario>` 格式，测试用例使用 table-driven 风格
- 常量：魔法数字必须定义为命名常量，并注释其含义和来源

**4. 学习要点标注**

在代码中使用 `// 📚 学习要点:` 前缀标注关键的 Go/WebSocket 知识点：

```go
// 📚 学习要点: HTTP Hijack 机制
// WebSocket 升级时，gorilla/websocket 调用 http.Hijacker 接口"劫持"底层 TCP 连接。
// 劫持后，该连接不再由 http.Server 管理，因此 Server.Shutdown() 无法感知它。
// 这就是为什么我们需要 Hub.Stop() 来主动关闭 WebSocket 连接。
conn, err := upgrader.Upgrade(w, r, nil)
```

### 日志采样策略（高负载场景）

当连接数超过阈值时，connect/disconnect 日志可能产生大量输出。设计预留了采样扩展点：

```go
// logSampled 在高频事件中按比例采样日志输出。
// 当前实现：始终输出所有日志（适合学习和调试）。
// 生产优化：当 clientCount > 1000 时，可改为每 10 次事件输出 1 条摘要日志。
//
// 📚 学习要点: 日志采样是生产系统的常见优化。
// 在高 QPS 场景下，每个请求都写日志会成为性能瓶颈（I/O 开销 + 锁竞争）。
// 常见策略：计数采样（每 N 条输出 1 条）、概率采样、速率限制（每秒最多 M 条）。
func (h *Hub) logClientEvent(event, clientID string) {
    count := h.clientCount()
    logger.Info("Hub", "%s %s, total: %d", event, clientID, count)
}
```

当前阶段保持全量日志输出，便于学习和调试。

## Architecture

```mermaid
graph TD
    subgraph "Production Infrastructure"
        V[Vercel - Static Hosting]
        CP[Container Platform - HF Spaces / Railway]
        CJ[cron-job.org - Keep-alive]
    end

    subgraph "arthas-client (Vercel)"
        FE[React + Vite SPA]
        VJ[vercel.json - SPA rewrite + cache]
    end

    subgraph "arthas-server (Docker)"
        MAIN[main.go - HTTP server + shutdown]
        PING[/ping handler]
        WS[/ws handler]
        CORS[Origin validator]
        LOG[Structured logger]
        HUB[Hub - connection manager]
    end

    FE -->|WSS| WS
    CJ -->|GET /ping| PING
    V --> FE
    CP --> MAIN
    MAIN --> PING
    MAIN --> WS
    WS --> CORS
    CORS -->|pass| HUB
    CORS -->|reject 403| WS
    HUB --> LOG
```

**Key architectural decisions:**

- The `/ping` endpoint shares the same `http.ServeMux` and port as `/ws` — no separate health-check port.
- Uses an **explicit `http.NewServeMux()`** instead of `DefaultServeMux` for testability and isolation.
- Graceful shutdown uses a **two-phase approach**: `http.Server.Shutdown()` stops the listener, then `Hub.Stop()` actively closes all WebSocket connections. This is necessary because WebSocket connections are hijacked from the HTTP server and `Shutdown()` alone will NOT wait for them.
- Origin validation happens inside the `websocket.Upgrader.CheckOrigin` function, before the WebSocket handshake completes.
- Structured logging is implemented as a thin helper in a new `internal/logger` package wrapping the standard `log` package.
- `ReadHeaderTimeout` is set on `http.Server` to prevent slowloris attacks.

## Components and Interfaces

### 1. `cmd/server/main.go` — Server Lifecycle

**Current state:** Calls `http.ListenAndServe` directly with no shutdown handling, uses `DefaultServeMux`.

**Changes:**

```go
// 📚 学习要点: Go 的 ldflags 机制
// -ldflags "-X main.Version=..." 在编译时将字符串值注入到变量中。
// 这是 Go 程序实现「构建时配置」的标准方式，无需配置文件或环境变量。
// CI/CD 流水线通常注入 git tag 或 commit hash 作为版本号。
var Version = "1.0.0" // overridable via -ldflags "-X main.Version=..."

func main() {
    // 1. Initialize structured logger
    // 📚 学习要点: 日志初始化必须在所有 goroutine 启动之前完成。
    // log.SetFlags() 和 log.SetOutput() 不是并发安全的（写操作），
    // 但 log.Printf() 是并发安全的（内部有 mutex）。
    logger.Init()

    // 2. Create Hub, start Hub.Run()
    // 📚 学习要点: Hub 在独立 goroutine 中运行事件循环。
    // 这是 Go 中常见的「actor 模型」：一个 goroutine 独占状态，
    // 其他 goroutine 通过 channel 发送消息来请求状态变更。
    hub := network.NewHub()
    go hub.Run()

    // 3. Register routes on explicit ServeMux
    // 📚 学习要点: 为什么不用 http.DefaultServeMux？
    // DefaultServeMux 是全局变量，多个测试并行运行时会互相干扰。
    // 显式创建 ServeMux 使路由配置可测试、可隔离。
    mux := http.NewServeMux()
    mux.HandleFunc("/ping", handlePing)
    mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
        network.ServeWs(hub, w, r)
    })

    // 4. Create http.Server with security timeouts
    port := os.Getenv("PORT")
    if port == "" {
        port = "8080"
    }

    // 📚 学习要点: http.Server 结构体 vs http.ListenAndServe 函数
    // http.ListenAndServe 是便捷函数，内部创建一个默认 Server。
    // 直接使用 http.Server 可以：
    // - 设置超时参数（ReadHeaderTimeout 防止 slowloris 攻击）
    // - 调用 Shutdown() 实现优雅关闭
    // - 在测试中使用 httptest.NewServer 替换
    srv := &http.Server{
        Addr:              ":" + port,
        Handler:           mux,
        ReadHeaderTimeout: 10 * time.Second, // 防止 slowloris 攻击
    }

    // 5. Start server in goroutine
    // 📚 学习要点: 为什么在 goroutine 中启动 ListenAndServe？
    // ListenAndServe 是阻塞调用，会一直运行直到出错或 Shutdown 被调用。
    // 放在 goroutine 中让 main 函数可以继续执行信号监听逻辑。
    go func() {
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            logger.Error("Server", "listen failed: %v", err)
            os.Exit(1)
        }
        // 📚 学习要点: err == http.ErrServerClosed 表示 Shutdown() 被调用，
        // 这是正常的关闭流程，不应视为错误。
    }()

    logger.Info("Server", "started on :%s (version %s)", port, Version)

    // 6. Wait for SIGTERM/SIGINT
    // 📚 学习要点: os/signal 包的信号处理
    // signal.Notify 将操作系统信号转发到 Go channel。
    // 缓冲区大小为 1：即使 main goroutine 暂时没有读取，信号也不会丢失。
    // SIGTERM: 容器编排器（Docker/K8s）发送的优雅停止信号
    // SIGINT: 用户按 Ctrl+C 时发送
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
    <-quit

    logger.Info("Server", "shutting down...")

    // 7. Two-phase graceful shutdown
    // 📚 学习要点: context.WithTimeout 创建一个带截止时间的 context。
    // 5 秒后 context 自动取消，用于限制关闭操作的最大等待时间。
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    // Phase 1: Stop accepting new connections
    // 📚 学习要点: Server.Shutdown 的行为
    // 1. 关闭所有 listener（不再接受新连接）
    // 2. 等待所有活跃的 HTTP 请求完成
    // 3. 但是！不会等待 WebSocket 连接（因为它们已被 Hijack）
    srv.Shutdown(shutdownCtx)

    // Phase 2: Close existing WebSocket connections
    // 📚 学习要点: 为什么需要 Phase 2？
    // WebSocket 连接通过 HTTP Hijack 脱离了 http.Server 的管理。
    // Shutdown() 对它们无感知，必须由 Hub 主动关闭。
    hub.Stop()

    // Phase 3: Wait for all client goroutines to finish (with timeout)
    // 📚 学习要点: WaitGroup + select 实现「等待或超时」模式
    // 这是 Go 中处理「最多等 N 秒」的标准模式。
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
// 容器编排器和外部保活服务（如 cron-job.org）通过此端点验证服务存活。
// 设计为无状态、无认证、极低延迟（< 1ms）。
func handlePing(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/plain")
    w.WriteHeader(http.StatusOK)
    w.Write([]byte("pong"))
}
```

**Interface:**
- `GET /ping` → 200 `"pong"` (plain text, no auth, sub-millisecond response)
- `GET /ws` → WebSocket upgrade (existing)

**Design rationale:**
- Explicit `http.NewServeMux()` avoids global state pollution in tests.
- `ReadHeaderTimeout: 10s` prevents slowloris attacks where clients send headers very slowly to exhaust server resources.
- Two-phase shutdown is necessary because `http.Server.Shutdown()` does NOT wait for hijacked (WebSocket) connections — it only waits for non-hijacked HTTP requests.

### 2. `internal/network/hub.go` — Hub Lifecycle & Graceful Shutdown

**Current state:** `Hub.Run()` is an infinite loop with no exit path.

**New fields and methods:**

```go
// Hub 是 WebSocket 连接的中央管理器，采用 CSP（Communicating Sequential Processes）模型。
//
// 📚 学习要点: CSP 并发模型
// Go 的并发哲学是「不要通过共享内存来通信，而要通过通信来共享内存」。
// Hub 是这一哲学的典型实现：
// - clients map 只在 Run() goroutine 中被修改（单一写者）
// - 其他 goroutine 通过 register/unregister channel 请求修改
// - 这消除了对 clients map 的竞态条件，无需复杂的锁策略
//
// Goroutine 拓扑：
//   main goroutine → Hub.Run() goroutine
//                  → Client.readPump() goroutine (per client)
//                  → Client.writePump() goroutine (per client)
type Hub struct {
    roomManager *room.RoomManager
    clients     map[*Client]bool
    register    chan *Client    // 无缓冲：确保注册的顺序性
    unregister  chan *Client    // 无缓冲：确保注销的顺序性
    mu          sync.RWMutex   // 保护 clients map 的并发读取（clientCount）

    // Graceful shutdown support
    // 📚 学习要点: done channel 的「close 广播」模式
    // 关闭一个 channel 会让所有阻塞在该 channel 上的 <-ch 操作立即返回零值。
    // 这是 Go 中实现「一对多取消通知」的惯用模式。
    done chan struct{}

    // 📚 学习要点: sync.WaitGroup 用于等待一组 goroutine 完成
    // Add(n) 增加计数，Done() 减少计数，Wait() 阻塞直到计数归零。
    // 这里用于跟踪所有 readPump/writePump goroutine，确保关闭时等待它们退出。
    wg sync.WaitGroup
}

func NewHub() *Hub {
    return &Hub{
        roomManager: room.NewRoomManager(),
        clients:     make(map[*Client]bool),
        register:    make(chan *Client),
        unregister:  make(chan *Client),
        done:        make(chan struct{}),
    }
}

// Run 启动 Hub 主事件循环。在独立 goroutine 中调用。
// 当 Stop() 被调用时（done channel 关闭），Run 返回。
//
// 📚 学习要点: select 多路复用
// select 语句让一个 goroutine 同时等待多个 channel 操作。
// 当多个 case 同时就绪时，Go 运行时随机选择一个执行（公平调度）。
func (h *Hub) Run() {
    for {
        select {
        case <-h.done:
            // 📚 学习要点: 关闭的 channel 立即返回零值
            // 一旦 done 被关闭，每次循环都会走到这个 case，退出循环。
            return
        case client := <-h.register:
            h.mu.Lock()
            h.clients[client] = true
            h.mu.Unlock()
            logger.Info("Hub", "client %s connected, total: %d", client.ID, h.clientCount())
        case client := <-h.unregister:
            h.mu.Lock()
            if _, ok := h.clients[client]; ok {
                delete(h.clients, client)
                close(client.send) // 关闭 send channel 通知 writePump 退出
            }
            h.mu.Unlock()
            h.handleClientDisconnect(client)
            logger.Info("Hub", "client %s disconnected, total: %d", client.ID, h.clientCount())
        }
    }
}

// Stop 触发优雅关闭：通知 Run() 退出，并主动关闭所有客户端连接。
//
// 📚 学习要点: 关闭顺序的重要性
// 1. 先 close(done) — 让 Run() 退出，不再处理 register/unregister
// 2. 再 close(client.send) — 让每个 writePump 退出
// 3. writePump 退出时关闭 WebSocket conn — 让 readPump 读取失败退出
// 这个顺序确保不会出现「向已关闭 channel 发送」的 panic。
func (h *Hub) Stop() {
    close(h.done)
    h.mu.Lock()
    for client := range h.clients {
        close(client.send)
        delete(h.clients, client)
    }
    h.mu.Unlock()
}

// Wait 阻塞直到所有客户端 goroutine（readPump + writePump）退出。
func (h *Hub) Wait() {
    h.wg.Wait()
}
```

**WaitGroup usage in ServeWs:**

```go
// ServeWs 处理 WebSocket 升级请求，创建 Client 并启动读写 goroutine。
//
// 📚 学习要点: WebSocket 升级流程
// 1. 客户端发送 HTTP GET 请求，带有 Upgrade: websocket 头
// 2. 服务器调用 Upgrade()，内部执行 HTTP Hijack 获取底层 TCP 连接
// 3. Hijack 后，该连接完全由我们的代码管理，http.Server 不再感知它
// 4. 这就是为什么 Server.Shutdown() 无法关闭 WebSocket 连接
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
    conn, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        // Only log non-CORS errors (CORS rejection already logged in CheckOrigin)
        if !isCORSRejection(err) {
            logger.Warn("WS", "upgrade error: %v", err)
        }
        return
    }

    client := &Client{
        ID:   generateID(),
        hub:  hub,
        conn: conn,
        send: make(chan []byte, sendBufferSize),
    }

    // 📚 学习要点: select 实现「发送或取消」模式
    // 如果 Hub 已经停止（done 已关闭），register channel 没有接收者，
    // 直接发送会永久阻塞。select + done 避免了这个死锁。
    select {
    case hub.register <- client:
    case <-hub.done:
        // Hub 已关闭，直接关闭连接，不注册
        conn.Close()
        return
    }

    // 📚 学习要点: WaitGroup 的 Add 必须在 goroutine 启动前调用
    // 如果在 goroutine 内部调用 Add，可能出现 Wait() 在 Add() 之前返回的竞态。
    hub.wg.Add(2)
    go func() {
        defer hub.wg.Done()
        client.writePump()
    }()
    go func() {
        defer hub.wg.Done()
        client.readPump()
    }()
}
```

**Channel safety in readPump defer (prevents blocking after shutdown):**

```go
func (c *Client) readPump() {
    defer func() {
        // 📚 学习要点: 为什么需要 select 守卫？
        // 场景：Hub.Stop() 已调用 → done 已关闭 → Run() 已退出
        // 此时 unregister channel 没有接收者（Run 不再 select 它）
        // 如果直接 `c.hub.unregister <- c`，会永久阻塞（goroutine 泄漏）
        // select + done 确保：如果 Hub 已停止，跳过注销（Stop 已清理）
        select {
        case c.hub.unregister <- c:
        case <-c.hub.done:
            // Hub already stopped, cleanup handled by Hub.Stop()
        }
        c.conn.Close()
    }()
    // ... existing readPump logic
}
```

**Design rationale for channel safety:** After `Hub.Run()` exits (done channel closed), the `register` and `unregister` channels have no reader. Without the `select` guard, goroutines would block forever on these unbuffered channels, causing a goroutine leak and preventing clean shutdown.

**Design rationale:**
- `done` channel allows `Run()` to exit cleanly during shutdown.
- `Stop()` closes all client `send` channels, which causes `writePump` to send a close frame and exit.
- `sync.WaitGroup` tracks readPump/writePump goroutines so `main.go` can wait for them to finish before exiting.
- The requirement "exit immediately once all connections have closed before the timeout expires" is satisfied by the `select` on `done` channel vs context deadline.

### 3. `internal/logger/logger.go` — Structured Logging

A new package providing formatted log output using only the standard library.

```go
// Package logger 提供结构化日志输出，封装标准库 log 包。
//
// 📚 学习要点: 为什么封装标准库 log？
// 1. 统一格式 — 所有日志自动包含时间戳、级别、模块，无需每次手动拼接
// 2. 单一修改点 — 未来切换到 JSON 格式或第三方库，只需修改此包
// 3. 语义清晰 — logger.Warn("CORS", ...) 比 log.Printf("[WARN] [CORS] ...") 更易读
//
// 线程安全性：
// - Init() 必须在所有 goroutine 启动前调用（非并发安全的配置操作）
// - Info/Warn/Error 可以从任意 goroutine 并发调用（底层 log.Printf 有 mutex）
package logger

import (
    "fmt"
    "log"
    "os"
    "time"
)

// Level constants — 日志级别
const (
    INFO  = "INFO"  // 正常运行事件（连接、断开、房间创建）
    WARN  = "WARN"  // 异常但可恢复的事件（CORS 拒绝、频率限制）
    ERROR = "ERROR" // 严重错误，可能影响服务（监听失败、序列化错误）
)

// Init 初始化日志配置：禁用默认时间前缀，输出到 stdout。
// 必须在 main() 中、启动任何 goroutine 之前调用。
//
// 📚 学习要点: 为什么输出到 stdout 而非文件？
// 容器化部署中，日志应输出到 stdout/stderr，由容器运行时收集。
// 这遵循 12-Factor App 原则的第 XI 条：将日志视为事件流。
func Init() {
    log.SetFlags(0)      // 禁用默认的日期时间前缀（我们自己格式化）
    log.SetOutput(os.Stdout)
}

// Info logs an INFO-level message: [RFC3339] [INFO] [module] message
func Info(module, format string, args ...interface{}) {
    emit(INFO, module, format, args...)
}

// Warn logs a WARN-level message: [RFC3339] [WARN] [module] message
func Warn(module, format string, args ...interface{}) {
    emit(WARN, module, format, args...)
}

// Error logs an ERROR-level message: [RFC3339] [ERROR] [module] message
func Error(module, format string, args ...interface{}) {
    emit(ERROR, module, format, args...)
}

// emit 是内部日志格式化函数，所有公开方法最终调用此函数。
// 📚 学习要点: unexported 函数（小写开头）只能在包内访问，
// 这是 Go 的封装机制，确保外部只能通过 Info/Warn/Error 调用。
func emit(level, module, format string, args ...interface{}) {
    ts := time.Now().Format(time.RFC3339)
    msg := fmt.Sprintf(format, args...)
    log.Printf("[%s] [%s] [%s] %s", ts, level, module, msg)
}
```

**Design rationale:**
- A dedicated package avoids scattering `time.Now().Format(time.RFC3339)` across every call site.
- The module tag (e.g., `Server`, `Hub`, `WS`, `CORS`) enables log filtering via grep.
- `Init()` is called once in `main()` before any goroutines start, ensuring no race condition on log configuration.
- Thread-safe: Go's `log` package uses an internal mutex.

### 4. `internal/network/origin.go` — Origin Validation (New File)

**Extracted to a separate file** for clarity and testability (instead of embedding in `client.go`):

```go
// Package network 的 origin.go 文件负责 WebSocket 连接的来源验证。
//
// 📚 学习要点: 为什么需要 Origin 验证？
// WebSocket 不受浏览器同源策略（Same-Origin Policy）的限制。
// 任何网页都可以向任何 WebSocket 服务器发起连接。
// Origin 验证是服务端唯一的防线，确保只有授权的前端域名可以连接。
// 这防止了 CSRF 类攻击：恶意网站无法冒充合法前端与后端通信。
package network

import (
    "strings"

    "github.com/arthas/arthas-server/internal/logger"
)

// allowedOrigins 存储解析后的允许来源列表。
// 📚 学习要点: 包级变量的初始化时机
// 此变量在 main() 中通过 InitOriginControl() 设置，
// 之后只被 CheckOriginAllowed() 读取（只读）。
// 由于写入发生在所有 goroutine 启动之前，不存在数据竞争。
var allowedOrigins []string

// InitOriginControl 解析 ALLOWED_ORIGINS 环境变量值。
// 空条目会被过滤（如 "a.com,,b.com," → ["a.com", "b.com"]）。
// 如果解析结果为空列表，则允许所有来源（开发模式）。
//
// 📚 学习要点: 防御性解析
// 用户可能输入格式不规范的值（多余逗号、空格）。
// 好的解析器应该宽容输入、严格输出（Postel's Law）。
func InitOriginControl(origins string) {
    if origins == "" {
        allowedOrigins = nil
        return
    }

    parts := strings.Split(origins, ",")
    result := make([]string, 0, len(parts)) // 预分配容量，避免多次扩容
    for _, p := range parts {
        trimmed := strings.TrimSpace(p)
        if trimmed != "" {
            result = append(result, trimmed)
        }
    }

    allowedOrigins = result

    if len(result) == 0 {
        logger.Warn("CORS", "ALLOWED_ORIGINS set but contains no valid entries, allowing all origins")
    } else {
        logger.Info("CORS", "origin control enabled, %d allowed origins", len(result))
    }
}

// CheckOriginAllowed 验证给定的 origin 是否在允许列表中。
// 当允许列表为空时（开发模式），对任何 origin 返回 true。
//
// 📚 学习要点: 精确匹配 vs 模式匹配
// 这里使用精确字符串匹配（==），不支持通配符。
// 原因：Origin 验证是安全边界，模糊匹配可能引入绕过漏洞。
// 例如 "*.evil.com" 如果用 strings.HasSuffix 实现，
// 攻击者可以注册 "not-evil.com" 来绕过。
func CheckOriginAllowed(origin string) bool {
    if len(allowedOrigins) == 0 {
        return true // dev mode: allow all
    }
    for _, allowed := range allowedOrigins {
        if origin == allowed {
            return true
        }
    }
    return false
}
```

**Changes to `client.go` upgrader:**

```go
// 📚 学习要点: Upgrader 配置
// ReadBufferSize/WriteBufferSize 控制 WebSocket 帧的读写缓冲区大小。
// 1024 字节对于聊天消息足够（我们的消息上限是 4096 字节）。
// CheckOrigin 是安全关键函数，在 HTTP → WebSocket 升级前调用。
var upgrader = websocket.Upgrader{
    ReadBufferSize:  1024,
    WriteBufferSize: 1024,
    CheckOrigin: func(r *http.Request) bool {
        origin := r.Header.Get("Origin")
        if CheckOriginAllowed(origin) {
            return true
        }
        logger.Warn("CORS", "rejected origin: %s from %s", origin, r.RemoteAddr)
        return false
    },
}
```

**CORS rejection logging deduplication:**

```go
// isCORSRejection 检测 WebSocket 升级错误是否由 Origin 验证失败引起。
//
// 📚 学习要点: 错误检测模式
// gorilla/websocket 在 CheckOrigin 返回 false 时，返回包含
// "origin not allowed" 的错误。我们通过字符串匹配识别这类错误，
// 避免在 ServeWs 中重复记录（CheckOrigin 内已经记录过了）。
//
// 更健壮的方式是使用 errors.Is/errors.As（如果库导出了错误类型），
// 但 gorilla/websocket 未导出此错误类型，只能用字符串匹配。
func isCORSRejection(err error) bool {
    return strings.Contains(err.Error(), "origin not allowed")
}
```

In `ServeWs`, only log non-CORS upgrade errors to avoid double-logging:
```go
if err != nil {
    if !isCORSRejection(err) {
        // 📚 学习要点: 错误包装（Error Wrapping）
        // Go 1.13+ 推荐使用 fmt.Errorf("context: %w", err) 包装错误，
        // 保留原始错误链，使 errors.Is/errors.As 可以穿透包装层。
        // 这里我们直接记录日志而非返回错误，因为 ServeWs 是顶层 handler。
        logger.Warn("WS", "upgrade error: %v", err)
    }
    return
}
```

**Design rationale:**
- Separate file (`origin.go`) keeps origin logic isolated and independently testable.
- Empty entries after split are filtered (not treated as "malformed") — this prevents the dangerous case where `ALLOWED_ORIGINS=,,,` silently allows all origins.
- CORS rejection is logged once in `CheckOrigin`, not again in `ServeWs`, avoiding duplicate log entries.
- `CheckOriginAllowed` is exported for direct unit testing without needing HTTP requests.

### 5. `arthas-client/vercel.json` — SPA Configuration

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, immutable, max-age=31536000"
        }
      ]
    }
  ]
}
```

**Design rationale:** Vite outputs hashed filenames to `/assets/` by default. Vercel serves existing files first before applying rewrites, so static assets are served directly. The rewrite rule enables client-side routing for all other paths. Cache headers target only hashed assets to enable aggressive caching (1 year).

### 6. `arthas-client/.env.production.example`

```
VITE_WS_URL=wss://your-backend-domain/ws
```

Documents the required build-time variable without committing secrets. The actual value is set as a Vercel Environment Variable.

**Note:** No frontend code changes are needed — `websocket.ts` already reads `import.meta.env.VITE_WS_URL` with fallback to `ws://localhost:8080/ws`.

### 7. Dockerfile Optimization

**Current state:** Basic multi-stage build (Go 1.22 Alpine → Alpine runtime), no ldflags, no HEALTHCHECK.

**Changes:**
- Add `-ldflags "-s -w -X main.Version=${VERSION}"` to strip debug symbols and inject version
- Add `HEALTHCHECK` instruction for container orchestrators
- Verify final image stays under 30MB (Go binary ~8MB after stripping + Alpine base ~7MB ≈ ~15MB)

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=1.0.0
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-s -w -X main.Version=${VERSION}" \
    -o server ./cmd/server

FROM alpine:latest
RUN apk --no-cache add ca-certificates

# 📚 学习要点: 容器安全 - 非 root 用户
# 生产容器不应以 root 运行，遵循最小权限原则。
# UID 1000 是 HF Spaces 的默认用户 ID，确保平台兼容性。
# 如果进程被攻破，攻击者只能获得受限用户权限，无法修改系统文件。
RUN adduser -D -u 1000 appuser

WORKDIR /home/appuser
COPY --from=builder /app/server .
RUN chown appuser:appuser ./server

USER appuser

EXPOSE 7860
ENV PORT=7860
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -qO- http://localhost:7860/ping || exit 1
CMD ["./server"]
```

**Design rationale:**
- `-s -w` strips symbol table and DWARF debug info, reducing binary size by ~30%.
- `-X main.Version=${VERSION}` allows CI/CD to inject the git tag or commit hash.
- `HEALTHCHECK` enables Docker's built-in health monitoring (used by orchestrators like Docker Compose, Kubernetes).
- Alpine's BusyBox includes `wget`, no additional packages needed.
- **Non-root user (UID 1000):** 遵循最小权限原则，HF Spaces 默认以 UID 1000 运行，Railway/Fly.io 也支持非 root 容器。

## Data Models

This feature introduces no new persistent data models. The changes are purely operational:

| Item             | Type                    | Description                                      |
| ------------------| -------------------------| --------------------------------------------------|
| `Version`        | `string` (compile-time) | Server version, injected via ldflags             |
| `allowedOrigins` | `[]string` (runtime)    | Parsed from `ALLOWED_ORIGINS` env var at startup |
| Log entry        | Structured text         | `[RFC3339] [LEVEL] [MODULE] message`             |
| `Hub.done`       | `chan struct{}`         | Closed to signal shutdown                        |
| `Hub.wg`         | `sync.WaitGroup`        | Tracks active client goroutines                  |

**Environment Variables:**

| Variable | Component | Required | Default | Description |
|----------|-----------|----------|---------|-------------|
| `PORT` | Backend | No | `8080` | HTTP listen port |
| `ALLOWED_ORIGINS` | Backend | No | (empty = allow all) | Comma-separated allowed origins |
| `VITE_WS_URL` | Frontend (build-time) | No | `ws://localhost:8080/ws` | WebSocket server URL |
| `VERSION` | Backend (build-time) | No | `1.0.0` | Injected via Docker ARG / ldflags |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Origin list parsing preserves all entries

*For any* comma-separated string of valid origin URLs (with arbitrary leading/trailing whitespace per entry), parsing the string into an origin list SHALL produce exactly the same set of trimmed, non-empty origins in the same order. Empty entries (resulting from consecutive commas or trailing commas) SHALL be filtered out.

**Validates: Requirements 2.2, 3.4**

### Property 2: Origin validation correctness

*For any* origin string and any non-empty allowed origins list, the origin validation function SHALL return `true` if and only if the origin exactly matches one of the entries in the allowed list. When the allowed list is empty, the function SHALL return `true` for any origin.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 3: Structured log format invariant

*For any* log event (with any module name, any level, and any message string that does not contain newlines), the formatted log output SHALL match the pattern `[<RFC3339>] [<LEVEL>] [<MODULE>] <message>` where `<RFC3339>` is a valid RFC 3339 timestamp, `<LEVEL>` is one of INFO/WARN/ERROR, and `<MODULE>` is the provided module string.

**Validates: Requirements 4.1**

### Property 4: Zero-knowledge log invariant

*For any* message relay operation with any iv and ciphertext values, the log output produced during that operation SHALL NOT contain the iv or ciphertext strings. This property holds regardless of the content of iv/ciphertext (including strings that look like log metadata).

**Validates: Requirements 4.5**

### Property 5: Graceful shutdown bounded termination

*For any* set of active WebSocket connections (0 to N), after SIGTERM is received, the server process SHALL exit within 5 seconds. If all connections close before the timeout, the server SHALL exit immediately without waiting for the full timeout.

**Validates: Requirements 1.3, 1.4**

## Error Handling

| Scenario | Behavior | HTTP/WS Response |
|----------|----------|------------------|
| Invalid Origin on WS upgrade | Reject upgrade, log WARN (once, in CheckOrigin) | HTTP 403 Forbidden |
| `/ping` during shutdown | May return 503 (server closing listener) | HTTP 503 |
| SIGTERM received | Two-phase: stop listener → close WS connections → wait/timeout → exit 0 | N/A (process level) |
| `ALLOWED_ORIGINS` contains only empty entries | Treat as empty list (allow all), log WARN at startup | N/A |
| `PORT` non-numeric | `ListenAndServe` fails → log ERROR + exit 1 | N/A |
| WebSocket write fails during shutdown | writePump exits, wg.Done() called, doesn't block shutdown | N/A |
| In-flight messages during shutdown | May be lost — acceptable for E2EE chat with no persistence guarantee | N/A |
| Slowloris attack (slow headers) | `ReadHeaderTimeout: 10s` closes connection after timeout | Connection reset |

**Graceful shutdown sequence (two-phase):**

```
SIGTERM received
    │
    ▼
Phase 1: srv.Shutdown(ctx)
    ├── Stops accepting new TCP connections
    ├── Waits for active HTTP requests (non-WebSocket) to complete
    └── Returns immediately for hijacked (WebSocket) connections
    │
    ▼
Phase 2: hub.Stop()
    ├── Closes hub.done channel → Hub.Run() exits
    ├── Closes all client.send channels
    └── writePump detects closed channel → sends WS close frame → exits
    │
    ▼
Phase 3: hub.Wait() with timeout
    ├── Waits for all readPump/writePump goroutines (via WaitGroup)
    ├── If all done before timeout → exit immediately
    └── If timeout expires → log warning, force exit
    │
    ▼
Exit with code 0
```

**CORS rejection flow:**

1. WebSocket upgrade request arrives
2. `CheckOrigin` reads `Origin` header
3. If `allowedOrigins` is empty → return true (dev mode)
4. If origin matches any entry → return true
5. Otherwise → log WARN with rejected origin and remote addr, return false
6. Gorilla WebSocket library returns HTTP 403 to client
7. `ServeWs` detects CORS-specific error → does NOT double-log

## Testing Strategy

### Unit Tests (Example-Based)

| Test | What it verifies |
|------|-----------------|
| `TestPingEndpoint` | GET /ping returns 200 + "pong" |
| `TestPingNoAuth` | /ping accessible without any headers |
| `TestPingResponseTime` | /ping responds within 100ms |
| `TestPortDefault` | Server defaults to 8080 when PORT unset |
| `TestPortFromEnv` | Server uses PORT env var value |
| `TestStartupLog` | Startup log contains port, version, RFC 3339 timestamp |
| `TestOriginRejection403` | Non-allowed origin gets HTTP 403 on WS upgrade |
| `TestAllowedOriginAccepted` | Allowed origin successfully upgrades |
| `TestEmptyOriginsAllowAll` | Empty ALLOWED_ORIGINS allows any origin |
| `TestOriginsWithExtraCommas` | `"a.com,,b.com,"` parses to `["a.com", "b.com"]` |
| `TestLogConnectDisconnect` | Connect/disconnect logs contain client ID + count |
| `TestLogRoomCreateDestroy` | Room events log room ID + count |
| `TestLogNoCORSDoubleLog` | CORS rejection produces exactly one log entry |
| `TestVersionLdflags` | Version injected via ldflags appears in startup log |
| `TestReadHeaderTimeout` | Slow client sending headers is disconnected after 10s |

### Property-Based Tests

> 📚 **为什么使用 Property-Based Testing（PBT）而非仅靠 Example-Based Testing？**
>
> Example-based 测试验证的是「这几个具体输入产生了正确输出」，而 PBT 验证的是「对于所有满足约束的输入，某个性质始终成立」。
>
> 类比：Example-based 测试像是在地图上标注几个已知安全的点，PBT 像是证明整个区域都是安全的。
>
> 实际价值：
> - PBT 能发现开发者未想到的边界情况（如空字符串、超长输入、特殊字符）
> - 一个 property test 等价于数百个 example test 的覆盖范围
> - 当 property test 失败时，框架会自动「缩小」（shrink）输入到最小反例，便于调试
>
> 局限性：`testing/quick` 是 Go 内置的简易 PBT 库，不支持 shrinking。
> 如果未来需要更强的 PBT 能力，可考虑 `github.com/leanovate/gopter`（但当前不引入新依赖）。

**Library:** Go standard `testing/quick` package (no new dependencies)

**Configuration:** Minimum 100 iterations per property test.

| Test | Property | Tag |
|------|----------|-----|
| `TestParseOriginsProperty` | Property 1: Origin list parsing | `Feature: production-deployment, Property 1: Origin list parsing preserves all entries` |
| `TestOriginValidationProperty` | Property 2: Origin validation | `Feature: production-deployment, Property 2: Origin validation correctness` |
| `TestLogFormatProperty` | Property 3: Log format invariant | `Feature: production-deployment, Property 3: Structured log format invariant` |
| `TestNoSecretInLogsProperty` | Property 4: Zero-knowledge log | `Feature: production-deployment, Property 4: Zero-knowledge log invariant` |

### Integration Tests

| Test | What it verifies | Environment |
|------|-----------------|-------------|
| `TestGracefulShutdown` | SIGTERM → server stops accepting, exits within 5s | Any |
| `TestGracefulShutdownEarlyExit` | All clients disconnect → server exits before 5s timeout | Any |
| `TestDockerImageSize` | Built image < 30MB | CI only (`//go:build integration`) |
| `TestFrontendBuildSelfContained` | `npm run build` produces dist/ with no external CDN refs | CI only |

### Test File Locations

- `arthas-server/cmd/server/main_test.go` — ping endpoint, startup, shutdown, ReadHeaderTimeout
- `arthas-server/internal/logger/logger_test.go` — log format properties
- `arthas-server/internal/network/origin_test.go` — CORS/origin validation properties + unit tests
- `arthas-server/internal/network/hub_test.go` — Hub lifecycle, Stop/Wait behavior

## Design Decisions & Alternatives

本节记录关键设计决策及其替代方案，帮助理解为什么选择当前方案。

### `done` Channel vs `context.Context`

**选择：** 使用 `done chan struct{}` 作为 Hub 的关闭信号。

**替代方案：** 使用 `context.Context` 传播取消信号。

| 维度 | done channel | context.Context |
|------|-------------|-----------------|
| 语义清晰度 | 高 — 关闭即广播 | 中 — 需理解 context 树 |
| 代码复杂度 | 低 — 单一 channel | 中 — 需要传递 ctx 参数 |
| 可组合性 | 低 — 仅支持取消 | 高 — 支持超时、值传递 |
| Go 惯用程度 | 中 — 常见于简单场景 | 高 — 标准库推荐模式 |

**决策理由：**

```go
// 📚 学习要点: done channel 的「close 广播」模式
//
// Go 中关闭一个 channel 会让所有阻塞在该 channel 上的 goroutine 立即收到零值。
// 这是一种高效的「一对多」通知机制，无需知道有多少接收者。
//
// 对比 context.Context：
// - context 适合请求级别的生命周期管理（HTTP handler → 下游调用）
// - done channel 适合组件级别的生命周期管理（Hub 启动 → Hub 关闭）
//
// 在本项目中，Hub 是一个长生命周期组件，不是请求链的一部分，
// 因此 done channel 更直观。如果未来 Hub 需要调用外部服务（如数据库），
// 则应改用 context.Context 以支持超时传播。
close(h.done) // 所有 select 中监听 h.done 的 goroutine 都会被唤醒
```

### 全量日志 vs 采样日志

**选择：** 当前阶段保持全量日志输出。

**理由：** 作为学习项目，全量日志有助于观察系统行为。生产环境中若连接数 > 1000/s，应引入采样机制。设计中已预留 `logClientEvent` 扩展点，未来可无侵入地切换为采样模式。

### 非 root 容器用户

**选择：** 使用 UID 1000 的非 root 用户运行容器。

**理由：**
- 最小权限原则 — 即使容器被攻破，攻击者无法获得 root 权限
- HF Spaces 默认以 UID 1000 运行 Docker 容器
- Railway 和 Fly.io 均支持非 root 容器
- 唯一限制：无法绑定 < 1024 的端口（我们使用 7860，不受影响）

## Migration Notes

### Logging Migration

All existing `log.Printf("[Hub] ...")` and `log.Printf("[WS] ...")` calls must be replaced with the new logger:

| Before | After |
|--------|-------|
| `log.Printf("[Hub] Client %s connected. Total: %d", ...)` | `logger.Info("Hub", "client %s connected, total: %d", ...)` |
| `log.Printf("[WS] Upgrade error: %v", err)` | `logger.Warn("WS", "upgrade error: %v", err)` |
| `log.Printf("[Hub] Failed to marshal ...: %v", err)` | `logger.Error("Hub", "failed to marshal ...: %v", err)` |

### Files Modified

| File | Change Type |
|------|-------------|
| `cmd/server/main.go` | Major rewrite: explicit mux, http.Server, two-phase shutdown |
| `internal/network/hub.go` | Add done channel, wg, Stop(), Wait() methods |
| `internal/network/client.go` | Update upgrader CheckOrigin, update ServeWs for wg tracking |
| `internal/network/origin.go` | **New file**: origin parsing and validation |
| `internal/logger/logger.go` | **New file**: structured logging |
| `arthas-client/vercel.json` | **New file**: SPA rewrite + cache headers |
| `arthas-client/.env.production.example` | **New file**: documents VITE_WS_URL |
| `arthas-server/Dockerfile` | Add ldflags, HEALTHCHECK |

### Files NOT Modified

| File | Reason |
|------|--------|
| `arthas-client/src/network/websocket.ts` | Already reads `VITE_WS_URL` from `import.meta.env` |
| `internal/room/manager.go` | `RoomCount()` already exists |
| `internal/network/protocol.go` | No protocol changes needed |
| `go.mod` | No new dependencies |

## Appendix: Go 核心概念索引

本 feature 涉及的 Go 核心概念及其在代码中的位置，供学习时快速定位：

| 概念 | 文件 | 关键代码 | 学习价值 |
|------|------|----------|----------|
| Channel close 广播 | `hub.go` | `close(h.done)` | 一对多取消通知的惯用模式 |
| 无缓冲 Channel 同步 | `hub.go` | `register/unregister chan *Client` | 确保操作顺序性，理解阻塞语义 |
| select 多路复用 | `hub.go` | `select { case <-h.done: ... }` | 同时等待多个 channel 的核心机制 |
| HTTP Hijack | `client.go` | `upgrader.Upgrade(w, r, nil)` | WebSocket 如何从 HTTP 接管 TCP 连接 |
| sync.WaitGroup | `hub.go` + `client.go` | `wg.Add(2)` / `wg.Done()` / `wg.Wait()` | 等待一组 goroutine 完成 |
| Signal handling | `main.go` | `signal.Notify(quit, syscall.SIGTERM)` | 操作系统信号与 Go channel 的桥接 |
| context.WithTimeout | `main.go` | `context.WithTimeout(ctx, 5*time.Second)` | 带截止时间的取消传播 |
| Goroutine 生命周期 | `client.go` | `go client.readPump()` / `writePump()` | 每个连接的并发读写模型 |
| sync.RWMutex | `hub.go` | `h.mu.RLock()` / `h.mu.Lock()` | 读多写少场景的锁优化 |
| 包级变量初始化顺序 | `origin.go` | `var allowedOrigins []string` | 理解 init 时序与并发安全 |
| ldflags 编译注入 | `main.go` | `var Version = "1.0.0"` | 构建时配置的标准方式 |
| defer 栈执行顺序 | `client.go` | `defer func() { ... }()` | LIFO 清理资源的惯用模式 |
| http.Server 结构体 | `main.go` | `&http.Server{ReadHeaderTimeout: ...}` | 生产级 HTTP 服务器配置 |
| 12-Factor App 日志 | `logger.go` | `log.SetOutput(os.Stdout)` | 容器化部署的日志最佳实践 |
