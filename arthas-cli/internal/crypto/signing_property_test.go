// signing_property_test.go — Ed25519 签名的属性测试
//
// 本文件使用 pgregory.net/rapid 对 Ed25519 签名模块进行属性测试，
// 验证签名系统的两个核心安全属性：
//
// 1. Property 3: 签名往返正确性 — 对任意字节序列，sign→verify 始终成功
// 2. Property 5: 篡改检测 — 修改已签名的数据后，验证必须失败
//
// 这些属性是消息签名系统安全性的基础保证：
// - Property 3 确保合法消息不会被误判为伪造
// - Property 5 确保任何篡改都能被检测到（服务器无法在不被发现的情况下修改消息）
//
// 📚 学习要点: 属性测试在密码学中的价值
// 密码学代码的正确性至关重要——一个微小的实现错误可能导致整个安全模型崩溃。
// 属性测试通过生成大量随机输入（包括边界情况），验证安全不变量在所有情况下成立。
// 这比手写几个固定测试用例提供了更强的信心。
package crypto

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"testing"

	"pgregory.net/rapid"
)

// Feature: security-upgrade, Property 3: Ed25519 keypair validity and sign/verify round-trip
// **Validates: Requirements 2.1, 2.2, 2.4, 2.5, 4.1, 5.1**

// TestProperty_SignVerifyRoundTrip 验证 Ed25519 签名的往返正确性：
// 对于任意生成的密钥对和任意字节序列，使用私钥签名后，
// 使用对应的公钥验证必须始终返回 true。
//
// 同时验证密钥对的基本属性：
// - 私钥长度为 64 字节（seed 32 + public key 32）
// - 公钥长度为 32 字节
//
// 📚 学习要点: Ed25519 的确定性签名
// Ed25519 对相同的 (privateKey, message) 输入始终产生相同的签名。
// 这意味着 sign→verify 的往返正确性是一个确定性属性，
// 不受随机数质量的影响（与 ECDSA 不同）。
func TestProperty_SignVerifyRoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成 Ed25519 密钥对
		kp, err := GenerateSigningKeyPair()
		if err != nil {
			t.Fatalf("GenerateSigningKeyPair() returned unexpected error: %v", err)
		}

		// 断言：密钥长度正确
		if len(kp.PrivateKey) != ed25519.PrivateKeySize {
			t.Fatalf("PrivateKey length = %d, expected %d", len(kp.PrivateKey), ed25519.PrivateKeySize)
		}
		if len(kp.PublicKey) != ed25519.PublicKeySize {
			t.Fatalf("PublicKey length = %d, expected %d", len(kp.PublicKey), ed25519.PublicKeySize)
		}

		// 生成任意长度的随机字节序列作为 signable bytes
		// 长度范围 0-1024，覆盖空消息到较长消息的场景
		dataLen := rapid.IntRange(0, 1024).Draw(t, "dataLen")
		signableBytes := make([]byte, dataLen)
		for i := range signableBytes {
			signableBytes[i] = byte(rapid.IntRange(0, 255).Draw(t, "byte"))
		}

		// 签名
		sigBase64url := kp.Sign(signableBytes)

		// 验证：使用对应公钥验证签名必须成功
		valid := VerifySignature(kp.PublicKey, signableBytes, sigBase64url)
		if !valid {
			t.Fatalf("VerifySignature returned false for valid sign→verify round-trip")
		}
	})
}

// Feature: security-upgrade, Property 5: Tamper detection — modifying any field invalidates signature
// **Validates: Requirements 4.6**

// TestProperty_TamperDetection 验证篡改检测属性：
// 对于任意已签名的字节序列，修改其中任意一个字节后，
// 使用原始签名进行验证必须返回 false。
//
// 这是消息签名系统的核心安全保证：
// 服务器（或任何中间人）无法在不被检测的情况下修改消息的任何部分。
// 即使只修改一个比特，签名验证也会失败。
//
// 📚 学习要点: 签名的不可伪造性
// Ed25519 签名基于椭圆曲线离散对数困难性。
// 没有私钥的攻击者无法为修改后的消息生成有效签名，
// 也无法修改消息使其仍然匹配原始签名。
// 这两个方向的安全性共同保证了消息完整性。
func TestProperty_TamperDetection(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成密钥对
		kp, err := GenerateSigningKeyPair()
		if err != nil {
			t.Fatalf("GenerateSigningKeyPair() returned unexpected error: %v", err)
		}

		// 生成非空的随机字节序列（至少 1 字节，否则无法篡改）
		dataLen := rapid.IntRange(1, 1024).Draw(t, "dataLen")
		signableBytes := make([]byte, dataLen)
		for i := range signableBytes {
			signableBytes[i] = byte(rapid.IntRange(0, 255).Draw(t, "byte"))
		}

		// 签名原始数据
		sigBase64url := kp.Sign(signableBytes)

		// 篡改：在随机位置翻转一个字节（XOR 一个非零值）
		tamperedBytes := make([]byte, len(signableBytes))
		copy(tamperedBytes, signableBytes)

		flipPos := rapid.IntRange(0, len(tamperedBytes)-1).Draw(t, "flipPos")
		// 确保翻转后的值与原始值不同（XOR 一个 1-255 范围的值）
		flipVal := byte(rapid.IntRange(1, 255).Draw(t, "flipVal"))
		tamperedBytes[flipPos] ^= flipVal

		// 验证：使用篡改后的数据和原始签名，验证必须失败
		valid := VerifySignature(kp.PublicKey, tamperedBytes, sigBase64url)
		if valid {
			t.Fatalf("VerifySignature returned true for tampered data (flipped byte at position %d)", flipPos)
		}
	})
}

// TestProperty_WrongKeyVerificationFails 验证使用错误公钥验证签名必须失败：
// 对于任意字节序列，使用一个密钥对签名后，
// 使用另一个不同密钥对的公钥验证必须返回 false。
//
// 这验证了签名的来源认证属性：
// 只有持有对应私钥的发送者才能生成可通过其公钥验证的签名。
// 其他任何人（包括服务器）都无法伪造有效签名。
//
// **Validates: Requirements 4.6**
func TestProperty_WrongKeyVerificationFails(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成两个不同的密钥对
		kp1, err := GenerateSigningKeyPair()
		if err != nil {
			t.Fatalf("GenerateSigningKeyPair() [1] returned unexpected error: %v", err)
		}
		kp2, err := GenerateSigningKeyPair()
		if err != nil {
			t.Fatalf("GenerateSigningKeyPair() [2] returned unexpected error: %v", err)
		}

		// 生成随机字节序列
		dataLen := rapid.IntRange(1, 1024).Draw(t, "dataLen")
		signableBytes := make([]byte, dataLen)
		for i := range signableBytes {
			signableBytes[i] = byte(rapid.IntRange(0, 255).Draw(t, "byte"))
		}

		// 使用第一个密钥对签名
		sigBase64url := kp1.Sign(signableBytes)

		// 使用第二个密钥对的公钥验证 — 必须失败
		valid := VerifySignature(kp2.PublicKey, signableBytes, sigBase64url)
		if valid {
			t.Fatalf("VerifySignature returned true when using wrong public key")
		}
	})
}

// Feature: security-upgrade, Property 8: Public key announcement round-trip with self-verification
// **Validates: Requirements 3.2, 3.3**

// TestProperty8_PublicKeyAnnouncementRoundTrip 验证公钥广播的完整往返流程：
// 对于任意生成的 Ed25519 密钥对，构建 Public_Key_Announcement payload，
// 签名后在接收端使用嵌入的公钥进行自验证，验证必须成功，
// 且解码后的公钥字节必须与原始公钥完全一致。
//
// 这是 TOFU（Trust On First Use）信任模型的基础保证：
// - 自验证证明发送方确实持有对应的私钥（防止格式错误的公钥被存储）
// - 字节一致性确保公钥在编码/解码过程中不会损坏
//
// 📚 学习要点: 公钥广播的自证明机制
// 接收方收到公钥广播时，发送方的公钥尚未存储（这正是广播的目的）。
// 因此验证逻辑为"自验证"：用广播中携带的 pubkey 验证广播本身的 sig。
// 这证明发送方确实持有对应的私钥。如果自验证失败，丢弃该广播。
// 注意：这不能防止 MITM（服务器可替换整个广播），但能防止无效公钥被存储。
func TestProperty8_PublicKeyAnnouncementRoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// Step 1: 生成 Ed25519 密钥对
		kp, err := GenerateSigningKeyPair()
		if err != nil {
			t.Fatalf("GenerateSigningKeyPair() returned unexpected error: %v", err)
		}

		// Step 2: 将公钥编码为 base64url（无 padding）
		encodedPubKey := base64.RawURLEncoding.EncodeToString(kp.PublicKey)

		// Step 3: 构建 Public_Key_Announcement payload
		// 格式与设计文档一致：type="pubkey", text="", pubkey=base64url(key)
		payload := map[string]interface{}{
			"type":   "pubkey",
			"text":   "",
			"pubkey": encodedPubKey,
		}

		// Step 4: 计算 Signable_Bytes（canonical JSON，移除 sig 字段）
		signableBytes, err := ComputeSignableBytes(payload)
		if err != nil {
			t.Fatalf("ComputeSignableBytes() returned unexpected error: %v", err)
		}

		// Step 5: 使用私钥签名
		sig := kp.Sign(signableBytes)

		// Step 6: 接收端自验证 — 从 payload 中解码公钥，验证签名
		// 模拟接收方：从 base64url 解码公钥
		decodedPubKey, err := base64.RawURLEncoding.DecodeString(encodedPubKey)
		if err != nil {
			t.Fatalf("base64.RawURLEncoding.DecodeString() failed: %v", err)
		}

		// 使用解码后的公钥验证签名（自验证）
		valid := VerifySignature(ed25519.PublicKey(decodedPubKey), signableBytes, sig)
		if !valid {
			t.Fatalf("Self-verification of public key announcement failed: signature is invalid")
		}

		// Step 7: 验证解码后的公钥字节与原始公钥完全一致
		if !bytes.Equal(decodedPubKey, kp.PublicKey) {
			t.Fatalf("Decoded public key bytes differ from original:\n  original: %x\n  decoded:  %x",
				kp.PublicKey, decodedPubKey)
		}
	})
}
