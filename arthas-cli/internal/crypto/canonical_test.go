// canonical_test.go 验证 Canonical JSON 序列化的正确性。
//
// 本文件包含两类测试：
//  1. Test Vector 验证 — 使用与 Web 客户端共享的硬编码 hex 值，
//     证明两端实现产生完全相同的字节输出（跨客户端互操作性的黄金标准）。
//  2. 边界情况测试 — 验证空 map、嵌套结构、Unicode 字符串等场景。
//
// 📚 学习要点: 为什么使用 hex 比较而非字符串比较？
// hex 比较直接验证字节级等价性，消除编码差异（如 BOM、换行符）的干扰。
// 这与 Web 端的 Buffer.from(json, 'utf8').toString('hex') 完全对应，
// 是跨客户端签名互操作的最严格验证方式。
//
// **Property 9: Cross-client canonical JSON byte equivalence (via shared vectors)**
// **Validates: Requirements 7.4, 7.5**
package crypto

import (
	"encoding/hex"
	"testing"
)

// ──────────────────────────────────────────────────────────────────────────────
// Test Vector 验证（跨客户端互操作基准）
// ──────────────────────────────────────────────────────────────────────────────

func TestCanonicalJSON_TestVector1_PlainText(t *testing.T) {
	// Test Vector 1 (纯文本):
	//   Input:  {"text": "Hello"}
	//   Signable JSON: {"text":"Hello"}
	//   Signable Bytes (hex): 7b2274657874223a2248656c6c6f227d
	input := map[string]interface{}{
		"text": "Hello",
	}
	expectedHex := "7b2274657874223a2248656c6c6f227d"

	result, err := CanonicalJSON(input)
	if err != nil {
		t.Fatalf("CanonicalJSON() error: %v", err)
	}

	gotHex := hex.EncodeToString(result)
	if gotHex != expectedHex {
		t.Errorf("Test Vector 1 failed:\n  got:  %s\n  want: %s\n  got string:  %s", gotHex, expectedHex, string(result))
	}
}

func TestCanonicalJSON_TestVector2_NestedReply(t *testing.T) {
	// Test Vector 2 (带 reply — 验证嵌套对象递归排序):
	//   Input:  {"reply": {"preview": "Hi", "senderName": "A", "stableId": "x:1"}, "text": "World"}
	//   Signable JSON: {"reply":{"preview":"Hi","senderName":"A","stableId":"x:1"},"text":"World"}
	//   Signable Bytes (hex): 7b227265706c79223a7b2270726576696577223a224869222c2273656e6465724e616d65223a2241222c22737461626c654964223a22783a31227d2c2274657874223a22576f726c64227d
	input := map[string]interface{}{
		"reply": map[string]interface{}{
			"preview":    "Hi",
			"senderName": "A",
			"stableId":   "x:1",
		},
		"text": "World",
	}
	expectedHex := "7b227265706c79223a7b2270726576696577223a224869222c2273656e6465724e616d65223a2241222c22737461626c654964223a22783a31227d2c2274657874223a22576f726c64227d"

	result, err := CanonicalJSON(input)
	if err != nil {
		t.Fatalf("CanonicalJSON() error: %v", err)
	}

	gotHex := hex.EncodeToString(result)
	if gotHex != expectedHex {
		t.Errorf("Test Vector 2 failed:\n  got:  %s\n  want: %s\n  got string:  %s", gotHex, expectedHex, string(result))
	}
}

func TestCanonicalJSON_TestVector3_PubkeyAnnouncement(t *testing.T) {
	// Test Vector 3 (pubkey announcement):
	//   Input:  {"pubkey": "dGVzdC1wdWJsaWMta2V5LWJhc2U2NHVybA", "text": "", "type": "pubkey"}
	//   Signable JSON: {"pubkey":"dGVzdC1wdWJsaWMta2V5LWJhc2U2NHVybA","text":"","type":"pubkey"}
	//   Signable Bytes (hex): 7b227075626b6579223a226447567a6443317764574a7361574d74613256354c574a68633255324e4856796241222c2274657874223a22222c2274797065223a227075626b6579227d
	input := map[string]interface{}{
		"pubkey": "dGVzdC1wdWJsaWMta2V5LWJhc2U2NHVybA",
		"text":   "",
		"type":   "pubkey",
	}
	expectedHex := "7b227075626b6579223a226447567a6443317764574a7361574d74613256354c574a68633255324e4856796241222c2274657874223a22222c2274797065223a227075626b6579227d"

	result, err := CanonicalJSON(input)
	if err != nil {
		t.Fatalf("CanonicalJSON() error: %v", err)
	}

	gotHex := hex.EncodeToString(result)
	if gotHex != expectedHex {
		t.Errorf("Test Vector 3 failed:\n  got:  %s\n  want: %s\n  got string:  %s", gotHex, expectedHex, string(result))
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// 边界情况测试
// ──────────────────────────────────────────────────────────────────────────────

func TestCanonicalJSON_EmptyMap(t *testing.T) {
	// 空 map 应产生 "{}"
	input := map[string]interface{}{}

	result, err := CanonicalJSON(input)
	if err != nil {
		t.Fatalf("CanonicalJSON() error: %v", err)
	}

	expected := "{}"
	if string(result) != expected {
		t.Errorf("Empty map: got %q, want %q", string(result), expected)
	}
}

func TestCanonicalJSON_NestedStructures(t *testing.T) {
	// 嵌套结构：包含数组和多层嵌套对象
	input := map[string]interface{}{
		"data": map[string]interface{}{
			"items": []interface{}{"a", "b", "c"},
			"count": float64(3),
		},
		"action": "list",
	}

	result, err := CanonicalJSON(input)
	if err != nil {
		t.Fatalf("CanonicalJSON() error: %v", err)
	}

	// Keys sorted: "action" < "data"; within "data": "count" < "items"
	// Array elements maintain original order
	expected := `{"action":"list","data":{"count":3,"items":["a","b","c"]}}`
	if string(result) != expected {
		t.Errorf("Nested structures:\n  got:  %s\n  want: %s", string(result), expected)
	}
}

func TestCanonicalJSON_UnicodeStrings(t *testing.T) {
	// Unicode 字符串应保持 UTF-8 原样（不转义为 \uXXXX）
	input := map[string]interface{}{
		"text": "你好世界",
	}

	result, err := CanonicalJSON(input)
	if err != nil {
		t.Fatalf("CanonicalJSON() error: %v", err)
	}

	// strconv.Quote 保持 UTF-8 字符原样，与 JavaScript JSON.stringify 一致
	expected := `{"text":"你好世界"}`
	if string(result) != expected {
		t.Errorf("Unicode strings:\n  got:  %s\n  want: %s", string(result), expected)
	}
}

func TestCanonicalJSON_KeySortingOrder(t *testing.T) {
	// 验证 key 按 Unicode 字母序排列（不是插入顺序）
	input := map[string]interface{}{
		"zebra":  "z",
		"apple":  "a",
		"mango":  "m",
		"banana": "b",
	}

	result, err := CanonicalJSON(input)
	if err != nil {
		t.Fatalf("CanonicalJSON() error: %v", err)
	}

	expected := `{"apple":"a","banana":"b","mango":"m","zebra":"z"}`
	if string(result) != expected {
		t.Errorf("Key sorting:\n  got:  %s\n  want: %s", string(result), expected)
	}
}

func TestCanonicalJSON_NullAndBoolValues(t *testing.T) {
	input := map[string]interface{}{
		"active": true,
		"data":   nil,
		"flag":   false,
	}

	result, err := CanonicalJSON(input)
	if err != nil {
		t.Fatalf("CanonicalJSON() error: %v", err)
	}

	// Keys sorted: "active" < "data" < "flag"
	expected := `{"active":true,"data":null,"flag":false}`
	if string(result) != expected {
		t.Errorf("Null and bool:\n  got:  %s\n  want: %s", string(result), expected)
	}
}

func TestCanonicalJSON_IntegerTypes(t *testing.T) {
	// 验证各种整数类型正确序列化（无小数点）
	input := map[string]interface{}{
		"float_int": float64(42),
		"int":       int(7),
		"int64":     int64(999),
	}

	result, err := CanonicalJSON(input)
	if err != nil {
		t.Fatalf("CanonicalJSON() error: %v", err)
	}

	// Keys sorted: "float_int" < "int" < "int64"
	// All integers output without decimal point
	expected := `{"float_int":42,"int":7,"int64":999}`
	if string(result) != expected {
		t.Errorf("Integer types:\n  got:  %s\n  want: %s", string(result), expected)
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// ComputeSignableBytes 测试
// ──────────────────────────────────────────────────────────────────────────────

func TestComputeSignableBytes_RemovesSigField(t *testing.T) {
	// ComputeSignableBytes 应移除 "sig" 字段后序列化
	payload := map[string]interface{}{
		"text": "Hello",
		"sig":  "some-signature-value",
	}

	result, err := ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() error: %v", err)
	}

	// 移除 sig 后，应与 Test Vector 1 相同
	expectedHex := "7b2274657874223a2248656c6c6f227d"
	gotHex := hex.EncodeToString(result)
	if gotHex != expectedHex {
		t.Errorf("ComputeSignableBytes with sig field:\n  got:  %s\n  want: %s", gotHex, expectedHex)
	}
}

func TestComputeSignableBytes_DoesNotModifyOriginalMap(t *testing.T) {
	// ComputeSignableBytes 不应修改调用方的原始 map
	payload := map[string]interface{}{
		"text": "Hello",
		"sig":  "original-sig",
	}

	_, err := ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() error: %v", err)
	}

	// 原始 map 应保持不变
	if payload["sig"] != "original-sig" {
		t.Errorf("Original map was modified: sig = %v, want 'original-sig'", payload["sig"])
	}
}

func TestComputeSignableBytes_WithoutSigField(t *testing.T) {
	// 没有 sig 字段时，应正常序列化所有字段
	payload := map[string]interface{}{
		"text": "Hello",
	}

	result, err := ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() error: %v", err)
	}

	expectedHex := "7b2274657874223a2248656c6c6f227d"
	gotHex := hex.EncodeToString(result)
	if gotHex != expectedHex {
		t.Errorf("ComputeSignableBytes without sig:\n  got:  %s\n  want: %s", gotHex, expectedHex)
	}
}

func TestComputeSignableBytes_ComplexPayloadWithSig(t *testing.T) {
	// 复杂 payload（含 sig + reply）— sig 被移除，其余按 canonical JSON 序列化
	payload := map[string]interface{}{
		"text": "World",
		"sig":  "base64url-signature-here",
		"reply": map[string]interface{}{
			"preview":    "Hi",
			"senderName": "A",
			"stableId":   "x:1",
		},
	}

	result, err := ComputeSignableBytes(payload)
	if err != nil {
		t.Fatalf("ComputeSignableBytes() error: %v", err)
	}

	// 移除 sig 后，应与 Test Vector 2 相同
	expectedHex := "7b227265706c79223a7b2270726576696577223a224869222c2273656e6465724e616d65223a2241222c22737461626c654964223a22783a31227d2c2274657874223a22576f726c64227d"
	gotHex := hex.EncodeToString(result)
	if gotHex != expectedHex {
		t.Errorf("ComputeSignableBytes complex payload:\n  got:  %s\n  want: %s", gotHex, expectedHex)
	}
}
