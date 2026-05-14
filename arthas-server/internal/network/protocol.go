package network

// 消息类型 ID — Client → Server
const (
	MsgCreateRoom   uint8 = 0x01
	MsgJoinRoom     uint8 = 0x02
	MsgSendMessage  uint8 = 0x03
	MsgLeaveRoom    uint8 = 0x04
	MsgTyping       uint8 = 0x05
	MsgPong         uint8 = 0x06
	MsgSendReaction uint8 = 0x07
)

// 消息类型 ID — Server → Client
const (
	MsgRoomCreated   uint8 = 0x10
	MsgRoomJoined    uint8 = 0x11
	MsgMemberJoined  uint8 = 0x12
	MsgMemberLeft    uint8 = 0x13
	MsgRelayMessage  uint8 = 0x14
	MsgMemberTyping  uint8 = 0x15
	MsgRoomClosed    uint8 = 0x16
	MsgError         uint8 = 0x17
	MsgPing          uint8 = 0x18
	MsgRelayReaction uint8 = 0x19
)

// 错误码
const (
	ErrCodeRoomNotFound   = "E001"
	ErrCodeRoomFull       = "E002"
	ErrCodeNotInRoom      = "E003"
	ErrCodeRateLimited    = "E004"
	ErrCodeInvalidMessage = "E005"
	ErrCodeWrongPassword  = "E006"
)

// Message 通用消息信封，使用 MessagePack 二进制序列化。
type Message struct {
	Type uint8       `msgpack:"type"`
	Data interface{} `msgpack:"data"`
}

// --- Client → Server 数据结构 ---

// CreateRoomData 创建房间请求。
type CreateRoomData struct {
	Name      string `msgpack:"name"`
	Password  string `msgpack:"password"`
	Ephemeral int    `msgpack:"ephemeral"`
}

// JoinRoomData 加入房间请求。
type JoinRoomData struct {
	RoomID   string `msgpack:"roomId"`
	Name     string `msgpack:"name"`
	Password string `msgpack:"password"`
}

// SendMessageData 发送加密消息。
type SendMessageData struct {
	IV         string `msgpack:"iv"`
	Ciphertext string `msgpack:"ciphertext"`
}

// LeaveRoomData 离开房间请求（无字段）。
type LeaveRoomData struct{}

// TypingData 输入状态通知。
type TypingData struct {
	Typing bool `msgpack:"typing"`
}

// PongData 心跳回复。
type PongData struct {
	T int64 `msgpack:"t"`
}

// --- Server → Client 数据结构 ---

// RoomCreatedData 房间创建成功响应。
type RoomCreatedData struct {
	RoomID string `msgpack:"roomId"`
}

// RoomJoinedData 加入房间成功响应，包含当前成员列表。
type RoomJoinedData struct {
	RoomID      string       `msgpack:"roomId"`
	Members     []MemberInfo `msgpack:"members"`
	HasPassword bool         `msgpack:"hasPassword"`
	Ephemeral   int          `msgpack:"ephemeral"`
}

// MemberJoinedData 新成员加入通知。
type MemberJoinedData struct {
	ID    string `msgpack:"id"`
	Name  string `msgpack:"name"`
	Color string `msgpack:"color"`
}

// MemberLeftData 成员离开通知。
type MemberLeftData struct {
	ID string `msgpack:"id"`
}

// RelayMessageData 服务器中转的加密消息。
type RelayMessageData struct {
	SenderID   string `msgpack:"senderId"`
	SenderName string `msgpack:"senderName"`
	IV         string `msgpack:"iv"`
	Ciphertext string `msgpack:"ciphertext"`
	T          int64  `msgpack:"t"`
}

// RelayReactionData 服务器中转的加密反应消息。
type RelayReactionData struct {
	SenderID   string `msgpack:"senderId"`
	SenderName string `msgpack:"senderName"`
	IV         string `msgpack:"iv"`
	Ciphertext string `msgpack:"ciphertext"`
	T          int64  `msgpack:"t"`
}

// MemberTypingData 成员输入状态通知。
type MemberTypingData struct {
	ID     string `msgpack:"id"`
	Typing bool   `msgpack:"typing"`
}

// RoomClosedData 房间关闭通知（无字段）。
type RoomClosedData struct{}

// ErrorData 错误响应。
type ErrorData struct {
	Code string `msgpack:"code"`
	Msg  string `msgpack:"msg"`
}

// PingData 服务器心跳。
type PingData struct {
	T int64 `msgpack:"t"`
}

// --- 共用结构 ---

// MemberInfo 成员信息，用于 RoomJoined 响应中的成员列表。
type MemberInfo struct {
	ID    string `msgpack:"id"`
	Name  string `msgpack:"name"`
	Color string `msgpack:"color"`
}
