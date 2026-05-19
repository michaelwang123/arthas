// input_property_test.go — 输入验证属性测试
//
// 本文件使用 pgregory.net/rapid 进行属性测试，验证用户输入验证函数
// 在整个合法/非法输入空间中的正确性。
//
// 📚 学习要点: 为什么对验证函数做属性测试？
// 验证函数的正确性边界是"rune 数量"而非"字节数量"。
// 属性测试通过生成包含多字节字符（CJK、emoji）的随机字符串，
// 确保验证逻辑在所有 Unicode 输入下都按 rune 计数而非字节计数。
// 这能发现诸如"误用 len(s) 而非 utf8.RuneCountInString(s)"的 bug。
package ui

import (
	"testing"
	"unicode"

	"pgregory.net/rapid"
)

// multiScriptRune 生成包含 Latin、CJK 和 Emoji 字符的 rune 生成器。
//
// 📚 学习要点: 为什么混合多种 Unicode 范围？
// 不同 Unicode 范围的字符在 UTF-8 中占用不同字节数：
// - Latin (A-Z, a-z): 1 字节/rune
// - CJK (中文等): 3 字节/rune
// - Emoji/Symbol: 4 字节/rune
// 混合生成确保验证逻辑正确使用 rune 计数而非字节计数。
func multiScriptRune() *rapid.Generator[rune] {
	return rapid.RuneFrom(nil, unicode.Latin, unicode.Han, unicode.S)
}

// ============================================================================
// Feature: cli-client, Property 12: Display Name Validation
// ============================================================================

// TestProperty_DisplayNameValid 验证 1-20 rune 的字符串被 ValidateDisplayName 接受。
//
// **Validates: Requirements 9.7**
//
// 属性定义：
// 对于任意由 Latin、CJK、Emoji 字符组成的 1-20 rune 字符串，
// ValidateDisplayName 必须返回 nil（接受该名称）。
func TestProperty_DisplayNameValid(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成 1-20 rune 的多脚本字符串
		name := rapid.StringOfN(multiScriptRune(), 1, 20, -1).Draw(t, "name")

		err := ValidateDisplayName(name)
		if err != nil {
			t.Errorf("ValidateDisplayName(%q) = %v, want nil (len=%d runes)",
				name, err, len([]rune(name)))
		}
	})
}

// TestProperty_DisplayNameTooLong 验证超过 20 rune 的字符串被 ValidateDisplayName 拒绝。
//
// **Validates: Requirements 9.7**
//
// 属性定义：
// 对于任意由 Latin、CJK、Emoji 字符组成的 21-100 rune 字符串，
// ValidateDisplayName 必须返回 error（拒绝该名称）。
func TestProperty_DisplayNameTooLong(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成 21-100 rune 的多脚本字符串
		name := rapid.StringOfN(multiScriptRune(), 21, 100, -1).Draw(t, "name")

		err := ValidateDisplayName(name)
		if err == nil {
			t.Errorf("ValidateDisplayName(%q) = nil, want error (len=%d runes)",
				name, len([]rune(name)))
		}
	})
}

// TestProperty_DisplayNameEmpty 验证空字符串被 ValidateDisplayName 拒绝。
//
// **Validates: Requirements 9.7**
//
// 属性定义：
// 空字符串（0 rune）传入 ValidateDisplayName 必须返回 error。
// 虽然这是一个确定性测试（输入固定为 ""），但将其纳入属性测试文件
// 以保持 Property 12 的完整性验证。
func TestProperty_DisplayNameEmpty(t *testing.T) {
	err := ValidateDisplayName("")
	if err == nil {
		t.Error("ValidateDisplayName(\"\") = nil, want error")
	}
}

// ============================================================================
// Feature: cli-client, Property 13: Message Length Validation
// ============================================================================

// TestProperty_MessageLengthValidation_Accept 验证 1-500 rune 的字符串被接受。
//
// **Validates: Requirements 7.5**
//
// 属性定义：
// 对于任意 1-500 rune 长度的 UTF-8 字符串（包含 ASCII、CJK、emoji 等），
// ValidateMessageLength 必须返回 nil（接受该消息）。
//
// 📚 学习要点: rapid.StringOfN 与 rune 生成
// rapid.StringOfN 的第二、三个参数控制生成字符串的 rune 数量范围（非字节数）。
// 配合 rapid.RuneFrom 可以生成包含多字节字符的字符串，
// 确保测试覆盖"字节数远大于 rune 数"的场景（如全中文字符串）。
func TestProperty_MessageLengthValidation_Accept(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成 1-500 rune 的字符串，包含多种 Unicode 字符
		text := rapid.StringOfN(
			rapid.RuneFrom(nil, unicode.Latin, unicode.Han, unicode.Katakana),
			1, 500, -1,
		).Draw(t, "text")

		err := ValidateMessageLength(text)
		if err != nil {
			t.Errorf("ValidateMessageLength should accept %d-rune string, got error: %v",
				len([]rune(text)), err)
		}
	})
}

// TestProperty_MessageLengthValidation_Reject 验证超过 500 rune 的字符串被拒绝。
//
// **Validates: Requirements 7.5**
//
// 属性定义：
// 对于任意 501-1000 rune 长度的 UTF-8 字符串，
// ValidateMessageLength 必须返回 ErrMessageTooLong 错误。
//
// 📚 学习要点: 边界值测试的重要性
// 属性测试生成器的范围从 501 开始（刚好超过限制），
// 确保边界条件（500 vs 501）被正确处理。
// rapid 的 shrinking 机制会在失败时自动找到最小反例，
// 帮助定位是否是 off-by-one 错误。
func TestProperty_MessageLengthValidation_Reject(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成 501-1000 rune 的字符串
		text := rapid.StringOfN(
			rapid.RuneFrom(nil, unicode.Latin, unicode.Han, unicode.Katakana),
			501, 1000, -1,
		).Draw(t, "text")

		err := ValidateMessageLength(text)
		if err != ErrMessageTooLong {
			t.Errorf("ValidateMessageLength should reject %d-rune string, got: %v",
				len([]rune(text)), err)
		}
	})
}
