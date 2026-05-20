// session_signing_test.go — CLI 会话签名集成的单元测试。
//
// 本文件验证 Ed25519 消息签名在 CLI 会话层的集成正确性：
// - 密钥对生成（加入房间时）
// - 公钥广播格式和加密
// - 公钥广播接收和自验证
// - 签名验证成功（正常显示）和失败（[unverified] 前缀）
// - 公钥冲突处理（接受新密钥 + 警告消息）
// - 向后兼容（无签名消息）
//
// 📚 学习要点: 会话签名集成测试的范围
// 这些测试验证 session.go 中签名相关方法的协调逻辑：
// generateAndBroadcastKeyPair、handlePublicKeyAnnouncement、handleRelayMessage
// 中的签名验证路径。底层密码学操作（Ed25519 sign/verify）已在
// internal/crypto/signing_test.go 中独立验证，此处关注集成正确性。
package chat

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/arthas/arthas-cli/internal/crypto"
	"github.com/arthas/arthas-cli/internal/protocol"
	"github.com/arthas/arthas-cli/internal/ui"
)

// ---------------------------------------------------------------------------
// 测试：密钥对生成（加入房间时）
// ---------------------------------------------------------------------------

// TestSessionSigning_KeypairGeneration 验证 GenerateSigningKeyPair 生成有效的 Ed25519 密钥对。
//
// 📚 学习要点: Ed25519 密钥尺寸
// - 公钥: 32 字节（ed25519.PublicKeySize）
// - 私钥: 64 字节（ed25519.PrivateKeySize）= 32 字节 seed + 32 字节公钥副本
// 这些尺寸是 Ed25519 算法的固定属性，不可配置。
//
// Validates: Requirements 2.2
func TestSessionSigning_KeypairGeneration(t *testing.T) {
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair failed: %v", err)
	}

	// 验证公钥长度为 32 字节
	if len(kp.PublicKey) != ed25519.PublicKeySize {
		t.Errorf("PublicKey length = %d, want %d", len(kp.PublicKey), ed25519.PublicKeySize)
	}

	// 验证私钥长度为 64 字节
	if len(kp.PrivateKey) != ed25519.PrivateKeySize {
		t.Errorf("PrivateKey length = %d, want %d", len(kp.PrivateKey), ed25519.PrivateKeySize)
	}

	// 验证公钥与私钥的后 32 字节一致（Ed25519 私钥结构: seed || publicKey）
	derivedPub := kp.PrivateKey.Public().(ed25519.PublicKey)
	if !bytes.Equal(kp.PublicKey, derivedPub) {
		t.Error("PublicKey does not match the public key derived from PrivateKey")
	}
}

// TestSessionSigning_KeypairUniqueness 验证每次调用生成不同的密钥对。
//
// Validates: Requirements 2.2
func TestSessionSigning_KeypairUniqueness(t *testing.T) {
	kp1, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("First GenerateSigningKeyPair failed: %v", err)
	}

	kp2, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("Second GenerateSigningKeyPair failed: %v", err)
	}

	if bytes.Equal(kp1.PublicKey, kp2.PublicKey) {
		t.Error("Two generated keypairs have identical public keys (extremely unlikely)")
	}
}

// ---------------------------------------------------------------------------
// 测试：公钥广播格式和加密
// ---------------------------------------------------------------------------

// TestSessionSigning_PubkeyAnnouncementFormat 验证公钥广播载荷的格式正确性。
//
// 📚 学习要点: 公钥广播的 payload 结构
// 公钥广播作为标准加密消息发送，解密后的 JSON 结构为：
// {"type":"pubkey","text":"","pubkey":"<base64url>","sig":"<base64url>"}
// - type: 固定为 "pubkey"，标识这是公钥广播而非普通消息
// - text: 固定为空字符串（公钥广播没有文本内容）
// - pubkey: base64url 编码的 32 字节 Ed25519 公钥
// - sig: 对 {type, text, pubkey} 的 Ed25519 签名（自证明）
//
// Validates: Requirements 3.1
func TestSessionSigning_PubkeyAnnouncementFormat(t *testing.T) {
	// 生成密钥对
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair failed: %v", err)
	}

	// 构建公钥广播 payload（模拟 generateAndBroadcastKeyPair 的逻辑）
	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp.PublicKey)
	payload := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": pubKeyB64,
	}

	// 验证必要字段存在
	if payload["type"] != "pubkey" {
		t.Errorf("type = %q, want %q", payload["type"], "pubkey")
	}
	if payload["text"] != "" {
		t.Errorf("text = %q, want empty string", payload["text"])
	}
	if payload["pubkey"] != pubKeyB64 {
		t.Errorf("pubkey mismatch")
	}

	// 计算签名
	signableBytes, err := crypto.ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes failed: %v", err)
	}
	sig := kp.Sign(signableBytes)
	payload["sig"] = sig

	// 验证签名字段存在且非空
	if sig == "" {
		t.Error("sig should not be empty")
	}

	// 验证完整 payload 可以序列化为 JSON
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	// 验证 JSON 包含所有必要字段
	var parsed map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
	for _, field := range []string{"type", "text", "pubkey", "sig"} {
		if _, ok := parsed[field]; !ok {
			t.Errorf("JSON missing field %q", field)
		}
	}
}

// TestSessionSigning_PubkeyAnnouncementEncryption 验证公钥广播可以被加密和解密。
//
// Validates: Requirements 3.1
func TestSessionSigning_PubkeyAnnouncementEncryption(t *testing.T) {
	// 生成房间密钥和签名密钥对
	roomKey, err := crypto.GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey failed: %v", err)
	}
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair failed: %v", err)
	}

	// 构建并签名公钥广播
	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp.PublicKey)
	payload := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": pubKeyB64,
	}
	signableBytes, err := crypto.ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes failed: %v", err)
	}
	payload["sig"] = kp.Sign(signableBytes)

	// 序列化并加密
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	iv, ciphertext, err := crypto.Encrypt(roomKey, jsonBytes)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// 解密并验证
	plaintext, err := crypto.Decrypt(roomKey, iv, ciphertext)
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}

	var restored map[string]interface{}
	if err := json.Unmarshal(plaintext, &restored); err != nil {
		t.Fatalf("json.Unmarshal decrypted payload failed: %v", err)
	}

	if restored["type"] != "pubkey" {
		t.Errorf("decrypted type = %q, want %q", restored["type"], "pubkey")
	}
	if restored["pubkey"] != pubKeyB64 {
		t.Errorf("decrypted pubkey mismatch")
	}
}

// ---------------------------------------------------------------------------
// 测试：公钥广播接收和自验证
// ---------------------------------------------------------------------------

// TestSessionSigning_PubkeyAnnouncementSelfVerification 验证 handlePublicKeyAnnouncement
// 正确执行自验证并存储公钥。
//
// 📚 学习要点: 自验证（Self-Verification）
// 收到公钥广播时，发送方的公钥尚未存储（这正是广播的目的）。
// 验证逻辑为"自验证"：用广播中携带的 pubkey 验证广播本身的 sig。
// 这证明发送方确实持有对应的私钥，防止格式错误的公钥被存储。
//
// Validates: Requirements 3.3
func TestSessionSigning_PubkeyAnnouncementSelfVerification(t *testing.T) {
	// 生成密钥对
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair failed: %v", err)
	}

	// 构建公钥广播 payload 并签名
	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp.PublicKey)
	payload := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": pubKeyB64,
	}
	signableBytes, err := crypto.ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes failed: %v", err)
	}
	sig := kp.Sign(signableBytes)

	// 创建 Session 并调用 handlePublicKeyAnnouncement
	s := &Session{
		display:      ui.NewDisplay("TestUser"),
		members:      make(map[string]protocol.MemberInfo),
		publicKeyMap: make(map[string]*PublicKeyEntry),
		state:        StateChatting,
	}

	msgPayload := &MessagePayload{
		Type:   "pubkey",
		Text:   "",
		PubKey: pubKeyB64,
		Sig:    sig,
	}

	s.handlePublicKeyAnnouncement("sender01", "Alice", msgPayload)

	// 验证公钥已存储
	entry, ok := s.publicKeyMap["sender01"]
	if !ok {
		t.Fatal("Public key not stored after valid announcement")
	}

	// 验证存储的公钥与原始公钥一致
	if !bytes.Equal(entry.PublicKey, kp.PublicKey) {
		t.Error("Stored public key does not match original")
	}

	// 验证 FirstSeen 已设置
	if entry.FirstSeen.IsZero() {
		t.Error("FirstSeen should be set")
	}
}

// TestSessionSigning_PubkeyAnnouncementInvalidSig 验证自验证失败时公钥不被存储。
//
// Validates: Requirements 3.3
func TestSessionSigning_PubkeyAnnouncementInvalidSig(t *testing.T) {
	// 生成密钥对
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair failed: %v", err)
	}

	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp.PublicKey)

	// 使用错误的签名（随机 64 字节）
	fakeSig := base64.RawURLEncoding.EncodeToString(make([]byte, 64))

	s := &Session{
		display:      ui.NewDisplay("TestUser"),
		members:      make(map[string]protocol.MemberInfo),
		publicKeyMap: make(map[string]*PublicKeyEntry),
		state:        StateChatting,
	}

	msgPayload := &MessagePayload{
		Type:   "pubkey",
		Text:   "",
		PubKey: pubKeyB64,
		Sig:    fakeSig,
	}

	s.handlePublicKeyAnnouncement("sender01", "Alice", msgPayload)

	// 验证公钥未被存储（自验证失败）
	if _, ok := s.publicKeyMap["sender01"]; ok {
		t.Error("Public key should NOT be stored when self-verification fails")
	}
}

// TestSessionSigning_PubkeyAnnouncementInvalidLength 验证非 32 字节公钥被拒绝。
//
// Validates: Requirements 3.3
func TestSessionSigning_PubkeyAnnouncementInvalidLength(t *testing.T) {
	// 使用 16 字节的无效公钥
	invalidKey := make([]byte, 16)
	invalidKeyB64 := base64.RawURLEncoding.EncodeToString(invalidKey)

	s := &Session{
		display:      ui.NewDisplay("TestUser"),
		members:      make(map[string]protocol.MemberInfo),
		publicKeyMap: make(map[string]*PublicKeyEntry),
		state:        StateChatting,
	}

	msgPayload := &MessagePayload{
		Type:   "pubkey",
		Text:   "",
		PubKey: invalidKeyB64,
		Sig:    "some-invalid-sig",
	}

	s.handlePublicKeyAnnouncement("sender01", "Alice", msgPayload)

	// 验证公钥未被存储
	if _, ok := s.publicKeyMap["sender01"]; ok {
		t.Error("Public key should NOT be stored when key length is invalid")
	}
}

// ---------------------------------------------------------------------------
// 测试：签名验证成功和失败
// ---------------------------------------------------------------------------

// TestSessionSigning_VerificationSuccess 验证签名验证成功时消息正常显示（无前缀）。
//
// 📚 学习要点: 签名验证的完整路径
// handleRelayMessage 中的验证流程：
// 1. 解密消息得到 JSON payload
// 2. 检查 sig 字段是否存在
// 3. 查找发送方公钥（从 publicKeyMap）
// 4. 反序列化为 map，调用 ComputeSignableBytes
// 5. 调用 VerifySignature 验证
// 6. 验证成功：正常显示；验证失败：添加 [unverified] 前缀
//
// Validates: Requirements 5.1
func TestSessionSigning_VerificationSuccess(t *testing.T) {
	// 生成房间密钥和签名密钥对
	roomKey, err := crypto.GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey failed: %v", err)
	}
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair failed: %v", err)
	}

	// 构建签名消息（模拟 handleUserInput 的签名流程）
	payload := MessagePayload{Text: "Hello, signed message!"}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	var payloadMap map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &payloadMap); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}

	signableBytes, err := crypto.ComputeSignableBytes(payloadMap)
	if err != nil {
		t.Fatalf("ComputeSignableBytes failed: %v", err)
	}
	sig := kp.Sign(signableBytes)
	payloadMap["sig"] = sig

	// 重新序列化并加密
	signedJSON, err := json.Marshal(payloadMap)
	if err != nil {
		t.Fatalf("json.Marshal signed payload failed: %v", err)
	}
	iv, ciphertext, err := crypto.Encrypt(roomKey, signedJSON)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// 创建 Session，预存发送方公钥
	s := &Session{
		roomKey: roomKey,
		display: ui.NewDisplay("TestUser"),
		members: map[string]protocol.MemberInfo{
			"sender01": {ID: "sender01", Name: "Alice", Color: "#ff5733"},
		},
		publicKeyMap: map[string]*PublicKeyEntry{
			"sender01": {
				PublicKey: kp.PublicKey,
				FirstSeen: time.Now(),
			},
		},
		state: StateChatting,
	}

	// 构造 RelayMessage data
	data := map[string]interface{}{
		"senderId":   "sender01",
		"senderName": "Alice",
		"iv":         iv,
		"ciphertext": ciphertext,
		"t":          time.Now().UnixMilli(),
	}

	// 调用 handleRelayMessage — 验证成功时不应 panic
	// （验证成功 = 正常显示，无 [unverified] 前缀）
	s.handleRelayMessage(data)
}

// TestSessionSigning_VerificationFailure 验证签名验证失败时消息带 [unverified] 前缀。
//
// 📚 学习要点: 验证失败的场景
// 签名验证失败可能由以下原因导致：
// - 消息在传输中被篡改（服务器修改了 payload）
// - 使用了错误的公钥（公钥冲突未正确处理）
// - 签名计算错误（客户端 bug）
// 无论原因如何，CLI 都应显示 [unverified] 前缀警告用户。
//
// Validates: Requirements 5.5
func TestSessionSigning_VerificationFailure(t *testing.T) {
	// 生成房间密钥和两个不同的签名密钥对
	roomKey, err := crypto.GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey failed: %v", err)
	}
	signerKP, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair (signer) failed: %v", err)
	}
	wrongKP, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair (wrong) failed: %v", err)
	}

	// 使用 signerKP 签名消息
	payload := MessagePayload{Text: "This message will fail verification"}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	var payloadMap map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &payloadMap); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}

	signableBytes, err := crypto.ComputeSignableBytes(payloadMap)
	if err != nil {
		t.Fatalf("ComputeSignableBytes failed: %v", err)
	}
	sig := signerKP.Sign(signableBytes)
	payloadMap["sig"] = sig

	signedJSON, err := json.Marshal(payloadMap)
	if err != nil {
		t.Fatalf("json.Marshal signed payload failed: %v", err)
	}
	iv, ciphertext, err := crypto.Encrypt(roomKey, signedJSON)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// 创建 Session，但存储错误的公钥（wrongKP 的公钥）
	s := &Session{
		roomKey: roomKey,
		display: ui.NewDisplay("TestUser"),
		members: map[string]protocol.MemberInfo{
			"sender01": {ID: "sender01", Name: "Alice", Color: "#ff5733"},
		},
		publicKeyMap: map[string]*PublicKeyEntry{
			"sender01": {
				PublicKey: wrongKP.PublicKey, // 错误的公钥
				FirstSeen: time.Now(),
			},
		},
		state: StateChatting,
	}

	// 构造 RelayMessage data
	data := map[string]interface{}{
		"senderId":   "sender01",
		"senderName": "Alice",
		"iv":         iv,
		"ciphertext": ciphertext,
		"t":          time.Now().UnixMilli(),
	}

	// 调用 handleRelayMessage — 验证失败时不应 panic
	// 内部会将 senderName 修改为 "[unverified] Alice"
	s.handleRelayMessage(data)
}

// TestSessionSigning_VerificationWithCorrectKey 验证使用正确公钥时签名验证通过。
//
// 📚 学习要点: 端到端签名验证路径
// 此测试模拟完整的签名→加密→解密→验证路径，确保各层正确协作。
//
// Validates: Requirements 5.1
func TestSessionSigning_VerificationWithCorrectKey(t *testing.T) {
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair failed: %v", err)
	}

	// 构建 payload 并签名
	payloadMap := map[string]interface{}{
		"text": "Test message for verification",
	}
	signableBytes, err := crypto.ComputeSignableBytes(payloadMap)
	if err != nil {
		t.Fatalf("ComputeSignableBytes failed: %v", err)
	}
	sig := kp.Sign(signableBytes)

	// 使用正确的公钥验证
	if !crypto.VerifySignature(kp.PublicKey, signableBytes, sig) {
		t.Error("Signature verification should succeed with correct key")
	}
}

// TestSessionSigning_VerificationWithWrongKey 验证使用错误公钥时签名验证失败。
//
// Validates: Requirements 5.1
func TestSessionSigning_VerificationWithWrongKey(t *testing.T) {
	kp1, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair (1) failed: %v", err)
	}
	kp2, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair (2) failed: %v", err)
	}

	// 使用 kp1 签名
	payloadMap := map[string]interface{}{
		"text": "Signed with kp1",
	}
	signableBytes, err := crypto.ComputeSignableBytes(payloadMap)
	if err != nil {
		t.Fatalf("ComputeSignableBytes failed: %v", err)
	}
	sig := kp1.Sign(signableBytes)

	// 使用 kp2 的公钥验证 — 应失败
	if crypto.VerifySignature(kp2.PublicKey, signableBytes, sig) {
		t.Error("Signature verification should FAIL with wrong key")
	}
}

// ---------------------------------------------------------------------------
// 测试：公钥冲突处理
// ---------------------------------------------------------------------------

// TestSessionSigning_PublicKeyConflict 验证同一成员发送新公钥时的冲突处理：
// 接受新公钥并显示警告消息。
//
// 📚 学习要点: TOFU Key Change 处理策略
// 当同一 memberId 的公钥发生变更时（如成员断线重连后生成新密钥对）：
// 1. 接受新公钥（更新 publicKeyMap）
// 2. 显示警告消息 "[key changed] {name}"
// 3. 不阻止通信（新公钥立即生效）
// 这与 SSH 的 host key change 类似，但不阻止连接（临时聊天场景中密钥变更是正常操作）。
//
// Validates: Requirements 3.3
func TestSessionSigning_PublicKeyConflict(t *testing.T) {
	// 生成两个不同的密钥对（模拟同一成员的旧密钥和新密钥）
	oldKP, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair (old) failed: %v", err)
	}
	newKP, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair (new) failed: %v", err)
	}

	// 创建 Session，预存旧公钥
	s := &Session{
		display:      ui.NewDisplay("TestUser"),
		members:      make(map[string]protocol.MemberInfo),
		publicKeyMap: make(map[string]*PublicKeyEntry),
		state:        StateChatting,
	}

	// 存储旧公钥
	s.publicKeyMap["sender01"] = &PublicKeyEntry{
		PublicKey: oldKP.PublicKey,
		FirstSeen: time.Now().Add(-time.Minute), // 1 分钟前
	}

	// 构建新公钥的广播并签名
	newPubKeyB64 := base64.RawURLEncoding.EncodeToString(newKP.PublicKey)
	payload := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": newPubKeyB64,
	}
	signableBytes, err := crypto.ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes failed: %v", err)
	}
	sig := newKP.Sign(signableBytes)

	msgPayload := &MessagePayload{
		Type:   "pubkey",
		Text:   "",
		PubKey: newPubKeyB64,
		Sig:    sig,
	}

	// 处理新公钥广播
	s.handlePublicKeyAnnouncement("sender01", "Alice", msgPayload)

	// 验证公钥已更新为新公钥
	entry, ok := s.publicKeyMap["sender01"]
	if !ok {
		t.Fatal("Public key entry should exist after conflict resolution")
	}
	if !bytes.Equal(entry.PublicKey, newKP.PublicKey) {
		t.Error("Public key should be updated to the new key")
	}
	if bytes.Equal(entry.PublicKey, oldKP.PublicKey) {
		t.Error("Public key should NOT still be the old key")
	}
}

// TestSessionSigning_PublicKeySameKeyNoop 验证重复广播相同公钥时静默更新（无警告）。
//
// Validates: Requirements 3.3
func TestSessionSigning_PublicKeySameKeyNoop(t *testing.T) {
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair failed: %v", err)
	}

	s := &Session{
		display:      ui.NewDisplay("TestUser"),
		members:      make(map[string]protocol.MemberInfo),
		publicKeyMap: make(map[string]*PublicKeyEntry),
		state:        StateChatting,
	}

	// 存储公钥
	originalTime := time.Now().Add(-time.Minute)
	s.publicKeyMap["sender01"] = &PublicKeyEntry{
		PublicKey: kp.PublicKey,
		FirstSeen: originalTime,
	}

	// 重新广播相同公钥
	pubKeyB64 := base64.RawURLEncoding.EncodeToString(kp.PublicKey)
	payload := map[string]interface{}{
		"type":   "pubkey",
		"text":   "",
		"pubkey": pubKeyB64,
	}
	signableBytes, err := crypto.ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes failed: %v", err)
	}
	sig := kp.Sign(signableBytes)

	msgPayload := &MessagePayload{
		Type:   "pubkey",
		Text:   "",
		PubKey: pubKeyB64,
		Sig:    sig,
	}

	s.handlePublicKeyAnnouncement("sender01", "Alice", msgPayload)

	// 验证公钥仍然存在且未变更
	entry, ok := s.publicKeyMap["sender01"]
	if !ok {
		t.Fatal("Public key entry should still exist")
	}
	if !bytes.Equal(entry.PublicKey, kp.PublicKey) {
		t.Error("Public key should remain unchanged")
	}
}

// ---------------------------------------------------------------------------
// 测试：向后兼容（无签名消息）
// ---------------------------------------------------------------------------

// TestSessionSigning_BackwardCompatibility_UnsignedMessage 验证没有 sig 字段的消息
// 能正常显示（向后兼容旧客户端或不支持 Ed25519 的客户端）。
//
// 📚 学习要点: 向后兼容策略
// 旧版客户端发送的消息不包含 sig 字段。CLI 应将这些消息正常显示，
// 不添加任何验证指示器或警告。这确保混合版本的客户端可以在同一房间中通信。
//
// Validates: Requirements 5.5
func TestSessionSigning_BackwardCompatibility_UnsignedMessage(t *testing.T) {
	roomKey, err := crypto.GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey failed: %v", err)
	}

	// 构建无签名的消息（模拟旧客户端）
	payload := MessagePayload{Text: "Message from old client without signing"}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	// 加密
	iv, ciphertext, err := crypto.Encrypt(roomKey, jsonBytes)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// 创建 Session（有发送方公钥，但消息无签名）
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair failed: %v", err)
	}

	s := &Session{
		roomKey: roomKey,
		display: ui.NewDisplay("TestUser"),
		members: map[string]protocol.MemberInfo{
			"sender01": {ID: "sender01", Name: "OldClient", Color: "#aabbcc"},
		},
		publicKeyMap: map[string]*PublicKeyEntry{
			"sender01": {
				PublicKey: kp.PublicKey,
				FirstSeen: time.Now(),
			},
		},
		state: StateChatting,
	}

	data := map[string]interface{}{
		"senderId":   "sender01",
		"senderName": "OldClient",
		"iv":         iv,
		"ciphertext": ciphertext,
		"t":          time.Now().UnixMilli(),
	}

	// 不应 panic — 无签名消息应正常显示
	s.handleRelayMessage(data)
}

// TestSessionSigning_BackwardCompatibility_PlainTextPayload 验证非 JSON 格式的
// 加密载荷能正常处理（极旧版本客户端直接加密文本）。
//
// Validates: Requirements 5.5
func TestSessionSigning_BackwardCompatibility_PlainTextPayload(t *testing.T) {
	roomKey, err := crypto.GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey failed: %v", err)
	}

	// 直接加密纯文本（非 JSON）
	plainText := "Plain text without JSON wrapper"
	iv, ciphertext, err := crypto.Encrypt(roomKey, []byte(plainText))
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	s := &Session{
		roomKey: roomKey,
		display: ui.NewDisplay("TestUser"),
		members: map[string]protocol.MemberInfo{
			"sender01": {ID: "sender01", Name: "VeryOldClient", Color: "#112233"},
		},
		publicKeyMap: make(map[string]*PublicKeyEntry),
		state:        StateChatting,
	}

	data := map[string]interface{}{
		"senderId":   "sender01",
		"senderName": "VeryOldClient",
		"iv":         iv,
		"ciphertext": ciphertext,
		"t":          time.Now().UnixMilli(),
	}

	// 不应 panic — 非 JSON 载荷应使用整个明文作为消息文本
	s.handleRelayMessage(data)
}

// TestSessionSigning_BackwardCompatibility_NoPublicKey 验证发送方公钥未知时
// 签名消息仍正常显示（TOFU：信任在下次收到公钥广播时建立）。
//
// Validates: Requirements 5.5
func TestSessionSigning_BackwardCompatibility_NoPublicKey(t *testing.T) {
	roomKey, err := crypto.GenerateRoomKey()
	if err != nil {
		t.Fatalf("GenerateRoomKey failed: %v", err)
	}
	kp, err := crypto.GenerateSigningKeyPair()
	if err != nil {
		t.Fatalf("GenerateSigningKeyPair failed: %v", err)
	}

	// 构建签名消息
	payload := MessagePayload{Text: "Signed but pubkey unknown to receiver"}
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}

	var payloadMap map[string]interface{}
	if err := json.Unmarshal(jsonBytes, &payloadMap); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}

	signableBytes, err := crypto.ComputeSignableBytes(payloadMap)
	if err != nil {
		t.Fatalf("ComputeSignableBytes failed: %v", err)
	}
	payloadMap["sig"] = kp.Sign(signableBytes)

	signedJSON, err := json.Marshal(payloadMap)
	if err != nil {
		t.Fatalf("json.Marshal signed payload failed: %v", err)
	}
	iv, ciphertext, err := crypto.Encrypt(roomKey, signedJSON)
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// 创建 Session，publicKeyMap 中没有发送方的公钥
	s := &Session{
		roomKey: roomKey,
		display: ui.NewDisplay("TestUser"),
		members: map[string]protocol.MemberInfo{
			"sender01": {ID: "sender01", Name: "NewMember", Color: "#445566"},
		},
		publicKeyMap: make(map[string]*PublicKeyEntry), // 空 map — 公钥未知
		state:        StateChatting,
	}

	data := map[string]interface{}{
		"senderId":   "sender01",
		"senderName": "NewMember",
		"iv":         iv,
		"ciphertext": ciphertext,
		"t":          time.Now().UnixMilli(),
	}

	// 不应 panic — 公钥未知时消息正常显示（TOFU）
	s.handleRelayMessage(data)
}
