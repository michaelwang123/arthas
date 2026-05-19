// display_property_test.go — Display 层属性测试
//
// 本文件使用 pgregory.net/rapid 验证终端显示格式化的正确性：
// - Property 8: 时间戳格式化始终产生合法的 HH:MM 字符串
// - Property 9: 消息显示输出包含所有必需元素（发送者名、消息文本、时间戳）
//
// 📚 学习要点: 测试 stdout 输出
// ShowMessage 使用 fmt.Printf 直接写入 stdout，无法通过返回值验证。
// 测试策略：使用 os.Pipe() 临时替换 os.Stdout，捕获输出后恢复。
// 这是 Go 中测试 stdout 输出的标准模式，但需注意：
// - 必须在测试结束时恢复 os.Stdout（defer 保证）
// - 并发测试中不安全（rapid 内部是顺序执行，所以这里安全）
package ui

import (
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"testing"

	"pgregory.net/rapid"
)

// ============================================================================
// Feature: cli-client, Property 9: Message Display Contains Required Elements
// ============================================================================

// TestProperty_MessageDisplayContainsRequiredElements 验证 ShowMessage 输出包含
// 发送者名、消息文本和合法 HH:MM 时间戳。
//
// **Validates: Requirements 5.5**
//
// 属性定义：
// 对于任意非空发送者名（1-20 字符）、合法 hex 颜色（#RRGGBB）、
// 非空消息文本（1-100 字符）和合法时间戳，
// ShowMessage 的输出必须同时包含发送者名、消息文本和 HH:MM 格式的时间戳。
//
// 📚 学习要点: 为什么使用 colorSupport=false？
// 禁用颜色后，输出不含 ANSI 转义序列，简化了字符串匹配验证。
// 在 colorSupport=false 模式下，ShowMessage 输出格式为：
//
//	[HH:MM] senderName: text\n
//
// 这使得我们可以直接用 strings.Contains 验证各元素的存在性。
func TestProperty_MessageDisplayContainsRequiredElements(t *testing.T) {
	// HH:MM 时间戳正则：[00-23]:[00-59]
	timestampRe := regexp.MustCompile(`\b([01][0-9]|2[0-3]):[0-5][0-9]\b`)

	rapid.Check(t, func(t *rapid.T) {
		// 生成随机发送者名（1-20 个可打印 ASCII 字符，避免换行符干扰输出解析）
		nameChars := []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
		senderName := rapid.StringOfN(
			rapid.RuneFrom(nameChars),
			1, 20, -1,
		).Draw(t, "senderName")

		// 生成随机 hex 颜色 #RRGGBB
		r := rapid.IntRange(0, 255).Draw(t, "r")
		g := rapid.IntRange(0, 255).Draw(t, "g")
		b := rapid.IntRange(0, 255).Draw(t, "b")
		hexColor := fmt.Sprintf("#%02x%02x%02x", r, g, b)

		// 生成随机消息文本（1-100 个可打印 ASCII 字符，避免换行符）
		textChars := []rune("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?")
		text := rapid.StringOfN(
			rapid.RuneFrom(textChars),
			1, 100, -1,
		).Draw(t, "text")

		// 生成随机时间戳（合理范围：2020-01-01 到 2030-01-01 的 Unix 毫秒）
		timestamp := rapid.Int64Range(1577836800000, 1893456000000).Draw(t, "timestamp")

		// 创建 colorSupport=false 的 Display 实例（直接构造，绕过检测逻辑）
		display := &Display{
			colorSupport: false,
			myName:       "testUser",
		}

		// 捕获 stdout 输出
		output := captureStdout(func() {
			display.ShowMessage(senderName, hexColor, text, timestamp)
		})

		// 验证 1: 输出包含发送者名
		if !strings.Contains(output, senderName) {
			t.Fatalf("ShowMessage output %q does not contain sender name %q", output, senderName)
		}

		// 验证 2: 输出包含消息文本
		if !strings.Contains(output, text) {
			t.Fatalf("ShowMessage output %q does not contain message text %q", output, text)
		}

		// 验证 3: 输出包含合法的 HH:MM 时间戳
		if !timestampRe.MatchString(output) {
			t.Fatalf("ShowMessage output %q does not contain a valid HH:MM timestamp", output)
		}
	})
}

// captureStdout 捕获函数执行期间写入 stdout 的内容。
//
// 📚 学习要点: os.Pipe() 捕获 stdout 的原理
// os.Pipe() 创建一对连接的文件描述符（读端 + 写端）。
// 将 os.Stdout 替换为写端后，所有 fmt.Printf 的输出都流入管道。
// 关闭写端后，从读端 io.ReadAll 即可获取全部输出。
// 必须用 defer 恢复原始 os.Stdout，否则后续测试输出会丢失。
func captureStdout(fn func()) string {
	// 保存原始 stdout
	origStdout := os.Stdout

	// 创建管道
	pr, pw, err := os.Pipe()
	if err != nil {
		panic(fmt.Sprintf("os.Pipe() failed: %v", err))
	}

	// 替换 stdout 为管道写端
	os.Stdout = pw

	// 执行目标函数
	fn()

	// 关闭写端，触发读端 EOF
	pw.Close()

	// 恢复原始 stdout
	os.Stdout = origStdout

	// 读取管道中的全部输出
	captured, err := io.ReadAll(pr)
	if err != nil {
		panic(fmt.Sprintf("io.ReadAll failed: %v", err))
	}
	pr.Close()

	return string(captured)
}
