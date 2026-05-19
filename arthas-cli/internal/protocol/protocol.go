// protocol.go 定义 arthas-cli 与 Arthas 服务器之间的 MessagePack 二进制协议。
//
// 协议信封格式:
//
//	所有 WebSocket 消息使用统一的 {type: uint8, data: object} 信封，
//	通过 MessagePack 二进制序列化传输。type 字段标识消息类型（1 字节），
//	data 字段包含该类型对应的结构化数据。
//
// 与 Web 客户端的兼容性:
//
//	本文件中的消息类型常量和数据结构与 arthas-server/internal/network/protocol.go
//	以及 arthas-client (Web) 的 TypeScript 实现完全对齐。CLI 客户端使用相同的
//	消息类型编号、字段名（通过 msgpack tag）和编码规则，确保三端互操作。
//
// 📚 学习要点: 协议层与实现层的分离
// 本文件只包含类型定义和常量，不包含任何编解码逻辑或网络 I/O。
// 编解码逻辑在 codec.go 中实现。这种分离使得：
// 1. 协议定义可以作为文档阅读（无需理解编解码细节）
// 2. 类型定义可以被多个包引用而不引入循环依赖
// 3. 协议变更的影响范围清晰可控
package protocol

// ---------------------------------------------------------------------------
// 消息类型常量 — Client → Server
// ---------------------------------------------------------------------------
//
// 📚 学习要点: 消息类型编号方案
// Client→Server 消息使用 0x01-0x0C 低位段，Server→Client 消息使用 0x10-0x1E 高位段。
// 这种分段设计使得仅通过 type 字段就能判断消息方向，便于调试和日志分析。
// 每种 SendFile* 消息都有对应的 RelayFile* 消息（偏移量 = 0x12）。
const (
	// MsgCreateRoom 创建房间请求。
	// 客户端发送此消息请求创建新房间，服务器响应 MsgRoomCreated + MsgRoomJoined。
	MsgCreateRoom uint8 = 0x01

	// MsgJoinRoom 加入房间请求。
	// 客户端发送此消息请求加入已有房间，服务器响应 MsgRoomJoined 或 MsgError。
	MsgJoinRoom uint8 = 0x02

	// MsgSendMessage 发送加密聊天消息。
	// data 包含 base64url 编码的 IV 和 AES-256-GCM 密文。
	MsgSendMessage uint8 = 0x03

	// MsgLeaveRoom 离开房间请求。
	// 客户端主动离开房间（/quit、Ctrl+C、Ctrl+D 触发）。
	MsgLeaveRoom uint8 = 0x04

	// MsgTyping 输入状态通知。
	// CLI 不发送此消息（终端无法检测"正在输入"状态），但定义以保持协议完整性。
	MsgTyping uint8 = 0x05

	// MsgPong 心跳回复。
	// 收到服务器 MsgPing 后，回复相同的时间戳以维持连接。
	MsgPong uint8 = 0x06

	// MsgSendReaction 发送加密反应消息。
	// CLI MVP 不实现此功能，但定义以保持协议完整性。
	MsgSendReaction uint8 = 0x07

	// 文件传输 Client → Server（CLI 不发送，但定义以保持协议完整性）
	MsgSendFileMeta     uint8 = 0x08 // 发送加密文件元数据
	MsgSendFileChunk    uint8 = 0x09 // 发送加密文件分片
	MsgSendFileComplete uint8 = 0x0A // 通知所有分片已发送完毕
	MsgSendFileCancel   uint8 = 0x0B // 发送方取消文件传输
	MsgSendFileAck      uint8 = 0x0C // 接收方确认文件接收完成
)

// ---------------------------------------------------------------------------
// 消息类型常量 — Server → Client
// ---------------------------------------------------------------------------

const (
	// MsgRoomCreated 房间创建成功响应。
	// 包含服务器分配的 roomId，紧接着会收到 MsgRoomJoined。
	MsgRoomCreated uint8 = 0x10

	// MsgRoomJoined 加入房间成功响应。
	// 包含房间 ID、当前成员列表、密码保护状态和临时模式配置。
	MsgRoomJoined uint8 = 0x11

	// MsgMemberJoined 新成员加入通知。
	// 包含新成员的 ID、昵称和分配的颜色。
	MsgMemberJoined uint8 = 0x12

	// MsgMemberLeft 成员离开通知。
	// 包含离开成员的 ID，CLI 从 members map 中查找对应昵称。
	MsgMemberLeft uint8 = 0x13

	// MsgRelayMessage 服务器中转的加密聊天消息。
	// 包含发送者信息、加密数据和服务器时间戳。
	MsgRelayMessage uint8 = 0x14

	// MsgMemberTyping 成员输入状态通知。
	// CLI 静默忽略此消息（终端不显示输入指示器）。
	MsgMemberTyping uint8 = 0x15

	// MsgRoomClosed 房间关闭通知。
	// 收到后显示 "Room closed" 并正常退出（exit 0）。
	MsgRoomClosed uint8 = 0x16

	// MsgError 服务器错误响应。
	// 包含错误码和描述信息，CLI 显示后根据上下文决定是否退出。
	MsgError uint8 = 0x17

	// MsgPing 服务器心跳。
	// 包含时间戳 T，CLI 必须回复 MsgPong 携带相同的 T 值。
	MsgPing uint8 = 0x18

	// MsgRelayReaction 服务器中转的加密反应消息。
	// CLI 静默忽略此消息（终端不显示反应）。
	MsgRelayReaction uint8 = 0x19

	// 文件传输 Server → Client 中转消息（CLI 全部静默忽略）
	MsgRelayFileMeta     uint8 = 0x1A // 中转加密文件元数据
	MsgRelayFileChunk    uint8 = 0x1B // 中转加密文件分片
	MsgRelayFileComplete uint8 = 0x1C // 中转传输完成信号
	MsgRelayFileCancel   uint8 = 0x1D // 中转取消传输信号
	MsgRelayFileAck      uint8 = 0x1E // 中转接收确认
)

// ---------------------------------------------------------------------------
// 错误码常量
// ---------------------------------------------------------------------------
//
// 📚 学习要点: 错误码设计
// 服务器使用字符串错误码（而非数字）以提高可读性和可扩展性。
// CLI 只需处理与房间加入相关的错误码（E001、E002、E006），
// 其他错误码（E003-E005）在 CLI 正常使用中不会遇到。
const (
	// ErrRoomNotFound 房间不存在（可能已过期或 ID 错误）。
	ErrRoomNotFound = "E001"

	// ErrRoomFull 房间已满（达到最大成员数限制）。
	ErrRoomFull = "E002"

	// ErrIncorrectPassword 房间密码错误。
	ErrIncorrectPassword = "E006"
)

// ---------------------------------------------------------------------------
// 消息信封
// ---------------------------------------------------------------------------

// Message 是所有 WebSocket 消息的通用信封结构。
// Type 标识消息类型（对应上方的 Msg* 常量），Data 包含该类型的具体数据。
//
// 📚 学习要点: interface{} 作为 Data 类型的权衡
// 发送时 Data 是具体的结构体（如 CreateRoomData），msgpack 将其编码为 map。
// 接收时 Data 被解码为 map[string]interface{}，需要手动提取字段。
// 这种设计避免了为每种消息类型定义独立的解码逻辑，
// 代价是接收端需要类型断言（通过 ToInt() 等辅助函数安全处理）。
type Message struct {
	Type uint8       `msgpack:"type"`
	Data interface{} `msgpack:"data"`
}

// ---------------------------------------------------------------------------
// Client → Server 数据结构
// ---------------------------------------------------------------------------

// CreateRoomData 创建房间请求的数据字段。
// Name 是创建者的显示昵称，Password 为房间密码（CLI MVP 发送空字符串），
// Ephemeral 为临时模式秒数（CLI MVP 发送 0 表示非临时）。
type CreateRoomData struct {
	Name      string `msgpack:"name"`
	Password  string `msgpack:"password"`
	Ephemeral int64  `msgpack:"ephemeral"`
}

// JoinRoomData 加入房间请求的数据字段。
// RoomID 是 21 字符的 NanoID，Name 是加入者的显示昵称，
// Password 为房间密码（CLI MVP 发送空字符串）。
type JoinRoomData struct {
	RoomID   string `msgpack:"roomId"`
	Name     string `msgpack:"name"`
	Password string `msgpack:"password"`
}

// SendMessageData 发送加密消息的数据字段。
// IV 和 Ciphertext 均为 base64url 编码的字符串，
// 与 Web 客户端的编码方式完全一致。
//
// 安全注释: IV 必须是 12 字节随机值（crypto/rand 生成），
// 同一密钥下绝不重复。Ciphertext 包含 AES-256-GCM 的 16 字节认证标签。
type SendMessageData struct {
	IV         string `msgpack:"iv"`
	Ciphertext string `msgpack:"ciphertext"`
}

// LeaveRoomData 离开房间请求的数据字段（无字段）。
// 服务器收到后将客户端从房间移除并广播 MemberLeft 给其他成员。
type LeaveRoomData struct{}

// PongData 心跳回复的数据字段。
// T 是从 PingData 中原样回传的时间戳（Unix 毫秒），
// 服务器用于计算往返延迟。
type PongData struct {
	T int64 `msgpack:"t"`
}

// ---------------------------------------------------------------------------
// 共用结构
// ---------------------------------------------------------------------------

// MemberInfo 房间成员信息，用于 RoomJoined 响应中的成员列表
// 以及 CLI 内部的 members map（用于 MemberLeft 时查找昵称和颜色）。
type MemberInfo struct {
	// ID 是服务器分配的 8 字符 UUID 前缀，用于唯一标识成员。
	ID string `msgpack:"id"`
	// Name 是成员的显示昵称（1-20 字符）。
	Name string `msgpack:"name"`
	// Color 是服务器分配的 CSS hex 颜色（如 "#4a7fbf"），用于终端着色。
	Color string `msgpack:"color"`
}
