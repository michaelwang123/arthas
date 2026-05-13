package network

import (
	"log"
	"net/http"
	"sync"
	"time"

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

	// 最大消息大小
	maxMessageSize = 4096
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // MVP 阶段允许所有来源
	},
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
}

// ServeWs 处理 WebSocket 升级请求
func ServeWs(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[WS] Upgrade error: %v", err)
		return
	}

	client := &Client{
		ID:   generateID(),
		hub:  hub,
		conn: conn,
		send: make(chan []byte, sendBufferSize),
	}

	hub.register <- client

	// 启动读写协程
	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
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
				log.Printf("[WS] Read error from %s: %v", c.ID, err)
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
				log.Printf("[WS] Failed to marshal Ping message for %s: %v", c.ID, err)
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
