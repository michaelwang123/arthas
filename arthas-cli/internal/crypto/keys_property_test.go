// keys_property_test.go — 密钥生成的属性测试
//
// 本文件使用 pgregory.net/rapid 对 GenerateRoomKey() 进行属性测试，
// 验证密钥生成的基本安全保证：每次调用都返回恰好 32 字节的密钥。
//
// 📚 学习要点: 为什么用属性测试验证密钥长度？
// 单元测试只验证一次调用的结果，而属性测试通过大量随机迭代确保
// 该不变量在所有情况下都成立。虽然 GenerateRoomKey() 没有输入参数，
// rapid.Check 仍然有价值——它多次调用函数，验证在不同系统状态下
// （如熵池压力）密钥长度始终为 32 字节。
package crypto

import (
	"testing"

	"pgregory.net/rapid"
)

// Feature: cli-client, Property 14: Key Generation Size
// **Validates: Requirements 1.2**

// TestProperty_KeyGenerationSize 验证 GenerateRoomKey() 的基本不变量：
// 每次调用都返回恰好 32 字节（256 位）的密钥且无错误。
//
// AES-256 要求密钥长度恰好为 32 字节，任何偏差都会导致加密失败
// 或安全性降级。此属性测试确保密钥生成函数在多次调用中始终满足此约束。
func TestProperty_KeyGenerationSize(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 调用密钥生成函数
		key, err := GenerateRoomKey()

		// 断言：不应返回错误
		if err != nil {
			t.Fatalf("GenerateRoomKey() returned unexpected error: %v", err)
		}

		// 断言：密钥长度必须恰好为 32 字节（AES-256 要求）
		if len(key) != 32 {
			t.Fatalf("GenerateRoomKey() returned %d bytes, expected exactly 32", len(key))
		}
	})
}
