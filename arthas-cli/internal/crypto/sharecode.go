// sharecode.go — 分享码解析与构建
//
// 本文件负责 Arthas 分享码（Share_Code）的解析和构建。
// 分享码是房间创建者分发给其他成员的凭证字符串，包含加入房间所需的全部信息：
// 房间 ID、加密密钥、以及可选的临时模式参数。
//
// 分享码格式: {roomId}:{base64url(roomKey)}[:{ephemeral}]
//   - roomId:    21 字符 NanoID（服务器生成的房间唯一标识）
//   - keyEncoded: 43 字符 base64url（32 字节 AES-256 密钥，无 padding）
//   - ephemeral: 可选整数（临时模式秒数，0 或缺省表示非临时）
//
// 安全模型：
// - 分享码包含明文密钥，必须通过安全渠道传输（面对面、加密消息等）
// - 任何持有分享码的人都能解密房间内的所有消息
// - 服务器永远不接触分享码，只看到 roomId
//
// 📚 学习要点: 为什么分享码使用冒号分隔而非 URL 参数？
// 冒号分隔的格式更紧凑，便于在终端中复制粘贴。
// NanoID 字符集（A-Za-z0-9_-）和 base64url 字符集都不包含冒号，
// 因此冒号是安全的分隔符，不会与内容冲突。
// 这与 Web 客户端的 shareKey.ts 中的格式完全一致。
package crypto

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// roomIDLength 定义 NanoID 房间标识符的固定长度。
// 服务器使用 nanoid 库生成 21 字符的唯一 ID（默认字母表: A-Za-z0-9_-）。
const roomIDLength = 21

// keyEncodedLength 定义 base64url 编码后密钥的固定长度。
// 32 字节密钥经 base64url 编码（无 padding）后为 ⌈32×4/3⌉ = 43 字符。
const keyEncodedLength = 43

// ShareCode 表示解析后的分享码结构。
//
// 📚 学习要点: 为什么将分享码解析为结构体？
// 将字符串解析为强类型结构体有多个好处：
// 1. 编译时类型安全 — 不会混淆 roomID 和 key
// 2. 验证集中化 — ParseShareCode 是唯一的验证入口
// 3. 不可变语义 — 解析后的值已经过验证，后续代码无需重复检查
type ShareCode struct {
	RoomID    string // 21 字符 NanoID（服务器分配的房间唯一标识）
	KeyBytes  []byte // 32 字节原始 AES-256 密钥
	Ephemeral int    // 临时模式秒数（0 = 非临时，>0 = 消息在指定秒数后过期）
}

// ParseShareCode 解析分享码字符串，提取房间 ID、密钥和可选的临时模式参数。
//
// 格式: {roomId}:{base64url(roomKey)}[:{ephemeral}]
//
// 验证规则：
//   - 按冒号分割后必须有 2 或 3 段
//   - 第 1 段（roomId）：必须恰好 21 字符
//   - 第 2 段（key）：必须恰好 43 字符，且能解码为 32 字节
//   - 第 3 段（ephemeral）：可选，必须为非负整数
//
// 📚 学习要点: 为什么使用 ImportKeyBase64URL 而非直接解码？
// ImportKeyBase64URL 已经封装了 base64url 解码 + 32 字节长度验证，
// 复用它避免了重复验证逻辑，也确保了密钥验证规则的一致性。
// 如果未来密钥验证规则变更（如支持不同长度），只需修改一处。
//
// 参数：
//   - code: 分享码字符串
//
// 返回值：
//   - *ShareCode: 解析后的分享码结构体
//   - error: 格式无效时返回描述性错误
func ParseShareCode(code string) (*ShareCode, error) {
	parts := strings.Split(code, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return nil, errors.New("invalid share code: expected format {roomId}:{key}[:{ephemeral}]")
	}

	// 验证 roomId 长度（21 字符 NanoID）
	roomID := parts[0]
	if len(roomID) != roomIDLength {
		return nil, fmt.Errorf("invalid share code: room ID must be %d characters, got %d", roomIDLength, len(roomID))
	}

	// 验证 key 段长度（43 字符 base64url）
	keyEncoded := parts[1]
	if len(keyEncoded) != keyEncodedLength {
		return nil, fmt.Errorf("invalid share code: key segment must be %d characters, got %d", keyEncodedLength, len(keyEncoded))
	}

	// 解码并验证密钥（base64url → 32 字节）
	keyBytes, err := ImportKeyBase64URL(keyEncoded)
	if err != nil {
		return nil, fmt.Errorf("invalid share code: %w", err)
	}

	// 解析可选的 ephemeral 段
	ephemeral := 0
	if len(parts) == 3 {
		ephemeral, err = strconv.Atoi(parts[2])
		if err != nil {
			return nil, fmt.Errorf("invalid share code: ephemeral must be a valid integer, got %q", parts[2])
		}
		if ephemeral < 0 {
			return nil, fmt.Errorf("invalid share code: ephemeral must be non-negative, got %d", ephemeral)
		}
	}

	return &ShareCode{
		RoomID:    roomID,
		KeyBytes:  keyBytes,
		Ephemeral: ephemeral,
	}, nil
}

// BuildShareCode 从组件构建分享码字符串。
//
// 格式规则：
//   - ephemeral == 0: 输出 "{roomId}:{base64url(key)}"（两段格式）
//   - ephemeral > 0:  输出 "{roomId}:{base64url(key)}:{ephemeral}"（三段格式）
//
// 📚 学习要点: 为什么 ephemeral == 0 时不输出第三段？
// 省略默认值（0）使分享码更短，便于复制粘贴。
// Web 客户端也采用相同策略：非临时房间的分享码只有两段。
// ParseShareCode 在缺少第三段时默认 ephemeral = 0，保证了双向兼容。
//
// 参数：
//   - roomID: 21 字符房间 ID
//   - key: 32 字节原始密钥
//   - ephemeral: 临时模式秒数（0 = 非临时）
//
// 返回值：
//   - string: 构建好的分享码字符串
func BuildShareCode(roomID string, key []byte, ephemeral int) string {
	keyEncoded := ExportKeyBase64URL(key)
	if ephemeral > 0 {
		return roomID + ":" + keyEncoded + ":" + strconv.Itoa(ephemeral)
	}
	return roomID + ":" + keyEncoded
}
