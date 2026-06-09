package network

import (
	"sync"
	"testing"
	"time"

	"github.com/arthas/arthas-server/internal/room"
	"github.com/vmihailenco/msgpack/v5"
)

// =============================================================================
// 测试辅助函数
// =============================================================================

// setupHubWithRoom 创建一个 Hub，注册客户端并将其加入房间。
// 返回 Hub、Room、Client 以及用于接收广播消息的 channel。
func setupHubWithRoom(t *testing.T) (*Hub, *room.Room, *Client) {
	t.Helper()
	hub := NewHub()
	go hub.Run()
	t.Cleanup(func() {
		hub.Stop()
	})

	// 等待 Run() 启动
	time.Sleep(10 * time.Millisecond)

	// 创建客户端
	client := &Client{
		ID:     "sender-01",
		RoomID: "room-abc",
		Name:   "Alice",
		Color:  "#ff0000",
		hub:    hub,
		send:   make(chan []byte, sendBufferSize),
	}

	// 注册客户端到 Hub
	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	// 创建房间并添加成员
	r := hub.roomManager.CreateRoom("room-abc", "", 0, 0, 0)
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

	return hub, r, client
}

// addReceiverToRoom 向房间中添加一个接收方，返回接收方 Client 和其 send channel。
func addReceiverToRoom(t *testing.T, hub *Hub, r *room.Room, id, name string) (*Client, chan []byte) {
	t.Helper()
	receiverSend := make(chan []byte, sendBufferSize)
	receiver := &Client{
		ID:     id,
		RoomID: r.ID,
		Name:   name,
		Color:  "#00ff00",
		hub:    hub,
		send:   receiverSend,
	}

	hub.mu.Lock()
	hub.clients[receiver] = true
	hub.mu.Unlock()

	member := &room.Member{
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
	if err := r.AddMember(member); err != nil {
		t.Fatalf("failed to add receiver member: %v", err)
	}

	return receiver, receiverSend
}

// drainChannel 从 channel 中读取一条消息（带超时）。
func drainChannel(ch chan []byte, timeout time.Duration) ([]byte, bool) {
	select {
	case msg := <-ch:
		return msg, true
	case <-time.After(timeout):
		return nil, false
	}
}

// decodeMessage 将 msgpack 字节解码为 Message 结构。
func decodeMessage(t *testing.T, data []byte) Message {
	t.Helper()
	var msg Message
	if err := msgpack.Unmarshal(data, &msg); err != nil {
		t.Fatalf("failed to unmarshal message: %v", err)
	}
	return msg
}

// =============================================================================
// handleFileMeta 测试
// =============================================================================

// TestHandleFileMeta_ValidRequest 测试有效的文件元数据请求能正确广播。
// 验证：发送方在房间中、无活跃传输时，Meta 消息被广播给其他成员。
func TestHandleFileMeta_ValidRequest(t *testing.T) {
	hub, r, sender := setupHubWithRoom(t)
	_, receiverSend := addReceiverToRoom(t, hub, r, "recv-01", "Bob")

	// 构建有效的 FileMeta 数据
	data := map[string]interface{}{
		"transferId": "transfer-abc-123",
		"iv":         "base64url-iv-data",
		"ciphertext": []byte("encrypted-metadata-bytes"),
	}

	// 调用 handler
	hub.handleFileMeta(sender, data)

	// 验证接收方收到了广播消息
	msg, ok := drainChannel(receiverSend, 2*time.Second)
	if !ok {
		t.Fatal("接收方未收到广播消息")
	}

	// 解码并验证消息类型
	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRelayFileMeta {
		t.Errorf("期望消息类型 0x%02x，实际 0x%02x", MsgRelayFileMeta, decoded.Type)
	}

	// 验证 sender 的 activeTransferID 已设置
	if sender.activeTransferID != "transfer-abc-123" {
		t.Errorf("期望 activeTransferID='transfer-abc-123'，实际='%s'", sender.activeTransferID)
	}

	// 验证 transferStartAt 已设置（非零值）
	if sender.transferStartAt.IsZero() {
		t.Error("期望 transferStartAt 非零")
	}
}

// TestHandleFileMeta_NotInRoom 测试未加入房间的客户端发送 Meta 被拒绝。
func TestHandleFileMeta_NotInRoom(t *testing.T) {
	hub, _, _ := setupHubWithRoom(t)

	// 创建一个未加入房间的客户端
	outsider := &Client{
		ID:     "outsider-01",
		RoomID: "", // 未加入任何房间
		Name:   "Outsider",
		hub:    hub,
		send:   make(chan []byte, sendBufferSize),
	}

	data := map[string]interface{}{
		"transferId": "transfer-xyz",
		"iv":         "some-iv",
		"ciphertext": []byte("some-data"),
	}

	hub.handleFileMeta(outsider, data)

	// 验证收到错误消息
	msg, ok := drainChannel(outsider.send, 500*time.Millisecond)
	if !ok {
		t.Fatal("未收到错误响应")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgError {
		t.Errorf("期望错误消息类型 0x%02x，实际 0x%02x", MsgError, decoded.Type)
	}

	// 验证 activeTransferID 未被设置
	if outsider.activeTransferID != "" {
		t.Errorf("outsider 的 activeTransferID 不应被设置，实际='%s'", outsider.activeTransferID)
	}
}

// TestHandleFileMeta_ActiveTransferConflict 测试已有活跃传输时新 Meta 被拒绝。
func TestHandleFileMeta_ActiveTransferConflict(t *testing.T) {
	hub, _, sender := setupHubWithRoom(t)

	// 设置已有活跃传输
	sender.activeTransferID = "existing-transfer"
	sender.transferStartAt = time.Now()

	data := map[string]interface{}{
		"transferId": "new-transfer",
		"iv":         "some-iv",
		"ciphertext": []byte("some-data"),
	}

	hub.handleFileMeta(sender, data)

	// 验证收到错误消息
	msg, ok := drainChannel(sender.send, 500*time.Millisecond)
	if !ok {
		t.Fatal("未收到错误响应")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgError {
		t.Errorf("期望错误消息类型 0x%02x，实际 0x%02x", MsgError, decoded.Type)
	}

	// 验证 activeTransferID 未被覆盖
	if sender.activeTransferID != "existing-transfer" {
		t.Errorf("activeTransferID 不应被覆盖，期望='existing-transfer'，实际='%s'", sender.activeTransferID)
	}
}

// =============================================================================
// handleFileChunk 测试
// =============================================================================

// TestHandleFileChunk_ValidChunk 测试有效的文件分片能通过 BroadcastFileData 转发。
func TestHandleFileChunk_ValidChunk(t *testing.T) {
	hub, r, sender := setupHubWithRoom(t)
	_, receiverSend := addReceiverToRoom(t, hub, r, "recv-01", "Bob")

	// 设置活跃传输
	sender.activeTransferID = "transfer-abc"
	sender.transferStartAt = time.Now()

	// 构建有效的 chunk 数据
	data := map[string]interface{}{
		"transferId": "transfer-abc",
		"index":      int8(3), // 模拟 msgpack 解码的 int8 类型
		"iv":         []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12},
		"data":       []byte("encrypted-chunk-data-here"),
	}

	hub.handleFileChunk(sender, data)

	// 验证接收方收到了转发的 chunk
	msg, ok := drainChannel(receiverSend, 2*time.Second)
	if !ok {
		t.Fatal("接收方未收到转发的 chunk")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRelayFileChunk {
		t.Errorf("期望消息类型 0x%02x，实际 0x%02x", MsgRelayFileChunk, decoded.Type)
	}
}

// TestHandleFileChunk_MismatchedTransferID 测试 transferId 不匹配时 chunk 被拒绝。
func TestHandleFileChunk_MismatchedTransferID(t *testing.T) {
	hub, _, sender := setupHubWithRoom(t)

	// 设置活跃传输
	sender.activeTransferID = "transfer-abc"
	sender.transferStartAt = time.Now()

	// 发送一个 transferId 不匹配的 chunk
	data := map[string]interface{}{
		"transferId": "wrong-transfer-id",
		"index":      int8(0),
		"iv":         []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12},
		"data":       []byte("some-data"),
	}

	hub.handleFileChunk(sender, data)

	// 验证收到错误消息
	msg, ok := drainChannel(sender.send, 500*time.Millisecond)
	if !ok {
		t.Fatal("未收到错误响应")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgError {
		t.Errorf("期望错误消息类型 0x%02x，实际 0x%02x", MsgError, decoded.Type)
	}
}

// TestHandleFileChunk_ToIntParsesIndex 测试 toInt() 正确解析各种 msgpack 整数类型。
// 📚 学习要点: vmihailenco/msgpack/v5 将小正整数解码为 int8/uint8 等最小类型，
// 必须使用 toInt() 统一处理。
func TestHandleFileChunk_ToIntParsesIndex(t *testing.T) {
	hub, r, sender := setupHubWithRoom(t)
	_, receiverSend := addReceiverToRoom(t, hub, r, "recv-01", "Bob")

	sender.activeTransferID = "transfer-abc"
	sender.transferStartAt = time.Now()

	// 测试 uint8 类型的 index（模拟 msgpack 解码 128-255 范围的值）
	data := map[string]interface{}{
		"transferId": "transfer-abc",
		"index":      uint8(79), // 最大 chunk index (5MB / 64KB = 80 chunks, 0-based)
		"iv":         []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12},
		"data":       []byte("chunk-data"),
	}

	hub.handleFileChunk(sender, data)

	// 验证接收方收到了消息（说明 index 被正确解析）
	msg, ok := drainChannel(receiverSend, 2*time.Second)
	if !ok {
		t.Fatal("接收方未收到转发的 chunk（uint8 index 解析失败）")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRelayFileChunk {
		t.Errorf("期望消息类型 0x%02x，实际 0x%02x", MsgRelayFileChunk, decoded.Type)
	}
}

// =============================================================================
// handleFileComplete / handleFileCancel 测试
// =============================================================================

// TestHandleFileComplete_ClearsActiveTransfer 测试 Complete 消息清除活跃传输状态并广播。
func TestHandleFileComplete_ClearsActiveTransfer(t *testing.T) {
	hub, r, sender := setupHubWithRoom(t)
	_, receiverSend := addReceiverToRoom(t, hub, r, "recv-01", "Bob")

	// 设置活跃传输
	sender.activeTransferID = "transfer-abc"
	sender.transferStartAt = time.Now()

	data := map[string]interface{}{
		"transferId": "transfer-abc",
	}

	hub.handleFileComplete(sender, data)

	// 验证 activeTransferID 已清除
	if sender.activeTransferID != "" {
		t.Errorf("期望 activeTransferID 为空，实际='%s'", sender.activeTransferID)
	}

	// 验证接收方收到了 Complete 广播
	msg, ok := drainChannel(receiverSend, 2*time.Second)
	if !ok {
		t.Fatal("接收方未收到 Complete 广播")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRelayFileComplete {
		t.Errorf("期望消息类型 0x%02x，实际 0x%02x", MsgRelayFileComplete, decoded.Type)
	}
}

// TestHandleFileCancel_ClearsActiveTransfer 测试 Cancel 消息清除活跃传输状态并广播。
func TestHandleFileCancel_ClearsActiveTransfer(t *testing.T) {
	hub, r, sender := setupHubWithRoom(t)
	_, receiverSend := addReceiverToRoom(t, hub, r, "recv-01", "Bob")

	// 设置活跃传输
	sender.activeTransferID = "transfer-abc"
	sender.transferStartAt = time.Now()

	data := map[string]interface{}{
		"transferId": "transfer-abc",
	}

	hub.handleFileCancel(sender, data)

	// 验证 activeTransferID 已清除
	if sender.activeTransferID != "" {
		t.Errorf("期望 activeTransferID 为空，实际='%s'", sender.activeTransferID)
	}

	// 验证接收方收到了 Cancel 广播
	msg, ok := drainChannel(receiverSend, 2*time.Second)
	if !ok {
		t.Fatal("接收方未收到 Cancel 广播")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRelayFileCancel {
		t.Errorf("期望消息类型 0x%02x，实际 0x%02x", MsgRelayFileCancel, decoded.Type)
	}
}

// =============================================================================
// handleFileAck 测试
// =============================================================================

// TestHandleFileAck_RelayedOnlyToSender 测试 ACK 仅定向转发给原始发送方（非广播）。
func TestHandleFileAck_RelayedOnlyToSender(t *testing.T) {
	hub, r, sender := setupHubWithRoom(t)
	receiver, _ := addReceiverToRoom(t, hub, r, "recv-01", "Bob")
	_, bystander2Send := addReceiverToRoom(t, hub, r, "recv-02", "Charlie")

	// 设置发送方的活跃传输
	sender.activeTransferID = "transfer-abc"
	sender.transferStartAt = time.Now()

	// 接收方发送 ACK
	data := map[string]interface{}{
		"transferId": "transfer-abc",
	}

	hub.handleFileAck(receiver, data)

	// 验证发送方收到了 ACK
	msg, ok := drainChannel(sender.send, 2*time.Second)
	if !ok {
		t.Fatal("发送方未收到 ACK")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRelayFileAck {
		t.Errorf("期望消息类型 0x%02x，实际 0x%02x", MsgRelayFileAck, decoded.Type)
	}

	// 验证旁观者（bystander）没有收到 ACK
	_, received := drainChannel(bystander2Send, 200*time.Millisecond)
	if received {
		t.Error("旁观者不应收到 ACK（ACK 应仅定向发送给发送方）")
	}
}

// =============================================================================
// SendFileData 测试
// =============================================================================

// TestSendFileData_SuccessWithinTimeout 测试 send channel 有空间时立即返回 true。
func TestSendFileData_SuccessWithinTimeout(t *testing.T) {
	client := &Client{
		ID:   "test-client",
		send: make(chan []byte, sendBufferSize),
	}

	data := []byte("test-file-data")
	result := client.SendFileData(data)

	if !result {
		t.Error("期望 SendFileData 返回 true（channel 有空间）")
	}

	// 验证数据确实进入了 channel
	select {
	case received := <-client.send:
		if string(received) != string(data) {
			t.Errorf("期望数据 '%s'，实际 '%s'", data, received)
		}
	default:
		t.Error("send channel 中没有数据")
	}
}

// TestSendFileData_TimeoutReturnsFalse 测试 send channel 满时超时返回 false。
// 📚 学习要点: 此测试验证背压机制 — 当接收方 send buffer 持续满时，
// SendFileData 在 5 秒后超时返回 false，而非永久阻塞。
func TestSendFileData_TimeoutReturnsFalse(t *testing.T) {
	// 创建一个容量为 0 的 channel（立即阻塞）
	client := &Client{
		ID:   "test-client",
		send: make(chan []byte), // 无缓冲 channel
	}

	start := time.Now()
	result := client.SendFileData([]byte("data"))
	elapsed := time.Since(start)

	if result {
		t.Error("期望 SendFileData 返回 false（channel 满，超时）")
	}

	// 验证超时时间约为 5 秒（允许 500ms 误差）
	if elapsed < 4500*time.Millisecond || elapsed > 6000*time.Millisecond {
		t.Errorf("期望超时约 5 秒，实际耗时 %v", elapsed)
	}
}

// =============================================================================
// BroadcastFileData 测试
// =============================================================================

// TestBroadcastFileData_SlowReceiverDoesNotBlockFast 测试慢接收方超时不阻塞快接收方。
// 📚 学习要点: BroadcastFileData 使用并发 goroutine 发送，
// 即使某个接收方的 send buffer 满了（需要等待 5s 超时），
// 其他接收方仍能立即收到数据。
func TestBroadcastFileData_SlowReceiverDoesNotBlockFast(t *testing.T) {
	r := room.NewRoom("test-room", "", 0, 0, 0)

	// 快接收方：有缓冲的 channel
	fastCh := make(chan []byte, 10)
	fastMember := &room.Member{
		ID:   "fast-recv",
		Name: "Fast",
		SendFunc: func(data []byte) {
			fastCh <- data
		},
		SendFileFunc: func(data []byte) bool {
			select {
			case fastCh <- data:
				return true
			case <-time.After(fileDataSendTimeout):
				return false
			}
		},
	}

	// 慢接收方：无缓冲 channel，没有消费者（会超时）
	slowCh := make(chan []byte) // 无缓冲，无消费者 = 永远阻塞
	slowMember := &room.Member{
		ID:   "slow-recv",
		Name: "Slow",
		SendFunc: func(data []byte) {
			// 不使用
		},
		SendFileFunc: func(data []byte) bool {
			select {
			case slowCh <- data:
				return true
			case <-time.After(fileDataSendTimeout):
				return false
			}
		},
	}

	// 发送方（被排除）
	senderMember := &room.Member{
		ID:   "sender",
		Name: "Sender",
		SendFunc: func(data []byte) {
			t.Error("发送方不应收到自己的广播")
		},
		SendFileFunc: func(data []byte) bool {
			t.Error("发送方不应收到自己的广播")
			return true
		},
	}

	r.AddMember(senderMember)
	r.AddMember(fastMember)
	r.AddMember(slowMember)

	testData := []byte("file-chunk-data")

	// 在后台执行 BroadcastFileData（因为慢接收方会阻塞 5s）
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		r.BroadcastFileData("sender", testData)
	}()

	// 快接收方应该很快收到数据（不需要等待慢接收方）
	select {
	case received := <-fastCh:
		if string(received) != string(testData) {
			t.Errorf("快接收方收到错误数据: %s", received)
		}
	case <-time.After(1 * time.Second):
		t.Fatal("快接收方在 1 秒内未收到数据（被慢接收方阻塞了）")
	}

	// 等待 BroadcastFileData 完成（慢接收方超时后）
	wg.Wait()
}

// =============================================================================
// handleClientDisconnect 测试
// =============================================================================

// TestHandleClientDisconnect_ActiveTransferBroadcastsCancel 测试客户端断线时
// 如果有活跃传输，会广播 CANCEL 信号并清理状态。
func TestHandleClientDisconnect_ActiveTransferBroadcastsCancel(t *testing.T) {
	hub, r, sender := setupHubWithRoom(t)
	_, receiverSend := addReceiverToRoom(t, hub, r, "recv-01", "Bob")

	// 设置活跃传输
	sender.activeTransferID = "transfer-abc"
	sender.transferStartAt = time.Now()

	// 模拟断线
	hub.handleClientDisconnect(sender)

	// 验证 activeTransferID 已清除
	if sender.activeTransferID != "" {
		t.Errorf("期望 activeTransferID 为空，实际='%s'", sender.activeTransferID)
	}

	// 验证 RoomID 已清除（handleLeaveRoom 的效果）
	if sender.RoomID != "" {
		t.Errorf("期望 RoomID 为空，实际='%s'", sender.RoomID)
	}

	// 验证接收方收到了 CANCEL 广播
	msg, ok := drainChannel(receiverSend, 2*time.Second)
	if !ok {
		t.Fatal("接收方未收到断线触发的 CANCEL 广播")
	}

	decoded := decodeMessage(t, msg)
	if decoded.Type != MsgRelayFileCancel {
		t.Errorf("期望消息类型 0x%02x (RelayFileCancel)，实际 0x%02x", MsgRelayFileCancel, decoded.Type)
	}
}

// TestHandleClientDisconnect_NoActiveTransfer 测试无活跃传输时断线不广播 CANCEL。
func TestHandleClientDisconnect_NoActiveTransfer(t *testing.T) {
	hub, r, sender := setupHubWithRoom(t)
	_, receiverSend := addReceiverToRoom(t, hub, r, "recv-01", "Bob")

	// 无活跃传输
	sender.activeTransferID = ""

	hub.handleClientDisconnect(sender)

	// 验证接收方收到的是 MemberLeft（来自 handleLeaveRoom），而非 CANCEL
	msg, ok := drainChannel(receiverSend, 500*time.Millisecond)
	if ok {
		decoded := decodeMessage(t, msg)
		if decoded.Type == MsgRelayFileCancel {
			t.Error("无活跃传输时不应广播 CANCEL")
		}
		// MsgMemberLeft 是正常的（handleLeaveRoom 的效果）
	}
}

// =============================================================================
// cleanupStaleTransfers 测试
// =============================================================================

// TestCleanupStaleTransfers_ClearsOldTransfers 测试超过 90 秒的传输被清理。
func TestCleanupStaleTransfers_ClearsOldTransfers(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	defer hub.Stop()
	time.Sleep(10 * time.Millisecond)

	// 创建一个有过期传输的客户端
	staleClient := &Client{
		ID:               "stale-client",
		RoomID:           "some-room",
		activeTransferID: "stale-transfer",
		transferStartAt:  time.Now().Add(-100 * time.Second), // 100 秒前开始（超过 90s 阈值）
		hub:              hub,
		send:             make(chan []byte, sendBufferSize),
	}

	// 创建一个有新鲜传输的客户端
	freshClient := &Client{
		ID:               "fresh-client",
		RoomID:           "some-room",
		activeTransferID: "fresh-transfer",
		transferStartAt:  time.Now().Add(-30 * time.Second), // 30 秒前开始（未超过 90s）
		hub:              hub,
		send:             make(chan []byte, sendBufferSize),
	}

	hub.mu.Lock()
	hub.clients[staleClient] = true
	hub.clients[freshClient] = true
	hub.mu.Unlock()

	// 执行清理
	hub.cleanupStaleTransfers()

	// 验证过期传输被清理
	if staleClient.activeTransferID != "" {
		t.Errorf("期望过期传输被清理，实际 activeTransferID='%s'", staleClient.activeTransferID)
	}

	// 验证新鲜传输未被清理
	if freshClient.activeTransferID != "fresh-transfer" {
		t.Errorf("期望新鲜传输保留，实际 activeTransferID='%s'", freshClient.activeTransferID)
	}
}

// TestCleanupStaleTransfers_NoActiveTransfer 测试无活跃传输的客户端不受影响。
func TestCleanupStaleTransfers_NoActiveTransfer(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	defer hub.Stop()
	time.Sleep(10 * time.Millisecond)

	client := &Client{
		ID:               "idle-client",
		RoomID:           "some-room",
		activeTransferID: "", // 无活跃传输
		hub:              hub,
		send:             make(chan []byte, sendBufferSize),
	}

	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	// 执行清理 — 不应 panic 或修改任何状态
	hub.cleanupStaleTransfers()

	if client.activeTransferID != "" {
		t.Error("无活跃传输的客户端不应被修改")
	}
}
