// keys.go — 密钥生成与 base64url 编解码
//
// 本文件负责 AES-256 对称密钥的生成、导出和导入。
// 在 Arthas 的端到端加密架构中，Room_Key 是房间内所有成员共享的唯一密钥，
// 用于加密和解密所有聊天消息。密钥通过 Share_Code 分发给其他成员。
//
// 安全模型：
// - 密钥由房间创建者在本地生成，服务器永远不接触明文密钥
// - 使用 crypto/rand（CSPRNG）确保密钥不可预测
// - base64url 编码用于在 URL 和终端中安全传输密钥
//
// 📚 学习要点: 为什么是 32 字节（256 位）？
// AES-256 要求密钥长度恰好为 32 字节。这提供了 2^256 的密钥空间，
// 即使面对量子计算机（Grover 算法将有效安全性降至 128 位），
// 仍然提供足够的安全边际。这也是 NIST 推荐的最高 AES 密钥长度。
package crypto

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
)

// keySize 定义 AES-256 密钥的字节长度。
// AES 支持 16（AES-128）、24（AES-192）、32（AES-256）三种密钥长度，
// Arthas 选择最高安全级别 AES-256。
const keySize = 32

// GenerateRoomKey 生成 32 字节（256 位）的 AES-256 密钥。
//
// 使用 crypto/rand.Reader 作为随机源，这是 Go 标准库提供的
// 密码学安全伪随机数生成器（CSPRNG）。在 Linux 上底层使用 getrandom(2)，
// 在 macOS 上使用 arc4random，在 Windows 上使用 CryptGenRandom。
//
// 📚 学习要点: 为什么使用 crypto/rand 而非 math/rand？
// math/rand 使用确定性 PRNG（伪随机数生成器），给定相同种子会产生相同序列，
// 不适合生成密钥。crypto/rand 从操作系统的熵池获取真随机性，
// 输出不可预测，满足密码学安全要求。
//
// 返回值：
//   - []byte: 32 字节原始密钥
//   - error: 如果系统随机源不可用（极罕见情况）
func GenerateRoomKey() ([]byte, error) {
	key := make([]byte, keySize)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("failed to generate room key: %w", err)
	}
	return key, nil
}

// ExportKeyBase64URL 将 32 字节密钥导出为 base64url 编码字符串。
//
// 使用 base64.RawURLEncoding（无 padding 的 URL 安全变体）：
//   - '+' → '-', '/' → '_'（URL 安全字符替换）
//   - 无尾部 '=' padding（RawURLEncoding 的 "Raw" 含义）
//
// 32 字节密钥编码后固定为 43 字符（⌈32×4/3⌉ = 43）。
// 此编码与 Web 客户端 utils.ts 中的 base64url 实现完全兼容。
//
// 📚 学习要点: 为什么使用 RawURLEncoding 而非 StdEncoding？
// 标准 Base64 使用 '+' 和 '/' 字符，在 URL 中需要百分号编码（%2B, %2F），
// 且尾部 '=' padding 在某些上下文中会被截断。
// base64url（RFC 4648 §5）使用 '-' 和 '_' 替代，无 padding，
// 可以安全地嵌入 URL、文件名和终端命令中。
func ExportKeyBase64URL(key []byte) string {
	return base64.RawURLEncoding.EncodeToString(key)
}

// ImportKeyBase64URL 将 base64url 编码字符串解码为 32 字节密钥。
//
// 执行两步验证：
//  1. base64url 解码（检测无效字符）
//  2. 长度验证（必须恰好 32 字节）
//
// 参数：
//   - encoded: base64url 编码的密钥字符串（预期 43 字符）
//
// 返回值：
//   - []byte: 32 字节原始密钥
//   - error: 解码失败或长度不匹配时返回描述性错误
func ImportKeyBase64URL(encoded string) ([]byte, error) {
	key, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("invalid base64url key encoding: %w", err)
	}
	if len(key) != keySize {
		return nil, fmt.Errorf("invalid key length: expected %d bytes, got %d bytes", keySize, len(key))
	}
	return key, nil
}
