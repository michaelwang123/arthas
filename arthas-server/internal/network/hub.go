package network

import (
	"log"
	"sync"

	"github.com/arthas/arthas-server/internal/game"
	"github.com/vmihailenco/msgpack/v5"
)

// Hub 管理所有 WebSocket 连接
type Hub struct {
	mu         sync.RWMutex
	clients    map[string]*Client
	game       *game.Game
	register   chan *Client
	unregister chan *Client
}

func NewHub(g *game.Game) *Hub {
	h := &Hub{
		clients:    make(map[string]*Client),
		game:       g,
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}

	go h.run()
	return h
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()

			// 添加玩家到游戏
			h.game.AddPlayer(client.ID)

			// 发送欢迎消息
			welcome := Message{
				Type: MsgWelcome,
				Data: WelcomeData{
					PlayerID: client.ID,
					GameConfig: GameConfig{
						WorldWidth:  game.WorldWidth,
						WorldHeight: game.WorldHeight,
						TickRate:    game.TickRate,
					},
				},
			}
			data, _ := msgpack.Marshal(welcome)
			client.Send(data)

			// 通知其他玩家
			h.broadcastExcept(client.ID, Message{
				Type: MsgPlayerJoined,
				Data: map[string]interface{}{"id": client.ID},
			})

			log.Printf("[Hub] Client %s registered. Total: %d", client.ID, len(h.clients))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.send)
			}
			h.mu.Unlock()

			// 从游戏移除
			h.game.RemovePlayer(client.ID)

			// 通知其他玩家
			h.broadcastExcept(client.ID, Message{
				Type: MsgPlayerLeft,
				Data: map[string]interface{}{"id": client.ID},
			})

			log.Printf("[Hub] Client %s unregistered. Total: %d", client.ID, len(h.clients))
		}
	}
}

// BroadcastGameState 广播游戏状态给所有客户端
func (h *Hub) BroadcastGameState(state *game.GameStateSnapshot) {
	msg := Message{
		Type: MsgGameState,
		Data: state,
	}

	data, err := msgpack.Marshal(msg)
	if err != nil {
		log.Printf("[Hub] Failed to marshal game state: %v", err)
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, client := range h.clients {
		select {
		case client.send <- data:
		default:
			// 客户端发送缓冲区满，跳过
		}
	}
}

// SendToPlayer 发送消息给特定玩家
func (h *Hub) SendToPlayer(playerID string, msgType uint8, msgData interface{}) {
	h.mu.RLock()
	client, ok := h.clients[playerID]
	h.mu.RUnlock()

	if !ok {
		return
	}

	msg := Message{Type: msgType, Data: msgData}
	data, err := msgpack.Marshal(msg)
	if err != nil {
		return
	}

	select {
	case client.send <- data:
	default:
	}
}

func (h *Hub) broadcastExcept(excludeID string, msg Message) {
	data, err := msgpack.Marshal(msg)
	if err != nil {
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()

	for id, client := range h.clients {
		if id == excludeID {
			continue
		}
		select {
		case client.send <- data:
		default:
		}
	}
}

// HandleMessage 处理来自客户端的消息
func (h *Hub) HandleMessage(clientID string, raw []byte) {
	var msg Message
	if err := msgpack.Unmarshal(raw, &msg); err != nil {
		log.Printf("[Hub] Failed to unmarshal message from %s: %v", clientID, err)
		return
	}

	switch msg.Type {
	case MsgPlayerInput:
		h.handlePlayerInput(clientID, msg.Data)
	case MsgSkillUse:
		h.handleSkillUse(clientID, msg.Data)
	case MsgPong:
		// 心跳回复，可以计算 RTT
	}
}

func (h *Hub) handlePlayerInput(clientID string, data interface{}) {
	// MessagePack 解码后是 map[string]interface{}
	m, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	seq := toUint32(m["seq"])
	dx := toFloat64(m["dx"])
	dy := toFloat64(m["dy"])
	attack := toBool(m["attack"])
	mouseX := toFloat64(m["mouseX"])
	mouseY := toFloat64(m["mouseY"])

	h.game.HandleInput(clientID, seq, dx, dy, attack, mouseX, mouseY)
}

func (h *Hub) handleSkillUse(clientID string, data interface{}) {
	m, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	skillID := toInt(m["skillId"])
	targetX := toFloat64(m["targetX"])
	targetY := toFloat64(m["targetY"])

	h.game.HandleSkillUse(clientID, skillID, targetX, targetY)
}

// 类型转换辅助函数
func toFloat64(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int64:
		return float64(val)
	case int:
		return float64(val)
	case uint64:
		return float64(val)
	default:
		return 0
	}
}

func toUint32(v interface{}) uint32 {
	switch val := v.(type) {
	case uint64:
		return uint32(val)
	case int64:
		return uint32(val)
	case int:
		return uint32(val)
	case float64:
		return uint32(val)
	default:
		return 0
	}
}

func toInt(v interface{}) int {
	switch val := v.(type) {
	case int64:
		return int(val)
	case int:
		return val
	case uint64:
		return int(val)
	case float64:
		return int(val)
	default:
		return 0
	}
}

func toBool(v interface{}) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}
