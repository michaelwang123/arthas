// crossclient_test.go — 跨客户端签名互操作性集成测试
//
// 本文件验证 Go CLI 客户端的 Ed25519 签名实现与 Web 客户端产生完全相同的密码学输出。
// 使用 Appendix A 固定 Test Vector：相同 seed → 相同公钥 → 相同签名。
//
// 📚 学习要点: 跨客户端互操作性验证策略
// 在多客户端系统中，仅验证单端正确性不够——必须确保两端对相同输入产生相同输出。
// 策略：在两端测试中硬编码相同的 Test Vector（seed、公钥、签名），
// 如果两端都通过，则证明互操作性成立（传递性证明）。
// 这比运行时跨进程通信测试更简单、更可靠、更易于 CI 集成。
//
// 架构角色：
// - 本文件是 CLI 端的互操作性证明
// - 对应的 Web 端测试：src/crypto/signing.crossclient.test.ts
// - 两个文件使用完全相同的 Test Vector，独立验证各自实现
//
// Validates: Requirement 7.6 (cross-client integration test)
// Requirements: 7.1, 7.2, 7.6
package crypto

import (
	"crypto/ed25519"
	"encoding/hex"
	"testing"
)

// TestCrossClient_SeedDerivesExpectedPublicKey 验证从 Appendix A 固定 seed 派生的公钥
// 与 Web 客户端产生的公钥完全一致。
//
// 这是跨客户端互操作的第一步：如果两端从相同 seed 派生出不同公钥，
// 则后续的签名验证必然失败。Ed25519 公钥派生是确定性的，
// 因此这个测试验证两端使用了兼容的 Ed25519 实现。
func TestCrossClient_SeedDerivesExpectedPublicKey(t *testing.T) {
	// Appendix A 固定 seed（32 字节，ASCII: "test-seed-for-arthas-vectors!!!!"）
	seed, err := hex.DecodeString(testVectorSeedHex)
	if err != nil {
		t.Fatalf("failed to decode seed hex: %v", err)
	}

	// 从 seed 派生密钥对
	privateKey := ed25519.NewKeyFromSeed(seed)
	publicKey := privateKey.Public().(ed25519.PublicKey)

	// 验证公钥与 Appendix A 期望值一致
	// Web 客户端使用 PKCS8 导入相同 seed 后，导出的公钥必须与此相同
	gotHex := hex.EncodeToString(publicKey)
	if gotHex != testVectorPublicKeyHex {
		t.Errorf("cross-client public key mismatch:\n  Go derived:   %s\n  expected (shared): %s",
			gotHex, testVectorPublicKeyHex)
	}
}

// TestCrossClient_SignProducesIdenticalSignature 验证 Go 端对 Test Vector 1 payload ("Hello")
// 的签名与 Web 端产生的签名完全一致（字节级相同）。
//
// 📚 学习要点: 确定性签名是跨客户端互操作的基础
// Ed25519 签名是确定性的：sign(privateKey, message) 始终返回相同结果。
// 这意味着两端对相同 (seed, message) 必须产生相同签名——
// 如果不同，说明某端的实现有 bug（而非随机性差异）。
//
// 验证步骤：
// 1. 从固定 seed 生成密钥对
// 2. 对 Test Vector 1 的 signable bytes 签名
// 3. 比较签名 hex 与 Appendix A 期望值
// 4. 使用 VerifySignature 函数验证签名有效性
func TestCrossClient_SignProducesIdenticalSignature(t *testing.T) {
	// 从 Appendix A seed 构造密钥对
	seed, err := hex.DecodeString(testVectorSeedHex)
	if err != nil {
		t.Fatalf("failed to decode seed hex: %v", err)
	}

	privateKey := ed25519.NewKeyFromSeed(seed)
	publicKey := privateKey.Public().(ed25519.PublicKey)
	kp := &SigningKeyPair{
		PrivateKey: privateKey,
		PublicKey:  publicKey,
	}

	// Test Vector 1: signable bytes = UTF-8 of '{"text":"Hello"}'
	signableBytes, err := hex.DecodeString(testVectorSignableBytesHex)
	if err != nil {
		t.Fatalf("failed to decode signable bytes hex: %v", err)
	}

	// 使用项目的 Sign 方法生成签名
	sigBase64url := kp.Sign(signableBytes)

	// 验证 base64url 签名与 Appendix A 期望值一致
	// Web 客户端的 signPayload() 对相同输入必须产生此相同值
	if sigBase64url != testVectorSignatureBase64url {
		t.Errorf("cross-client signature mismatch (base64url):\n  Go produced:      %s\n  expected (shared): %s",
			sigBase64url, testVectorSignatureBase64url)
	}

	// 额外验证：将签名解码为 hex 并与期望的 hex 比较（双重确认）
	sigBytes, err := hex.DecodeString(testVectorSignatureHex)
	if err != nil {
		t.Fatalf("failed to decode expected signature hex: %v", err)
	}

	// 直接用 ed25519.Sign 生成原始签名字节并比较
	rawSig := ed25519.Sign(privateKey, signableBytes)
	gotSigHex := hex.EncodeToString(rawSig)
	expectedSigHex := hex.EncodeToString(sigBytes)
	if gotSigHex != expectedSigHex {
		t.Errorf("cross-client signature mismatch (hex):\n  Go produced:      %s\n  expected (shared): %s",
			gotSigHex, expectedSigHex)
	}
}

// TestCrossClient_VerifySignatureWithSharedVector 验证使用项目的 VerifySignature 函数
// 能正确验证 Appendix A 中的签名。
//
// 这模拟了跨客户端验证场景：
// - Web 客户端使用相同 seed 签名消息，产生相同签名
// - CLI 客户端收到消息后，使用 VerifySignature 验证
// - 如果验证通过，证明两端的签名/验证实现互操作
func TestCrossClient_VerifySignatureWithSharedVector(t *testing.T) {
	// 使用 Appendix A 的公钥和签名
	publicKey, err := hex.DecodeString(testVectorPublicKeyHex)
	if err != nil {
		t.Fatalf("failed to decode public key hex: %v", err)
	}

	signableBytes, err := hex.DecodeString(testVectorSignableBytesHex)
	if err != nil {
		t.Fatalf("failed to decode signable bytes hex: %v", err)
	}

	// 使用项目的 VerifySignature 函数验证 Appendix A 签名
	// 这证明 CLI 端能验证 Web 端（或任何使用相同 seed 的客户端）产生的签名
	result := VerifySignature(ed25519.PublicKey(publicKey), signableBytes, testVectorSignatureBase64url)
	if !result {
		t.Error("cross-client verification failed: VerifySignature returned false for Appendix A Test Vector")
	}
}

// TestCrossClient_TamperedPayloadFailsVerification 验证修改 payload 后签名验证失败。
//
// 跨客户端安全保证：即使攻击者（如恶意服务器）修改了消息内容，
// 接收端（无论是 Web 还是 CLI）都能检测到篡改。
func TestCrossClient_TamperedPayloadFailsVerification(t *testing.T) {
	publicKey, err := hex.DecodeString(testVectorPublicKeyHex)
	if err != nil {
		t.Fatalf("failed to decode public key hex: %v", err)
	}

	signableBytes, err := hex.DecodeString(testVectorSignableBytesHex)
	if err != nil {
		t.Fatalf("failed to decode signable bytes hex: %v", err)
	}

	// 模拟篡改：修改 signable bytes 的最后一个字节
	tampered := make([]byte, len(signableBytes))
	copy(tampered, signableBytes)
	tampered[len(tampered)-1] ^= 0x42

	// 使用原始签名验证篡改后的 payload → 必须失败
	result := VerifySignature(ed25519.PublicKey(publicKey), tampered, testVectorSignatureBase64url)
	if result {
		t.Error("cross-client tamper detection failed: VerifySignature returned true for modified payload")
	}
}
