// color_property_test.go 使用属性测试验证 HexToANSI256 颜色转换的正确性。
//
// 📚 学习要点: 属性测试 vs 单元测试
// 单元测试验证特定输入的输出（如 "#ff0000" → index 196）。
// 属性测试验证对所有合法输入都成立的通用性质：
// - 输出格式始终正确（以 \033[38;5; 开头，以 m 结尾）
// - 颜色索引始终在 16-231 范围内（RGB 色立方体区域）
// 这能发现单元测试遗漏的边界情况（如 R=G=B=128 时的舍入行为）。
package ui

import (
	"fmt"
	"strconv"
	"strings"
	"testing"

	"pgregory.net/rapid"
)

// Feature: cli-client, Property 7: Hex Color to ANSI Conversion
//
// For any valid #RRGGBB hex color, conversion produces a string starting with
// "\033[38;5;" and ending with "m", with a valid index 0-255.
//
// Validates: Requirements 6.1
func TestProperty_HexColorToANSIConversion(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		// 生成 3 个随机字节 (0-255) 作为 R, G, B 分量
		r := rapid.IntRange(0, 255).Draw(t, "r")
		g := rapid.IntRange(0, 255).Draw(t, "g")
		b := rapid.IntRange(0, 255).Draw(t, "b")

		// 构造合法的 #RRGGBB hex 颜色字符串
		hex := fmt.Sprintf("#%02x%02x%02x", r, g, b)

		// 执行转换
		result := HexToANSI256(hex)

		// 验证 1: 输出不为空（合法输入不应返回空字符串）
		if result == "" {
			t.Fatalf("HexToANSI256(%q) returned empty string for valid hex color", hex)
		}

		// 验证 2: 以 "\033[38;5;" 开头
		prefix := "\033[38;5;"
		if !strings.HasPrefix(result, prefix) {
			t.Fatalf("HexToANSI256(%q) = %q, does not start with %q", hex, result, prefix)
		}

		// 验证 3: 以 "m" 结尾
		if !strings.HasSuffix(result, "m") {
			t.Fatalf("HexToANSI256(%q) = %q, does not end with 'm'", hex, result)
		}

		// 验证 4: 中间部分是有效的整数 0-255
		middle := result[len(prefix) : len(result)-1]
		index, err := strconv.Atoi(middle)
		if err != nil {
			t.Fatalf("HexToANSI256(%q) = %q, middle part %q is not a valid integer", hex, result, middle)
		}
		if index < 0 || index > 255 {
			t.Fatalf("HexToANSI256(%q) = %q, index %d is out of range [0, 255]", hex, result, index)
		}

		// 📚 学习要点: 更精确的范围验证
		// 由于 HexToANSI256 仅使用 6×6×6 RGB 色立方体（索引 16-231），
		// 我们可以验证索引落在这个更窄的范围内。
		// 索引 = 16 + 36*ri + 6*gi + bi，其中 ri, gi, bi ∈ [0,5]
		// 最小值: 16 + 0 + 0 + 0 = 16
		// 最大值: 16 + 180 + 30 + 5 = 231
		if index < 16 || index > 231 {
			t.Fatalf("HexToANSI256(%q) = %q, index %d is outside RGB cube range [16, 231]", hex, result, index)
		}
	})
}
