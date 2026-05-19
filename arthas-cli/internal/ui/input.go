// input.go 处理用户终端输入和输入验证。
//
// 本文件提供两类功能：
// 1. stdin 行读取（ReadLine）— 供 stdinPump goroutine 使用，阻塞读取用户输入
// 2. 输入验证（ValidateDisplayName, ValidateMessageLength）— 供 CLI 入口和聊天会话复用
//
// 📚 学习要点: 为什么验证函数使用 rune 而非 byte 计数？
// Go 的 string 底层是 UTF-8 字节序列，一个中文字符占 3 字节，一个 emoji 可能占 4 字节。
// 用户感知的"字符数"应该用 rune（Unicode 码点）计算，与 Web 客户端的
// JavaScript `string.length`（UTF-16 code unit）行为接近。
// 例如 "你好" 是 2 个 rune（6 字节），用户期望它算 2 个字符。
package ui

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode/utf8"
)

// 验证相关的错误定义。
// 导出以便调用方可以使用 errors.Is() 进行精确匹配。
var (
	// ErrNameEmpty 表示昵称为空字符串。
	ErrNameEmpty = errors.New("display name must not be empty")

	// ErrNameTooLong 表示昵称超过 20 个 rune。
	ErrNameTooLong = errors.New("display name must not exceed 20 characters")

	// ErrMessageTooLong 表示消息超过 500 个 rune。
	ErrMessageTooLong = errors.New("message must not exceed 500 characters")
)

// scanner 是包级别的 stdin 扫描器，供 ReadLine 使用。
// 📚 学习要点: 为什么使用包级变量？
// bufio.Scanner 内部维护缓冲区状态，多次创建会导致数据丢失。
// 整个 CLI 生命周期中只需要一个 stdin Scanner 实例。
var scanner = bufio.NewScanner(os.Stdin)

// ReadLine 从 stdin 读取一行输入（阻塞）。
// 返回去除尾部换行符的字符串。
// 当 stdin 关闭（Ctrl+D on Unix, Ctrl+Z+Enter on Windows）时返回 io.EOF。
//
// 📚 学习要点: bufio.Scanner 的 EOF 行为
// Scanner.Scan() 在遇到 EOF 时返回 false，且 Scanner.Err() 返回 nil。
// 这与 bufio.Reader.ReadString() 不同（后者返回 io.EOF error）。
// 我们需要区分"正常 EOF"和"读取错误"两种情况。
func ReadLine() (string, error) {
	if scanner.Scan() {
		return scanner.Text(), nil
	}
	// Scan() 返回 false：检查是 EOF 还是读取错误
	if err := scanner.Err(); err != nil {
		return "", err
	}
	// err == nil 表示到达 EOF（stdin 关闭）
	return "", io.EOF
}

// PromptName 交互式提示用户输入昵称。
// 循环提示直到用户输入有效的 Display_Name（1-20 rune），
// 或者 stdin 关闭（返回 io.EOF）。
//
// 验证规则：非空且不超过 20 个 rune（Unicode 码点）。
func PromptName() (string, error) {
	for {
		fmt.Print("Enter your display name: ")

		line, err := ReadLine()
		if err != nil {
			return "", err
		}

		name := strings.TrimSpace(line)

		if err := ValidateDisplayName(name); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %s\n", err.Error())
			continue
		}

		return name, nil
	}
}

// ValidateDisplayName validates that a display name is 1-20 runes.
// Returns nil if valid, or an appropriate error if the name is empty or too long.
//
// This function is exported for reuse by:
// - cmd/arthas-cli/main.go (--name flag validation)
// - internal/chat/session.go (join flow validation)
// - Property tests (Property 12: Display Name Validation)
func ValidateDisplayName(name string) error {
	if name == "" {
		return ErrNameEmpty
	}
	if utf8.RuneCountInString(name) > 20 {
		return ErrNameTooLong
	}
	return nil
}

// ValidateMessageLength validates that a message is at most 500 runes.
// Returns nil if valid, or ErrMessageTooLong if the message exceeds the limit.
//
// 📚 学习要点: 为什么消息长度限制是 500 rune？
// 这与 Web 客户端的 MessageInput 组件限制一致（500 字符）。
// 统一限制确保 CLI 和 Web 客户端发送的消息在对方都能正常显示，
// 避免超长消息导致终端渲染问题或服务器拒绝。
//
// This function is exported for reuse by:
// - internal/chat/session.go (message sending validation)
// - Property tests (Property 13: Message Length Validation)
func ValidateMessageLength(text string) error {
	if utf8.RuneCountInString(text) > 500 {
		return ErrMessageTooLong
	}
	return nil
}
