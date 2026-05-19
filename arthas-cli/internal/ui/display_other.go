//go:build !windows

// display_other.go 提供非 Windows 平台（Linux、macOS）的终端颜色支持检测。
//
// 📚 学习要点: Unix 终端颜色支持
// Linux 和 macOS 的绝大多数终端模拟器（xterm、iTerm2、GNOME Terminal、Alacritty 等）
// 都原生支持 ANSI 转义序列，无需额外配置。
// 唯一的例外是 TERM=dumb（已在 detectColorSupport 中处理）和管道/重定向场景。
// 因此非 Windows 平台默认返回 true（支持颜色）。
package ui

// detectPlatformColorSupport 在 Unix 平台上默认返回 true。
// TERM=dumb 和 NO_COLOR 的检测已在 detectColorSupport() 中完成，
// 到达此函数时表示终端环境正常，可以安全使用 ANSI 转义序列。
func detectPlatformColorSupport() bool {
	return true
}
