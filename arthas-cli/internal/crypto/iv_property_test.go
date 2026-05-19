// iv_property_test.go 使用属性测试验证 AES-256-GCM 加密的 IV 唯一性。
//
// 📚 学习要点: IV 唯一性为什么重要？
// AES-GCM 的安全性依赖于同一密钥下 IV（Initialization Vector）绝不重复。
// 如果两条消息使用相同的 IV 和密钥加密：
// - 攻击者可以计算两条明文的 XOR（泄露明文信息）
// - 攻击者可以伪造认证标签（破坏完整性保证）
// 本测试验证 Encrypt 函数在多次调用时生成的 IV 互不相同。
package crypto

import (
	"testing"

	"pgregory.net/rapid"
)

// Feature: cli-client, Property 3: IV Uniqueness
//
// **Validates: Requirements 4.6**
//
// 对于使用同一密钥的 N 次加密操作，所有生成的 12 字节 IV 必须互不相同。
// 这验证了 Encrypt 函数正确使用 crypto/rand 生成随机 IV，
// 碰撞概率在实际使用中可忽略（约 2^(-48) 对于 2^32 条消息）。
func TestProperty_IVUniqueness(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 1. 生成一个随机 32 字节 AES-256 密钥
		key := make([]byte, 32)
		for i := range key {
			key[i] = byte(rapid.IntRange(0, 255).Draw(t, "keyByte"))
		}

		// 2. 生成 N（加密次数），范围 2-100
		n := rapid.IntRange(2, 100).Draw(t, "n")

		// 3. 使用相同密钥和相同明文加密 N 次，收集所有 IV
		plaintext := []byte("same plaintext for all encryptions")
		ivSet := make(map[string]bool, n)

		for i := 0; i < n; i++ {
			iv, _, err := Encrypt(key, plaintext)
			if err != nil {
				t.Fatalf("Encrypt() failed on iteration %d: %v", i, err)
			}

			// 4. 检查 IV 是否已存在于集合中（重复检测）
			if ivSet[iv] {
				t.Fatalf("IV collision detected: iv=%q appeared more than once in %d encryptions", iv, n)
			}
			ivSet[iv] = true
		}

		// 5. 验证集合大小等于 N（所有 IV 唯一）
		if len(ivSet) != n {
			t.Fatalf("expected %d unique IVs, got %d", n, len(ivSet))
		}
	})
}
