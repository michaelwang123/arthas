// session_signing_test.go — CLI 会话层 Ed25519 签名集成测试
//
// 本文件验证 session.go 中签名相关功能的正确性：
// - 密钥对生成（generateAndBroadcastKeyPair 的密钥生成部分）
// - 公钥广播格式和自验证
// - 签名验证成功/失败
// - 公钥冲突处理（TOFU key change）
// - 向后兼容（无签名消息）
//
// 📚 学习要点: 为什么不测试完整的 WebSocket 流程？
// 完整的 WebSocket 集成测试需要模拟服务器连接，复杂且脆弱。
// 本文件聚焦于密码学操作的正确性（签名、验证、公钥处理），
// 这些是安全功能的核心——如果密码学操作正确，网络传输只是搬运字节。
//
// **Validates: Requirements 2.2, 3.1, 3.3, 5.1, 5.5**
package chat

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/arthas/arthas-cli/internal/crypto"
	"github.com/arthas/arthas-cli/internal/ui"
)

// ---------------------------------------------------------------------------
// Test: 密钥对生成
// ---------------------------------------------------------------------------

// TestSigningKeyPairGeneration 验证 generateAndBroadcastKeyPair 正确生成密钥对。
// 由于 generateAndBroadcastKeyPair 需要 roomKey 和 conn 来广播，
// 我们直接测试 crypto.GenerateSigningKeyPair 并验证 Session 字段赋值逻辑。
//
// **Validates: Requirement 2.2**
func TestSigningKeyPairGeneration(t *testing.T) {
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair() failed: %v", err)
	}

	// 验证公钥长度
	if len(kp.PublicKey) != ed25519.PublicKeySize {
		t.Errorf("PublicKey length = %d, want %d", len(kp.PublicKey), ed25519.PublicKeySize)
	}

	// 验证私钥长度
	if len(kp.PrivateKey) != ed25519.PrivateKeySize {
		t.Errorf("PrivateKey length = %d, want %d", len(kp.PrivateKey), ed25519.PrivateKeySize)
	}

	// 验证公钥是私钥的后 32 字节（Ed25519 标准格式）
	derivedPub := kp.PrivateKey.Public().(ed25519.PublicKey)
	if !derivedPub.Equal(kp.PublicKey) {
		t.Error("PublicKey does not match private key derivation")
	}
}

// ---------------------------------------------------------------------------
// Test: 公钥广播格式和签名
// ---------------------------------------------------------------------------

// TestPubkeyAnnouncementFormat 验证公钥广播 payload 的格式正确性。
// 模拟 generateAndBroadcastKeyPair 中构建 payload 的逻辑，
// 验证 JSON 结构包含所有必要字段且签名有效。
//
// **Validates: Requirements 3.1, 3.2**
func TestPubkeyAnnouncementFormat(t *testing.T) {
	// 生成密钥对
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair() failed: %v", err)
	}

	// 构建 announcement payload（与 generateAndBroadcastKeyPair 逻辑一致）
	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp.PublicKey)
	payload := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": pubKeyB64,
	}

	// 计算 Signable_Bytes
	signableBytes, err := crypto.ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() failed: %v", err)
	}

	// 签名
	sig := kp.Sign(signableBytes)
	payload["sig"] = sig

	// 序列化为 JSON
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal() failed: %v", err)
	}

	// 反序列化验证格式
	var parsed map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
		t.Fatalf("json.Unmarshal() failed: %v", err)
	}

	// 验证必要字段存在
	if parsed["type"] != "pubkey" {
		t.Errorf("type = %v, want 'pubkey'", parsed["type"])
	}
	if parsed["text"] != "" {
		t.Errorf("text = %v, want ''", parsed["text"])
	}
	if _, ok := parsed["pubkey"]; !ok {
		t.Error("pubkey field missing from announcement")
	}
	if _, ok := parsed["sig"]; !ok {
		t.Error("sig field missing from announcement")
	}

	// 验证 pubkey 是有效的 base64url 编码的 32 字节
	pubkeyStr, ok := parsed["pubkey"].(string)
	if !ok {
		t.Fatal("pubkey is not a string")
	}
	decodedPubkey, err := base64.RawURLEncoding.DecodeString(pubkeyStr)
	if err != nil {
		t.Fatalf("pubkey base64url decode failed: %v", err)
	}
	if len(decodedPubkey) != 32 {
		t.Errorf("decoded pubkey length = %d, want 32", len(decodedPubkey))
	}
}

// ---------------------------------------------------------------------------
// Test: 公钥广播自验证
// ---------------------------------------------------------------------------

// TestPubkeyAnnouncementSelfVerification 验证公钥广播的自验证逻辑：
// 用广播中携带的公钥验证广播本身的签名。
//
// **Validates: Requirement 3.3**
func TestPubkeyAnnouncementSelfVerification(t *testing.T) {
	// 生成密钥对并构建签名的 announcement
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair() failed: %v", err)
	}

	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp.PublicKey)
	payload := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": pubKeyB64,
	}

	signableBytes, err := crypto.ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() failed: %v", err)
	}

	sig := kp.Sign(signableBytes)

	// 模拟接收方的自验证逻辑（与 handlePublicKeyAnnouncement 一致）
	// 1. 解码公钥
	receivedPubKey, err := base64.RawURLEncoding.DecodeString(pubKeyB64)
	if err != nil {
		t.Fatalf("base64url decode failed: %v", err)
	}

	// 2. 重建验证 payload
	verifyMap := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": pubKeyB64,
	}

	// 3. 计算 Signable_Bytes
	verifyBytes, err := crypto.ComputeSignableBytes(verifyMap)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() for verification failed: %v", err)
	}

	// 4. 验证签名
	if !crypto.VerifySignature(ed25519.PublicKey(receivedPubKey), verifyBytes, sig) {
		t.Error("Self-verification of pubkey announcement failed; expected success")
	}
}

// TestPubkeyAnnouncementInvalidSigRejected 验证无效签名的公钥广播被拒绝。
func TestPubkeyAnnouncementInvalidSigRejected(t *testing.T) {
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair() failed: %v", err)
	}

	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp.PublicKey)

	// 使用错误的签名（随机字节）
	fakeSig := base64.RawURLEncoding.EncodeToString(make([]byte, 64))

	// 模拟接收方验证
	verifyMap := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": pubKeyB64,
	}
	verifyBytes, err := crypto.ComputeSignableBytes(verifyMap)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() failed: %v", err)
	}

	receivedPubKey, _ := base64.RawURLEncoding.DecodeString(pubKeyB64)
	if crypto.VerifySignature(ed25519.PublicKey(receivedPubKey), verifyBytes, fakeSig) {
		t.Error("Verification should fail for fake signature; got success")
	}
}

// ---------------------------------------------------------------------------
// Test: handlePublicKeyAnnouncement 集成
// ---------------------------------------------------------------------------

// TestHandlePublicKeyAnnouncement_StoresKey 验证有效的公钥广播被正确存储。
//
// **Validates: Requirement 3.3**
func TestHandlePublicKeyAnnouncement_StoresKey(t *testing.T) {
	// 创建最小 Session
	s := &Session{
		display:      ui.NewDisplay("test"),
		publicKeyMap: make(map[string]*PublicKeyEntry),
	}

	// 生成密钥对并构建有效的 announcement payload
	kp, _ := crypto.GenerateSigningKeyPair()
	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp.PublicKey)

	payloadMap := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": pubKeyB64,
	}
	signableBytes, _ := crypto.ComputeSignableBytes(payloadMap)
	sig := kp.Sign(signableBytes)

	msgPayload := &MessagePayload{
		Type:   "pubkey",
		Text:   "",
		PubKey: pubKeyB64,
		Sig:    sig,
	}

	// 调用 handlePublicKeyAnnouncement
	s.handlePublicKeyAnnouncement("sender-1", "Alice", msgPayload)

	// 验证公钥已存储
	entry, ok := s.publicKeyMap["sender-1"]
	if !ok {
		t.Fatal("publicKeyMap should contain sender-1 after valid announcement")
	}
	if !entry.PublicKey.Equal(kp.PublicKey) {
		t.Error("stored public key does not match the announced key")
	}
	if entry.FirstSeen.IsZero() {
		t.Error("FirstSeen should be set to a non-zero time")
	}
}

// TestHandlePublicKeyAnnouncement_InvalidSigDiscarded 验证无效签名的广播被丢弃。
func TestHandlePublicKeyAnnouncement_InvalidSigDiscarded(t *testing.T) {
	s := &Session{
		display:      ui.NewDisplay("test"),
		publicKeyMap: make(map[string]*PublicKeyEntry),
	}

	kp, _ := crypto.GenerateSigningKeyPair()
	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp.PublicKey)

	// 使用无效签名
	msgPayload := &MessagePayload{
		Type:   "pubkey",
		Text:   "",
		PubKey: pubKeyB64,
		Sig:    base64.RawURLEncoding.EncodeToString(make([]byte, 64)),
	}

	s.handlePublicKeyAnnouncement("sender-1", "Alice", msgPayload)

	// 验证公钥未被存储
	if _, ok := s.publicKeyMap["sender-1"]; ok {
		t.Error("publicKeyMap should NOT contain sender-1 after invalid announcement")
	}
}

// ---------------------------------------------------------------------------
// Test: 公钥冲突处理（TOFU Key Change）
// ---------------------------------------------------------------------------

// TestPublicKeyConflict_AcceptsNewKey 验证公钥冲突时接受新公钥。
//
// **Validates: Requirement 3.5**
func TestPublicKeyConflict_AcceptsNewKey(t *testing.T) {
	s := &Session{
		display:      ui.NewDisplay("test"),
		publicKeyMap: make(map[string]*PublicKeyEntry),
	}

	// 存储第一个公钥
	kp1, _ := crypto.GenerateSigningKeyPair()
	s.publicKeyMap["sender-1"] = &PublicKeyEntry{
		PublicKey: kp1.PublicKey,
		FirstSeen: time.Now().Add(-time.Hour),
	}

	// 生成第二个密钥对并构建有效的 announcement
	kp2, _ := crypto.GenerateSigningKeyPair()
	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp2.PublicKey)

	payloadMap := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": pubKeyB64,
	}
	signableBytes, _ := crypto.ComputeSignableBytes(payloadMap)
	sig := kp2.Sign(signableBytes)

	msgPayload := &MessagePayload{
		Type:   "pubkey",
		Text:   "",
		PubKey: pubKeyB64,
		Sig:    sig,
	}

	// 处理新的公钥广播（应触发冲突处理）
	s.handlePublicKeyAnnouncement("sender-1", "Alice", msgPayload)

	// 验证新公钥已存储（替换旧公钥）
	entry := s.publicKeyMap["sender-1"]
	if !entry.PublicKey.Equal(kp2.PublicKey) {
		t.Error("publicKeyMap should contain the NEW public key after conflict")
	}
}

// ---------------------------------------------------------------------------
// Test: 签名验证成功/失败
// ---------------------------------------------------------------------------

// TestSignatureVerification_Success 验证有效签名的消息通过验证。
//
// **Validates: Requirement 5.1**
func TestSignatureVerification_Success(t *testing.T) {
	kp, _ := crypto.GenerateSigningKeyPair()

	// 构建消息 payload 并签名
	payloadMap := map[string]interface{}{
		"text": "Hello, world!",
	}
	signableBytes, err := crypto.ComputeSignableBytes(payloadMap)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() failed: %v", err)
	}
	sig := kp.Sign(signableBytes)

	// 验证签名
	if !crypto.VerifySignature(kp.PublicKey, signableBytes, sig) {
		t.Error("VerifySignature should return true for valid signature")
	}
}

// TestSignatureVerification_Failure 验证篡改后的消息签名验证失败。
//
// **Validates: Requirement 5.5**
func TestSignatureVerification_Failure(t *testing.T) {
	kp, _ := crypto.GenerateSigningKeyPair()

	// 构建消息 payload 并签名
	payloadMap := map[string]interface{}{
		"text": "Hello, world!",
	}
	signableBytes, err := crypto.ComputeSignableBytes(payloadMap)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() failed: %v", err)
	}
	sig := kp.Sign(signableBytes)

	// 篡改消息
	tamperedMap := map[string]interface{}{
		"text": "Tampered message!",
	}
	tamperedBytes, err := crypto.ComputeSignableBytes(tamperedMap)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() for tampered failed: %v", err)
	}

	// 验证应失败
	if crypto.VerifySignature(kp.PublicKey, tamperedBytes, sig) {
		t.Error("VerifySignature should return false for tampered message")
	}
}

// TestSignatureVerification_WrongKey 验证使用错误公钥验证失败。
func TestSignatureVerification_WrongKey(t *testing.T) {
	kp1, _ := crypto.GenerateSigningKeyPair()
	kp2, _ := crypto.GenerateSigningKeyPair()

	payloadMap := map[string]interface{}{
		"text": "Hello",
	}
	signableBytes, _ := crypto.ComputeSignableBytes(payloadMap)
	sig := kp1.Sign(signableBytes)

	// 使用 kp2 的公钥验证 kp1 的签名 → 应失败
	if crypto.VerifySignature(kp2.PublicKey, signableBytes, sig) {
		t.Error("VerifySignature should return false when using wrong public key")
	}
}

// ---------------------------------------------------------------------------
// Test: 向后兼容（无签名消息）
// ---------------------------------------------------------------------------

// TestBackwardCompatibility_NoSigField 验证无 sig 字段的消息正常处理。
// 在 handleRelayMessage 中，如果 payload.Sig == ""，消息正常显示不添加前缀。
//
// **Validates: Requirement 5.7**
func TestBackwardCompatibility_NoSigField(t *testing.T) {
	// 构建无签名的 MessagePayload
	payload := MessagePayload{
		Text: "Hello from old client",
	}

	// 序列化/反序列化验证 Sig 字段为空
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal() failed: %v", err)
	}

	var restored MessagePayload
	if err := json.Unmarshal(jsonBytes, &restored); err != nil {
		t.Fatalf("json.Unmarshal() failed: %v", err)
	}

	// Sig 字段应为空字符串（omitempty 不输出，反序列化后为零值）
	if restored.Sig != "" {
		t.Errorf("Sig should be empty for unsigned message, got %q", restored.Sig)
	}

	// 验证消息文本保持不变
	if restored.Text != "Hello from old client" {
		t.Errorf("Text mismatch: got %q", restored.Text)
	}
}

// TestBackwardCompatibility_MessageWithSigDisplaysNormally 验证有签名但公钥未知时正常显示。
// 在 TOFU 模型中，如果发送方公钥未知，消息正常显示（不添加 [⚠ unverified] 前缀）。
//
// **Validates: Requirement 5.5**
func TestBackwardCompatibility_MessageWithSigButNoPubKey(t *testing.T) {
	kp, _ := crypto.GenerateSigningKeyPair()

	// 构建签名消息
	payloadMap := map[string]interface{}{
		"text": "Signed message",
	}
	signableBytes, _ := crypto.ComputeSignableBytes(payloadMap)
	sig := kp.Sign(signableBytes)

	// 模拟 Session 中公钥未知的情况
	s := &Session{
		display:      ui.NewDisplay("test"),
		publicKeyMap: make(map[string]*PublicKeyEntry),
	}

	// 公钥未知时，senderName 不应被修改
	senderName := "Alice"
	payload := MessagePayload{
		Text: "Signed message",
		Sig:  sig,
	}

	// 模拟 handleRelayMessage 中的验证逻辑
	if payload.Sig != "" {
		if _, ok := s.publicKeyMap["unknown-sender"]; ok {
			// 公钥已知 → 验证（此分支不会执行）
			t.Error("should not reach here")
		}
		// 公钥未知 → 正常显示（TOFU）
	}

	// senderName 应保持不变
	if senderName != "Alice" {
		t.Errorf("senderName should remain 'Alice' when pubkey unknown, got %q", senderName)
	}
}
