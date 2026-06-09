package match

// 消息类型 ID — Client → Server (0x20-0x27)
//
// Match 模块专用消息类型，与 network/protocol.go 中的 0x01-0x1E 不冲突。
// Hub 通过数值范围 (0x20-0x2F) 前置路由到 MatchServer，不在 Hub switch 中逐一添加 case。
const (
	MsgMatchRequest    uint8 = 0x20 // 进入匹配队列
	MsgMatchCancel     uint8 = 0x21 // 取消匹配
	MsgMatchKeyRelay   uint8 = 0x22 // Client A 中转 AES-256 密钥给 Client B
	MsgMatchInviteJoin uint8 = 0x23 // 通过邀请链接加入匹配
	MsgMatchReport     uint8 = 0x24 // 举报配对对象
	MsgMatchExtend     uint8 = 0x25 // 提议延长房间时间
	MsgMatchNext       uint8 = 0x26 // Session loop: 进入下一次匹配
)

// 消息类型 ID — Server → Client (0x28-0x2F)
const (
	MsgMatchGenerateKey   uint8 = 0x28 // 指示 Client A 生成 AES-256 密钥
	MsgMatchFound         uint8 = 0x29 // 配对成功通知（含 roomId）
	MsgMatchTimeout       uint8 = 0x2A // 队列等待超时通知
	MsgMatchError         uint8 = 0x2B // 匹配错误通知
	MsgMatchPartnerLeft   uint8 = 0x2C // 配对方离开通知
	MsgMatchExtendReq     uint8 = 0x2D // 对方提议延期通知
	MsgMatchExtended      uint8 = 0x2E // 延期成功通知
	MsgMatchInviteCreated uint8 = 0x2F // 邀请链接已创建
)

// Match 错误码 (M001-M012)
//
// 与 network/protocol.go 中的 E001-E011 系列错误码互不冲突。
// Match 错误码以 "M" 前缀区分，便于客户端路由错误处理逻辑。
const (
	ErrCodeMatchDisabled      = "M001" // 功能已禁用（--disable-random-match）
	ErrCodeAlreadyInQueue     = "M002" // 用户已在匹配队列中
	ErrCodeAlreadyInRoom      = "M003" // 用户已在房间中，需先离开
	ErrCodeCooldown           = "M004" // 冷却期内（10s），请稍后再试
	ErrCodeRateLimit          = "M005" // 超过每小时匹配请求限制
	ErrCodeQueueFull          = "M006" // 匹配队列已满
	ErrCodeInvalidTags        = "M007" // 无效的兴趣标签（超过 3 个或不在预定义列表中）
	ErrCodeIPBlocked          = "M008" // IP 因举报过多被临时封禁
	ErrCodeInviteExpired      = "M009" // 邀请链接已过期（超过 5 分钟）
	ErrCodeInviteInvalid      = "M010" // 无效的邀请令牌（已使用或不存在）
	ErrCodeExtendMaxReached   = "M011" // 已达最大延期次数（默认 3 次）
	ErrCodeKeyExchangeTimeout = "M012" // 密钥交换超时（5s 内未完成）
)
