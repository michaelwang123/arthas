// signing_test.go — Ed25519 签名模块的单元测试（基于 Appendix A Test Vector）
//
// 本文件使用设计文档 Appendix A 中的固定 Test Vector 验证 Ed25519 签名实现的正确性。
// Test Vector 使用固定 seed 生成，确保跨客户端（Web + CLI）产生完全相同的密码学输出。
//
// 📚 学习要点: 为什么使用固定 Test Vector 而非随机测试？
// 固定 Test Vector 是跨客户端互操作性的"黄金标准"——如果两端对相同输入产生相同输出，
// 则证明两端的密码学实现是兼容的。随机测试（property-based）验证算法正确性，
// 固定向量验证跨平台一致性。两者互补，缺一不可。
//
// 测试覆盖：
// 1. 固定 seed → 固定 public key 派生
// 2. 固定 signable bytes → 固定 signature（Ed25519 确定性签名）
// 3. 正确公钥验证 → true
// 4. 修改 signable bytes 后验证 → false（篡改检测）
// 5. ZeroKeyPair 清零验证
package crypto

import (
	"crypto/ed25519"
	"encoding/hex"
	"testing"
)

// Appendix A Test Vector 常量
// 这些值来自设计文档，由程序化工具生成并验证，作为跨客户端互操作的基准。
const (
	// 32 字节 seed（ASCII: "test-seed-for-arthas-vectors!!!!")
	testVectorSeedHex = "746573742d736565642d666f722d6172746861732d766563746f727321212121"

	// 从 seed 派生的 32 字节 Ed25519 公钥
	testVectorPublicKeyHex = "3f23c13782fe6b1341fcd51844ecbc4de9e3af1cdf3a1f5599e8f1ad38340618"

	// 公钥的 base64url 编码（无 padding）
	testVectorPublicKeyBase64url = "PyPBN4L-axNB_NUYROy8TenjrxzfOh9VmejxrTg0Bhg"

	// Signable Bytes: canonical JSON '{"text":"Hello"}' 的 UTF-8 编码
	testVectorSignableBytesHex = "7b2274657874223a2248656c6c6f227d"

	// 对 signable bytes 的 Ed25519 签名（64 字节）
	testVectorSignatureHex = "072335f25bc666c64dc8ae69e005ab8beac57cbe082a51077d43fdf1f4eb969bfbbc32c05f017fae68a0c9d84404b49c276ba35b872f88ade0e4a64a16c4b308"

	// 签名的 base64url 编码（无 padding）
	testVectorSignatureBase64url = "ByM18lvGZsZNyK5p4AWri-rFfL4IKlEHfUP98fTrlpv7vDLAXwF_rmigydhEBLScJ2ujW4cviK3g5KZKFsSzCA"
)

// TestSigningKeyPair_DerivePublicKeyFromSeed 验证从固定 seed 派生的公钥与 Test Vector 一致。
//
// 这是跨客户端互操作的基础：Web 和 CLI 对相同 seed 必须产生相同公钥。
// Ed25519 公钥派生是确定性的（seed → private key → public key），
// 因此固定 seed 始终产生固定公钥。
func TestSigningKeyPair_DerivePublicKeyFromSeed(t *testing.T) {
	seed, err := hex.DecodeString(testVectorSeedHex)
	if err != nil {
		t.Fatalf("failed to decode seed hex: %v", err)
	}

	// 从 seed 派生私钥和公钥
	privateKey := ed25519.NewKeyFromSeed(seed)
	publicKey := privateKey.Public().(ed25519.PublicKey)

	// 验证公钥与 Test Vector 一致
	expectedPubKey, err := hex.DecodeString(testVectorPublicKeyHex)
	if err != nil {
		t.Fatalf("failed to decode expected public key hex: %v", err)
	}

	if len(publicKey) != 32 {
		t.Errorf("expected public key length 32, got %d", len(publicKey))
	}

	if hex.EncodeToString(publicKey) != testVectorPublicKeyHex {
		t.Errorf("public key mismatch:\n  got:      %s\n  expected: %s",
			hex.EncodeToString(publicKey), testVectorPublicKeyHex)
	}

	if len(expectedPubKey) != len(publicKey) {
		t.Errorf("public key byte length mismatch: got %d, expected %d",
			len(publicKey), len(expectedPubKey))
	}
}

// TestSigningKeyPair_SignProducesExpectedSignature 验证对固定 signable bytes 的签名与 Test Vector 一致。
//
// 📚 学习要点: Ed25519 确定性签名
// Ed25519 对相同的 (privateKey, message) 输入始终产生相同的签名输出。
// 这使得我们可以用固定 Test Vector 验证实现正确性——如果签名不匹配，
// 说明实现有 bug（而非随机性导致的差异）。
func TestSigningKeyPair_SignProducesExpectedSignature(t *testing.T) {
	seed, err := hex.DecodeString(testVectorSeedHex)
	if err != nil {
		t.Fatalf("failed to decode seed hex: %v", err)
	}

	signableBytes, err := hex.DecodeString(testVectorSignableBytesHex)
	if err != nil {
		t.Fatalf("failed to decode signable bytes hex: %v", err)
	}

	// 构造 SigningKeyPair（使用固定 seed）
	privateKey := ed25519.NewKeyFromSeed(seed)
	publicKey := privateKey.Public().(ed25519.PublicKey)
	kp := &SigningKeyPair{
		PrivateKey: privateKey,
		PublicKey:  publicKey,
	}

	// 调用 Sign 方法，验证返回的 base64url 签名与 Test Vector 一致
	sigBase64url := kp.Sign(signableBytes)

	if sigBase64url != testVectorSignatureBase64url {
		t.Errorf("signature mismatch:\n  got:      %s\n  expected: %s",
			sigBase64url, testVectorSignatureBase64url)
	}
}

// TestVerifySignature_CorrectKeyReturnsTrue 验证使用正确公钥和签名时验证通过。
//
// 这是签名系统的核心正确性测试：合法签名 + 正确公钥 → 验证成功。
func TestVerifySignature_CorrectKeyReturnsTrue(t *testing.T) {
	publicKey, err := hex.DecodeString(testVectorPublicKeyHex)
	if err != nil {
		t.Fatalf("failed to decode public key hex: %v", err)
	}

	signableBytes, err := hex.DecodeString(testVectorSignableBytesHex)
	if err != nil {
		t.Fatalf("failed to decode signable bytes hex: %v", err)
	}

	// 使用 Test Vector 中的 base64url 签名进行验证
	result := VerifySignature(ed25519.PublicKey(publicKey), signableBytes, testVectorSignatureBase64url)
	if !result {
		t.Error("VerifySignature returned false for valid Test Vector signature; expected true")
	}
}

// TestVerifySignature_ModifiedBytesReturnsFalse 验证修改 signable bytes 后签名验证失败。
//
// 这是篡改检测的核心测试：即使修改消息中的一个字节，签名验证也必须失败。
// 这确保服务器无法在不被检测的情况下修改消息内容。
func TestVerifySignature_ModifiedBytesReturnsFalse(t *testing.T) {
	publicKey, err := hex.DecodeString(testVectorPublicKeyHex)
	if err != nil {
		t.Fatalf("failed to decode public key hex: %v", err)
	}

	signableBytes, err := hex.DecodeString(testVectorSignableBytesHex)
	if err != nil {
		t.Fatalf("failed to decode signable bytes hex: %v", err)
	}

	// 修改 signable bytes 的第一个字节（翻转最低位）
	modifiedBytes := make([]byte, len(signableBytes))
	copy(modifiedBytes, signableBytes)
	modifiedBytes[0] ^= 0x01

	// 使用原始签名验证修改后的字节 → 必须返回 false
	result := VerifySignature(ed25519.PublicKey(publicKey), modifiedBytes, testVectorSignatureBase64url)
	if result {
		t.Error("VerifySignature returned true for modified signable bytes; expected false (tamper detection)")
	}
}

// TestZeroKeyPair_AllBytesZeroed 验证 ZeroKeyPair 将所有密钥字节清零。
//
// 📚 学习要点: 内存清零的安全意义
// 密钥在使用完毕后应尽快从内存中清除，减少密钥暴露的时间窗口。
// 虽然 Go 的 GC 使得完全清零是 best-effort（旧副本可能残留），
// 但显式清零仍然是密码学最佳实践（defense in depth）。
func TestZeroKeyPair_AllBytesZeroed(t *testing.T) {
	seed, err := hex.DecodeString(testVectorSeedHex)
	if err != nil {
		t.Fatalf("failed to decode seed hex: %v", err)
	}

	// 构造 SigningKeyPair
	privateKey := ed25519.NewKeyFromSeed(seed)
	publicKey := privateKey.Public().(ed25519.PublicKey)
	kp := &SigningKeyPair{
		PrivateKey: privateKey,
		PublicKey:  publicKey,
	}

	// 确认清零前密钥非零
	hasNonZero := false
	for _, b := range kp.PrivateKey {
		if b != 0 {
			hasNonZero = true
			break
		}
	}
	if !hasNonZero {
		t.Fatal("private key is all zeros before ZeroKeyPair — test setup error")
	}

	// 执行清零
	kp.ZeroKeyPair()

	// 验证私钥所有字节为零
	for i, b := range kp.PrivateKey {
		if b != 0 {
			t.Errorf("PrivateKey[%d] = 0x%02x after ZeroKeyPair; expected 0x00", i, b)
		}
	}

	// 验证公钥所有字节为零
	for i, b := range kp.PublicKey {
		if b != 0 {
			t.Errorf("PublicKey[%d] = 0x%02x after ZeroKeyPair; expected 0x00", i, b)
		}
	}
}

// TestVerifySignature_InvalidBase64ReturnsFalse 验证无效 base64url 签名时返回 false。
//
// 安全默认行为：任何格式错误的签名都视为验证失败，不 panic。
func TestVerifySignature_InvalidBase64ReturnsFalse(t *testing.T) {
	publicKey, err := hex.DecodeString(testVectorPublicKeyHex)
	if err != nil {
		t.Fatalf("failed to decode public key hex: %v", err)
	}

	signableBytes, err := hex.DecodeString(testVectorSignableBytesHex)
	if err != nil {
		t.Fatalf("failed to decode signable bytes hex: %v", err)
	}

	// 无效 base64url 字符串
	result := VerifySignature(ed25519.PublicKey(publicKey), signableBytes, "not-valid-base64!!!")
	if result {
		t.Error("VerifySignature returned true for invalid base64url signature; expected false")
	}
}

// TestVerifySignature_WrongLengthSignatureReturnsFalse 验证长度不正确的签名返回 false。
//
// Ed25519 签名固定为 64 字节，任何其他长度都应被拒绝。
func TestVerifySignature_WrongLengthSignatureReturnsFalse(t *testing.T) {
	publicKey, err := hex.DecodeString(testVectorPublicKeyHex)
	if err != nil {
		t.Fatalf("failed to decode public key hex: %v", err)
	}

	signableBytes, err := hex.DecodeString(testVectorSignableBytesHex)
	if err != nil {
		t.Fatalf("failed to decode signable bytes hex: %v", err)
	}

	// 使用一个太短的签名（32 字节而非 64 字节）
	shortSig := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" // 32 bytes in base64url
	result := VerifySignature(ed25519.PublicKey(publicKey), signableBytes, shortSig)
	if result {
		t.Error("VerifySignature returned true for 32-byte signature; expected false (must be 64 bytes)")
	}
}
