// hub_expiry_property_test.go — handleJoinRoom 过期检查与 cleanupExpiredRooms 属性测试
//
// 本文件使用 pgregory.net/rapid 进行属性测试（Property-Based Testing），
// 验证 handleJoinRoom 的过期拒绝逻辑和 cleanupExpiredRooms 的一致性行为。
//
// 📚 学习要点: 测试紧耦合逻辑的策略
// handleJoinRoom 依赖 WebSocket 上下文（Client、Hub、send channel），
// 直接测试完整方法需要大量 mock 设置。但其核心过期判断逻辑是：
//
//	room.IsExpired(time.Now().Unix()) → true → 返回 E007
//
// 我们通过测试底层 IsExpired 逻辑 + RoomManager 交互来验证属性，
// 确保无论 Expiry_Checker 是否已运行，过期房间的 join 都会被拒绝。
//
// Feature: qr-share-and-room-expiry, Property 5: Join expired room error
// Feature: qr-share-and-room-expiry, Property 10: Join-during-expiry consistency
package network

import (
	"testing"
	"time"

	"github.com/arthas/arthas-server/internal/room"
	"github.com/vmihailenco/msgpack/v5"
	"pgregory.net/rapid"
)

// parseErrorResponse 从 msgpack 编码的消息字节中解析错误码和错误消息。
// 由于 Message.Data 是 interface{}，反序列化后为 map[string]interface{}，
// 需要手动提取 "code" 和 "msg" 字段。
func parseErrorResponse(t interface{ Fatalf(string, ...interface{}) }, msgBytes []byte) (code string, msg string) {
	var raw Message
	if err := msgpack.Unmarshal(msgBytes, &raw); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if raw.Type != MsgError {
		t.Fatalf("expected MsgError (type=%d), got type=%d", MsgError, raw.Type)
	}

	// Data 反序列化为 map[string]interface{}
	dataMap, ok := raw.Data.(map[string]interface{})
	if !ok {
		t.Fatalf("expected Data to be map[string]interface{}, got %T", raw.Data)
	}

	code, _ = dataMap["code"].(string)
	msg, _ = dataMap["msg"].(string)
	return code, msg
}

// ---------------------------------------------------------------------------
// Property 5: Join expired room error
// ---------------------------------------------------------------------------
//
// 属性定义：
// 对于任意房间，若其 expiresAt 非零且在当前服务器时间之前（即 IsExpired(now)==true），
// 则 join 请求必须收到错误码 "E007"，消息为 "room has expired"。
//
// 📚 学习要点: 为什么在 network 包中测试而非 room 包？
// Property 5 验证的是 handleJoinRoom 的行为（返回 E007），
// 而非单纯的 IsExpired 逻辑（已在 room_property_test.go 中覆盖）。
// 此测试通过构造完整的 Hub + Client + Room 环境，验证端到端的过期拒绝行为。
//
// **Validates: Requirements 7.1**

// TestProperty5_JoinExpiredRoomError 验证过期房间的 join 请求返回 E007。
//
// 测试策略：
// 1. 创建一个 Hub 和已过期的房间（expiresAt 在过去）
// 2. 构造一个客户端并调用 handleJoinRoom
// 3. 验证客户端收到的响应是 E007 错误
func TestProperty5_JoinExpiredRoomError(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成过期时间点：确保在当前时间之前
		now := time.Now().Unix()
		// expiresAt 在 1 到 now-1 之间（确保已过期）
		expiresAt := rapid.Int64Range(1, now-1).Draw(t, "expiresAt")

		// 生成房间 ID（21 字符，模拟 NanoID）
		roomID := rapid.StringMatching(`[a-zA-Z0-9_-]{21}`).Draw(t, "roomID")

		// 创建 Hub 并启动
		hub := NewHub()
		go hub.Run()
		defer hub.Stop()

		// 等待 Run() 启动
		time.Sleep(5 * time.Millisecond)

		// 创建过期房间
		hub.roomManager.CreateRoom(roomID, "", 0, expiresAt, 0)

		// 创建客户端（模拟 join 请求的发送方）
		clientSend := make(chan []byte, sendBufferSize)
		client := &Client{
			ID:     "join-client-001",
			RoomID: "", // 未加入任何房间
			Name:   "",
			hub:    hub,
			send:   clientSend,
		}

		// 注册客户端到 Hub
		hub.mu.Lock()
		hub.clients[client] = true
		hub.mu.Unlock()

		// 构造 join 请求数据
		joinData := map[string]interface{}{
			"roomId":   roomID,
			"name":     "TestUser",
			"password": "",
		}

		// 调用 handleJoinRoom
		hub.handleJoinRoom(client, joinData)

		// 从 client 的 send channel 读取响应
		select {
		case msgBytes := <-clientSend:
			code, msg := parseErrorResponse(t, msgBytes)

			// 验证错误码为 E007
			if code != ErrCodeRoomExpired {
				t.Fatalf("expected error code %q, got %q (expiresAt=%d, now=%d)",
					ErrCodeRoomExpired, code, expiresAt, now)
			}

			// 验证错误消息
			if msg != "room has expired" {
				t.Fatalf("expected message %q, got %q", "room has expired", msg)
			}

		case <-time.After(1 * time.Second):
			t.Fatal("timeout waiting for error response from handleJoinRoom")
		}

		// 验证客户端未被加入房间
		if client.RoomID != "" {
			t.Fatalf("client should not be assigned to any room, but RoomID=%q", client.RoomID)
		}
	})
}

// ---------------------------------------------------------------------------
// Property 10: Join-during-expiry consistency
// ---------------------------------------------------------------------------
//
// 属性定义：
// 对于任意房间，若 IsExpired(now)==true 在 join 请求时刻成立，
// 则 join 必须被拒绝（返回 E007），无论 Expiry_Checker（GetExpiredRooms）
// 是否已经运行过。
//
// 📚 学习要点: 双重防线的一致性验证
// Arthas 的过期机制有两层防线：
// 1. Expiry_Checker（异步，60s 周期）— 主动销毁过期房间
// 2. handleJoinRoom（同步，实时）— 被动拒绝过期房间的 join 请求
//
// Property 10 验证的是：即使 Expiry_Checker 尚未运行（房间仍存在于 RoomManager 中），
// handleJoinRoom 也能独立地拒绝过期房间。这确保了两层防线的独立性和一致性。
//
// 测试策略：
// - 场景 A: Expiry_Checker 未运行 → 房间仍存在 → join 被拒绝（E007）
// - 场景 B: Expiry_Checker 已运行 → 房间已被销毁 → join 被拒绝（E001 room not found）
// 两种场景下 join 都被拒绝，只是错误码不同。Property 10 聚焦场景 A。
//
// **Validates: Requirements 7.1**

// TestProperty10_JoinDuringExpiryConsistency_WithoutExpiryChecker 验证
// 即使 Expiry_Checker 未运行，过期房间的 join 请求仍被拒绝。
func TestProperty10_JoinDuringExpiryConsistency_WithoutExpiryChecker(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		now := time.Now().Unix()

		// 生成过期时间（确保已过期）
		expiresAt := rapid.Int64Range(1, now-1).Draw(t, "expiresAt")

		// 生成房间 ID
		roomID := rapid.StringMatching(`[a-zA-Z0-9_-]{21}`).Draw(t, "roomID")

		// 创建 Hub（不手动触发 cleanupExpiredRooms）
		hub := NewHub()
		go hub.Run()
		defer hub.Stop()
		time.Sleep(5 * time.Millisecond)

		// 创建过期房间
		r := hub.roomManager.CreateRoom(roomID, "", 0, expiresAt, 0)

		// 验证前置条件：房间确实已过期
		if !r.IsExpired(now) {
			t.Fatalf("precondition failed: room should be expired (expiresAt=%d, now=%d)",
				expiresAt, now)
		}

		// 验证前置条件：Expiry_Checker 未运行，房间仍存在
		if hub.roomManager.GetRoom(roomID) == nil {
			t.Fatal("precondition failed: room should still exist (Expiry_Checker not run)")
		}

		// 构造客户端并尝试 join
		clientSend := make(chan []byte, sendBufferSize)
		client := &Client{
			ID:     "consistency-client",
			RoomID: "",
			Name:   "",
			hub:    hub,
			send:   clientSend,
		}

		hub.mu.Lock()
		hub.clients[client] = true
		hub.mu.Unlock()

		joinData := map[string]interface{}{
			"roomId":   roomID,
			"name":     "ConsistencyUser",
			"password": "",
		}

		// 调用 handleJoinRoom（Expiry_Checker 未运行）
		hub.handleJoinRoom(client, joinData)

		// 验证收到 E007 错误
		select {
		case msgBytes := <-clientSend:
			code, _ := parseErrorResponse(t, msgBytes)

			if code != ErrCodeRoomExpired {
				t.Fatalf("expected E007, got %q — join should be rejected even without Expiry_Checker",
					code)
			}

		case <-time.After(1 * time.Second):
			t.Fatal("timeout waiting for error response")
		}

		// 验证客户端未加入房间
		if client.RoomID != "" {
			t.Fatalf("client should not be in any room, but RoomID=%q", client.RoomID)
		}
	})
}

// TestProperty10_JoinDuringExpiryConsistency_AfterExpiryChecker 验证
// Expiry_Checker 运行后，过期房间被销毁，join 请求返回 E001（room not found）。
// 这验证了双重防线的第二层：房间已被清理时的行为。
func TestProperty10_JoinDuringExpiryConsistency_AfterExpiryChecker(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		now := time.Now().Unix()

		// 生成过期时间
		expiresAt := rapid.Int64Range(1, now-1).Draw(t, "expiresAt")

		// 生成房间 ID
		roomID := rapid.StringMatching(`[a-zA-Z0-9_-]{21}`).Draw(t, "roomID")

		// 创建 Hub
		hub := NewHub()
		go hub.Run()
		defer hub.Stop()
		time.Sleep(5 * time.Millisecond)

		// 创建过期房间
		hub.roomManager.CreateRoom(roomID, "", 0, expiresAt, 0)

		// 手动触发 cleanupExpiredRooms（模拟 Expiry_Checker 已运行）
		hub.cleanupExpiredRooms()

		// 验证房间已被销毁
		if hub.roomManager.GetRoom(roomID) != nil {
			t.Fatal("room should have been destroyed by cleanupExpiredRooms")
		}

		// 构造客户端并尝试 join
		clientSend := make(chan []byte, sendBufferSize)
		client := &Client{
			ID:     "post-cleanup-client",
			RoomID: "",
			Name:   "",
			hub:    hub,
			send:   clientSend,
		}

		hub.mu.Lock()
		hub.clients[client] = true
		hub.mu.Unlock()

		joinData := map[string]interface{}{
			"roomId":   roomID,
			"name":     "PostCleanupUser",
			"password": "",
		}

		// 调用 handleJoinRoom（房间已被 Expiry_Checker 销毁）
		hub.handleJoinRoom(client, joinData)

		// 验证收到 E001 错误（room not found）
		select {
		case msgBytes := <-clientSend:
			code, _ := parseErrorResponse(t, msgBytes)

			// 房间已被销毁，应返回 E001
			if code != ErrCodeRoomNotFound {
				t.Fatalf("expected E001 (room not found after cleanup), got %q", code)
			}

		case <-time.After(1 * time.Second):
			t.Fatal("timeout waiting for error response")
		}

		// 验证客户端未加入房间
		if client.RoomID != "" {
			t.Fatalf("client should not be in any room, but RoomID=%q", client.RoomID)
		}
	})
}

// TestProperty10_JoinDuringExpiryConsistency_IsExpiredIndependentOfGetExpiredRooms 验证
// room.IsExpired(now) 的结果不受 GetExpiredRooms 调用的影响。
// 这是一个纯逻辑属性：IsExpired 是纯函数，其结果仅取决于 expiresAt 和 now，
// 与 RoomManager 的任何操作无关。
//
// 📚 学习要点: 纯函数的独立性验证
// IsExpired(now) 是纯函数——它不修改任何状态，也不依赖外部状态。
// 无论 GetExpiredRooms 是否被调用（即 Expiry_Checker 是否运行），
// IsExpired 对相同的 (expiresAt, now) 输入始终返回相同结果。
// 此测试通过在 GetExpiredRooms 调用前后分别检查 IsExpired，验证其独立性。
func TestProperty10_JoinDuringExpiryConsistency_IsExpiredIndependentOfGetExpiredRooms(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成时间参数
		now := rapid.Int64Range(1_000_000_000, 2_000_000_000).Draw(t, "now")
		// expiresAt 在 now 之前（确保已过期）
		expiresAt := rapid.Int64Range(1, now-1).Draw(t, "expiresAt")

		roomID := rapid.StringMatching(`[a-zA-Z0-9_-]{21}`).Draw(t, "roomID")

		rm := room.NewRoomManager()
		r := rm.CreateRoom(roomID, "", 0, expiresAt, 0)

		// 验证 IsExpired 在 GetExpiredRooms 调用前返回 true
		beforeResult := r.IsExpired(now)
		if !beforeResult {
			t.Fatalf("IsExpired(%d) should be true before GetExpiredRooms (expiresAt=%d)",
				now, expiresAt)
		}

		// 调用 GetExpiredRooms（模拟 Expiry_Checker 扫描）
		expired := rm.GetExpiredRooms(now)
		if len(expired) == 0 {
			t.Fatal("GetExpiredRooms should return at least one expired room")
		}

		// 验证 IsExpired 在 GetExpiredRooms 调用后仍返回 true（纯函数不受影响）
		afterResult := r.IsExpired(now)
		if !afterResult {
			t.Fatalf("IsExpired(%d) should still be true after GetExpiredRooms (expiresAt=%d)",
				now, expiresAt)
		}

		// 验证前后结果一致
		if beforeResult != afterResult {
			t.Fatalf("IsExpired result changed after GetExpiredRooms: before=%v, after=%v",
				beforeResult, afterResult)
		}
	})
}
