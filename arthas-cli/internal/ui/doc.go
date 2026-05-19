// Package ui handles terminal output formatting and user input for arthas-cli.
//
// 负责将聊天消息、系统事件渲染为带颜色的终端输出，
// 以及从 stdin 读取用户输入。支持 ANSI 256-color 和无色回退。
//
// 📚 学习要点: UI 层的平台兼容性
// 终端颜色支持因平台而异：Linux/macOS 的大多数终端支持 ANSI 转义序列，
// Windows 需要启用 Virtual Terminal Processing（Win10+）。
// UI 层在初始化时检测颜色支持，不支持时自动回退到纯文本输出。
package ui
