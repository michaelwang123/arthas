package network

import (
	"fmt"
	"sync"
	"time"

	"github.com/arthas/arthas-server/internal/logger"
	"github.com/arthas/arthas-server/internal/room"
	gonanoid "github.com/matoous/go-nanoid/v2"
	"github.com/vmihailenco/msgpack/v5"
)

// Hub 管理所有 WebSocket 连接，并将消息路由到对应的房间处理逻辑。
//
// 📚 学习要点: CSP 并发模型与关闭顺序
// Hub 采用 CSP（Communicating Sequential Processes）模型：
// - clients map 只在 Run() goroutine 中被修改（单一写者）
// - 其他 goroutine 通过 register/unregister channel 请求修改
//
// Goroutine 拓扑：
//
//	main goroutine → Hub.Run() goroutine
//	               → Client.readPump() goroutine (per client)
//	               → Client.writePump() goroutine (per client)
//
// 关闭顺序：
// 1. main() 调用 Hub.Stop() → 关闭 done channel
// 2. Run() 检测到 done 关闭 → 退出循环
// 3. Stop() 关闭所有 client.send channel → writePump 退出
// 4. writePump 退出后关闭 conn → readPump 读取失败退出
// 5. WaitGroup 计数归零 → main() 的 hub.Wait() 返回，继续退出
type Hub struct {
	roomManager *room.RoomManager
	clients     map[*Client]bool
	register    chan *Client
	unregister  chan *Client
	mu          sync.RWMutex

	// 📚 学习要点: done channel 的「close 广播」模式
	// 关闭一个 channel 会让所有阻塞在该 channel 上的 <-ch 操作立即返回零值。
	// 这是 Go 中实现「一对多取消通知」的惯用模式。
	// 当 Stop() 被调用时，close(done) 会同时唤醒 Run() 中的 select
	// 以及任何其他监听 done 的 goroutine，实现一对多的关闭通知。
	done chan struct{}

	// 📚 学习要点: sync.WaitGroup 用于等待一组 goroutine 完成
	// Add(n) 增加计数，Done() 减少计数，Wait() 阻塞直到计数归零。
	// 这里用于跟踪所有 readPump/writePump goroutine，确保关闭时等待它们退出。
	// 使用规则：Add() 必须在启动 goroutine 之前调用（在 ServeWs 中），
	// 否则可能出现 Wait() 在 Add() 之前返回的竞态条件。
	wg sync.WaitGroup
}

// NewHub 创建一个新的 Hub 实例，内部初始化 RoomManager。
func NewHub() *Hub {
	return &Hub{
		roomManager: room.NewRoomManager(),
		clients:     make(map[*Client]bool),
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		done:        make(chan struct{}),
	}
}

// Run 启动 Hub 主循环，处理客户端注册/注销事件。
// 当 done channel 被关闭时（通过 Stop() 调用），Run 退出循环并返回。
//
// 📚 学习要点: select 多路复用与 done channel
// select 语句让一个 goroutine 同时等待多个 channel 操作。
// 当 done channel 被关闭后，<-h.done 会立即返回零值（struct{}{}），
// 使得每次循环迭代都会匹配到该 case，从而退出 for 循环。
// 这是 Go 中实现「可取消事件循环」的标准模式。
func (h *Hub) Run() {
	for {
		select {
		case <-h.done:
			// 📚 学习要点: 关闭的 channel 立即返回零值
			// 一旦 done 被 close()，每次 select 都会走到这个 case，退出循环。
			// 这使得 Run() 可以被外部（Stop()）优雅地终止。
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
				close(client.send)
			}
			h.mu.Unlock()

			// 断线自动离开房间
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
//
// 📚 学习要点: 为什么使用 Lock()（写锁）而非 RLock()（读锁）？
// Stop() 需要修改 clients map（delete 操作）和关闭 send channel，
// 这是写操作。同时 clientCount() 使用 RLock 读取 map 长度。
// 如果 Stop() 用 RLock，会与 clientCount() 的 RLock 并发执行，
// 但 delete 操作不是并发安全的 — 必须用写锁互斥所有读者。
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
//
// 📚 学习要点: WaitGroup 的语义
// wg.Wait() 会阻塞调用者，直到内部计数器归零。
// 每个 readPump/writePump 在启动前调用 wg.Add(1)，退出时调用 wg.Done()。
// 当所有 pump goroutine 都退出后，Wait() 返回，表示可以安全退出进程。
//
// 典型调用模式（在 main.go 中）：
//
//	hub.Stop()   // 触发关闭
//	hub.Wait()   // 等待所有 goroutine 退出
//	os.Exit(0)   // 安全退出
func (h *Hub) Wait() {
	h.wg.Wait()
}

// HandleMessage 解析原始消息并根据类型路由到对应的处理函数。
func (h *Hub) HandleMessage(client *Client, msg *Message) {
	switch msg.Type {
	case MsgCreateRoom:
		h.handleCreateRoom(client, msg.Data)
	case MsgJoinRoom:
		h.handleJoinRoom(client, msg.Data)
	case MsgSendMessage:
		h.handleSendMessage(client, msg.Data)
	case MsgLeaveRoom:
		h.handleLeaveRoom(client, msg.Data)
	case MsgTyping:
		h.handleTyping(client, msg.Data)
	case MsgPong:
		h.handlePong(client, msg.Data)
	case MsgSendReaction:
		h.handleSendReaction(client, msg.Data)
	default:
		logger.Warn("Hub", "unknown message type 0x%02x from client %s", msg.Type, client.ID)
	}
}

// ParseAndHandleMessage 从原始字节解析消息并路由处理。
// 供 client.go 的 readPump 调用。
func (h *Hub) ParseAndHandleMessage(client *Client, raw []byte) {
	var msg Message
	if err := msgpack.Unmarshal(raw, &msg); err != nil {
		logger.Warn("Hub", "failed to unmarshal message from %s: %v", client.ID, err)
		h.sendError(client, ErrCodeInvalidMessage, "invalid message format")
		return
	}
	h.HandleMessage(client, &msg)
}

// --- 消息处理 stub（Task 2 实现） ---

func (h *Hub) handleCreateRoom(client *Client, data interface{}) {
	// Reject if client is already in a room
	if client.RoomID != "" {
		h.sendError(client, ErrCodeInvalidMessage, "already in a room")
		return
	}

	// Parse data — msgpack deserializes into map[string]interface{}
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		h.sendError(client, ErrCodeInvalidMessage, "invalid create room data")
		return
	}

	name, _ := dataMap["name"].(string)

	// Validate name: 1-20 characters, non-empty
	if len(name) == 0 || len([]rune(name)) > 20 {
		h.sendError(client, ErrCodeInvalidMessage, "name must be 1-20 characters")
		return
	}

	// Parse password (SHA-256 hash from client, 64 hex chars or empty)
	password, _ := dataMap["password"].(string)

	// Validate password: if non-empty, must be exactly 64 hex characters (SHA-256 hash)
	if password != "" && len(password) != 64 {
		h.sendError(client, ErrCodeInvalidMessage, "invalid password format")
		return
	}

	// Parse ephemeral — msgpack may deserialize as int64 or uint64
	var ephemeral int
	if v, ok := dataMap["ephemeral"].(int64); ok {
		ephemeral = int(v)
	} else if v, ok := dataMap["ephemeral"].(uint64); ok {
		ephemeral = int(v)
	}

	// Generate NanoID (21 chars) for roomId
	roomId, err := gonanoid.New()
	if err != nil {
		logger.Error("Hub", "failed to generate NanoID: %v", err)
		h.sendError(client, ErrCodeInvalidMessage, "failed to create room")
		return
	}

	// Create the room via RoomManager with password and ephemeral
	r := h.roomManager.CreateRoom(roomId, password, ephemeral)

	// Set client fields
	client.Name = name
	client.Color = generateColor(client.ID)
	client.RoomID = roomId

	// Add client as a member to the room
	member := &room.Member{
		ID:    client.ID,
		Name:  client.Name,
		Color: client.Color,
		SendFunc: func(data []byte) {
			client.Send(data)
		},
	}
	if err := r.AddMember(member); err != nil {
		logger.Error("Hub", "failed to add creator to room: %v", err)
		h.sendError(client, ErrCodeRoomFull, "room is full")
		return
	}

	// Send RoomCreated back to the client
	h.sendToClient(client, MsgRoomCreated, RoomCreatedData{
		RoomID: roomId,
	})

	// Send RoomJoined with the creator as the only member
	h.sendToClient(client, MsgRoomJoined, RoomJoinedData{
		RoomID: roomId,
		Members: []MemberInfo{
			{
				ID:    client.ID,
				Name:  client.Name,
				Color: client.Color,
			},
		},
		HasPassword: password != "",
		Ephemeral:   ephemeral,
	})

	logger.Info("Hub", "room %s created by client %s (%s), total rooms: %d", roomId, client.ID, name, h.roomManager.RoomCount())
}

func (h *Hub) handleJoinRoom(client *Client, data interface{}) {
	// Reject if client is already in a room
	if client.RoomID != "" {
		h.sendError(client, ErrCodeInvalidMessage, "already in a room")
		return
	}

	// Parse data — msgpack deserializes into map[string]interface{}
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		h.sendError(client, ErrCodeInvalidMessage, "invalid join room data")
		return
	}

	roomId, _ := dataMap["roomId"].(string)
	name, _ := dataMap["name"].(string)
	password, _ := dataMap["password"].(string)

	// Validate name: 1-20 characters
	if len(name) == 0 || len([]rune(name)) > 20 {
		h.sendError(client, ErrCodeInvalidMessage, "name must be 1-20 characters")
		return
	}

	// Look up the room
	r := h.roomManager.GetRoom(roomId)
	if r == nil {
		h.sendError(client, ErrCodeRoomNotFound, "room not found")
		return
	}

	// Verify password if room is password-protected
	if r.PasswordHash != "" && password != r.PasswordHash {
		h.sendError(client, ErrCodeWrongPassword, "wrong password")
		return
	}

	// Check if room is full
	if r.IsFull() {
		h.sendError(client, ErrCodeRoomFull, "room is full")
		return
	}

	// Set client fields
	client.Name = name
	client.Color = generateColor(client.ID)
	client.RoomID = roomId

	// Get current members BEFORE adding the new client (for building the full member list)
	existingMembers := r.GetMembers()

	// Add client as a member to the room
	member := &room.Member{
		ID:    client.ID,
		Name:  client.Name,
		Color: client.Color,
		SendFunc: func(data []byte) {
			client.Send(data)
		},
	}
	if err := r.AddMember(member); err != nil {
		// Race condition: room became full between IsFull() check and AddMember()
		client.RoomID = ""
		h.sendError(client, ErrCodeRoomFull, "room is full")
		return
	}

	// Broadcast MemberJoined to all existing members (excluding the new joiner)
	memberJoinedMsg := Message{
		Type: MsgMemberJoined,
		Data: MemberJoinedData{
			ID:    client.ID,
			Name:  client.Name,
			Color: client.Color,
		},
	}
	broadcastData, err := msgpack.Marshal(memberJoinedMsg)
	if err != nil {
		logger.Error("Hub", "failed to marshal MemberJoined message: %v", err)
	} else {
		r.Broadcast(client.ID, broadcastData)
	}

	// Build full member list (existing members + the new joiner)
	members := make([]MemberInfo, 0, len(existingMembers)+1)
	for _, m := range existingMembers {
		members = append(members, MemberInfo{
			ID:    m.ID,
			Name:  m.Name,
			Color: m.Color,
		})
	}
	members = append(members, MemberInfo{
		ID:    client.ID,
		Name:  client.Name,
		Color: client.Color,
	})

	// Send RoomJoined to the joining client
	h.sendToClient(client, MsgRoomJoined, RoomJoinedData{
		RoomID:      roomId,
		Members:     members,
		HasPassword: r.PasswordHash != "",
		Ephemeral:   r.Ephemeral,
	})

	logger.Info("Hub", "client %s (%s) joined room %s", client.ID, name, roomId)
}

func (h *Hub) handleSendMessage(client *Client, data interface{}) {
	// 1. 检查客户端是否在房间中
	if client.RoomID == "" {
		h.sendError(client, ErrCodeNotInRoom, "not in a room")
		return
	}

	// 2. 解析 data 提取 iv 和 ciphertext
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		h.sendError(client, ErrCodeInvalidMessage, "invalid message data")
		return
	}

	iv, _ := dataMap["iv"].(string)
	ciphertext, _ := dataMap["ciphertext"].(string)

	// 3. 验证 iv 和 ciphertext 非空
	if iv == "" || ciphertext == "" {
		h.sendError(client, ErrCodeInvalidMessage, "iv and ciphertext must be non-empty strings")
		return
	}

	// 4. 频率限制检查
	if client.IsRateLimited() {
		h.sendError(client, ErrCodeRateLimited, "rate limited, please slow down")
		return
	}

	// 5. 查找房间
	r := h.roomManager.GetRoom(client.RoomID)
	if r == nil {
		// 房间已被销毁（极端情况）
		client.RoomID = ""
		h.sendError(client, ErrCodeNotInRoom, "room no longer exists")
		return
	}

	// 6. 构建 RelayMessage（附带服务器时间戳）
	now := time.Now().UnixMilli()
	relayMsg := Message{
		Type: MsgRelayMessage,
		Data: RelayMessageData{
			SenderID:   client.ID,
			SenderName: client.Name,
			IV:         iv,
			Ciphertext: ciphertext,
			T:          now,
		},
	}

	// 7. 序列化并广播给房间内其他成员（排除发送者）
	broadcastData, err := msgpack.Marshal(relayMsg)
	if err != nil {
		logger.Error("Hub", "failed to marshal RelayMessage: %v", err)
		return
	}
	r.Broadcast(client.ID, broadcastData)

	// 注意：不记录 ciphertext 内容（零知识设计）
}

func (h *Hub) handleSendReaction(client *Client, data interface{}) {
	// 1. 检查客户端是否在房间中
	if client.RoomID == "" {
		h.sendError(client, ErrCodeNotInRoom, "not in a room")
		return
	}

	// 2. 解析 data 提取 iv 和 ciphertext
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		h.sendError(client, ErrCodeInvalidMessage, "invalid reaction data")
		return
	}

	iv, _ := dataMap["iv"].(string)
	ciphertext, _ := dataMap["ciphertext"].(string)

	// 3. 验证 iv 和 ciphertext 非空
	if iv == "" || ciphertext == "" {
		h.sendError(client, ErrCodeInvalidMessage, "iv and ciphertext must be non-empty strings")
		return
	}

	// 4. 不做频率限制（反应是轻量交互）

	// 5. 查找房间
	r := h.roomManager.GetRoom(client.RoomID)
	if r == nil {
		client.RoomID = ""
		h.sendError(client, ErrCodeNotInRoom, "room no longer exists")
		return
	}

	// 6. 构建 RelayReaction 并广播给房间内其他成员
	now := time.Now().UnixMilli()
	relayMsg := Message{
		Type: MsgRelayReaction,
		Data: RelayReactionData{
			SenderID:   client.ID,
			SenderName: client.Name,
			IV:         iv,
			Ciphertext: ciphertext,
			T:          now,
		},
	}

	broadcastData, err := msgpack.Marshal(relayMsg)
	if err != nil {
		logger.Error("Hub", "failed to marshal RelayReaction: %v", err)
		return
	}
	r.Broadcast(client.ID, broadcastData)
}

func (h *Hub) handleLeaveRoom(client *Client, data interface{}) {
	// If client is not in a room, nothing to do
	if client.RoomID == "" {
		return
	}

	roomId := client.RoomID

	// Look up the room
	r := h.roomManager.GetRoom(roomId)
	if r != nil {
		// Remove the client from the room
		remaining := r.RemoveMember(client.ID)

		// Broadcast MemberLeft to remaining members
		memberLeftMsg := Message{
			Type: MsgMemberLeft,
			Data: MemberLeftData{
				ID: client.ID,
			},
		}
		broadcastData, err := msgpack.Marshal(memberLeftMsg)
		if err != nil {
			logger.Error("Hub", "failed to marshal MemberLeft message: %v", err)
		} else {
			r.Broadcast(client.ID, broadcastData)
		}

		// If room is now empty, remove it
		if remaining == 0 {
			h.roomManager.RemoveRoom(roomId)
			logger.Info("Hub", "room %s destroyed (empty), total rooms: %d", roomId, h.roomManager.RoomCount())
		}
	}

	// Clear client's room association
	client.RoomID = ""

	logger.Info("Hub", "client %s left room %s", client.ID, roomId)
}

func (h *Hub) handleTyping(client *Client, data interface{}) {
	// 1. Check if client is in a room
	if client.RoomID == "" {
		h.sendError(client, ErrCodeNotInRoom, "not in a room")
		return
	}

	// 2. Parse data to extract typing boolean
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		h.sendError(client, ErrCodeInvalidMessage, "invalid typing data")
		return
	}

	typing, _ := dataMap["typing"].(bool)

	// 3. Look up the room
	r := h.roomManager.GetRoom(client.RoomID)
	if r == nil {
		client.RoomID = ""
		h.sendError(client, ErrCodeNotInRoom, "room no longer exists")
		return
	}

	// 4. Create MemberTyping message and broadcast to room (excluding sender)
	typingMsg := Message{
		Type: MsgMemberTyping,
		Data: MemberTypingData{
			ID:     client.ID,
			Typing: typing,
		},
	}
	broadcastData, err := msgpack.Marshal(typingMsg)
	if err != nil {
		logger.Error("Hub", "failed to marshal MemberTyping message: %v", err)
		return
	}
	r.Broadcast(client.ID, broadcastData)
}

func (h *Hub) handlePong(client *Client, data interface{}) {
	// 更新客户端最后一次 Pong 时间戳，确认客户端存活
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return
	}
	// 提取客户端回传的时间戳（可用于 RTT 计算）
	if t, ok := dataMap["t"].(int64); ok {
		client.LastPong = t
	} else if t, ok := dataMap["t"].(uint64); ok {
		client.LastPong = int64(t)
	} else {
		// 如果无法解析时间戳，使用当前时间
		client.LastPong = time.Now().UnixMilli()
	}
}

// handleClientDisconnect 处理客户端断线，自动离开所在房间。
func (h *Hub) handleClientDisconnect(client *Client) {
	// 如果客户端在某个房间中，执行离开逻辑
	if client.RoomID != "" {
		h.handleLeaveRoom(client, nil)
	}
}

// --- 辅助方法 ---

// sendError 向客户端发送错误消息。
func (h *Hub) sendError(client *Client, code string, msg string) {
	errMsg := Message{
		Type: MsgError,
		Data: ErrorData{
			Code: code,
			Msg:  msg,
		},
	}
	data, err := msgpack.Marshal(errMsg)
	if err != nil {
		logger.Error("Hub", "failed to marshal error message: %v", err)
		return
	}
	client.Send(data)
}

// sendToClient 向客户端发送指定类型的消息。
func (h *Hub) sendToClient(client *Client, msgType uint8, msgData interface{}) {
	msg := Message{Type: msgType, Data: msgData}
	data, err := msgpack.Marshal(msg)
	if err != nil {
		logger.Error("Hub", "failed to marshal message: %v", err)
		return
	}
	client.Send(data)
}

// clientCount 返回当前连接的客户端数量（需在持有锁或调用后使用）。
func (h *Hub) clientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// generateColor 根据客户端 ID 生成一个十六进制颜色值。
// 使用简单的 hash 算法将 ID 映射到颜色空间。
func generateColor(id string) string {
	var hash uint32
	for _, c := range id {
		hash = hash*31 + uint32(c)
	}
	// 生成 RGB 颜色，确保颜色不会太暗（每个通道至少 64）
	r := (hash>>16)&0xFF | 0x40
	g := (hash>>8)&0xFF | 0x40
	b := hash&0xFF | 0x40
	// 限制到 0xFF
	if r > 0xFF {
		r = 0xFF
	}
	if g > 0xFF {
		g = 0xFF
	}
	if b > 0xFF {
		b = 0xFF
	}
	return fmt.Sprintf("#%02x%02x%02x", r, g, b)
}
