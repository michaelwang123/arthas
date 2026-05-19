// decrypt.go — AES-256-GCM 解密实现
//
// 本文件实现 AES-256-GCM 解密功能，是 encrypt.go 的逆操作。
// 接收 base64url 编码的 IV 和密文，验证 GCM 认证标签后返回明文。
//
// 在 Arthas 架构中，解密发生在接收端：
// WebSocket 收到 RelayMessage → 提取 iv + ciphertext → Decrypt → 明文 JSON
//
// 与 Web 客户端 src/crypto/decrypt.ts 的 decryptMessage() 完全兼容：
// 两者使用相同的 base64url 编码规则和 AES-GCM 参数。
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"fmt"
)

// Decrypt 使用 AES-256-GCM 解密密文并验证认证标签。
//
// 参数:
//   - key: 32 字节 AES-256 密钥（房间密钥）
//   - ivB64: base64url 编码的 12 字节 IV（无 padding）
//   - ciphertextB64: base64url 编码的密文（包含 16 字节 GCM 认证标签）
//
// 返回:
//   - plaintext: 解密后的明文字节
//   - error: 解密失败时返回描述性错误（密钥错误或数据被篡改）
//
// 📚 学习要点: GCM 认证标签验证
// AES-GCM 的 Open 方法在解密的同时验证认证标签（authentication tag）。
// 如果密钥错误、IV 被修改、或密文被篡改，Open 会返回错误而非错误的明文。
// 这是 AEAD（Authenticated Encryption with Associated Data）的核心安全属性：
// 攻击者无法在不被检测的情况下修改密文内容。
func Decrypt(key []byte, ivB64 string, ciphertextB64 string) ([]byte, error) {
	// 1. Base64URL 解码 IV
	// 📚 学习要点: RawURLEncoding vs StdEncoding
	// RawURLEncoding 使用 URL 安全字符（- 替代 +，_ 替代 /）且无 padding（=）。
	// 这与 Web 客户端 utils.ts 中的 fromBase64Url() 行为完全一致。
	iv, err := base64.RawURLEncoding.DecodeString(ivB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode IV: %w", err)
	}

	// 2. Base64URL 解码密文（包含 GCM 认证标签）
	ciphertext, err := base64.RawURLEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return nil, fmt.Errorf("failed to decode ciphertext: %w", err)
	}

	// 3. 创建 AES cipher block
	// key 必须为 16/24/32 字节，对应 AES-128/192/256。
	// Arthas 使用 32 字节密钥（AES-256）。
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	// 4. 创建 GCM 模式
	// GCM（Galois/Counter Mode）提供加密 + 认证。
	// 默认 nonce 大小为 12 字节，认证标签为 16 字节。
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	// 5. 解密并验证认证标签
	// 📚 学习要点: gcm.Open 的安全属性
	// Open(dst, nonce, ciphertext, additionalData) 执行以下操作：
	// - 使用 nonce（IV）和密钥解密密文
	// - 验证密文末尾的 16 字节认证标签
	// - 如果标签不匹配，返回 "cipher: message authentication failed" 错误
	// - 不会返回部分解密的明文（全有或全无）
	//
	// 这意味着：
	// - 密钥错误 → 认证失败 → 返回错误（不会返回乱码）
	// - 密文被篡改 → 认证失败 → 返回错误
	// - 中间人攻击 → 认证失败 → 返回错误
	plaintext, err := gcm.Open(nil, iv, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("decryption failed: authentication tag verification failed (wrong key or tampered data): %w", err)
	}

	return plaintext, nil
}
