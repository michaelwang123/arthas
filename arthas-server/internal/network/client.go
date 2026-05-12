package network

import (
	"log"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
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

// Client 代表一个 WebSocket 客户端连接
type Client struct {
	ID   string
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
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

		c.hub.HandleMessage(c.ID, message)
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
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
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
