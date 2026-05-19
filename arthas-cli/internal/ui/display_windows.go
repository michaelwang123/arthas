//go:build windows

// display_windows.go 提供 Windows 平台的终端颜色支持检测。
//
// 📚 学习要点: Windows Virtual Terminal Processing (VTP)
// Windows 10 版本 1607 (Anniversary Update) 起支持 ANSI 转义序列，
// 但需要通过 SetConsoleMode 显式启用 ENABLE_VIRTUAL_TERMINAL_PROCESSING 标志。
// 旧版 Windows（如 Windows 7）的 cmd.exe 不支持 ANSI 转义序列，
// 输出会显示为乱码（如 "←[38;5;32m"）。
//
// 检测策略：尝试在 stdout 的控制台句柄上启用 VTP 标志，
// 如果成功则表示终端支持 ANSI 颜色，否则回退到纯文本模式。
package ui

import (
	"os"
	"syscall"
	"unsafe"
)

// Windows 控制台模式标志常量。
const (
	// enableVirtualTerminalProcessing 启用 ANSI 转义序列处理。
	// 对应 Windows API 的 ENABLE_VIRTUAL_TERMINAL_PROCESSING (0x0004)。
	enableVirtualTerminalProcessing = 0x0004
)

// Windows kernel32.dll 函数引用。
var (
	kernel32           = syscall.NewLazyDLL("kernel32.dll")
	procGetConsoleMode = kernel32.NewProc("GetConsoleMode")
	procSetConsoleMode = kernel32.NewProc("SetConsoleMode")
)

// detectPlatformColorSupport 在 Windows 上检测并尝试启用 Virtual Terminal Processing。
//
// 实现步骤：
//  1. 获取 stdout 的文件句柄
//  2. 调用 GetConsoleMode 获取当前控制台模式
//  3. 尝试设置 ENABLE_VIRTUAL_TERMINAL_PROCESSING 标志
//  4. 如果 SetConsoleMode 成功，表示终端支持 ANSI 颜色
//
// 📚 学习要点: 为什么要尝试 SetConsoleMode 而非仅检查版本号？
// 检查 Windows 版本号不可靠（用户可能使用第三方终端如 Windows Terminal、
// ConEmu 等，它们在旧版 Windows 上也支持 ANSI）。
// 直接尝试启用 VTP 是最可靠的检测方式：成功即支持，失败即不支持。
func detectPlatformColorSupport() bool {
	// 获取 stdout 的底层文件描述符
	handle := syscall.Handle(os.Stdout.Fd())

	// 获取当前控制台模式
	var mode uint32
	r, _, _ := procGetConsoleMode.Call(uintptr(handle), uintptr(unsafe.Pointer(&mode)))
	if r == 0 {
		// GetConsoleMode 失败（可能不是控制台，如管道重定向）
		return false
	}

	// 尝试启用 Virtual Terminal Processing
	r, _, _ = procSetConsoleMode.Call(uintptr(handle), uintptr(mode|enableVirtualTerminalProcessing))
	return r != 0
}
