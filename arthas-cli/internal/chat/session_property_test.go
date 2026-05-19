// session_property_test.go 包含 chat 会话层的属性测试。
//
// 本文件使用 pgregory.net/rapid 框架验证会话消息处理的通用属性：
// - Property 10: Ping/Pong 时间戳回显正确性
// - Property 11: 未处理的消息类型不会导致错误或 panic
//
// 📚 学习要点: 属性测试 vs 单元测试
// 属性测试不验证特定输入的特定输出，而是验证"对所有输入都成立的性质"。
// 对于消息路由，关键性质是：未知/未处理的消息类型不会导致程序崩溃。
// 对于 Ping/Pong，关键性质是：时间戳在编解码过程中不丢失精度。
// 这比枚举几个具体值更有说服力——rapid 会自动探索边界情况。
package chat

import (
	"testing"

	"github.com/arthas/arthas-cli/internal/protocol"
	"github.com/arthas/arthas-cli/internal/ui"
	"pgregory.net/rapid"
)

// Feature: cli-client, Property 10: Ping/Pong Timestamp Echo
// **Validates: Requirements 8.1**
//
// 📚 学习要点: 为什么在协议层测试 Ping/Pong？
// handlePing 的核心逻辑是：提取 Ping 中的时间戳 T → 构造 PongData{T: T} →
// 编码为 msgpack 字节 → 发送。如果我们能证明"编码 PongData{T} 后解码得到相同的 T"，
// 就等价于证明了 handlePing 的时间戳回显正确性，而无需模拟 WebSocket 连接。
// 这种"在最小可测试边界验证属性"的策略使测试更简单、更快、更可靠。
//
// 📚 学习要点: 此属性为什么重要？
// 服务器通过 Ping/Pong 机制测量 RTT（往返延迟）：
//  1. 服务器发送 Ping{t: T}（T = 当前 Unix 毫秒时间戳）
//  2. 客户端回复 Pong{t: T}（必须原样回传 T）
//  3. 服务器计算 RTT = now - T
//
// 如果时间戳在编解码过程中被截断或丢失精度（例如 msgpack 将大整数编码为
// 较小类型后溢出），服务器计算的 RTT 将完全错误，可能导致误判连接质量。
// 此属性测试覆盖 int64 全范围，确保即使是极端时间戳值也能正确往返。
func TestProperty_PingPongTimestampEcho(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成任意 int64 时间戳（覆盖完整范围，包括负值和极大值）
		timestamp := rapid.Int64().Draw(t, "timestamp")

		// 模拟 handlePing 的核心逻辑：构造 Pong 消息并编码
		pongMsg := &protocol.Message{
			Type: protocol.MsgPong,
			Data: protocol.PongData{T: timestamp},
		}

		// 编码为 msgpack 字节（与实际发送到 WebSocket 的格式相同）
		encoded, err := protocol.Encode(pongMsg)
		if err != nil {
			t.Fatalf("Encode Pong failed: %v", err)
		}

		// 解码（模拟服务器端接收并解析）
		decoded, err := protocol.Decode(encoded)
		if err != nil {
			t.Fatalf("Decode Pong failed: %v", err)
		}

		// 验证消息类型
		if decoded.Type != protocol.MsgPong {
			t.Fatalf("Type mismatch: got 0x%02x, want 0x%02x", decoded.Type, protocol.MsgPong)
		}

		// 提取时间戳（使用 ToInt 安全处理 msgpack 整数类型变化）
		data, ok := decoded.Data.(map[string]interface{})
		if !ok {
			t.Fatalf("Data is not map[string]interface{}, got %T", decoded.Data)
		}

		got := protocol.ToInt(data["t"])
		if got != timestamp {
			t.Fatalf("Timestamp echo failed: got %d, want %d", got, timestamp)
		}
	})
}

// Feature: cli-client, Property 11: Unhandled Message Types Ignored
// **Validates: Requirements 8.5**
//
// 📚 学习要点: 向前兼容性的属性验证
// Arthas 协议可能在未来添加新的消息类型。CLI 必须对未知类型静默忽略，
// 不能 panic 或返回错误。此属性测试通过随机生成未处理的消息类型 ID，
// 验证 handleServerMessage 在面对任何未处理类型时都能安全返回。
//
// 测试覆盖的消息类型范围：
//   - 0x15 (MemberTyping): CLI 不显示输入指示器
//   - 0x19 (RelayReaction): CLI MVP 不支持反应
//   - 0x1A-0x1E (文件传输): CLI MVP 不支持文件传输
//   - 0x20-0xFF: 未来可能添加的消息类型
//   - 0x00: 无效的零值类型
func TestProperty_UnhandledMessageTypesIgnored(t *testing.T) {
	// 定义已知的未处理消息类型集合
	knownUnhandled := []uint8{
		protocol.MsgMemberTyping,      // 0x15
		protocol.MsgRelayReaction,     // 0x19
		protocol.MsgRelayFileMeta,     // 0x1A
		protocol.MsgRelayFileChunk,    // 0x1B
		protocol.MsgRelayFileComplete, // 0x1C
		protocol.MsgRelayFileCancel,   // 0x1D
		protocol.MsgRelayFileAck,      // 0x1E
	}

	// 定义未定义的消息类型范围（0x20-0xFF 和 0x00）
	undefinedTypes := []uint8{0x00}
	for i := uint8(0x20); i != 0; i++ { // 0x20 to 0xFF
		undefinedTypes = append(undefinedTypes, i)
	}

	// 合并所有未处理类型
	allUnhandled := append(knownUnhandled, undefinedTypes...)

	rapid.Check(t, func(t *rapid.T) {
		// 从未处理类型集合中随机选择一个消息类型
		msgType := rapid.SampledFrom(allUnhandled).Draw(t, "msgType")

		// 创建最小 Session 实例
		// 📚 学习要点: 最小化测试依赖
		// 对于未处理的消息类型，handleServerMessage 不会访问 conn 字段，
		// 因此 conn 可以为 nil。但 display 和 members 必须有效，
		// 因为某些已处理的消息类型路径会访问它们（虽然本测试不会触发）。
		s := &Session{
			display: ui.NewDisplay("test"),
			members: make(map[string]protocol.MemberInfo),
			state:   StateChatting,
		}

		// 构造消息（data 可以是 nil 或任意 map）
		msg := &protocol.Message{
			Type: msgType,
			Data: map[string]interface{}{},
		}

		// 调用 handleServerMessage — 如果没有 panic，测试通过
		// 📚 学习要点: "不 panic" 作为属性断言
		// 对于静默忽略的消息类型，正确行为就是"什么都不做"。
		// 在属性测试中，测试函数正常返回（不 panic）本身就是断言成立的证明。
		// rapid 会用数百个随机类型值调用此函数，任何一次 panic 都会被捕获并报告。
		s.handleServerMessage(msg)
	})
}
