// encrypt.go 实现 AES-256-GCM 加密功能。
//
// 本文件是 Arthas CLI 加密层的核心组件，负责将明文消息加密为密文。
// 加密结果与 Web 客户端（src/crypto/encrypt.ts）完全兼容：
// - 使用相同的 AES-256-GCM 算法
// - 使用相同的 12 字节随机 IV
// - 使用相同的 base64url（无 padding）编码格式
//
// 📚 学习要点: AES-GCM 是什么？
// AES-GCM（Galois/Counter Mode）是一种 AEAD（Authenticated Encryption with
// Associated Data）算法，同时提供：
// - 机密性（Confidentiality）：明文被加密，攻击者无法读取内容
// - 完整性（Integrity）：16 字节认证标签（auth tag）确保密文未被篡改
// - 认证（Authentication）：只有持有正确密钥的人才能解密和验证
//
// 与单纯的 AES-CTR 或 AES-CBC 不同，GCM 模式不需要额外的 HMAC 来保证完整性，
// 这简化了协议设计并减少了实现错误的可能性。
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
)

// Encrypt 使用 AES-256-GCM 加密明文。
//
// 自动生成 12 字节随机 IV（使用 crypto/rand CSPRNG），
// 返回 base64url 编码（RawURLEncoding，无 padding）的 IV 和密文。
// 密文末尾包含 16 字节 GCM authentication tag（由 gcm.Seal 自动附加）。
//
// 参数:
//   - key: 32 字节（256 位）AES 密钥
//   - plaintext: 待加密的明文字节切片
//
// 返回:
//   - iv: base64url 编码的 12 字节初始化向量
//   - ciphertext: base64url 编码的密文（含 16 字节 auth tag）
//   - err: 加密过程中的错误（密钥长度错误、随机数生成失败等）
//
// 📚 学习要点: 为什么返回 base64url 而非原始字节？
// Arthas 协议使用 MessagePack 传输加密消息，MessagePack 的 string 类型
// 比 bin 类型更通用（JavaScript 端处理更方便）。base64url 编码将二进制数据
// 转为 URL 安全的 ASCII 字符串，与 Web 客户端的 toBase64Url() 完全兼容。
func Encrypt(key []byte, plaintext []byte) (iv string, ciphertext string, err error) {
	// 1. 创建 AES cipher block
	// key 必须是 16、24 或 32 字节（对应 AES-128、AES-192、AES-256）
	// Arthas 使用 AES-256，所以 key 必须是 32 字节
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", "", fmt.Errorf("crypto/encrypt: failed to create AES cipher: %w", err)
	}

	// 2. 创建 GCM 模式
	// GCM 默认使用 12 字节 nonce（IV）和 16 字节 authentication tag
	// 📚 学习要点: 为什么 GCM 使用 12 字节 nonce？
	// NIST SP 800-38D 推荐 96 位（12 字节）nonce 作为 GCM 的标准长度。
	// 使用其他长度的 nonce 需要额外的 GHASH 计算，降低性能且不增加安全性。
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", fmt.Errorf("crypto/encrypt: failed to create GCM: %w", err)
	}

	// 3. 生成 12 字节随机 IV（Initialization Vector）
	// 📚 学习要点: IV 唯一性是 AES-GCM 安全性的关键前提
	// 同一密钥下，如果两条消息使用相同的 IV，攻击者可以：
	// - 计算两条明文的 XOR（泄露明文信息）
	// - 伪造认证标签（破坏完整性保证）
	// 使用 crypto/rand（操作系统 CSPRNG）生成随机 IV，
	// 碰撞概率约为 2^(-48)（对于 2^32 条消息），在实际使用中可忽略。
	nonce := make([]byte, gcm.NonceSize()) // NonceSize() = 12
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", "", fmt.Errorf("crypto/encrypt: failed to generate random IV: %w", err)
	}

	// 4. 加密明文
	// Seal 将密文和 16 字节认证标签拼接在一起返回：
	//   result = ciphertext || auth_tag
	//   len(result) = len(plaintext) + gcm.Overhead()  (Overhead = 16)
	//
	// 📚 学习要点: Seal 的第一个参数 dst
	// Seal(dst, nonce, plaintext, additionalData) 将结果追加到 dst。
	// 传入 nil 表示分配新的切片。传入 nonce[:0] 可以将 nonce 和密文
	// 拼接到同一个切片中（节省一次分配），但 Arthas 协议分开传输 IV 和密文，
	// 所以这里传 nil 更清晰。
	sealed := gcm.Seal(nil, nonce, plaintext, nil)

	// 5. Base64URL 编码（无 padding）
	// 使用 RawURLEncoding：URL 安全字符集（+ → -, / → _）且无 = padding
	// 与 Web 客户端的 toBase64Url() 函数输出完全一致
	iv = base64.RawURLEncoding.EncodeToString(nonce)
	ciphertext = base64.RawURLEncoding.EncodeToString(sealed)

	return iv, ciphertext, nil
}
