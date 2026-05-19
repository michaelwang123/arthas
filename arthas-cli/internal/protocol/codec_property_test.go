// codec_property_test.go 使用属性测试验证 MessagePack 编解码的正确性。
//
// 本文件实现 Property 4: MessagePack Codec Round-Trip，验证对于任意有效的
// 协议消息（CreateRoom、JoinRoom、SendMessage、LeaveRoom、Pong），
// 编码后再解码能产生等价的 type 和 data 字段。
//
// 📚 学习要点: 属性测试 vs 单元测试
// 单元测试验证特定输入的正确性（如 "Alice" 编码后能解码回 "Alice"），
// 属性测试验证**所有可能输入**的通用性质（如"任意字符串编码后都能解码回原值"）。
// 属性测试能发现单元测试遗漏的边界情况（如空字符串、Unicode、极大整数）。
//
// Feature: cli-client, Property 4: MessagePack Codec Round-Trip
package protocol

import (
	"encoding/base64"
	"testing"

	"pgregory.net/rapid"
)

// nanoIDChars 是 NanoID 使用的字符集，用于生成有效的 roomId。
const nanoIDChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"

// genName 生成 1-20 字符的随机显示名称。
// 使用 ASCII 字母和数字以确保 msgpack 编码的确定性。
func genName(t *rapid.T) string {
	length := rapid.IntRange(1, 20).Draw(t, "nameLen")
	chars := make([]byte, length)
	for i := range chars {
		chars[i] = byte(rapid.IntRange(0x20, 0x7E).Draw(t, "nameChar"))
	}
	return string(chars)
}

// genPassword 生成 0-30 字符的随机密码字符串。
func genPassword(t *rapid.T) string {
	length := rapid.IntRange(0, 30).Draw(t, "pwLen")
	chars := make([]byte, length)
	for i := range chars {
		chars[i] = byte(rapid.IntRange(0x20, 0x7E).Draw(t, "pwChar"))
	}
	return string(chars)
}

// genRoomID 生成 21 字符的 NanoID 格式房间 ID。
func genRoomID(t *rapid.T) string {
	chars := make([]byte, 21)
	for i := range chars {
		idx := rapid.IntRange(0, len(nanoIDChars)-1).Draw(t, "roomIdChar")
		chars[i] = nanoIDChars[idx]
	}
	return string(chars)
}

// genBase64URL 生成随机的 base64url 编码字符串（模拟 IV 或密文）。
func genBase64URL(t *rapid.T) string {
	// 生成 12-64 字节的随机数据，然后 base64url 编码
	length := rapid.IntRange(12, 64).Draw(t, "b64Len")
	raw := make([]byte, length)
	for i := range raw {
		raw[i] = byte(rapid.IntRange(0, 255).Draw(t, "b64Byte"))
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

// genEphemeral 生成非负的 int64 值（临时模式秒数）。
func genEphemeral(t *rapid.T) int64 {
	return rapid.Int64Range(0, 86400*30).Draw(t, "ephemeral")
}

// genTimestamp 生成合理范围内的 Unix 毫秒时间戳。
func genTimestamp(t *rapid.T) int64 {
	return rapid.Int64Range(0, 2000000000000).Draw(t, "timestamp")
}

// TestPropertyCodecRoundTrip_CreateRoom 验证 CreateRoom 消息的编解码往返正确性。
//
// **Validates: Requirements 1.3, 2.4, 4.4, 10.1, 10.2, 10.3, 10.5**
func TestPropertyCodecRoundTrip_CreateRoom(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		name := genName(t)
		password := genPassword(t)
		ephemeral := genEphemeral(t)

		original := &Message{
			Type: MsgCreateRoom,
			Data: CreateRoomData{
				Name:      name,
				Password:  password,
				Ephemeral: ephemeral,
			},
		}

		encoded, err := Encode(original)
		if err != nil {
			t.Fatalf("Encode failed: %v", err)
		}

		decoded, err := Decode(encoded)
		if err != nil {
			t.Fatalf("Decode failed: %v", err)
		}

		// Verify type field is identical
		if decoded.Type != MsgCreateRoom {
			t.Fatalf("Type mismatch: got 0x%02x, want 0x%02x", decoded.Type, MsgCreateRoom)
		}

		// Verify data fields (decoded as map[string]interface{})
		data, ok := decoded.Data.(map[string]interface{})
		if !ok {
			t.Fatalf("Data is not map[string]interface{}, got %T", decoded.Data)
		}

		if got, ok := data["name"].(string); !ok || got != name {
			t.Fatalf("name mismatch: got %v, want %q", data["name"], name)
		}
		if got, ok := data["password"].(string); !ok || got != password {
			t.Fatalf("password mismatch: got %v, want %q", data["password"], password)
		}
		if got := ToInt(data["ephemeral"]); got != ephemeral {
			t.Fatalf("ephemeral mismatch: got %d, want %d", got, ephemeral)
		}
	})
}

// TestPropertyCodecRoundTrip_JoinRoom 验证 JoinRoom 消息的编解码往返正确性。
//
// **Validates: Requirements 1.3, 2.4, 4.4, 10.1, 10.2, 10.3, 10.5**
func TestPropertyCodecRoundTrip_JoinRoom(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		roomID := genRoomID(t)
		name := genName(t)
		password := genPassword(t)

		original := &Message{
			Type: MsgJoinRoom,
			Data: JoinRoomData{
				RoomID:   roomID,
				Name:     name,
				Password: password,
			},
		}

		encoded, err := Encode(original)
		if err != nil {
			t.Fatalf("Encode failed: %v", err)
		}

		decoded, err := Decode(encoded)
		if err != nil {
			t.Fatalf("Decode failed: %v", err)
		}

		if decoded.Type != MsgJoinRoom {
			t.Fatalf("Type mismatch: got 0x%02x, want 0x%02x", decoded.Type, MsgJoinRoom)
		}

		data, ok := decoded.Data.(map[string]interface{})
		if !ok {
			t.Fatalf("Data is not map[string]interface{}, got %T", decoded.Data)
		}

		if got, ok := data["roomId"].(string); !ok || got != roomID {
			t.Fatalf("roomId mismatch: got %v, want %q", data["roomId"], roomID)
		}
		if got, ok := data["name"].(string); !ok || got != name {
			t.Fatalf("name mismatch: got %v, want %q", data["name"], name)
		}
		if got, ok := data["password"].(string); !ok || got != password {
			t.Fatalf("password mismatch: got %v, want %q", data["password"], password)
		}
	})
}

// TestPropertyCodecRoundTrip_SendMessage 验证 SendMessage 消息的编解码往返正确性。
//
// **Validates: Requirements 1.3, 2.4, 4.4, 10.1, 10.2, 10.3, 10.5**
func TestPropertyCodecRoundTrip_SendMessage(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		iv := genBase64URL(t)
		ciphertext := genBase64URL(t)

		original := &Message{
			Type: MsgSendMessage,
			Data: SendMessageData{
				IV:         iv,
				Ciphertext: ciphertext,
			},
		}

		encoded, err := Encode(original)
		if err != nil {
			t.Fatalf("Encode failed: %v", err)
		}

		decoded, err := Decode(encoded)
		if err != nil {
			t.Fatalf("Decode failed: %v", err)
		}

		if decoded.Type != MsgSendMessage {
			t.Fatalf("Type mismatch: got 0x%02x, want 0x%02x", decoded.Type, MsgSendMessage)
		}

		data, ok := decoded.Data.(map[string]interface{})
		if !ok {
			t.Fatalf("Data is not map[string]interface{}, got %T", decoded.Data)
		}

		if got, ok := data["iv"].(string); !ok || got != iv {
			t.Fatalf("iv mismatch: got %v, want %q", data["iv"], iv)
		}
		if got, ok := data["ciphertext"].(string); !ok || got != ciphertext {
			t.Fatalf("ciphertext mismatch: got %v, want %q", data["ciphertext"], ciphertext)
		}
	})
}

// TestPropertyCodecRoundTrip_LeaveRoom 验证 LeaveRoom 消息的编解码往返正确性。
//
// LeaveRoom 的 data 为空结构体，解码后应为空 map 或 nil。
//
// **Validates: Requirements 1.3, 2.4, 4.4, 10.1, 10.2, 10.3, 10.5**
func TestPropertyCodecRoundTrip_LeaveRoom(t *testing.T) {
	// LeaveRoom 没有随机字段，但我们仍然用 rapid.Check 验证
	// 编解码在多次执行中的一致性（检测非确定性 bug）。
	rapid.Check(t, func(t *rapid.T) {
		// 使用随机种子确保 rapid 框架正常运行
		_ = rapid.IntRange(0, 100).Draw(t, "dummy")

		original := &Message{
			Type: MsgLeaveRoom,
			Data: LeaveRoomData{},
		}

		encoded, err := Encode(original)
		if err != nil {
			t.Fatalf("Encode failed: %v", err)
		}

		decoded, err := Decode(encoded)
		if err != nil {
			t.Fatalf("Decode failed: %v", err)
		}

		if decoded.Type != MsgLeaveRoom {
			t.Fatalf("Type mismatch: got 0x%02x, want 0x%02x", decoded.Type, MsgLeaveRoom)
		}

		// LeaveRoomData is an empty struct; decoded Data may be an empty map or nil
		// Both are acceptable since there are no fields to verify
		if decoded.Data != nil {
			if data, ok := decoded.Data.(map[string]interface{}); ok {
				if len(data) != 0 {
					t.Fatalf("LeaveRoom data should be empty, got %v", data)
				}
			}
		}
	})
}

// TestPropertyCodecRoundTrip_Pong 验证 Pong 消息的编解码往返正确性。
//
// 📚 学习要点: 为什么 Pong 的时间戳测试特别重要？
// msgpack 会将小整数编码为 int8/uint8 等紧凑类型，而非 int64。
// 如果不使用 ToInt() 辅助函数，直接 data["t"].(int64) 会在小时间戳时 panic。
// 属性测试通过生成各种大小的时间戳值，确保 ToInt() 在所有情况下都能正确工作。
//
// **Validates: Requirements 1.3, 2.4, 4.4, 10.1, 10.2, 10.3, 10.5**
func TestPropertyCodecRoundTrip_Pong(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		timestamp := genTimestamp(t)

		original := &Message{
			Type: MsgPong,
			Data: PongData{T: timestamp},
		}

		encoded, err := Encode(original)
		if err != nil {
			t.Fatalf("Encode failed: %v", err)
		}

		decoded, err := Decode(encoded)
		if err != nil {
			t.Fatalf("Decode failed: %v", err)
		}

		if decoded.Type != MsgPong {
			t.Fatalf("Type mismatch: got 0x%02x, want 0x%02x", decoded.Type, MsgPong)
		}

		data, ok := decoded.Data.(map[string]interface{})
		if !ok {
			t.Fatalf("Data is not map[string]interface{}, got %T", decoded.Data)
		}

		if got := ToInt(data["t"]); got != timestamp {
			t.Fatalf("timestamp mismatch: got %d, want %d", got, timestamp)
		}
	})
}

// TestPropertyCodecRoundTrip_AllTypes 综合验证所有消息类型的编解码往返正确性。
//
// 📚 学习要点: 综合属性测试的价值
// 除了单独测试每种消息类型，综合测试随机选择消息类型进行编解码，
// 模拟真实场景中消息类型的混合使用，确保编解码器不会因消息类型
// 的交替使用而产生状态污染。
//
// **Validates: Requirements 1.3, 2.4, 4.4, 10.1, 10.2, 10.3, 10.5**
func TestPropertyCodecRoundTrip_AllTypes(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Randomly select a message type
		msgType := rapid.IntRange(0, 4).Draw(t, "msgType")

		var original *Message

		switch msgType {
		case 0: // CreateRoom
			name := genName(t)
			password := genPassword(t)
			ephemeral := genEphemeral(t)
			original = &Message{
				Type: MsgCreateRoom,
				Data: CreateRoomData{Name: name, Password: password, Ephemeral: ephemeral},
			}
		case 1: // JoinRoom
			roomID := genRoomID(t)
			name := genName(t)
			password := genPassword(t)
			original = &Message{
				Type: MsgJoinRoom,
				Data: JoinRoomData{RoomID: roomID, Name: name, Password: password},
			}
		case 2: // SendMessage
			iv := genBase64URL(t)
			ciphertext := genBase64URL(t)
			original = &Message{
				Type: MsgSendMessage,
				Data: SendMessageData{IV: iv, Ciphertext: ciphertext},
			}
		case 3: // LeaveRoom
			original = &Message{
				Type: MsgLeaveRoom,
				Data: LeaveRoomData{},
			}
		case 4: // Pong
			timestamp := genTimestamp(t)
			original = &Message{
				Type: MsgPong,
				Data: PongData{T: timestamp},
			}
		}

		encoded, err := Encode(original)
		if err != nil {
			t.Fatalf("Encode failed for type 0x%02x: %v", original.Type, err)
		}

		decoded, err := Decode(encoded)
		if err != nil {
			t.Fatalf("Decode failed for type 0x%02x: %v", original.Type, err)
		}

		// Type must always be preserved
		if decoded.Type != original.Type {
			t.Fatalf("Type mismatch: got 0x%02x, want 0x%02x", decoded.Type, original.Type)
		}

		// Verify data fields based on message type
		switch msgType {
		case 0: // CreateRoom
			origData := original.Data.(CreateRoomData)
			data := decoded.Data.(map[string]interface{})
			if got := data["name"].(string); got != origData.Name {
				t.Fatalf("CreateRoom name mismatch: got %q, want %q", got, origData.Name)
			}
			if got := data["password"].(string); got != origData.Password {
				t.Fatalf("CreateRoom password mismatch: got %q, want %q", got, origData.Password)
			}
			if got := ToInt(data["ephemeral"]); got != origData.Ephemeral {
				t.Fatalf("CreateRoom ephemeral mismatch: got %d, want %d", got, origData.Ephemeral)
			}
		case 1: // JoinRoom
			origData := original.Data.(JoinRoomData)
			data := decoded.Data.(map[string]interface{})
			if got := data["roomId"].(string); got != origData.RoomID {
				t.Fatalf("JoinRoom roomId mismatch: got %q, want %q", got, origData.RoomID)
			}
			if got := data["name"].(string); got != origData.Name {
				t.Fatalf("JoinRoom name mismatch: got %q, want %q", got, origData.Name)
			}
			if got := data["password"].(string); got != origData.Password {
				t.Fatalf("JoinRoom password mismatch: got %q, want %q", got, origData.Password)
			}
		case 2: // SendMessage
			origData := original.Data.(SendMessageData)
			data := decoded.Data.(map[string]interface{})
			if got := data["iv"].(string); got != origData.IV {
				t.Fatalf("SendMessage iv mismatch: got %q, want %q", got, origData.IV)
			}
			if got := data["ciphertext"].(string); got != origData.Ciphertext {
				t.Fatalf("SendMessage ciphertext mismatch: got %q, want %q", got, origData.Ciphertext)
			}
		case 3: // LeaveRoom - no data fields to verify
		case 4: // Pong
			origData := original.Data.(PongData)
			data := decoded.Data.(map[string]interface{})
			if got := ToInt(data["t"]); got != origData.T {
				t.Fatalf("Pong timestamp mismatch: got %d, want %d", got, origData.T)
			}
		}
	})
}

// Feature: cli-client, Property 5: Integer Type Coercion (toInt)
//
// 📚 学习要点: 为什么需要测试 ToInt 的类型覆盖？
// vmihailenco/msgpack/v5 在解码到 interface{} 时，会根据数值大小选择最小适配类型：
// 小正整数 → int8，稍大 → uint8/int16/uint16，以此类推。
// 如果 ToInt() 遗漏了某个类型分支，对应范围的数值会返回 0（静默错误）。
// 此属性测试通过随机生成各种宽度的整数，验证 ToInt() 对所有类型都能正确转换。
//
// **Validates: Requirements 10.4**
func TestProperty_IntegerTypeCoercion(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成一个随机 int64 值，覆盖完整范围
		val := rapid.Int64().Draw(t, "baseValue")

		// 对每种可能的 Go 整数类型，验证 ToInt() 返回正确的 int64 值。
		// 我们将 val 截断到各类型的有效范围，然后包装为该类型传入 ToInt()。

		// int8: -128 ~ 127
		i8 := int8(val)
		if got := ToInt(i8); got != int64(i8) {
			t.Fatalf("ToInt(int8(%d)) = %d, want %d", i8, got, int64(i8))
		}

		// uint8: 0 ~ 255
		u8 := uint8(val)
		if got := ToInt(u8); got != int64(u8) {
			t.Fatalf("ToInt(uint8(%d)) = %d, want %d", u8, got, int64(u8))
		}

		// int16: -32768 ~ 32767
		i16 := int16(val)
		if got := ToInt(i16); got != int64(i16) {
			t.Fatalf("ToInt(int16(%d)) = %d, want %d", i16, got, int64(i16))
		}

		// uint16: 0 ~ 65535
		u16 := uint16(val)
		if got := ToInt(u16); got != int64(u16) {
			t.Fatalf("ToInt(uint16(%d)) = %d, want %d", u16, got, int64(u16))
		}

		// int32: -2147483648 ~ 2147483647
		i32 := int32(val)
		if got := ToInt(i32); got != int64(i32) {
			t.Fatalf("ToInt(int32(%d)) = %d, want %d", i32, got, int64(i32))
		}

		// uint32: 0 ~ 4294967295
		u32 := uint32(val)
		if got := ToInt(u32); got != int64(u32) {
			t.Fatalf("ToInt(uint32(%d)) = %d, want %d", u32, got, int64(u32))
		}

		// int64: 完整范围
		i64 := int64(val)
		if got := ToInt(i64); got != i64 {
			t.Fatalf("ToInt(int64(%d)) = %d, want %d", i64, got, i64)
		}

		// uint64: 0 ~ 18446744073709551615
		// 📚 学习要点: uint64 → int64 溢出行为
		// 当 uint64 值超过 int64 最大值 (2^63 - 1) 时，int64() 转换会产生负数。
		// 这是 Go 的标准行为，ToInt() 与 int64(uint64Value) 保持一致。
		// 在实际使用中，msgpack 时间戳和消息 ID 不会超过 int64 范围。
		u64 := uint64(val)
		if got := ToInt(u64); got != int64(u64) {
			t.Fatalf("ToInt(uint64(%d)) = %d, want %d", u64, got, int64(u64))
		}

		// int: 平台相关宽度（在 64 位系统上等同于 int64）
		i := int(val)
		if got := ToInt(i); got != int64(i) {
			t.Fatalf("ToInt(int(%d)) = %d, want %d", i, got, int64(i))
		}

		// uint: 平台相关宽度（在 64 位系统上等同于 uint64）
		u := uint(val)
		if got := ToInt(u); got != int64(u) {
			t.Fatalf("ToInt(uint(%d)) = %d, want %d", u, got, int64(u))
		}
	})
}
