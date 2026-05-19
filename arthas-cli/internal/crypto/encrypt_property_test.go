// encrypt_property_test.go — AES-256-GCM 加密/解密往返属性测试
//
// 本文件使用 pgregory.net/rapid 属性测试框架验证加密层的核心正确性属性：
// 对于任意合法密钥和任意 UTF-8 文本，加密后解密应还原原始内容。
//
// 📚 学习要点: 属性测试 vs 单元测试
// 单元测试验证特定输入的预期输出（"Hello" → 加密 → 解密 → "Hello"）。
// 属性测试验证对所有合法输入都成立的通用性质（∀ key, ∀ text: decrypt(encrypt(text)) == text）。
// rapid 库自动生成数百个随机输入（包括边界情况），比手写用例覆盖更全面。
package crypto

import (
	"encoding/json"
	"testing"
	"unicode"

	"pgregory.net/rapid"
)

// Feature: cli-client, Property 2: Encryption/Decryption Round-Trip (Message Payload)
//
// 📚 学习要点: 端到端加密往返验证
// 此属性测试验证 Arthas 消息加密的完整流程：
// 1. 构造 JSON 载荷 {"text": "<content>"}（与 Web 客户端 buildPayload 一致）
// 2. 使用 AES-256-GCM 加密 JSON 字节
// 3. 解密密文
// 4. 解析 JSON 并提取 text 字段
// 5. 验证提取的文本与原始输入完全一致
//
// 这确保了：
// - AES-GCM 加密/解密的正确性（密文未损坏）
// - Base64URL 编码/解码的往返一致性
// - JSON 序列化/反序列化对所有 UTF-8 字符的正确处理
// - 多字节字符（CJK、emoji）不会在加密流程中被截断或损坏
//
// **Validates: Requirements 4.1, 4.3, 5.1, 5.2, 5.3, 7.4**
func TestPropertyEncryptDecryptRoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成随机 32 字节 AES-256 密钥
		key := genKey(t)

		// 生成随机 UTF-8 文本（包含 Latin、CJK、emoji 字符）
		text := genUTF8Text(t)

		// 构造 JSON 载荷（与 chat/session.go 中 handleUserInput 的逻辑一致）
		// 📚 学习要点: 使用 json.Marshal 而非手动拼接
		// json.Marshal 正确处理所有需要转义的字符（引号、反斜杠、控制字符），
		// 确保与 Web 客户端的 JSON.stringify() 行为完全一致。
		type payload struct {
			Text string `json:"text"`
		}
		jsonBytes, err := json.Marshal(payload{Text: text})
		if err != nil {
			t.Fatalf("json.Marshal failed: %v", err)
		}

		// 加密 JSON 载荷
		ivB64, ctB64, err := Encrypt(key, jsonBytes)
		if err != nil {
			t.Fatalf("Encrypt failed: %v", err)
		}

		// 解密
		decrypted, err := Decrypt(key, ivB64, ctB64)
		if err != nil {
			t.Fatalf("Decrypt failed: %v", err)
		}

		// 解析 JSON 并提取 text 字段
		var result payload
		if err := json.Unmarshal(decrypted, &result); err != nil {
			t.Fatalf("json.Unmarshal failed: %v", err)
		}

		// 验证往返一致性
		if result.Text != text {
			t.Fatalf("round-trip mismatch:\n  original: %q\n  got:      %q", text, result.Text)
		}
	})
}

// genKey 生成 32 字节随机 AES-256 密钥。
// 📚 学习要点: 属性测试中的密钥生成
// 使用 rapid 的随机字节生成器而非 crypto/rand，
// 因为属性测试需要可重现的输入（rapid 控制随机种子以便缩小失败用例）。
func genKey(t *rapid.T) []byte {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(rapid.IntRange(0, 255).Draw(t, "key-byte"))
	}
	return key
}

// genUTF8Text 生成包含多种 Unicode 范围的 UTF-8 字符串。
// 覆盖 Latin（基本 ASCII）、Han（中日韩）、emoji 等多字节字符，
// 确保加密流程不会因字符编码问题而损坏数据。
func genUTF8Text(t *rapid.T) string {
	return rapid.StringOfN(
		rapid.RuneFrom(nil, unicode.Han, unicode.Latin, unicode.S),
		1, 200, -1,
	).Draw(t, "text")
}
