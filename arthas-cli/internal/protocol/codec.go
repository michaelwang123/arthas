// codec.go 实现 MessagePack 编解码功能，将 Message 结构体与二进制字节互转。
//
// 本文件是协议层的核心：所有 WebSocket 消息在发送前经过 Encode() 序列化，
// 接收后经过 Decode() 反序列化。ToInt() 辅助函数解决了 msgpack 库的整数类型
// 解码陷阱，是安全提取数字字段的必备工具。
//
// 📚 学习要点: 为什么需要独立的 codec 文件？
// 将编解码逻辑与类型定义分离（protocol.go vs codec.go）遵循单一职责原则：
// - protocol.go 只定义"是什么"（类型、常量、结构体）
// - codec.go 只定义"怎么转换"（序列化、反序列化、类型转换）
// 这使得两者可以独立修改和测试。
package protocol

import (
	"github.com/vmihailenco/msgpack/v5"
)

// Encode 将 Message 序列化为 MessagePack 字节切片。
//
// 编码后的字节格式为 msgpack map: {"type": <uint8>, "data": <object>}
// 其中 data 字段的具体结构取决于消息类型（如 CreateRoomData、SendMessageData 等）。
//
// 示例用法:
//
//	msg := &Message{Type: MsgSendMessage, Data: SendMessageData{IV: iv, Ciphertext: ct}}
//	bytes, err := Encode(msg)
func Encode(msg *Message) ([]byte, error) {
	return msgpack.Marshal(msg)
}

// Decode 将 MessagePack 字节切片反序列化为 Message。
//
// 重要：反序列化后 Data 字段的类型为 map[string]interface{}（而非原始结构体），
// 调用方需要使用类型断言提取字段值，数字字段必须通过 ToInt() 转换。
//
// 示例用法:
//
//	msg, err := Decode(rawBytes)
//	if err != nil { return err }
//	data := msg.Data.(map[string]interface{})
//	timestamp := ToInt(data["t"])
func Decode(data []byte) (*Message, error) {
	var msg Message
	err := msgpack.Unmarshal(data, &msg)
	if err != nil {
		return nil, err
	}
	return &msg, nil
}

// ToInt 安全地将 msgpack 解码的数字值转换为 int64。
//
// 📚 学习要点: msgpack 整数类型陷阱
// vmihailenco/msgpack/v5 在解码到 interface{} 时，会将整数编码为最小适配类型：
//   - 0 ~ 127        → int8   (不是 int64!)
//   - 128 ~ 255      → uint8
//   - -128 ~ -1      → int8
//   - 256 ~ 32767    → int16
//   - 32768 ~ 65535  → uint16
//   - ...以此类推
//
// 如果直接使用 value.(int64) 类型断言，当值为小整数时会 panic：
//
//	data["t"].(int64)  // ❌ panic: interface conversion: interface is int8, not int64
//
// ToInt() 使用 type switch 覆盖所有可能的整数类型，确保安全转换：
//
//	ToInt(data["t"])   // ✅ 无论底层类型是 int8 还是 int64，都正确返回 int64
//
// 对于非整数类型（string、nil、map 等），返回 0。
//
// ⚠️ 已知限制: uint64 值大于 math.MaxInt64 (9.2×10¹⁸) 时会静默溢出为负数。
// 在 Arthas 协议中，所有数字字段（时间戳、ephemeral 秒数）的值远小于此阈值，
// 因此不会触发溢出。如果未来协议引入大 uint64 字段，需要改用返回 (int64, error) 的变体。
func ToInt(v interface{}) int64 {
	switch n := v.(type) {
	case int8:
		return int64(n)
	case uint8:
		return int64(n)
	case int16:
		return int64(n)
	case uint16:
		return int64(n)
	case int32:
		return int64(n)
	case uint32:
		return int64(n)
	case int64:
		return n
	case uint64:
		return int64(n)
	case int:
		return int64(n)
	case uint:
		return int64(n)
	default:
		return 0
	}
}
