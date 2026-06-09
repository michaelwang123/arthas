package match

// --- Client → Server 数据结构 ---

// MatchRequestData 进入匹配队列请求。
// Tags 为用户选择的兴趣标签（0-3 个），服务器校验合法性。
type MatchRequestData struct {
	Tags []string `msgpack:"tags"` // 0-3 个兴趣标签（server validates against ValidTags）
}

// MatchKeyRelayData 客户端 A 中转 AES-256 密钥给服务器。
// 服务器收到后立即转发给配对方 B，不持久化、不日志记录。
type MatchKeyRelayData struct {
	Key string `msgpack:"key"` // base64url-encoded AES-256 key
}

// MatchInviteJoinData 通过邀请链接加入匹配请求。
type MatchInviteJoinData struct {
	Token string `msgpack:"token"` // 邀请令牌（crypto-random URL-safe token）
}

// MatchReportData 举报配对对象请求。
type MatchReportData struct {
	Reason string `msgpack:"reason"` // harassment | spam | inappropriate | other
}

// MatchNextData Session loop: 离开当前房间并重新进入匹配队列。
// 复用 MatchRequestData 结构——客户端显式重新发送 tags，
// 避免依赖 MatchRoomState 在房间销毁后可能丢失 tags 的边界情况。
type MatchNextData = MatchRequestData

// --- Server → Client 数据结构 ---

// MatchGenerateKeyData 服务器指示 Client A 生成 AES-256 密钥。
type MatchGenerateKeyData struct {
	PartnerID string `msgpack:"partnerId"` // 配对方 ID（用于 UI 显示）
}

// MatchFoundData 配对成功通知。
// 两个客户端都会收到此消息，但只有 Client B 的 Key 字段非空。
type MatchFoundData struct {
	RoomID    string `msgpack:"roomId"`        // 匹配房间 ID
	ExpiresAt int64  `msgpack:"expiresAt"`     // 房间过期时间（Unix 秒）
	Ephemeral int    `msgpack:"ephemeral"`     // 阅后即焚秒数
	Key       string `msgpack:"key,omitempty"` // base64url AES-256 key（仅 Client B 收到）
}

// MatchTimeoutData 匹配超时通知。
type MatchTimeoutData struct {
	WaitedSeconds int `msgpack:"waitedSeconds"` // 等待了多少秒
}

// MatchErrorData 匹配错误响应。
type MatchErrorData struct {
	Code       string `msgpack:"code"`                 // 错误码（M001-M012）
	Msg        string `msgpack:"msg"`                  // 描述性错误消息
	RetryAfter int    `msgpack:"retryAfter,omitempty"` // 重试等待秒数（速率限制时）
}

// MatchExtendedData 房间延期成功通知。
type MatchExtendedData struct {
	NewExpiresAt   int64 `msgpack:"newExpiresAt"`   // 新的过期时间（Unix 秒）
	ExtensionsLeft int   `msgpack:"extensionsLeft"` // 剩余可用延期次数
}

// MatchInviteCreatedData 邀请链接创建成功通知。
type MatchInviteCreatedData struct {
	Token     string `msgpack:"token"`     // 邀请令牌
	ExpiresAt int64  `msgpack:"expiresAt"` // 令牌过期时间（Unix 秒）
	Link      string `msgpack:"link"`      // 完整邀请 URL（{baseUrl}/match/{token}）
}
