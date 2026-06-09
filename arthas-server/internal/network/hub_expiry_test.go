package network

import (
	"testing"
	"time"

	"github.com/arthas/arthas-server/internal/room"
	"github.com/vmihailenco/msgpack/v5"
)

// ===========================================================================
// 集成测试：房间过期生命周期
//
// 📚 学习要点: 集成测试的策略
// 这些测试验证 Hub 层面的过期行为，包括：
// - 创建带过期时间的房间 → 验证 expiresAt 正确设置
// - cleanupExpiredRooms() 销毁过期房间 → 验证成员收到 MsgRoomClosed(reason="expired")
// - 过期预警 warnApproachingExpiry → 验证即将过期的房间收到预警
// - JoinRoom 对过期房间返回 E007
// - FILE_CANCEL 在过期销毁时广播给所有成员（包括发送方）
//
// 使用 NowFunc 注入可控时间源，避免依赖真实时钟的 60 秒扫描间隔。
//
// Validates: Requirements 4.4, 4.5, 6.2, 6.3, 7.1
// ===========================================================================

// TestExpiry_CreateRoomWithExpiry_CleanupDestroysRoom 验证创建带过期时间的房间后，
// cleanupExpiredRooms 能正确检测并销毁过期房间。
// 使用 NowFunc 模拟时间流逝，验证 cleanupExpiredRooms 的正确行为。
//
// 步骤：
// 1. 创建 Hub 和带过期时间的房间（expiresAt = now + 3600）
// 2. 设置 NowFunc 使其返回 expiresAt + 1（模拟时间已过期）
// 3. 调用 cleanupExpiredRooms()
// 4. 验证房间被销毁、成员收到 MsgRoomClosed(reason="expired")
//
// Validates: Requirements 6.2
func TestExpiry_CreateRoomWithExpiry_CleanupDestroysRoom(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	defer hub.Stop()
	time.Sleep(10 * time.Millisecond)

	// 创建带 1 小时过期时间的房间
	now := time.Now().Unix()
	expiresAt := now + 3600
	r := hub.roomManager.CreateRoom("room-expiry-01", "", 0, expiresAt, 0)

	// 添加一个成员并注册客户端
	memberSend := make(chan []byte, sendBufferSize)
	client := &Client{
		ID:     "member-01",
		RoomID: "room-expiry-01",
		Name:   "Alice",
		Color:  "#ff0000",
		hub:    hub,
		send:   memberSend,
	}

	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	member := &room.Member{
		ID:    client.ID,
		Name:  client.Name,
		Color: client.Color,
		SendFunc: func(data []byte) {
			client.Send(data)
		},
		SendFileFunc: func(data []byte) bool {
			return client.SendFileData(data)
		},
	}
	if err := r.AddMember(member); err != nil {
		t.Fatalf("failed to add member: %v", err)
	}

	// 验证房间存在
	if hub.roomManager.GetRoom("room-expiry-01") == nil {
		t.Fatal("房间应该存在")
	}

	// 模拟时间流逝：设置 NowFunc 返回 expiresAt + 1（已过期）
	// 📚 学习要点: 使用 NowFunc 注入时间而非 time.Sleep
	// 真实等待 3600 秒不现实，通过注入时间源实现快速测试。
	hub.roomManager.NowFunc = func() int64 { return expiresAt + 1 }

	// 调用 cleanupExpiredRooms 触发过期检查
	hub.cleanupExpiredRooms()

	// 验证房间已被销毁
	if hub.roomManager.GetRoom("room-expiry-01") != nil {
		t.Fatal("过期房间应该被销毁")
	}

	// 验证成员收到 MsgRoomClosed(reason="expired")
	msg, ok := drainChannel(memberSend, 2*time.Second)
	if !ok {
		t.Fatal("未收到 RoomClosed 消息")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRoomClosed {
		t.Fatalf("期望消息类型 0x%02x (MsgRoomClosed)，实际 0x%02x", MsgRoomClosed, decoded.Type)
	}

	// 解析 Data 验证 reason="expired"
	dataBytes, err := msgpack.Marshal(decoded.Data)
	if err != nil {
		t.Fatalf("failed to marshal decoded data: %v", err)
	}
	var closedData RoomClosedData
	if err := msgpack.Unmarshal(dataBytes, &closedData); err != nil {
		t.Fatalf("failed to unmarshal RoomClosedData: %v", err)
	}
	if closedData.Reason != "expired" {
		t.Errorf("期望 reason='expired'，实际='%s'", closedData.Reason)
	}

	// 验证客户端的 RoomID 已被清除
	if client.RoomID != "" {
		t.Errorf("期望 client.RoomID 为空，实际='%s'", client.RoomID)
	}
}

// TestExpiry_CreateRoomNegativeExpiry_ExpiresAtZero 验证 CreateRoom 时
// expiry=-1 导致 expiresAt 被清洗为 0（永不过期）。
//
// 📚 学习要点: 防御性输入清洗验证
// 虽然清洗逻辑在 hub.go 的 handleCreateRoom 中执行，
// 但此测试验证如果 expiresAt=0 传入 CreateRoom，房间确实永不过期。
//
// Validates: Requirements 4.4
func TestExpiry_CreateRoomNegativeExpiry_ExpiresAtZero(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	defer hub.Stop()
	time.Sleep(10 * time.Millisecond)

	// 创建客户端
	clientSend := make(chan []byte, sendBufferSize)
	client := &Client{
		ID:     "creator-01",
		RoomID: "",
		Name:   "",
		hub:    hub,
		send:   clientSend,
	}
	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	// 调用 handleCreateRoom，传入 expiry=-1（负数）
	data := map[string]interface{}{
		"name":      "TestRoom",
		"password":  "",
		"ephemeral": int8(0),
		"expiry":    int8(-1), // 负数
	}

	hub.handleCreateRoom(client, data)

	// 等待 RoomCreated 响应
	msg, ok := drainChannel(clientSend, 2*time.Second)
	if !ok {
		t.Fatal("未收到 RoomCreated 响应")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRoomCreated {
		t.Fatalf("期望消息类型 0x%02x (MsgRoomCreated)，实际 0x%02x", MsgRoomCreated, decoded.Type)
	}

	// 解析 RoomCreatedData 验证 expiresAt=0
	dataBytes, err := msgpack.Marshal(decoded.Data)
	if err != nil {
		t.Fatalf("failed to marshal decoded data: %v", err)
	}
	var createdData RoomCreatedData
	if err := msgpack.Unmarshal(dataBytes, &createdData); err != nil {
		t.Fatalf("failed to unmarshal RoomCreatedData: %v", err)
	}
	if createdData.ExpiresAt != 0 {
		t.Errorf("期望 expiresAt=0（负数清洗后），实际=%d", createdData.ExpiresAt)
	}

	// 验证房间的 GetExpiresAt() 返回 0
	r := hub.roomManager.GetRoom(createdData.RoomID)
	if r == nil {
		t.Fatal("房间应该存在")
	}
	if r.GetExpiresAt() != 0 {
		t.Errorf("期望 room.GetExpiresAt()=0，实际=%d", r.GetExpiresAt())
	}
}

// TestExpiry_CreateRoom_LargeExpiry_TruncatedToMax 验证超大 expiry 被截断为 MaxExpiryDuration。
// expiry=999999 时 expiresAt 应截断为 now+604800（最大 7 天）。
//
// 📚 学习要点: 验证服务器端的 MaxExpiryDuration 截断
// 恶意客户端可能设置 expiry=999999999 创建几乎永不过期的房间。
// 服务器必须截断为 MaxExpiryDuration（7天=604800秒）防止内存耗尽攻击。
//
// Validates: Requirements 4.4
func TestExpiry_CreateRoom_LargeExpiry_TruncatedToMax(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	defer hub.Stop()
	time.Sleep(10 * time.Millisecond)

	// 创建客户端
	clientSend := make(chan []byte, sendBufferSize)
	client := &Client{
		ID:     "creator-02",
		RoomID: "",
		Name:   "",
		hub:    hub,
		send:   clientSend,
	}
	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	// 记录创建前时间
	beforeCreate := time.Now().Unix()

	// 调用 handleCreateRoom，传入 expiry=999999（超过 MaxExpiryDuration）
	data := map[string]interface{}{
		"name":      "TestRoom2",
		"password":  "",
		"ephemeral": int8(0),
		"expiry":    999999, // 超大值，应被截断为 604800
	}

	hub.handleCreateRoom(client, data)

	afterCreate := time.Now().Unix()

	// 等待 RoomCreated 响应
	msg, ok := drainChannel(clientSend, 2*time.Second)
	if !ok {
		t.Fatal("未收到 RoomCreated 响应")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRoomCreated {
		t.Fatalf("期望消息类型 0x%02x (MsgRoomCreated)，实际 0x%02x", MsgRoomCreated, decoded.Type)
	}

	// 解析 RoomCreatedData 验证 expiresAt 被截断
	dataBytes, err := msgpack.Marshal(decoded.Data)
	if err != nil {
		t.Fatalf("failed to marshal decoded data: %v", err)
	}
	var createdData RoomCreatedData
	if err := msgpack.Unmarshal(dataBytes, &createdData); err != nil {
		t.Fatalf("failed to unmarshal RoomCreatedData: %v", err)
	}

	// expiresAt 应在 [beforeCreate + MaxExpiryDuration, afterCreate + MaxExpiryDuration] 范围内
	expectedMin := beforeCreate + room.MaxExpiryDuration
	expectedMax := afterCreate + room.MaxExpiryDuration

	if createdData.ExpiresAt < expectedMin || createdData.ExpiresAt > expectedMax {
		t.Errorf("期望 expiresAt 在 [%d, %d] 范围内（now+604800），实际=%d",
			expectedMin, expectedMax, createdData.ExpiresAt)
	}

	// 验证房间的 GetExpiresAt() 与截断值一致
	r := hub.roomManager.GetRoom(createdData.RoomID)
	if r == nil {
		t.Fatal("房间应该存在")
	}
	if r.GetExpiresAt() < expectedMin || r.GetExpiresAt() > expectedMax {
		t.Errorf("期望 room.GetExpiresAt() 在 [%d, %d] 范围内，实际=%d",
			expectedMin, expectedMax, r.GetExpiresAt())
	}
}

// TestExpiry_ExpiredRoomWithActiveTransfer_FileCancelBroadcastToAll 验证过期房间销毁时
// 如果有活跃文件传输，FILE_CANCEL 会广播给所有成员（包括发送方）。
//
// 📚 学习要点: broadcastFileCancelForExpiry vs broadcastFileCancelForDisconnect
// 过期场景中发送方仍然在线，需要收到 CANCEL 信号来停止发送。
// 断线场景中发送方已不在线，只需通知其他成员。
//
// Validates: Requirements 6.3
func TestExpiry_ExpiredRoomWithActiveTransfer_FileCancelBroadcastToAll(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	defer hub.Stop()
	time.Sleep(10 * time.Millisecond)

	// 创建带过期时间的房间
	now := time.Now().Unix()
	pastExpiresAt := now - 10 // 10 秒前已过期
	r := hub.roomManager.CreateRoom("room-transfer-expiry", "", 0, pastExpiresAt, 0)

	// 添加发送方（有活跃传输）
	senderSend := make(chan []byte, sendBufferSize)
	sender := &Client{
		ID:               "sender-01",
		RoomID:           "room-transfer-expiry",
		Name:             "Sender",
		Color:            "#ff0000",
		hub:              hub,
		send:             senderSend,
		activeTransferID: "transfer-expiry-001",
		transferStartAt:  time.Now(),
	}
	hub.mu.Lock()
	hub.clients[sender] = true
	hub.mu.Unlock()

	senderMember := &room.Member{
		ID:    sender.ID,
		Name:  sender.Name,
		Color: sender.Color,
		SendFunc: func(data []byte) {
			sender.Send(data)
		},
		SendFileFunc: func(data []byte) bool {
			return sender.SendFileData(data)
		},
	}
	if err := r.AddMember(senderMember); err != nil {
		t.Fatalf("failed to add sender: %v", err)
	}

	// 添加接收方
	receiverSend := make(chan []byte, sendBufferSize)
	receiver := &Client{
		ID:     "receiver-01",
		RoomID: "room-transfer-expiry",
		Name:   "Receiver",
		Color:  "#00ff00",
		hub:    hub,
		send:   receiverSend,
	}
	hub.mu.Lock()
	hub.clients[receiver] = true
	hub.mu.Unlock()

	receiverMember := &room.Member{
		ID:    receiver.ID,
		Name:  receiver.Name,
		Color: receiver.Color,
		SendFunc: func(data []byte) {
			receiver.Send(data)
		},
		SendFileFunc: func(data []byte) bool {
			return receiver.SendFileData(data)
		},
	}
	if err := r.AddMember(receiverMember); err != nil {
		t.Fatalf("failed to add receiver: %v", err)
	}

	// 调用 cleanupExpiredRooms 触发过期检查
	hub.cleanupExpiredRooms()

	// 验证房间已被销毁
	if hub.roomManager.GetRoom("room-transfer-expiry") != nil {
		t.Fatal("过期房间应该被销毁")
	}

	// 验证发送方收到 RelayFileCancel（过期场景通知所有人包括发送方）
	senderGotCancel := false
	senderGotRoomClosed := false
	for i := 0; i < 2; i++ {
		msg, ok := drainChannel(senderSend, 2*time.Second)
		if !ok {
			break
		}
		decoded := decodeMessage(t, msg)
		if decoded.Type == MsgRelayFileCancel {
			senderGotCancel = true
		}
		if decoded.Type == MsgRoomClosed {
			senderGotRoomClosed = true
		}
	}

	if !senderGotCancel {
		t.Error("发送方应收到 RelayFileCancel（过期场景通知所有人）")
	}
	if !senderGotRoomClosed {
		t.Error("发送方应收到 MsgRoomClosed")
	}

	// 验证接收方也收到 RelayFileCancel 和 RoomClosed
	receiverGotCancel := false
	receiverGotRoomClosed := false
	for i := 0; i < 2; i++ {
		msg, ok := drainChannel(receiverSend, 2*time.Second)
		if !ok {
			break
		}
		decoded := decodeMessage(t, msg)
		if decoded.Type == MsgRelayFileCancel {
			receiverGotCancel = true
		}
		if decoded.Type == MsgRoomClosed {
			receiverGotRoomClosed = true
		}
	}

	if !receiverGotCancel {
		t.Error("接收方应收到 RelayFileCancel")
	}
	if !receiverGotRoomClosed {
		t.Error("接收方应收到 MsgRoomClosed")
	}

	// 验证发送方的 activeTransferID 已被清除
	if sender.activeTransferID != "" {
		t.Errorf("发送方的 activeTransferID 应被清除，实际='%s'", sender.activeTransferID)
	}

	// 验证客户端的 RoomID 已被清除
	if sender.RoomID != "" {
		t.Errorf("期望 sender.RoomID 为空，实际='%s'", sender.RoomID)
	}
	if receiver.RoomID != "" {
		t.Errorf("期望 receiver.RoomID 为空，实际='%s'", receiver.RoomID)
	}
}

// TestExpiry_JoinExpiredRoom_ReturnsE007 验证 JoinRoom 对过期房间返回 E007 错误码。
// 即使 Expiry_Checker 尚未运行（房间仍存在），join 也会被实时拒绝。
//
// Validates: Requirements 7.1
func TestExpiry_JoinExpiredRoom_ReturnsE007(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	defer hub.Stop()
	time.Sleep(10 * time.Millisecond)

	// 创建已过期的房间
	now := time.Now().Unix()
	hub.roomManager.CreateRoom("room-expired-join", "", 0, now-60, 0) // 60 秒前已过期

	// 创建客户端
	clientSend := make(chan []byte, sendBufferSize)
	client := &Client{
		ID:     "joiner-01",
		RoomID: "",
		Name:   "",
		hub:    hub,
		send:   clientSend,
	}
	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	// 尝试 join 过期房间
	joinData := map[string]interface{}{
		"roomId":   "room-expired-join",
		"name":     "Bob",
		"password": "",
	}

	hub.handleJoinRoom(client, joinData)

	// 验证收到 E007 错误
	msg, ok := drainChannel(clientSend, 2*time.Second)
	if !ok {
		t.Fatal("未收到错误响应")
	}

	code, _ := parseErrorResponse(t, msg)
	if code != ErrCodeRoomExpired {
		t.Errorf("期望错误码 E007，实际='%s'", code)
	}

	// 验证客户端未加入房间
	if client.RoomID != "" {
		t.Errorf("客户端不应加入过期房间，但 RoomID='%s'", client.RoomID)
	}
}

// TestExpiry_JoinNoExpiredRoom_Succeeds 验证 JoinRoom 对未过期房间正常工作。
// 确保过期检查不会误拒未过期的房间。
func TestExpiry_JoinNoExpiredRoom_Succeeds(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	defer hub.Stop()
	time.Sleep(10 * time.Millisecond)

	// 创建未过期的房间（1 小时后过期）
	now := time.Now().Unix()
	futureExpiresAt := now + 3600
	hub.roomManager.CreateRoom("room-active-join", "", 0, futureExpiresAt, 0)

	// 创建客户端
	clientSend := make(chan []byte, sendBufferSize)
	client := &Client{
		ID:     "joiner-02",
		RoomID: "",
		Name:   "",
		hub:    hub,
		send:   clientSend,
	}
	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	// 尝试 join 未过期房间
	joinData := map[string]interface{}{
		"roomId":   "room-active-join",
		"name":     "Charlie",
		"password": "",
	}

	hub.handleJoinRoom(client, joinData)

	// 等待 RoomJoined 响应
	msg, ok := drainChannel(clientSend, 2*time.Second)
	if !ok {
		t.Fatal("未收到 RoomJoined 响应")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRoomJoined {
		t.Fatalf("期望消息类型 0x%02x (MsgRoomJoined)，实际 0x%02x", MsgRoomJoined, decoded.Type)
	}

	// 验证客户端已加入房间
	if client.RoomID != "room-active-join" {
		t.Errorf("客户端应加入房间，但 RoomID='%s'", client.RoomID)
	}
}

// TestExpiry_CleanupSkipsNoExpiredRooms 验证 cleanupExpiredRooms 不会销毁未过期的房间。
// 确保只有 expiresAt > 0 且 now > expiresAt 的房间被销毁。
func TestExpiry_CleanupSkipsNoExpiredRooms(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	defer hub.Stop()
	time.Sleep(10 * time.Millisecond)

	now := time.Now().Unix()

	// 创建永不过期的房间
	hub.roomManager.CreateRoom("room-never-expire", "", 0, 0, 0)

	// 创建未来过期的房间
	hub.roomManager.CreateRoom("room-future-expire", "", 0, now+3600, 0)

	// 创建已过期的房间（只有这个应被销毁）
	hub.roomManager.CreateRoom("room-past-expire", "", 0, now-10, 0)

	// 调用 cleanupExpiredRooms
	hub.cleanupExpiredRooms()

	// 验证永不过期的房间仍存在
	if hub.roomManager.GetRoom("room-never-expire") == nil {
		t.Error("永不过期的房间不应被销毁")
	}

	// 验证未来过期的房间仍存在
	if hub.roomManager.GetRoom("room-future-expire") == nil {
		t.Error("未来过期的房间不应被销毁")
	}

	// 验证已过期的房间被销毁
	if hub.roomManager.GetRoom("room-past-expire") != nil {
		t.Error("已过期的房间应被销毁")
	}
}
