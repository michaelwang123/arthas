package network

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/arthas/arthas-server/internal/logger"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/vmihailenco/msgpack/v5"
)

const (
	// 写入超时
	writeWait = 10 * time.Second

	// 读取超时（心跳间隔的 1.5 倍）
	pongWait = 40 * time.Second

	// 发送缓冲区大小
	sendBufferSize = 256

	// 📚 学习要点: maxMessageSize 的计算依据
	// 文件传输中最大的单条消息是 MSG_SEND_FILE_CHUNK：
	//   - 64KB 明文 chunk + 16B GCM auth tag + 12B IV = ~65,564 bytes 加密数据
	//   - msgpack 信封（type + data map header + transferId + index）≈ 50 bytes
	//   - 总计 ≈ 65,614 bytes
	// 设置为 100KB (102,400) 提供了充足的余量，同时防止恶意客户端发送超大消息。
	// 之前的 4096 字节限制仅适用于纯文本聊天消息场景。
	maxMessageSize = 102400

	// 📚 学习要点: 文件传输发送超时
	// SendFileData 使用带超时的阻塞发送，防止慢接收方拖住整个系统。
	// 5 秒超时的选择依据：
	// - 足够长：正常网络波动（1-2s）不会误判为超时
	// - 足够短：不会让发送方等待过久（影响其他接收方的体验）
	// - 与客户端 60s 传输超时配合：即使某个接收方超时，发送方仍继续发送给其他人
	fileDataSendTimeout = 5 * time.Second
)

// 📚 学习要点: Upgrader 配置与缓冲区大小
// ReadBufferSize/WriteBufferSize 控制 WebSocket 帧的读写缓冲区大小。
// 设置为 128KB (131072) 以适应文件传输场景：
// - 单个文件分片加密后约 65KB + msgpack 信封
// - 128KB 缓冲区确保单个 WebSocket 帧能容纳完整的文件分片消息
// - 如果缓冲区小于消息大小，gorilla/websocket 会自动分配临时缓冲区（性能损失）
//
// 📚 学习要点: 内存影响分析
// 每个 WebSocket 连接占用 ReadBufferSize + WriteBufferSize = 256KB 缓冲区。
// 50 个并发连接 = 50 × 256KB = 12.5MB — 对服务器来说完全可接受。
// 之前 1024 字节的配置仅适用于纯文本聊天消息场景。
//
// CheckOrigin 是安全关键函数，在 HTTP → WebSocket 升级前调用。
// 如果 CheckOrigin 返回 false，gorilla/websocket 会返回 HTTP 403 并
// 产生包含 "origin not allowed" 的错误。
var upgrader = websocket.Upgrader{
	ReadBufferSize:  131072,
	WriteBufferSize: 131072,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if CheckOriginAllowed(origin) {
			return true
		}
		logger.Warn("CORS", "rejected origin: %s from %s", origin, r.RemoteAddr)
		return false
	},
}

// isCORSRejection 检测 WebSocket 升级错误是否由 Origin 验证失败引起。
//
// 📚 学习要点: 脆弱的字符串匹配（Fragile String Matching）
// gorilla/websocket 在 CheckOrigin 返回 false 时，返回包含
// "origin not allowed" 的错误。我们通过字符串匹配识别这类错误，
// 避免在 ServeWs 中重复记录（CheckOrigin 内已经记录过了）。
//
// ⚠️ 脆弱性警告：此实现依赖 gorilla/websocket 的内部错误消息文本。
// 如果库更新了错误消息措辞，此检测会静默失效（退化为双重日志，不影响功能）。
// 更健壮的方式是使用 errors.Is/errors.As（如果库导出了错误类型），
// 但 gorilla/websocket 未导出此错误类型，只能用字符串匹配。
//
// 缓解策略：Task 6.2 中的单元测试会作为回归守卫，
// 当库升级导致字符串变化时测试会失败，提醒开发者更新此处。
func isCORSRejection(err error) bool {
	return strings.Contains(err.Error(), "origin not allowed")
}

// 消息频率限制常量
const (
	rateLimitWindow   = 10 * time.Second // 滑动窗口大小
	rateLimitMaxCount = 10               // 窗口内最大消息数
)

// Client 代表一个 WebSocket 客户端连接
type Client struct {
	ID       string
	RoomID   string // 当前所在房间 ID（空字符串 = 未加入任何房间）
	Name     string // 显示昵称（创建/加入房间时设置）
	Color    string // 颜色标识（服务器分配）
	LastPong int64  // 最近一次收到 Pong 的时间戳（UnixMilli）
	hub      *Hub
	conn     *websocket.Conn
	send     chan []byte

	// 消息频率限制：滑动窗口时间戳
	msgTimestamps []int64
	msgMu         sync.Mutex

	// 📚 学习要点: 文件传输活跃状态追踪（服务器端最小状态）
	// 服务器保持零知识架构，但需要追踪「每个客户端是否有活跃传输」以实现：
	// 1. 限制每客户端同时只有 1 个活跃传输（防止资源滥用）
	// 2. 客户端断线时清理传输状态（通知接收方发送 CANCEL）
	// 3. 传输超时清理（COMPLETE/CANCEL 消息丢失时的兜底机制）
	//
	// 注意：服务器只追踪 transferId 和时间戳，不存储任何文件内容。
	// activeTransferID 为空字符串表示当前没有活跃传输。
	activeTransferID string    // 当前活跃传输的 ID（空字符串 = 无活跃传输）
	transferStartAt  time.Time // 传输开始时间（用于服务器端超时清理）
}

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
		// CORS 拒绝已在 CheckOrigin 中记录，避免重复日志
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
	// 如果 Hub 已经停止（done 已关闭），register channel 没有接收者（Run 已退出），
	// 直接发送 `hub.register <- client` 会永久阻塞（goroutine 泄漏）。
	// 使用 select + done 避免了这个死锁：
	// - 正常情况：Run() 在运行，register 有接收者，走第一个 case
	// - 关闭中：done 已关闭，走第二个 case，直接关闭连接并返回
	select {
	case hub.register <- client:
	case <-hub.done:
		// Hub 已关闭，直接关闭连接，不注册
		conn.Close()
		return
	}

	// 📚 学习要点: WaitGroup 的 Add 必须在 goroutine 启动前调用
	// 如果在 goroutine 内部调用 Add()，可能出现以下竞态条件：
	//   1. main goroutine 调用 hub.Wait()（此时计数为 0）
	//   2. Wait() 立即返回（认为没有活跃的 goroutine）
	//   3. 新 goroutine 才执行 Add(1)
	// 结果：main 提前退出，goroutine 被强制终止，可能丢失数据。
	// 在启动前调用 Add(2) 确保 Wait() 能感知到即将启动的 goroutine。
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

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				logger.Warn("WS", "read error from %s: %v", c.ID, err)
			}
			break
		}

		c.hub.ParseAndHandleMessage(c, message)
	}
}

func (c *Client) writePump() {
	pingTicker := time.NewTicker(25 * time.Second)
	defer func() {
		pingTicker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub 关闭了 channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			err := c.conn.WriteMessage(websocket.BinaryMessage, message)
			if err != nil {
				return
			}

		case <-pingTicker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			// WebSocket-level ping for connection liveness
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
			// Application-level Ping (MsgPing) for frontend latency measurement
			pingMsg := Message{Type: MsgPing, Data: PingData{T: time.Now().UnixMilli()}}
			pingData, err := msgpack.Marshal(pingMsg)
			if err != nil {
				logger.Error("WS", "failed to marshal Ping message for %s: %v", c.ID, err)
				return
			}
			if err := c.conn.WriteMessage(websocket.BinaryMessage, pingData); err != nil {
				return
			}
		}
	}
}

// Send 发送消息到客户端
func (c *Client) Send(data []byte) {
	select {
	case c.send <- data:
	default:
		// 缓冲区满，丢弃
	}
}

// SendFileData 为文件传输消息提供带超时的阻塞发送。
// 与普通 Send() 不同，此方法会等待 send channel 有空间，
// 而不是在缓冲区满时静默丢弃。
//
// 📚 学习要点: 背压（Backpressure）设计 — 为什么文件传输需要阻塞发送？
//
// 普通聊天消息使用非阻塞 Send() 是正确的设计：
// - 聊天消息丢失一条不影响整体体验（用户可以重新发送）
// - 阻塞会导致 Hub.Run() goroutine 被慢客户端拖住，影响所有用户
// - sendBufferSize=256 对聊天消息绰绰有余（每秒最多几条消息）
//
// 但文件传输场景完全不同：
// - 丢失任何一个 chunk 都会导致整个传输失败（接收方永远收不齐所有分片）
// - 发送方以 10ms 间隔发送 80 个 chunk（5MB 文件），服务器 broadcast 给 N-1 个接收方
// - 如果某个接收方网络慢，其 send channel 填满后 chunk 被非阻塞 Send() 丢弃
// - 接收方永远无法重组完整文件 → 60s 后超时 → 用户体验极差
//
// 解决方案：为文件传输提供独立的发送方法，带 5s 超时：
//   - 成功（true）：chunk 进入 send channel，将被 writePump 发送到客户端
//   - 超时（false）：接收方 send buffer 持续满 5s，认为该接收方传输失败
//     调用方（BroadcastFileData）记录警告但不影响其他接收方的传输
//
// 📚 学习要点: 为什么不直接修改 Send() 为阻塞？
//  1. Send() 被 Hub.Run() 的消息路由逻辑调用（如 Broadcast）
//  2. 如果 Send() 阻塞，一个慢客户端会拖住整个 Hub 事件循环
//  3. Hub 事件循环被阻塞 = 所有客户端的消息都无法处理 = 全局卡死
//  4. 文件传输的 BroadcastFileData 使用独立 goroutine 并发发送，
//     即使某个接收方阻塞 5s，也不影响 Hub 主循环和其他接收方
//
// 📚 学习要点: time.After 的 GC 影响
// time.After(duration) 创建一个 Timer，即使 select 走了另一个 case，
// Timer 也要等到超时后才会被 GC 回收。对于高频调用（每个 chunk 对每个接收方），
// 这可能产生大量短生命周期 Timer 对象。
// 在当前场景下（最多 80 chunks × 49 接收方 = 3920 次调用/传输），
// 这个开销可以接受。如果未来需要优化，可以改用 time.NewTimer + timer.Stop()。
func (c *Client) SendFileData(data []byte) bool {
	select {
	case c.send <- data:
		return true
	case <-time.After(fileDataSendTimeout):
		// 接收方 send buffer 持续满 5s，认为该接收方传输失败
		return false
	}
}

func generateID() string {
	return uuid.New().String()[:8]
}

// IsRateLimited 检查客户端是否超过消息频率限制。
// 使用滑动窗口算法：保留最近 10 秒内的消息时间戳，
// 如果窗口内消息数 >= rateLimitMaxCount，则返回 true。
func (c *Client) IsRateLimited() bool {
	c.msgMu.Lock()
	defer c.msgMu.Unlock()

	now := time.Now().UnixMilli()
	windowStart := now - rateLimitWindow.Milliseconds()

	// 清除窗口外的旧时间戳
	validIdx := 0
	for _, ts := range c.msgTimestamps {
		if ts > windowStart {
			c.msgTimestamps[validIdx] = ts
			validIdx++
		}
	}
	c.msgTimestamps = c.msgTimestamps[:validIdx]

	// 检查是否超限
	if len(c.msgTimestamps) >= rateLimitMaxCount {
		return true
	}

	// 记录本次消息时间戳
	c.msgTimestamps = append(c.msgTimestamps, now)
	return false
}
