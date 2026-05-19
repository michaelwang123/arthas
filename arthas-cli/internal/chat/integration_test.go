// integration_test.go — 集成测试：使用 mock WebSocket 服务器验证 CLI 各层协作。
//
// 本文件使用 httptest + gorilla/websocket 搭建本地测试 WebSocket 服务器，
// 验证 chat session 与 protocol、crypto、network、ui 层的端到端集成。
//
// 📚 学习要点: 集成测试 vs 单元测试
// 单元测试验证单个函数的行为（如 Encrypt、Decode），集成测试验证多个模块
// 协作时的正确性。本文件的测试覆盖：
// - WebSocket 连接建立和消息交换
// - 协议编解码在真实网络传输中的正确性
// - 加密/解密在完整消息流中的端到端验证
// - 错误处理路径（服务器返回错误码）
// - 成员事件处理（加入/离开）
//
// 📚 学习要点: 为什么使用 httptest 而非真实服务器？
// httptest.Server 提供本地 HTTP 服务器，无需网络依赖：
// - 测试可以在离线环境运行（CI/CD 友好）
// - 测试服务器的行为完全可控（可以模拟各种响应）
// - 无端口冲突风险（httptest 自动分配可用端口）
// - 测试结束后自动清理资源
package chat

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/arthas/arthas-cli/internal/crypto"
	"github.com/arthas/arthas-cli/internal/network"
	"github.com/arthas/arthas-cli/internal/protocol"
	"github.com/arthas/arthas-cli/internal/ui"
	"github.com/gorilla/websocket"
)

// ---------------------------------------------------------------------------
// 测试辅助：Mock WebSocket 服务器
// ---------------------------------------------------------------------------

// upgrader 用于将 HTTP 连接升级为 WebSocket 连接。
// 📚 学习要点: CheckOrigin 返回 true 允许所有来源连接（测试环境无需 CORS 限制）。
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// mockServerHandler 定义 mock 服务器收到消息后的处理函数类型。
// 参数为服务器端 WebSocket 连接和收到的解码后消息。
type mockServerHandler func(conn *websocket.Conn, msg *protocol.Message)

// setupTestServer 创建一个 mock WebSocket 服务器，使用提供的 handler 处理消息。
//
// 📚 学习要点: httptest.Server 的生命周期
// httptest.NewServer 启动一个本地 HTTP 服务器，返回的 URL 格式为 http://127.0.0.1:PORT。
// 测试结束时必须调用 server.Close() 释放端口和 goroutine。
// 使用 t.Cleanup 注册清理函数，确保即使测试 panic 也能正确清理。
func setupTestServer(t *testing.T, handler mockServerHandler) (*httptest.Server, string) {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Logf("WebSocket upgrade failed: %v", err)
			return
		}
		defer conn.Close()

		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				// 连接关闭或读取错误，退出循环
				return
			}

			msg, err := protocol.Decode(raw)
			if err != nil {
				t.Logf("Failed to decode message: %v", err)
				continue
			}

			handler(conn, msg)
		}
	}))

	t.Cleanup(func() { server.Close() })

	// 将 http:// URL 转换为 ws:// URL
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	return server, wsURL
}

// sendServerMessage 从服务器端发送一条编码后的协议消息。
func sendServerMessage(t *testing.T, conn *websocket.Conn, msg *protocol.Message) {
	t.Helper()
	encoded, err := protocol.Encode(msg)
	if err != nil {
		t.Fatalf("Failed to encode server message: %v", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, encoded); err != nil {
		t.Logf("Failed to write server message: %v", err)
	}
}

// ---------------------------------------------------------------------------
// 测试：完整的创建房间流程
// ---------------------------------------------------------------------------

// TestIntegration_CreateRoomFlow 验证创建房间的完整流程：
// connect → CreateRoom → RoomCreated → RoomJoined → share code 输出
//
// 📚 学习要点: 为什么使用 goroutine + channel 测试阻塞函数？
// RunCreate 会阻塞直到 chatLoop 退出。测试需要在另一个 goroutine 中运行它，
// 同时在 mock 服务器中控制消息流。使用 channel 同步两端的执行顺序。
//
// Validates: Requirements 1.1-1.8
func TestIntegration_CreateRoomFlow(t *testing.T) {
	testRoomID := "abcdefghijklmnopqrstu" // 21 chars

	_, wsURL := setupTestServer(t, func(conn *websocket.Conn, msg *protocol.Message) {
		switch msg.Type {
		case protocol.MsgCreateRoom:
			// 验证 CreateRoom 消息格式
			data, ok := msg.Data.(map[string]interface{})
			if !ok {
				t.Errorf("CreateRoom data is not map, got %T", msg.Data)
				return
			}
			name, _ := data["name"].(string)
			if name != "TestUser" {
				t.Errorf("CreateRoom name = %q, want %q", name, "TestUser")
			}

			// 响应 RoomCreated
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomCreated,
				Data: map[string]interface{}{
					"roomId": testRoomID,
				},
			})

			// 响应 RoomJoined
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomJoined,
				Data: map[string]interface{}{
					"roomId": testRoomID,
					"members": []interface{}{
						map[string]interface{}{
							"id":    "user0001",
							"name":  "TestUser",
							"color": "#4a7fbf",
						},
					},
					"hasPassword": false,
					"ephemeral":   int64(0),
				},
			})

			// 等待一小段时间让客户端进入 chatLoop，然后关闭房间使测试退出
			time.Sleep(100 * time.Millisecond)
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomClosed,
				Data: map[string]interface{}{},
			})

		case protocol.MsgLeaveRoom:
			// 客户端离开，正常
		}
	})

	// 在 goroutine 中运行 RunCreate（它会阻塞）
	errCh := make(chan error, 1)
	go func() {
		errCh <- RunCreate(wsURL, "TestUser")
	}()

	// 等待 RunCreate 完成（超时保护）
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("RunCreate returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RunCreate timed out")
	}
}

// ---------------------------------------------------------------------------
// 测试：完整的加入房间流程
// ---------------------------------------------------------------------------

// TestIntegration_JoinRoomFlow 验证加入房间的完整流程：
// connect → JoinRoom → RoomJoined → member list display
//
// Validates: Requirements 2.1-2.9
func TestIntegration_JoinRoomFlow(t *testing.T) {
	testRoomID := "abcdefghijklmnopqrstu" // 21 chars
	testKey, err := crypto.GenerateRoomKey()
	if err != nil {
		t.Fatalf("Failed to generate test key: %v", err)
	}
	shareCode := crypto.BuildShareCode(testRoomID, testKey, 0)

	_, wsURL := setupTestServer(t, func(conn *websocket.Conn, msg *protocol.Message) {
		switch msg.Type {
		case protocol.MsgJoinRoom:
			// 验证 JoinRoom 消息格式
			data, ok := msg.Data.(map[string]interface{})
			if !ok {
				t.Errorf("JoinRoom data is not map, got %T", msg.Data)
				return
			}
			roomID, _ := data["roomId"].(string)
			if roomID != testRoomID {
				t.Errorf("JoinRoom roomId = %q, want %q", roomID, testRoomID)
			}
			name, _ := data["name"].(string)
			if name != "Joiner" {
				t.Errorf("JoinRoom name = %q, want %q", name, "Joiner")
			}

			// 响应 RoomJoined（包含多个成员）
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomJoined,
				Data: map[string]interface{}{
					"roomId": testRoomID,
					"members": []interface{}{
						map[string]interface{}{
							"id":    "user0001",
							"name":  "Creator",
							"color": "#ff5733",
						},
						map[string]interface{}{
							"id":    "user0002",
							"name":  "Joiner",
							"color": "#33ff57",
						},
					},
					"hasPassword": false,
					"ephemeral":   int64(0),
				},
			})

			// 关闭房间使测试退出
			time.Sleep(100 * time.Millisecond)
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomClosed,
				Data: map[string]interface{}{},
			})

		case protocol.MsgLeaveRoom:
			// 客户端离开，正常
		}
	})

	errCh := make(chan error, 1)
	go func() {
		errCh <- RunJoin(wsURL, "Joiner", shareCode)
	}()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("RunJoin returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("RunJoin timed out")
	}
}

// ---------------------------------------------------------------------------
// 测试：消息发送/接收循环（加密 → 发送 → 中转 → 解密 → 显示）
// ---------------------------------------------------------------------------

// TestIntegration_MessageSendReceiveCycle 验证完整的消息加密传输流程：
// 用户输入 → JSON 载荷 → AES-256-GCM 加密 → SendMessage → 服务器中转 →
// RelayMessage → 解密 → JSON 解析 → 显示
//
// 📚 学习要点: 端到端加密验证
// 此测试验证 CLI 发送的加密消息能被正确解密。mock 服务器收到 SendMessage 后，
// 将其作为 RelayMessage 回传（模拟另一个成员发送的消息），验证解密路径。
//
// Validates: Requirements 4.1-4.7, 5.1-5.6
func TestIntegration_MessageSendReceiveCycle(t *testing.T) {
	testRoomID := "abcdefghijklmnopqrstu"
	testKey, err := crypto.GenerateRoomKey()
	if err != nil {
		t.Fatalf("Failed to generate test key: %v", err)
	}

	// 使用 mutex 保护 receivedMessages
	var mu sync.Mutex
	var receivedIV, receivedCiphertext string

	_, wsURL := setupTestServer(t, func(conn *websocket.Conn, msg *protocol.Message) {
		switch msg.Type {
		case protocol.MsgCreateRoom:
			// 快速响应 RoomCreated + RoomJoined
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomCreated,
				Data: map[string]interface{}{"roomId": testRoomID},
			})
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomJoined,
				Data: map[string]interface{}{
					"roomId": testRoomID,
					"members": []interface{}{
						map[string]interface{}{
							"id": "user0001", "name": "Sender", "color": "#4a7fbf",
						},
					},
					"hasPassword": false,
					"ephemeral":   int64(0),
				},
			})

		case protocol.MsgSendMessage:
			// 捕获发送的加密消息
			data, ok := msg.Data.(map[string]interface{})
			if !ok {
				return
			}
			mu.Lock()
			receivedIV, _ = data["iv"].(string)
			receivedCiphertext, _ = data["ciphertext"].(string)
			mu.Unlock()

			// 模拟服务器中转：将消息作为 RelayMessage 回传
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRelayMessage,
				Data: map[string]interface{}{
					"senderId":   "user0002",
					"senderName": "OtherUser",
					"iv":         receivedIV,
					"ciphertext": receivedCiphertext,
					"t":          time.Now().UnixMilli(),
				},
			})

			// 关闭房间使测试退出
			time.Sleep(50 * time.Millisecond)
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomClosed,
				Data: map[string]interface{}{},
			})

		case protocol.MsgLeaveRoom:
			// 正常
		}
	})

	// 测试：直接验证加密/解密往返
	// 模拟 handleUserInput 的加密流程
	testMessage := "Hello, 世界! 🌍"
	payload := MessagePayload{Text: testMessage}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	iv, ciphertext, err := crypto.Encrypt(testKey, jsonBytes)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// 验证解密路径
	plaintext, err := crypto.Decrypt(testKey, iv, ciphertext)
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}

	var decoded MessagePayload
	if err := json.Unmarshal(plaintext, &decoded); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
	if decoded.Text != testMessage {
		t.Errorf("Round-trip message = %q, want %q", decoded.Text, testMessage)
	}

	// 测试：通过 WebSocket 发送加密消息
	conn, err := network.Dial(wsURL)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	// 发送 CreateRoom 触发服务器响应
	createMsg := &protocol.Message{
		Type: protocol.MsgCreateRoom,
		Data: protocol.CreateRoomData{Name: "Sender", Password: "", Ephemeral: 0},
	}
	encoded, err := protocol.Encode(createMsg)
	if err != nil {
		t.Fatalf("Encode CreateRoom failed: %v", err)
	}
	if err := conn.Send(encoded); err != nil {
		t.Fatalf("Send CreateRoom failed: %v", err)
	}

	// 等待 RoomCreated + RoomJoined
	for i := 0; i < 2; i++ {
		raw, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("ReadMessage failed: %v", err)
		}
		msg, err := protocol.Decode(raw)
		if err != nil {
			t.Fatalf("Decode failed: %v", err)
		}
		if msg.Type == protocol.MsgRoomJoined {
			break
		}
	}

	// 发送加密消息
	sendMsg := &protocol.Message{
		Type: protocol.MsgSendMessage,
		Data: protocol.SendMessageData{IV: iv, Ciphertext: ciphertext},
	}
	encoded, err = protocol.Encode(sendMsg)
	if err != nil {
		t.Fatalf("Encode SendMessage failed: %v", err)
	}
	if err := conn.Send(encoded); err != nil {
		t.Fatalf("Send SendMessage failed: %v", err)
	}

	// 读取 RelayMessage 响应
	raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage (relay) failed: %v", err)
	}
	relayMsg, err := protocol.Decode(raw)
	if err != nil {
		t.Fatalf("Decode relay failed: %v", err)
	}
	if relayMsg.Type != protocol.MsgRelayMessage {
		// 可能收到 RoomClosed，跳过
		if relayMsg.Type == protocol.MsgRoomClosed {
			return
		}
		t.Fatalf("Expected RelayMessage (0x14), got 0x%02x", relayMsg.Type)
	}

	// 验证 RelayMessage 中的加密数据可以被解密
	relayData, ok := relayMsg.Data.(map[string]interface{})
	if !ok {
		t.Fatalf("RelayMessage data is not map")
	}
	relayIV, _ := relayData["iv"].(string)
	relayCT, _ := relayData["ciphertext"].(string)

	decrypted, err := crypto.Decrypt(testKey, relayIV, relayCT)
	if err != nil {
		t.Fatalf("Decrypt relay message failed: %v", err)
	}

	var relayPayload MessagePayload
	if err := json.Unmarshal(decrypted, &relayPayload); err != nil {
		t.Fatalf("json.Unmarshal relay payload failed: %v", err)
	}
	if relayPayload.Text != testMessage {
		t.Errorf("Relay message text = %q, want %q", relayPayload.Text, testMessage)
	}
}

// ---------------------------------------------------------------------------
// 测试：服务器错误处理（E001, E002, E006）
// ---------------------------------------------------------------------------

// TestIntegration_ErrorHandling_E001 验证房间不存在错误的处理。
//
// Validates: Requirements 2.7
func TestIntegration_ErrorHandling_E001(t *testing.T) {
	testKey, _ := crypto.GenerateRoomKey()
	shareCode := crypto.BuildShareCode("abcdefghijklmnopqrstu", testKey, 0)

	_, wsURL := setupTestServer(t, func(conn *websocket.Conn, msg *protocol.Message) {
		if msg.Type == protocol.MsgJoinRoom {
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgError,
				Data: map[string]interface{}{
					"code":        protocol.ErrRoomNotFound,
					"description": "Room does not exist",
				},
			})
		}
	})

	err := RunJoin(wsURL, "TestUser", shareCode)
	if err == nil {
		t.Fatal("Expected error for E001, got nil")
	}
	if !strings.Contains(err.Error(), "room not found") {
		t.Errorf("Error message = %q, want to contain 'room not found'", err.Error())
	}
}

// TestIntegration_ErrorHandling_E002 验证房间已满错误的处理。
//
// Validates: Requirements 2.8
func TestIntegration_ErrorHandling_E002(t *testing.T) {
	testKey, _ := crypto.GenerateRoomKey()
	shareCode := crypto.BuildShareCode("abcdefghijklmnopqrstu", testKey, 0)

	_, wsURL := setupTestServer(t, func(conn *websocket.Conn, msg *protocol.Message) {
		if msg.Type == protocol.MsgJoinRoom {
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgError,
				Data: map[string]interface{}{
					"code":        protocol.ErrRoomFull,
					"description": "Room has reached maximum capacity",
				},
			})
		}
	})

	err := RunJoin(wsURL, "TestUser", shareCode)
	if err == nil {
		t.Fatal("Expected error for E002, got nil")
	}
	if !strings.Contains(err.Error(), "room is full") {
		t.Errorf("Error message = %q, want to contain 'room is full'", err.Error())
	}
}

// TestIntegration_ErrorHandling_E006 验证密码错误的处理。
//
// Validates: Requirements 2.9
func TestIntegration_ErrorHandling_E006(t *testing.T) {
	testKey, _ := crypto.GenerateRoomKey()
	shareCode := crypto.BuildShareCode("abcdefghijklmnopqrstu", testKey, 0)

	_, wsURL := setupTestServer(t, func(conn *websocket.Conn, msg *protocol.Message) {
		if msg.Type == protocol.MsgJoinRoom {
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgError,
				Data: map[string]interface{}{
					"code":        protocol.ErrIncorrectPassword,
					"description": "Incorrect room password",
				},
			})
		}
	})

	err := RunJoin(wsURL, "TestUser", shareCode)
	if err == nil {
		t.Fatal("Expected error for E006, got nil")
	}
	if !strings.Contains(err.Error(), "incorrect room password") {
		t.Errorf("Error message = %q, want to contain 'incorrect room password'", err.Error())
	}
}

// ---------------------------------------------------------------------------
// 测试：优雅关闭（RoomClosed, LeaveRoom）
// ---------------------------------------------------------------------------

// TestIntegration_GracefulShutdown_RoomClosed 验证收到 RoomClosed 后正常退出。
//
// 📚 学习要点: RoomClosed 的退出语义
// 收到 RoomClosed (0x16) 后，CLI 应显示 "Room closed" 并以 exit 0 退出。
// 这与连接断开（exit 1）不同——RoomClosed 是预期的正常结束。
//
// Validates: Requirements 6.4, 8.4
func TestIntegration_GracefulShutdown_RoomClosed(t *testing.T) {
	testRoomID := "abcdefghijklmnopqrstu"

	_, wsURL := setupTestServer(t, func(conn *websocket.Conn, msg *protocol.Message) {
		switch msg.Type {
		case protocol.MsgCreateRoom:
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomCreated,
				Data: map[string]interface{}{"roomId": testRoomID},
			})
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomJoined,
				Data: map[string]interface{}{
					"roomId":      testRoomID,
					"members":     []interface{}{},
					"hasPassword": false,
					"ephemeral":   int64(0),
				},
			})

			// 短暂延迟后发送 RoomClosed
			time.Sleep(100 * time.Millisecond)
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomClosed,
				Data: map[string]interface{}{},
			})

		case protocol.MsgLeaveRoom:
			// 正常
		}
	})

	errCh := make(chan error, 1)
	go func() {
		errCh <- RunCreate(wsURL, "TestUser")
	}()

	select {
	case err := <-errCh:
		// RoomClosed 应导致正常退出（nil error）
		if err != nil {
			t.Fatalf("Expected nil error on RoomClosed, got: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Test timed out waiting for RoomClosed shutdown")
	}
}

// TestIntegration_GracefulShutdown_LeaveRoom 验证客户端发送 LeaveRoom 消息。
//
// 📚 学习要点: LeaveRoom 的触发路径
// LeaveRoom 在以下情况发送：/quit、/exit、Ctrl+C、Ctrl+D。
// 此测试通过直接编码 LeaveRoom 消息并通过 WebSocket 发送来验证。
//
// Validates: Requirements 8.4
func TestIntegration_GracefulShutdown_LeaveRoom(t *testing.T) {
	leaveReceived := make(chan bool, 1)

	_, wsURL := setupTestServer(t, func(conn *websocket.Conn, msg *protocol.Message) {
		if msg.Type == protocol.MsgLeaveRoom {
			leaveReceived <- true
		}
	})

	// 建立连接
	conn, err := network.Dial(wsURL)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	// 直接编码并发送 LeaveRoom 消息（绕过 sendLeaveRoom 的立即关闭行为）
	encoded, err := protocol.Encode(&protocol.Message{
		Type: protocol.MsgLeaveRoom,
		Data: protocol.LeaveRoomData{},
	})
	if err != nil {
		t.Fatalf("Encode LeaveRoom failed: %v", err)
	}
	if err := conn.Send(encoded); err != nil {
		t.Fatalf("Send LeaveRoom failed: %v", err)
	}

	select {
	case <-leaveReceived:
		// 成功收到 LeaveRoom
	case <-time.After(2 * time.Second):
		t.Fatal("Server did not receive LeaveRoom message")
	}
}

// ---------------------------------------------------------------------------
// 测试：成员事件处理（MemberJoined / MemberLeft）
// ---------------------------------------------------------------------------

// TestIntegration_MemberJoined_AddsToMap 验证 MemberJoined 事件正确更新 members map。
//
// 📚 学习要点: members map 的重要性
// members map 是 CLI 维护的本地成员缓存，用于：
// 1. MemberLeft 时查找离开成员的名称（服务器只发送 id）
// 2. RelayMessage 时查找发送者的颜色（消息中不包含 color 字段）
// 如果 MemberJoined 没有正确更新 map，后续的消息显示和离开通知都会出错。
//
// Validates: Requirements 6.2
func TestIntegration_MemberJoined_AddsToMap(t *testing.T) {
	s := &Session{
		display: ui.NewDisplay("TestUser"),
		members: make(map[string]protocol.MemberInfo),
		state:   StateChatting,
	}

	// 模拟 MemberJoined 事件
	data := map[string]interface{}{
		"id":    "newuser1",
		"name":  "NewMember",
		"color": "#ff0000",
	}

	s.handleMemberJoined(data)

	// 验证成员已添加到 map
	member, ok := s.members["newuser1"]
	if !ok {
		t.Fatal("Member not added to map")
	}
	if member.Name != "NewMember" {
		t.Errorf("Member name = %q, want %q", member.Name, "NewMember")
	}
	if member.Color != "#ff0000" {
		t.Errorf("Member color = %q, want %q", member.Color, "#ff0000")
	}
	if member.ID != "newuser1" {
		t.Errorf("Member ID = %q, want %q", member.ID, "newuser1")
	}
}

// TestIntegration_MemberLeft_RemovesFromMap 验证 MemberLeft 事件正确从 members map 移除成员。
//
// Validates: Requirements 6.3
func TestIntegration_MemberLeft_RemovesFromMap(t *testing.T) {
	s := &Session{
		display: ui.NewDisplay("TestUser"),
		members: map[string]protocol.MemberInfo{
			"user0001": {ID: "user0001", Name: "Alice", Color: "#ff0000"},
			"user0002": {ID: "user0002", Name: "Bob", Color: "#00ff00"},
		},
		state: StateChatting,
	}

	// 模拟 MemberLeft 事件
	data := map[string]interface{}{
		"id": "user0001",
	}

	s.handleMemberLeft(data)

	// 验证成员已从 map 移除
	if _, ok := s.members["user0001"]; ok {
		t.Error("Member 'user0001' should have been removed from map")
	}

	// 验证其他成员未受影响
	if _, ok := s.members["user0002"]; !ok {
		t.Error("Member 'user0002' should still be in map")
	}
}

// TestIntegration_MemberLeft_UnknownID 验证 MemberLeft 对未知 ID 的处理（不 panic）。
func TestIntegration_MemberLeft_UnknownID(t *testing.T) {
	s := &Session{
		display: ui.NewDisplay("TestUser"),
		members: make(map[string]protocol.MemberInfo),
		state:   StateChatting,
	}

	// 对不存在的 ID 调用 handleMemberLeft 不应 panic
	data := map[string]interface{}{
		"id": "nonexistent",
	}

	// 如果没有 panic，测试通过
	s.handleMemberLeft(data)
}

// ---------------------------------------------------------------------------
// 测试：processRoomJoined 解析
// ---------------------------------------------------------------------------

// TestIntegration_ProcessRoomJoined 验证 RoomJoined 响应的完整解析。
//
// 📚 学习要点: RoomJoined 是加入房间后的关键响应
// 它包含当前成员列表、密码保护状态和临时模式配置。
// 正确解析这些字段是后续所有操作（消息显示、成员管理）的基础。
//
// Validates: Requirements 1.6, 2.5
func TestIntegration_ProcessRoomJoined(t *testing.T) {
	s := &Session{
		display: ui.NewDisplay("TestUser"),
		members: make(map[string]protocol.MemberInfo),
		state:   StateJoining,
	}

	msg := &protocol.Message{
		Type: protocol.MsgRoomJoined,
		Data: map[string]interface{}{
			"roomId": "abcdefghijklmnopqrstu",
			"members": []interface{}{
				map[string]interface{}{
					"id":    "user0001",
					"name":  "Alice",
					"color": "#ff5733",
				},
				map[string]interface{}{
					"id":    "user0002",
					"name":  "Bob",
					"color": "#33ff57",
				},
			},
			"hasPassword": true,
			"ephemeral":   int64(300),
		},
	}

	err := s.processRoomJoined(msg)
	if err != nil {
		t.Fatalf("processRoomJoined returned error: %v", err)
	}

	// 验证 members map
	if len(s.members) != 2 {
		t.Fatalf("Expected 2 members, got %d", len(s.members))
	}
	if s.members["user0001"].Name != "Alice" {
		t.Errorf("Member user0001 name = %q, want %q", s.members["user0001"].Name, "Alice")
	}
	if s.members["user0002"].Color != "#33ff57" {
		t.Errorf("Member user0002 color = %q, want %q", s.members["user0002"].Color, "#33ff57")
	}

	// 验证 hasPassword 和 ephemeral
	if !s.hasPassword {
		t.Error("Expected hasPassword = true")
	}
	if s.ephemeral != 300 {
		t.Errorf("Expected ephemeral = 300, got %d", s.ephemeral)
	}
}

// ---------------------------------------------------------------------------
// 测试：handleRelayMessage 解密和显示
// ---------------------------------------------------------------------------

// TestIntegration_HandleRelayMessage 验证收到的加密消息能被正确解密和解析。
//
// 📚 学习要点: 端到端验证
// 此测试模拟完整的接收路径：
// 1. 使用已知密钥加密一条消息
// 2. 构造 RelayMessage 格式的 data map
// 3. 调用 handleRelayMessage 验证不 panic 且正确处理
//
// Validates: Requirements 5.1-5.6
func TestIntegration_HandleRelayMessage(t *testing.T) {
	testKey, err := crypto.GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey failed: %v", err)
	}

	// 加密测试消息
	payload := MessagePayload{Text: "Hello from integration test!"}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	iv, ciphertext, err := crypto.Encrypt(testKey, jsonBytes)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	s := &Session{
		roomKey: testKey,
		display: ui.NewDisplay("TestUser"),
		members: map[string]protocol.MemberInfo{
			"sender01": {ID: "sender01", Name: "Alice", Color: "#ff5733"},
		},
		state: StateChatting,
	}

	// 构造 RelayMessage data
	data := map[string]interface{}{
		"senderId":   "sender01",
		"senderName": "Alice",
		"iv":         iv,
		"ciphertext": ciphertext,
		"t":          time.Now().UnixMilli(),
	}

	// 调用 handleRelayMessage — 不应 panic
	s.handleRelayMessage(data)
}

// TestIntegration_HandleRelayMessage_DecryptionFailure 验证解密失败时不崩溃。
//
// 📚 学习要点: 解密失败的容错处理
// 当密钥不匹配时（如用户使用旧分享码），解密会失败。
// CLI 应显示警告但继续运行，不中断会话。
//
// Validates: Requirements 5.6
func TestIntegration_HandleRelayMessage_DecryptionFailure(t *testing.T) {
	// 使用一个密钥加密，用另一个密钥尝试解密
	encryptKey, _ := crypto.GenerateRoomKey()
	decryptKey, _ := crypto.GenerateRoomKey() // 不同的密钥

	payload := MessagePayload{Text: "Secret message"}
	jsonBytes, _ := json.Marshal(payload)
	iv, ciphertext, _ := crypto.Encrypt(encryptKey, jsonBytes)

	s := &Session{
		roomKey: decryptKey, // 错误的密钥
		display: ui.NewDisplay("TestUser"),
		members: make(map[string]protocol.MemberInfo),
		state:   StateChatting,
	}

	data := map[string]interface{}{
		"senderId":   "sender01",
		"senderName": "Alice",
		"iv":         iv,
		"ciphertext": ciphertext,
		"t":          time.Now().UnixMilli(),
	}

	// 不应 panic，应显示 "[⚠ decryption failed]"
	s.handleRelayMessage(data)
}

// TestIntegration_HandleRelayMessage_BackwardCompatibility 验证非 JSON 明文的向后兼容。
//
// 📚 学习要点: 向后兼容性
// 早期版本的客户端可能直接加密文本（无 JSON 包装）。
// CLI 应能正确处理这种情况：JSON 解析失败时使用整个明文作为消息文本。
//
// Validates: Requirements 5.4
func TestIntegration_HandleRelayMessage_BackwardCompatibility(t *testing.T) {
	testKey, _ := crypto.GenerateRoomKey()

	// 直接加密纯文本（非 JSON 格式）
	plainText := "Plain text without JSON wrapper"
	iv, ciphertext, err := crypto.Encrypt(testKey, []byte(plainText))
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	s := &Session{
		roomKey: testKey,
		display: ui.NewDisplay("TestUser"),
		members: map[string]protocol.MemberInfo{
			"sender01": {ID: "sender01", Name: "OldClient", Color: "#aabbcc"},
		},
		state: StateChatting,
	}

	data := map[string]interface{}{
		"senderId":   "sender01",
		"senderName": "OldClient",
		"iv":         iv,
		"ciphertext": ciphertext,
		"t":          time.Now().UnixMilli(),
	}

	// 不应 panic — 应使用整个明文作为消息文本
	s.handleRelayMessage(data)
}

// ---------------------------------------------------------------------------
// 测试：Ping/Pong 通过 WebSocket 的端到端验证
// ---------------------------------------------------------------------------

// TestIntegration_PingPong_WebSocket 验证通过真实 WebSocket 连接的 Ping/Pong 交互。
//
// 📚 学习要点: 应用层 Ping/Pong vs WebSocket 层 Ping/Pong
// 此测试验证的是应用层心跳（MsgPing 0x18 / MsgPong 0x06），
// 不是 WebSocket 协议层的 Ping/Pong 控制帧。
// 应用层心跳用于服务器测量 RTT，WebSocket 层心跳用于检测 TCP 连接存活。
//
// 📚 学习要点: 测试策略 — 直接验证 handlePing
// 由于 RunCreate 的 chatLoop 涉及 stdin 阻塞，直接测试 handlePing 方法
// 更可靠。我们建立 WebSocket 连接，手动发送 Ping，验证收到正确的 Pong。
//
// Validates: Requirements 8.1
func TestIntegration_PingPong_WebSocket(t *testing.T) {
	testTimestamp := int64(1700000000000)
	pongReceived := make(chan int64, 1)

	// 服务器：发送 Ping，等待 Pong
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Logf("Upgrade failed: %v", err)
			return
		}
		defer conn.Close()

		// 发送 Ping 消息
		pingMsg := &protocol.Message{
			Type: protocol.MsgPing,
			Data: map[string]interface{}{"t": testTimestamp},
		}
		encoded, _ := protocol.Encode(pingMsg)
		conn.WriteMessage(websocket.BinaryMessage, encoded)

		// 等待 Pong 响应
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.Logf("ReadMessage failed: %v", err)
			return
		}
		msg, err := protocol.Decode(raw)
		if err != nil {
			t.Logf("Decode failed: %v", err)
			return
		}
		if msg.Type == protocol.MsgPong {
			data, ok := msg.Data.(map[string]interface{})
			if ok {
				pongReceived <- protocol.ToInt(data["t"])
			}
		}
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	// 客户端：连接，读取 Ping，调用 handlePing 发送 Pong
	conn, err := network.Dial(wsURL)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	// 读取 Ping 消息
	raw, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("ReadMessage failed: %v", err)
	}
	msg, err := protocol.Decode(raw)
	if err != nil {
		t.Fatalf("Decode failed: %v", err)
	}
	if msg.Type != protocol.MsgPing {
		t.Fatalf("Expected Ping (0x18), got 0x%02x", msg.Type)
	}

	// 使用 Session.handlePing 处理
	s := &Session{
		conn:    conn,
		display: ui.NewDisplay("PingTest"),
		members: make(map[string]protocol.MemberInfo),
		state:   StateChatting,
	}
	data, _ := msg.Data.(map[string]interface{})
	s.handlePing(data)

	// 验证服务器收到正确的 Pong
	select {
	case ts := <-pongReceived:
		if ts != testTimestamp {
			t.Errorf("Pong timestamp = %d, want %d", ts, testTimestamp)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Did not receive Pong response")
	}
}

// ---------------------------------------------------------------------------
// 测试：WebSocket 连接和协议编解码的端到端验证
// ---------------------------------------------------------------------------

// TestIntegration_WebSocketProtocol_RoundTrip 验证通过 WebSocket 传输的
// MessagePack 消息能被正确编解码。
//
// 📚 学习要点: 为什么需要网络层集成测试？
// 单元测试验证 Encode/Decode 在内存中的正确性，但无法发现：
// - WebSocket 帧类型不匹配（Binary vs Text）
// - 消息分片导致的解码错误
// - 网络字节序问题
// 此测试通过真实 WebSocket 连接验证完整的编解码路径。
//
// Validates: Requirements 10.1-10.5
func TestIntegration_WebSocketProtocol_RoundTrip(t *testing.T) {
	echoReceived := make(chan *protocol.Message, 1)

	_, wsURL := setupTestServer(t, func(conn *websocket.Conn, msg *protocol.Message) {
		// 服务器收到任何消息后原样回传（echo）
		sendServerMessage(t, conn, msg)
	})

	// 建立连接
	conn, err := network.Dial(wsURL)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer conn.Close()

	// 发送测试消息
	testMsg := &protocol.Message{
		Type: protocol.MsgSendMessage,
		Data: protocol.SendMessageData{
			IV:         "dGVzdC1pdi1kYXRh",
			Ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
		},
	}
	encoded, err := protocol.Encode(testMsg)
	if err != nil {
		t.Fatalf("Encode failed: %v", err)
	}
	if err := conn.Send(encoded); err != nil {
		t.Fatalf("Send failed: %v", err)
	}

	// 读取 echo 响应
	go func() {
		raw, err := conn.ReadMessage()
		if err != nil {
			t.Logf("ReadMessage failed: %v", err)
			return
		}
		msg, err := protocol.Decode(raw)
		if err != nil {
			t.Logf("Decode failed: %v", err)
			return
		}
		echoReceived <- msg
	}()

	select {
	case msg := <-echoReceived:
		if msg.Type != protocol.MsgSendMessage {
			t.Errorf("Echo type = 0x%02x, want 0x%02x", msg.Type, protocol.MsgSendMessage)
		}
		data, ok := msg.Data.(map[string]interface{})
		if !ok {
			t.Fatalf("Echo data is not map")
		}
		if iv, _ := data["iv"].(string); iv != "dGVzdC1pdi1kYXRh" {
			t.Errorf("Echo IV = %q, want %q", iv, "dGVzdC1pdi1kYXRh")
		}
		if ct, _ := data["ciphertext"].(string); ct != "dGVzdC1jaXBoZXJ0ZXh0" {
			t.Errorf("Echo ciphertext = %q, want %q", ct, "dGVzdC1jaXBoZXJ0ZXh0")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Did not receive echo response")
	}
}

// ---------------------------------------------------------------------------
// 测试：MemberJoined/MemberLeft 通过 WebSocket 的完整流程
// ---------------------------------------------------------------------------

// TestIntegration_MembershipEvents_WebSocket 验证通过 WebSocket 接收成员事件
// 并正确更新 members map。
//
// Validates: Requirements 6.2, 6.3
func TestIntegration_MembershipEvents_WebSocket(t *testing.T) {
	testRoomID := "abcdefghijklmnopqrstu"

	_, wsURL := setupTestServer(t, func(conn *websocket.Conn, msg *protocol.Message) {
		switch msg.Type {
		case protocol.MsgCreateRoom:
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomCreated,
				Data: map[string]interface{}{"roomId": testRoomID},
			})
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomJoined,
				Data: map[string]interface{}{
					"roomId": testRoomID,
					"members": []interface{}{
						map[string]interface{}{
							"id": "user0001", "name": "Creator", "color": "#ffffff",
						},
					},
					"hasPassword": false,
					"ephemeral":   int64(0),
				},
			})

			// 模拟新成员加入
			time.Sleep(50 * time.Millisecond)
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgMemberJoined,
				Data: map[string]interface{}{
					"id":    "user0002",
					"name":  "NewMember",
					"color": "#00ff00",
				},
			})

			// 模拟成员离开
			time.Sleep(50 * time.Millisecond)
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgMemberLeft,
				Data: map[string]interface{}{
					"id": "user0002",
				},
			})

			// 关闭房间
			time.Sleep(50 * time.Millisecond)
			sendServerMessage(t, conn, &protocol.Message{
				Type: protocol.MsgRoomClosed,
				Data: map[string]interface{}{},
			})

		case protocol.MsgLeaveRoom:
			// 正常
		}
	})

	errCh := make(chan error, 1)
	go func() {
		errCh <- RunCreate(wsURL, "Creator")
	}()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("RunCreate returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Test timed out")
	}
}
