// websocket.go 管理与 Arthas 服务器的 WebSocket 连接。
//
// 本文件封装了 gorilla/websocket 库，提供线程安全的消息读写接口。
// 上层 chat 包通过 Send/ReadMessage 与服务器通信，无需关心 WebSocket 帧类型、
// 超时管理和并发写入限制等底层细节。
//
// 📚 学习要点: 线程安全模型（Thread-Safety Model）
// gorilla/websocket 的 Conn 支持一个并发 reader 和一个并发 writer，
// 但不支持多个并发 writer。本包通过以下设计确保线程安全：
//
//   - ReadMessage() 只在 readPump goroutine 中调用（单一 reader）
//   - 所有写操作通过 sendCh channel 序列化到 writePump goroutine（单一 writer）
//   - Send() 是非阻塞的 channel 发送，任何 goroutine 都可以安全调用
//
// 这与服务器端 client.go 的 writePump 模式完全一致，是 Go WebSocket
// 应用中的标准并发模式。
package network

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// 连接超时常量（与服务器 client.go 对齐）
const (
	// writeWait 是写操作的超时时间。
	// 如果 10 秒内无法完成写入（网络拥塞或对端无响应），
	// 连接将被视为不健康并关闭。
	writeWait = 10 * time.Second

	// pongWait 是读超时时间（等待服务器 Ping 的最大间隔）。
	// 服务器每 25 秒发送一次 Ping，40 秒 = 25s × 1.6，
	// 提供足够的容错余量（网络延迟、GC 暂停等）。
	pongWait = 40 * time.Second

	// maxMessageSize 是单条 WebSocket 消息的最大字节数。
	// 与服务器的 maxMessageSize 一致（100KB），防止恶意或异常的超大消息
	// 耗尽客户端内存。
	maxMessageSize = 102400

	// sendChCapacity 是发送队列的容量。
	// 16 条消息的缓冲足以应对正常聊天场景的突发流量，
	// 同时限制内存使用（16 × 100KB = 1.6MB 最坏情况）。
	sendChCapacity = 16
)

// ErrSendQueueFull 在发送队列已满时返回。
// 调用方应向用户显示错误提示，而非静默丢弃消息。
var ErrSendQueueFull = errors.New("send queue full: message not sent")

// Conn 封装 WebSocket 连接，提供线程安全的读写操作。
//
// 📚 学习要点: 为什么封装 gorilla/websocket.Conn？
// gorilla/websocket 的 Conn 支持并发读（一个 reader）和并发写（一个 writer），
// 但不支持多个并发写者。如果 main goroutine 需要发送 Pong 响应，
// 同时 chat session 需要发送聊天消息，直接调用 WriteMessage 会产生数据竞争。
// 通过 sendCh + writePump 模式，将所有写操作序列化到单一 goroutine，
// 确保线程安全且代码易于推理。
type Conn struct {
	conn      *websocket.Conn    // 底层 WebSocket 连接
	sendCh    chan []byte        // 发送队列：所有写操作通过此 channel 序列化
	ctx       context.Context    // 连接生命周期上下文
	cancel    context.CancelFunc // 取消函数：任何退出路径调用以通知所有 goroutine
	closeOnce sync.Once          // 确保底层连接只关闭一次
}

// Dial 建立 WebSocket 连接到指定服务器 URL。
//
// 连接参数与服务器端配置对齐：
//   - HandshakeTimeout: 10s（防止慢速网络下无限等待）
//   - ReadBufferSize: 128KB（匹配服务器的 Upgrader 配置）
//   - WriteBufferSize: 128KB（匹配服务器的 Upgrader 配置）
//   - Origin: "arthas-cli"（用于服务器 CORS 白名单验证）
//
// 连接成功后自动：
//   - 设置 ReadLimit 为 maxMessageSize（100KB）
//   - 设置初始读超时为 pongWait（40s）
//   - 注册 PongHandler 以在收到 Pong 时重置读超时
//   - 启动 writePump goroutine
//
// 📚 学习要点: Origin 头与 CORS
// gorilla/websocket 的 Dialer 默认不发送 Origin 头。
// 生产环境服务器配置了 ALLOWED_ORIGINS 时，空 Origin 会被拒绝（HTTP 403）。
// 解决方案：在握手头中设置 Origin: "arthas-cli"，
// 服务器管理员需要在 ALLOWED_ORIGINS 中添加 "arthas-cli"。
// 开发模式下（ALLOWED_ORIGINS 未设置）无此限制。
func Dial(serverURL string) (*Conn, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		ReadBufferSize:   131072, // 128KB，匹配服务器 Upgrader 配置
		WriteBufferSize:  131072, // 128KB，匹配服务器 Upgrader 配置
	}

	// 设置 Origin 头用于 CORS 兼容
	header := http.Header{}
	header.Set("Origin", "arthas-cli")

	wsConn, _, err := dialer.Dial(serverURL, header)
	if err != nil {
		return nil, err
	}

	// 设置读取限制，防止服务器发送超大消息耗尽内存
	wsConn.SetReadLimit(maxMessageSize)

	// 设置初始读超时：如果 40 秒内没有收到任何消息（包括 Pong），
	// ReadMessage 将返回超时错误，触发连接关闭
	wsConn.SetReadDeadline(time.Now().Add(pongWait))

	// 📚 学习要点: PongHandler 与心跳机制
	// 服务器每 25 秒发送 WebSocket-level Ping 帧，客户端自动回复 Pong
	// （gorilla/websocket 默认行为）。但我们还需要在收到 Pong 时重置读超时，
	// 证明连接仍然活跃。如果 40 秒内没有收到 Pong，说明连接已断开。
	//
	// 注意：这里处理的是 WebSocket 协议级别的 Ping/Pong（控制帧），
	// 与应用层的 MsgPing/MsgPong（0x18/0x06）是不同的机制：
	//   - WebSocket Ping/Pong: 检测 TCP 连接存活（由 gorilla/websocket 自动处理）
	//   - MsgPing/MsgPong: 应用层心跳，用于前端延迟测量（由 chat session 处理）
	wsConn.SetPongHandler(func(string) error {
		wsConn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	ctx, cancel := context.WithCancel(context.Background())

	c := &Conn{
		conn:   wsConn,
		sendCh: make(chan []byte, sendChCapacity),
		ctx:    ctx,
		cancel: cancel,
	}

	// 启动 writePump goroutine：从 sendCh 消费消息并写入 WebSocket
	go c.writePump()

	return c, nil
}

// Send 将消息放入发送队列（非阻塞）。
//
// 任何 goroutine 都可以安全调用此方法。消息会被 writePump goroutine
// 从 sendCh 中取出并写入 WebSocket。
//
// 如果发送队列已满（16 条消息未被消费），返回 ErrSendQueueFull。
// 这通常意味着网络拥塞或 writePump 已退出，调用方应通知用户。
func (c *Conn) Send(data []byte) error {
	select {
	case c.sendCh <- data:
		return nil
	default:
		return ErrSendQueueFull
	}
}

// ReadMessage 从 WebSocket 读取下一条二进制消息（阻塞）。
//
// 每次成功读取后重置读超时为 pongWait（40s），确保活跃连接不会超时。
// 此方法应只在单一 goroutine（readPump）中调用。
//
// 返回的错误可能是：
//   - 读超时（连接不活跃）
//   - 连接被对端关闭（Close frame）
//   - 网络错误
func (c *Conn) ReadMessage() ([]byte, error) {
	_, message, err := c.conn.ReadMessage()
	if err != nil {
		return nil, err
	}

	// 成功读取消息，重置读超时
	c.conn.SetReadDeadline(time.Now().Add(pongWait))

	return message, nil
}

// Close 优雅关闭 WebSocket 连接。
//
// 关闭流程：
//  1. 取消 context（通知 writePump 退出）
//  2. 发送 WebSocket Close 帧（通知服务器客户端主动断开）
//  3. 关闭底层连接
//
// 📚 学习要点: 优雅关闭（Graceful Close）
// WebSocket 协议定义了关闭握手：发送 Close 帧后等待对端回复 Close 帧。
// 这里我们发送 Close 帧后直接关闭连接（不等待回复），因为：
//   - CLI 退出时不需要等待服务器确认
//   - 服务器会在收到 Close 帧或检测到连接断开时清理资源
//   - 简化实现，避免关闭超时的复杂处理
func (c *Conn) Close() error {
	// 取消 context，通知 writePump goroutine 退出
	c.cancel()

	// 📚 学习要点: sync.Once 防止 double-close
	// Close() 可能被多个路径调用（defer、signal handler、/quit 命令），
	// writePump 退出时也需要关闭连接。sync.Once 确保底层 WebSocket 连接
	// 只被关闭一次，避免重复关闭的资源浪费和潜在错误。
	var closeErr error
	c.closeOnce.Do(func() {
		// 发送 WebSocket Close 帧（尽力而为，忽略错误）
		closeMsg := websocket.FormatCloseMessage(websocket.CloseNormalClosure, "")
		_ = c.conn.WriteControl(
			websocket.CloseMessage,
			closeMsg,
			time.Now().Add(writeWait),
		)
		// 关闭底层连接
		closeErr = c.conn.Close()
	})
	return closeErr
}

// writePump 从 sendCh 读取数据并写入 WebSocket（独立 goroutine）。
//
// 📚 学习要点: writePump 模式（Write Pump Pattern）
// 这是 Go WebSocket 应用中的标准模式，解决以下问题：
//
//  1. 线程安全：gorilla/websocket 不支持并发写入。
//     writePump 是唯一的写者，所有其他 goroutine 通过 sendCh 提交写请求。
//
//  2. 超时控制：每次写入前设置 writeWait 超时（10s）。
//     如果网络拥塞导致写入阻塞超过 10s，连接被视为不健康并关闭。
//
//  3. 生命周期管理：通过 ctx.Done() 感知连接关闭，及时退出。
//     避免 goroutine 泄漏（writePump 永远等待已关闭的 sendCh）。
//
// writePump 退出条件：
//   - ctx 被取消（Close() 被调用）
//   - 写入 WebSocket 失败（网络错误）
func (c *Conn) writePump() {
	defer c.closeOnce.Do(func() {
		c.conn.Close()
	})

	for {
		select {
		case <-c.ctx.Done():
			// 连接关闭，退出 writePump
			return

		case message, ok := <-c.sendCh:
			if !ok {
				// sendCh 被关闭（不应发生，但防御性处理）
				return
			}

			// 设置写超时：如果 10 秒内无法完成写入，放弃并关闭连接
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))

			err := c.conn.WriteMessage(websocket.BinaryMessage, message)
			if err != nil {
				// 写入失败（网络错误、连接已关闭等），退出 writePump。
				// 取消 context 通知其他 goroutine 连接已断开。
				c.cancel()
				return
			}
		}
	}
}

// Done 返回 context 的 Done channel，用于检测连接是否已关闭。
//
// 上层代码可以在 select 中监听此 channel：
//
//	select {
//	case <-conn.Done():
//	    // 连接已关闭，执行清理
//	case msg := <-msgCh:
//	    // 处理消息
//	}
func (c *Conn) Done() <-chan struct{} {
	return c.ctx.Done()
}
