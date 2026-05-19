// Package main is the entry point for arthas-cli, a standalone terminal client
// for the Arthas encrypted chat system.
//
// arthas-cli implements the same WebSocket + MessagePack + AES-256-GCM protocol
// as the web client, enabling developers and server administrators to create and
// join encrypted chat rooms directly from the terminal.
//
// 📚 学习要点: 为什么使用独立的 Go module？
// arthas-cli 是一个独立的二进制程序，与 arthas-server 共享协议但不共享代码。
// 独立 module 意味着独立的依赖管理和版本控制，编译产物是单一静态二进制，
// 无需运行时依赖，便于分发和部署。
//
// 📚 学习要点: 为什么使用标准库 flag 而非 cobra？
// arthas-cli 只有两个子命令（create/join）和少量全局标志（--server, --name, --version, --help）。
// 对于如此简单的命令结构，标准库 flag.NewFlagSet 完全够用，
// 引入 cobra 等重型框架会增加二进制体积和依赖复杂度，不符合"零依赖部署"的设计目标。
// 使用 flag.NewFlagSet 为每个子命令创建独立的 FlagSet，实现子命令级别的参数解析。
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/arthas/arthas-cli/internal/chat"
	"github.com/arthas/arthas-cli/internal/ui"
)

// version is set at build time via -ldflags "-X main.version=<value>".
// Defaults to "dev" for local development builds.
var version = "dev"

// defaultServerURL is the default WebSocket server endpoint used when neither
// --server flag nor ARTHAS_SERVER env var is provided.
//
// 📚 学习要点: 默认服务器 URL 的选择
// 使用公共实例的 WebSocket 端点作为默认值，使得用户无需任何配置即可开始使用。
// 自托管用户可通过 --server 标志或 ARTHAS_SERVER 环境变量覆盖此默认值。
const defaultServerURL = "wss://arthas-chat.onrender.com/ws"

// usage prints the top-level help message to stderr and exits.
// 格式遵循 Unix CLI 惯例：简短描述 + 用法模式 + 子命令列表 + 全局选项。
func usage() {
	fmt.Fprintf(os.Stderr, `arthas-cli — Terminal client for Arthas encrypted chat

Usage:
  arthas-cli create [--server URL] [--name NAME]
  arthas-cli join <share_code> [--server URL] [--name NAME]
  arthas-cli --version
  arthas-cli --help

Commands:
  create    Create a new encrypted chat room
  join      Join an existing room using a share code

Global Options:
  --server  WebSocket server URL (default: %s)
            Can also be set via ARTHAS_SERVER environment variable
  --name    Display name (1-20 characters); prompted interactively if omitted
  --version Print version and exit
  --help    Print this help message and exit
`, defaultServerURL)
}

func main() {
	os.Exit(run())
}

// run contains the actual CLI logic, returning an exit code.
// Separating this from main() enables clean exit code handling via os.Exit
// without deferred functions being skipped.
//
// 📚 学习要点: 为什么将逻辑放在 run() 而非直接在 main() 中？
// os.Exit() 会立即终止进程，跳过所有 defer 语句。
// 将逻辑放在 run() 中，main() 只负责调用 os.Exit(run())，
// 这样 run() 内部的 defer 语句（如关闭连接）能正常执行。
// 同时 run() 返回 int 使得退出码逻辑更清晰可测试。
func run() int {
	// 处理顶层标志（--version, --help）
	// 📚 学习要点: 为什么手动检查 os.Args 而非使用 flag.Parse()？
	// 标准库 flag 包不原生支持子命令模式。如果直接 flag.Parse()，
	// 它会将 "create" 或 "join" 视为未知参数而报错。
	// 解决方案是先手动检查顶层标志，再根据第一个非标志参数路由到子命令。
	if len(os.Args) < 2 {
		usage()
		return 1
	}

	// 检查顶层标志（在子命令之前）
	switch os.Args[1] {
	case "--version", "-version":
		fmt.Printf("arthas-cli %s\n", version)
		return 0
	case "--help", "-help", "-h":
		usage()
		return 0
	}

	// 路由子命令
	switch os.Args[1] {
	case "create":
		return runCreate(os.Args[2:])
	case "join":
		return runJoin(os.Args[2:])
	default:
		fmt.Fprintf(os.Stderr, "Error: unknown command %q\n\n", os.Args[1])
		usage()
		return 1
	}
}

// resolveServerURL determines the server URL from flag value, environment variable,
// or default, following the precedence: flag > env > default.
//
// 📚 学习要点: 配置优先级模式
// CLI 工具的常见配置优先级为：命令行标志 > 环境变量 > 配置文件 > 默认值。
// arthas-cli 不使用配置文件（保持简单），因此优先级为：
// --server flag > ARTHAS_SERVER env > defaultServerURL 常量。
// 这种分层允许用户在不同场景下灵活配置：
// - 临时使用：--server 标志
// - 持久配置：环境变量（写入 .bashrc/.zshrc）
// - 零配置：默认公共实例
func resolveServerURL(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	if envURL := os.Getenv("ARTHAS_SERVER"); envURL != "" {
		return envURL
	}
	return defaultServerURL
}

// validateServerURL 验证服务器 URL 格式是否合法。
// 必须以 ws:// 或 wss:// 开头（WebSocket 协议）。
//
// 📚 学习要点: 为什么在 Dial 之前验证？
// gorilla/websocket 的 Dial 对无效 URL 返回的错误信息不够友好
// （如 "malformed ws or wss URL"），用户难以理解问题所在。
// 提前验证并给出明确提示，改善用户体验。
func validateServerURL(url string) error {
	if !strings.HasPrefix(url, "ws://") && !strings.HasPrefix(url, "wss://") {
		return fmt.Errorf("server URL must start with ws:// or wss://, got %q", url)
	}
	return nil
}

// resolveName determines the display name from flag value or interactive prompt.
// Returns the validated name or an error if validation/input fails.
//
// 📚 学习要点: 交互式回退策略
// 如果用户未通过 --name 标志提供昵称，CLI 会交互式提示输入。
// 这种"标志优先，交互回退"的模式在 CLI 工具中很常见（如 git commit 不带 -m 时打开编辑器）。
// 它兼顾了脚本化使用（通过标志传参）和交互式使用（手动输入）两种场景。
func resolveName(flagValue string) (string, error) {
	if flagValue != "" {
		// 验证通过标志提供的名称
		if err := ui.ValidateDisplayName(flagValue); err != nil {
			return "", err
		}
		return flagValue, nil
	}
	// 交互式提示输入
	return ui.PromptName()
}

// runCreate handles the "create" subcommand: parse flags, resolve config, start session.
//
// Usage: arthas-cli create [--server URL] [--name NAME]
func runCreate(args []string) int {
	// 📚 学习要点: flag.NewFlagSet 实现子命令
	// 每个子命令使用独立的 FlagSet，这样：
	// 1. 各子命令可以有不同的标志集合
	// 2. 标志解析不会与其他子命令的参数冲突
	// 3. 每个 FlagSet 可以有独立的 Usage 函数
	// flag.ContinueOnError 使得解析失败时不会直接 os.Exit，
	// 而是返回 error，让我们控制错误输出格式。
	fs := flag.NewFlagSet("create", flag.ContinueOnError)
	serverFlag := fs.String("server", "", "WebSocket server URL")
	nameFlag := fs.String("name", "", "Display name (1-20 characters)")

	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, `Usage: arthas-cli create [--server URL] [--name NAME]

Create a new encrypted chat room.

Options:
`)
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		// flag.ContinueOnError: Parse returns ErrHelp for -help
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	// "create" 不接受位置参数
	if fs.NArg() > 0 {
		fmt.Fprintf(os.Stderr, "Error: 'create' command does not accept positional arguments\n")
		fs.Usage()
		return 1
	}

	// 解析服务器 URL
	serverURL := resolveServerURL(*serverFlag)
	if err := validateServerURL(serverURL); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err.Error())
		return 1
	}

	// 解析显示名称
	name, err := resolveName(*nameFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err.Error())
		return 1
	}

	// 启动创建房间流程
	if err := chat.RunCreate(serverURL, name); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err.Error())
		return 1
	}

	return 0
}

// runJoin handles the "join" subcommand: parse flags, extract share code, start session.
//
// Usage: arthas-cli join <share_code> [--server URL] [--name NAME]
//
// 📚 学习要点: 位置参数与标志参数的混合解析
// "join" 子命令需要一个必需的位置参数（share_code）和可选的标志参数。
// flag.NewFlagSet.Parse() 会消费所有 --key=value 形式的参数，
// 剩余的非标志参数通过 fs.Args() 获取。
// 这里 share_code 是 fs.Args() 中的第一个元素。
func runJoin(args []string) int {
	fs := flag.NewFlagSet("join", flag.ContinueOnError)
	serverFlag := fs.String("server", "", "WebSocket server URL")
	nameFlag := fs.String("name", "", "Display name (1-20 characters)")

	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, `Usage: arthas-cli join <share_code> [--server URL] [--name NAME]

Join an existing encrypted chat room using a share code.

Arguments:
  share_code  The room share code (format: roomId:key[:ephemeral])

Options:
`)
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return 0
		}
		return 1
	}

	// "join" 需要恰好一个位置参数（share_code）
	if fs.NArg() < 1 {
		fmt.Fprintf(os.Stderr, "Error: 'join' command requires a share code argument\n")
		fs.Usage()
		return 1
	}
	if fs.NArg() > 1 {
		fmt.Fprintf(os.Stderr, "Error: 'join' command accepts only one positional argument (share code)\n")
		fs.Usage()
		return 1
	}

	shareCode := strings.TrimSpace(fs.Arg(0))

	// 解析服务器 URL
	serverURL := resolveServerURL(*serverFlag)
	if err := validateServerURL(serverURL); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err.Error())
		return 1
	}

	// 解析显示名称
	name, err := resolveName(*nameFlag)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err.Error())
		return 1
	}

	// 启动加入房间流程
	if err := chat.RunJoin(serverURL, name, shareCode); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %s\n", err.Error())
		return 1
	}

	return 0
}
