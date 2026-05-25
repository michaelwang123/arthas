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

	// 📚 学习要点: 文件传输消息类型编号方案
	// 文件传输 Client→Server 消息使用 0x08-0x0C 范围（紧接现有 0x07 之后）。
	// Server→Client 中转消息使用 0x1A-0x1E 范围（紧接现有 0x19 之后）。
	// 这种编号方案保持了「发送类 = 低位段，中转类 = 高位段」的一致性，
	// 同时为未来扩展预留了 0x0D-0x0F 和 0x1F+ 的空间。
	//
	// 每种 Send 消息都有对应的 Relay 消息（偏移量 = 0x12）：
	//   0x08 → 0x1A (Meta)
	//   0x09 → 0x1B (Chunk)
	//   0x0A → 0x1C (Complete)
	//   0x0B → 0x1D (Cancel)
	//   0x0C → 0x1E (Ack)

	MsgSendFileMeta     uint8 = 0x08 // 发送加密文件元数据（文件名、大小、分片数等）
	MsgSendFileChunk    uint8 = 0x09 // 发送加密文件分片（64KB 加密数据 + 12B IV）
	MsgSendFileComplete uint8 = 0x0A // 通知所有分片已发送完毕
	MsgSendFileCancel   uint8 = 0x0B // 发送方取消文件传输
	MsgSendFileAck      uint8 = 0x0C // 接收方确认文件接收完成
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

	// 文件传输 Server → Client 中转消息
	// 服务器收到 Send 消息后，附加发送方信息（senderId, senderName）后转发给房间其他成员。
	// 服务器不解密、不存储、不检查任何文件内容（零知识中转架构）。
	MsgRelayFileMeta     uint8 = 0x1A // 中转加密文件元数据给房间成员
	MsgRelayFileChunk    uint8 = 0x1B // 中转加密文件分片给房间成员
	MsgRelayFileComplete uint8 = 0x1C // 中转传输完成信号
	MsgRelayFileCancel   uint8 = 0x1D // 中转取消传输信号
	MsgRelayFileAck      uint8 = 0x1E // 中转接收确认给发送方
)

// 错误码
const (
	ErrCodeRoomNotFound   = "E001"
	ErrCodeRoomFull       = "E002"
	ErrCodeNotInRoom      = "E003"
	ErrCodeRateLimited    = "E004"
	ErrCodeInvalidMessage = "E005"
	ErrCodeWrongPassword  = "E006"

	// ErrCodeRoomExpired 表示客户端尝试加入一个已过期的房间。
	// 服务器在 handleJoinRoom 中检测到 room.IsExpired(now)==true 时返回此错误码。
	// 此检查在密码验证和容量检查之前执行，提供实时过期拒绝能力，
	// 即使 Expiry_Checker 尚未运行其周期性扫描也能立即拒绝过期房间。
	ErrCodeRoomExpired = "E007"
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

	// Expiry 房间有效期秒数，由客户端在创建房间时指定。
	// 取值范围：
	//   - 0: 永不过期（默认行为，向后兼容）
	//   - 负数: 服务器视为 0（防御性处理，不返回错误）
	//   - 1 ~ 604800: 有效的过期时长（秒）
	//   - >604800: 服务器静默截断为 604800（7 天上限，防止内存耗尽攻击）
	Expiry int `msgpack:"expiry"`
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

	// ExpiresAt 房间过期时间戳（Unix 秒）。
	// 取值范围：
	//   - 0: 房间永不过期
	//   - >0: 房间将在此 Unix 时间戳后过期，由服务器计算（now + expiry）
	// 客户端使用此值启动倒计时显示，但服务器是过期判定的唯一权威。
	ExpiresAt int64 `msgpack:"expiresAt"`
}

// RoomJoinedData 加入房间成功响应，包含当前成员列表。
type RoomJoinedData struct {
	RoomID      string       `msgpack:"roomId"`
	Members     []MemberInfo `msgpack:"members"`
	HasPassword bool         `msgpack:"hasPassword"`
	Ephemeral   int          `msgpack:"ephemeral"`

	// ExpiresAt 房间过期时间戳（Unix 秒）。
	// 取值范围：
	//   - 0: 房间永不过期
	//   - >0: 房间将在此 Unix 时间戳后过期
	// 加入者使用此值启动倒计时显示，与 RoomCreatedData.ExpiresAt 语义相同。
	ExpiresAt int64 `msgpack:"expiresAt"`
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

// RoomClosedData 房间关闭通知。
// 📚 学习要点: omitempty 实现向后兼容
// Reason 字段使用 omitempty tag，当值为空字符串时 msgpack 序列化会省略该字段。
// 这确保旧客户端（不识别 reason 字段）收到的消息格式与之前完全一致，
// 而新客户端可以根据 reason 字段区分关闭原因并显示不同的本地化消息。
type RoomClosedData struct {
	// Reason 房间关闭原因。
	// 取值范围：
	//   - "": 空字符串或缺失，表示常规关闭（所有成员离开）
	//   - "expired": 房间因过期被 Expiry_Checker 自动销毁
	// 客户端根据此字段显示不同的本地化提示消息。
	Reason string `msgpack:"reason,omitempty"`
}

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

// --- 文件传输 Client → Server 数据结构 ---
//
// 📚 学习要点: 零知识文件中转架构
// 文件传输采用「客户端加密 → 服务器盲转 → 客户端解密」模式：
// 1. 发送方在本地使用 Room_Key (AES-256-GCM) 加密文件分片
// 2. 服务器仅看到密文字节流，无法解密、无法检查内容
// 3. 服务器收到即转发，不缓存不持久化（内存占用仅在写操作期间）
// 4. 接收方使用相同的 Room_Key 解密还原文件
//
// 这些 Send* 结构体定义了客户端发送给服务器的消息格式。
// 服务器解析这些结构体仅为提取路由信息（transferId），
// 加密字段（iv, ciphertext, data）对服务器来说是不透明的字节流。

// SendFileMetaData 客户端发送加密文件元数据。
// 包含加密后的文件信息（文件名、大小、MIME 类型、分片总数、可选缩略图）。
// 服务器提取 TransferID 用于追踪活跃传输状态，其余字段原样转发。
//
// 📚 学习要点: 为什么 Metadata 也要加密？
// 文件名和 MIME 类型本身就是敏感信息（如 "公司财报2024.xlsx"）。
// 加密 Metadata 确保服务器无法通过文件名推断传输内容，
// 维持了完整的零知识属性。
type SendFileMetaData struct {
	TransferID string `msgpack:"transferId"` // 传输会话唯一标识（NanoID 21 chars，明文，用于路由）
	IV         string `msgpack:"iv"`         // base64url 编码的 96-bit IV（Metadata 加密用）
	Ciphertext []byte `msgpack:"ciphertext"` // 加密后的 FileMetadata JSON（msgpack bin 格式）
}

// SendFileChunkData 客户端发送加密文件分片。
// 每个分片独立加密（独立 IV），允许流式处理且单片损坏不影响其他片。
// 服务器验证 TransferID 匹配后原样转发给房间其他成员。
//
// 📚 学习要点: IV 使用 []byte 而非 string 的性能考量
// Metadata 的 IV 使用 string（base64url），因为只发送一次，方便调试和日志。
// Chunk 的 IV 使用 []byte（原始二进制），因为高频发送（最多 80 次/文件）：
// - 避免 base64 编码/解码开销（每次 12 bytes → 16 chars 的转换）
// - msgpack 对 []byte 使用 bin 格式，比 string 更紧凑（少 2-3 bytes 头部）
// - 服务器不需要读取 IV 内容，直接转发即可
type SendFileChunkData struct {
	TransferID string `msgpack:"transferId"` // 传输会话标识（与 Meta 中的相同）
	Index      int    `msgpack:"index"`      // 分片索引（0-based），用 toInt() 解析
	IV         []byte `msgpack:"iv"`         // 12 bytes 原始 IV（bin 格式，非 base64）
	Data       []byte `msgpack:"data"`       // 加密后的分片数据（bin 格式，含 16B GCM tag）
}

// SendFileCompleteData 传输完成信号。
// 发送方在所有分片发送完毕后发送此消息，通知接收方可以开始重组文件。
// 服务器收到后清除该客户端的 activeTransferID，允许发起新的传输。
type SendFileCompleteData struct {
	TransferID string `msgpack:"transferId"` // 已完成传输的会话标识
}

// SendFileCancelData 取消传输信号。
// 发送方主动取消正在进行的文件传输（如用户点击取消按钮）。
// 服务器收到后清除 activeTransferID 并广播取消信号给接收方。
// 接收方收到后应丢弃已接收的分片缓冲区，释放内存。
type SendFileCancelData struct {
	TransferID string `msgpack:"transferId"` // 被取消传输的会话标识
}

// SendFileAckData 接收确认信号。
// 接收方成功接收并重组完整文件后发送此确认。
// 服务器将此确认定向转发给原始发送方（非广播），
// 发送方据此更新 UI 显示 "已送达 (N/M)"。
//
// 📚 学习要点: ACK 是定向转发而非广播
// 与其他文件传输消息（Meta/Chunk/Complete/Cancel）的广播模式不同，
// ACK 只需要发送给原始发送方一人。服务器通过遍历房间成员，
// 找到 activeTransferID 匹配的客户端（即发送方），仅向其转发 ACK。
// 这减少了不必要的网络流量（N-2 个无关成员不会收到 ACK）。
type SendFileAckData struct {
	TransferID string `msgpack:"transferId"` // 已确认接收的传输会话标识
}

// --- 文件传输 Server → Client 数据结构 ---
//
// 📚 学习要点: Relay 消息的附加信息
// 服务器在转发时附加发送方身份信息（SenderID, SenderName），
// 使接收方能够在 UI 中正确显示「谁发送了这个文件」。
// 这些身份信息由服务器从已认证的 Client 对象中提取，
// 而非信任客户端自行声明（防止身份伪造）。
//
// RelayFileMeta 还附加服务器时间戳 T，用于消息排序和超时计算。

// RelayFileMetaData 服务器中转文件元数据给房间成员。
// 接收方据此准备分片缓冲区、显示文件信息占位符、启动超时定时器。
type RelayFileMetaData struct {
	SenderID   string `msgpack:"senderId"`   // 发送方客户端 ID（服务器填充）
	SenderName string `msgpack:"senderName"` // 发送方昵称（服务器填充）
	TransferID string `msgpack:"transferId"` // 传输会话标识
	IV         string `msgpack:"iv"`         // Metadata 加密 IV（base64url）
	Ciphertext []byte `msgpack:"ciphertext"` // 加密后的 FileMetadata
	T          int64  `msgpack:"t"`          // 服务器时间戳（Unix 毫秒）
}

// RelayFileChunkData 服务器中转文件分片给房间成员。
// 接收方使用 Room_Key + IV 解密分片，存入 buffer[Index] 位置。
// 依赖 TCP 保序特性，分片按发送顺序到达（无需乱序处理）。
type RelayFileChunkData struct {
	SenderID   string `msgpack:"senderId"`   // 发送方客户端 ID
	TransferID string `msgpack:"transferId"` // 传输会话标识
	Index      int    `msgpack:"index"`      // 分片索引（0-based）
	IV         []byte `msgpack:"iv"`         // 12 bytes 原始 IV
	Data       []byte `msgpack:"data"`       // 加密后的分片数据
}

// RelayFileCompleteData 服务器中转传输完成信号。
// 接收方收到后验证所有分片已到齐，然后重组文件并发送 ACK。
type RelayFileCompleteData struct {
	SenderID   string `msgpack:"senderId"`   // 发送方客户端 ID
	TransferID string `msgpack:"transferId"` // 已完成传输的会话标识
}

// RelayFileCancelData 服务器中转取消信号。
// 接收方收到后丢弃已接收的分片缓冲区，显示 "发送方已取消传输"。
// 此消息也在发送方断线时由服务器主动生成并广播（清理孤立传输）。
type RelayFileCancelData struct {
	SenderID   string `msgpack:"senderId"`   // 发送方客户端 ID
	TransferID string `msgpack:"transferId"` // 被取消传输的会话标识
}

// RelayFileAckData 服务器中转接收确认给发送方。
// 仅发送给原始发送方（定向转发，非广播）。
// 发送方据此更新 UI 中的送达计数 "已送达 (N/M)"。
//
// 📚 学习要点: 为什么使用 ReceiverID 而非 SenderID？
// 这条消息的方向是「接收方 → 服务器 → 发送方」。
// 发送方需要知道「谁确认了接收」，所以携带 ReceiverID。
// 这与其他 Relay 消息携带 SenderID 的模式不同，
// 因为 ACK 的语义是「接收方的确认」而非「发送方的数据」。
type RelayFileAckData struct {
	ReceiverID string `msgpack:"receiverId"` // 确认接收的客户端 ID
	TransferID string `msgpack:"transferId"` // 对应的传输会话标识
}
