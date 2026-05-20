// encrypt_property_test.go — AES-256-GCM 加密/解密往返属性测试
//
// 本文件使用 pgregory.net/rapid 属性测试框架验证加密层的核心正确性属性：
// 对于任意合法密钥和任意 UTF-8 文本，加密后解密应还原原始内容。
// 同时验证 Typing 状态加密的往返正确性和 IV 唯一性/长度属性。
//
// 📚 学习要点: 属性测试 vs 单元测试
// 单元测试验证特定输入的预期输出（"Hello" → 加密 → 解密 → "Hello"）。
// 属性测试验证对所有合法输入都成立的通用性质（∀ key, ∀ text: decrypt(encrypt(text)) == text）。
// rapid 库自动生成数百个随机输入（包括边界情况），比手写用例覆盖更全面。
package crypto

import (
	"encoding/base64"
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

// Feature: security-upgrade, Property 1: Typing encryption round-trip (extended to CLI encrypt module)
//
// 📚 学习要点: Typing 状态加密往返验证
// 此属性测试验证 Arthas Typing 状态加密的完整流程：
// 1. 生成随机 32 字节 AES-256 密钥
// 2. 随机选择 typing 状态（true 或 false）
// 3. 构造 JSON 载荷 {"typing":true} 或 {"typing":false}
// 4. 使用 AES-256-GCM 加密 JSON 字节
// 5. 解密密文
// 6. 解析 JSON 并提取 typing 字段
// 7. 验证提取的布尔值与原始输入完全一致
//
// 这确保了：
// - AES-GCM 加密/解密对 typing 载荷的正确性
// - Base64URL 编码/解码的往返一致性
// - JSON 序列化/反序列化对布尔值的正确处理
// - 与 Web 客户端 typingEncrypt.ts 的互操作性
//
// **Validates: Requirements 1.1, 1.3**
func TestPropertyTypingEncryptDecryptRoundTrip(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成随机 32 字节 AES-256 密钥
		key := genKey(t)

		// 随机生成 typing 状态（true 或 false）
		typing := rapid.Bool().Draw(t, "typing")

		// 构造 Typing_Payload JSON（与 Web 客户端 typingEncrypt.ts 一致）
		// 📚 学习要点: 使用 json.Marshal 确保与 Web 客户端 JSON.stringify 行为一致
		type typingPayload struct {
			Typing bool `json:"typing"`
		}
		jsonBytes, err := json.Marshal(typingPayload{Typing: typing})
		if err != nil {
			t.Fatalf("json.Marshal failed: %v", err)
		}

		// 加密 Typing_Payload
		ivB64, ctB64, err := Encrypt(key, jsonBytes)
		if err != nil {
			t.Fatalf("Encrypt failed: %v", err)
		}

		// 解密
		decrypted, err := Decrypt(key, ivB64, ctB64)
		if err != nil {
			t.Fatalf("Decrypt failed: %v", err)
		}

		// 解析 JSON 并提取 typing 字段
		var result typingPayload
		if err := json.Unmarshal(decrypted, &result); err != nil {
			t.Fatalf("json.Unmarshal failed: %v", err)
		}

		// 验证往返一致性
		if result.Typing != typing {
			t.Fatalf("typing round-trip mismatch: original=%v, got=%v", typing, result.Typing)
		}
	})
}

// Feature: security-upgrade, Property 2: IV uniqueness and correct length
//
// 📚 学习要点: IV 唯一性和长度对 AES-GCM 安全性的重要性
// AES-GCM 要求：
// 1. IV 必须恰好 12 字节（96 位）— NIST SP 800-38D 推荐长度
// 2. 同一密钥下所有 IV 必须唯一 — 重复 IV 会泄露明文 XOR 并破坏认证标签
//
// 此测试对 typing 载荷进行多次加密，验证：
// - 每个 IV 解码后恰好 12 字节
// - 所有 IV 互不相同（无碰撞）
//
// **Validates: Requirements 1.3**
func TestPropertyTypingIVUniquenessAndLength(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成随机 32 字节 AES-256 密钥
		key := genKey(t)

		// 生成加密次数 N（范围 2-50）
		n := rapid.IntRange(2, 50).Draw(t, "n")

		// 使用相同密钥和相同 typing 载荷加密 N 次
		typingJSON := []byte(`{"typing":true}`)
		ivSet := make(map[string]bool, n)

		for i := 0; i < n; i++ {
			ivB64, _, err := Encrypt(key, typingJSON)
			if err != nil {
				t.Fatalf("Encrypt() failed on iteration %d: %v", i, err)
			}

			// 验证 IV 长度：base64url 解码后必须恰好 12 字节
			// 📚 学习要点: 12 字节 = 96 位是 GCM 标准 nonce 长度
			// base64url 编码 12 字节 → 16 字符（无 padding）
			ivBytes, err := base64.RawURLEncoding.DecodeString(ivB64)
			if err != nil {
				t.Fatalf("IV base64url decode failed on iteration %d: %v", i, err)
			}
			if len(ivBytes) != 12 {
				t.Fatalf("IV length mismatch on iteration %d: expected 12 bytes, got %d bytes", i, len(ivBytes))
			}

			// 验证 IV 唯一性
			if ivSet[ivB64] {
				t.Fatalf("IV collision detected: iv=%q appeared more than once in %d encryptions", ivB64, n)
			}
			ivSet[ivB64] = true
		}

		// 验证集合大小等于 N（所有 IV 唯一）
		if len(ivSet) != n {
			t.Fatalf("expected %d unique IVs, got %d", n, len(ivSet))
		}
	})
}
