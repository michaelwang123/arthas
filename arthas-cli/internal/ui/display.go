// display.go 负责终端输出格式化，将聊天消息、系统事件渲染为带颜色的终端文本。
//
// 本文件提供 Display 结构体及其方法，统一管理所有终端输出：
// - 聊天消息（带发送者颜色和时间戳）
// - 自己发送的消息（本地回显）
// - 系统消息（成员加入/离开、房间关闭）
// - 错误消息（输出到 stderr）
// - 成员列表和分享码展示
// - 引用回复上下文
//
// 📚 学习要点: 颜色支持检测策略
// 终端颜色支持因平台和环境而异：
// - Linux/macOS: 大多数终端支持 ANSI 转义序列，但 TERM=dumb 不支持
// - Windows: 需要启用 Virtual Terminal Processing（Win10 1607+）
// - CI/管道: NO_COLOR 环境变量是跨平台的"禁用颜色"标准 (https://no-color.org/)
// 本实现在 NewDisplay() 中一次性检测，后续所有输出方法根据 colorSupport 字段决定
// 是否插入 ANSI 转义序列，避免每次输出都重复检测。
package ui

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/arthas/arthas-cli/internal/protocol"
)

// ANSI 转义序列常量，用于终端文本样式控制。
const (
	// ansiReset 重置所有终端样式为默认值。
	ansiReset = "\033[0m"

	// ansiDim 设置暗淡/低亮度文本样式，用于系统消息和引用上下文。
	ansiDim = "\033[2m"

	// ansiBold 设置粗体文本样式，用于自己发送的消息中的昵称。
	ansiBold = "\033[1m"

	// ansiCyan 设置青色前景色，用于分享码高亮显示。
	ansiCyan = "\033[36m"
)

// Display 管理终端输出格式化，封装颜色支持检测和消息渲染逻辑。
//
// 📚 学习要点: 为什么将颜色支持作为结构体字段？
// 颜色支持在程序生命周期内不会改变（终端不会在运行中切换模式）。
// 在构造时一次性检测并存储结果，避免每次输出都调用系统 API，
// 同时使得测试可以通过构造不同的 Display 实例来验证两种模式的行为。
type Display struct {
	// colorSupport 标识当前终端是否支持 ANSI 颜色转义序列。
	colorSupport bool
	// myName 当前用户的显示昵称，用于 ShowOwnMessage 中显示。
	myName string

	// --- 阅后即焚（Ephemeral）支持 ---
	// 📚 学习要点: 终端中的"消息消失"实现策略
	// Web 客户端使用 CSS 动画让消息淡出消失。终端无法实现淡出，
	// 但可以使用 ANSI 转义序列将已显示的行覆盖为 "[message expired]"。
	// 关键挑战：终端是顺序输出的，要修改之前的行需要知道它在当前光标位置的上方几行。
	// 解决方案：维护一个行计数器（lineCounter），每次输出一行就递增。
	// 每条消息记录它被显示时的行号，过期时计算 offset = 当前行号 - 消息行号，
	// 然后用 ANSI 光标移动序列回到那一行进行覆盖。
	lineCounter int // 已输出的总行数（每次 Println 递增）
}

// NewDisplay 创建 Display 实例，自动检测终端颜色支持。
//
// 颜色支持检测逻辑（按优先级）：
//  1. NO_COLOR 环境变量非空 → 禁用颜色（遵循 https://no-color.org/ 标准）
//  2. TERM=dumb → 禁用颜色（哑终端不支持转义序列）
//  3. Windows 平台 → 检查 Virtual Terminal Processing 是否可用
//  4. 其他情况 → 默认启用颜色（Linux/macOS 终端普遍支持）
func NewDisplay(myName string) *Display {
	return &Display{
		colorSupport: detectColorSupport(),
		myName:       myName,
	}
}

// ShowMessage 显示收到的聊天消息，带颜色的发送者名和时间戳。
// 格式: [HH:MM] <colored_name>: text
// 返回消息所在的行号（用于阅后即焚定时清除）。
//
// 参数:
//   - senderName: 发送者的显示昵称
//   - hexColor: 服务器分配的 CSS hex 颜色（如 "#4a7fbf"）
//   - text: 消息文本内容
//   - timestamp: 服务器时间戳（Unix 毫秒）
func (d *Display) ShowMessage(senderName, hexColor, text string, timestamp int64) int {
	ts := FormatTimestamp(timestamp)

	if d.colorSupport {
		colorSeq := HexToANSI256(hexColor)
		fmt.Printf("[%s] %s%s%s: %s\n", ts, colorSeq, senderName, ansiReset, text)
	} else {
		fmt.Printf("[%s] %s: %s\n", ts, senderName, text)
	}
	d.lineCounter++
	return d.lineCounter
}

// ShowOwnMessage 显示自己发送的消息（本地回显）。
// 使用粗体样式区分自己的消息和他人的消息。
// 格式: [HH:MM] <bold_name>: text
// 返回消息所在的行号（用于阅后即焚定时清除）。
//
// 📚 学习要点: 为什么需要本地回显？
// Arthas 服务器不会将消息回传给发送者（避免重复显示）。
// CLI 必须在发送成功后立即本地显示消息，让用户确认消息已发出。
// 使用当前时间作为时间戳（与服务器时间可能有微小差异，但用户无感知）。
func (d *Display) ShowOwnMessage(text string) int {
	ts := FormatTimestamp(time.Now().UnixMilli())

	if d.colorSupport {
		fmt.Printf("[%s] %s%s%s: %s\n", ts, ansiBold, d.myName, ansiReset, text)
	} else {
		fmt.Printf("[%s] %s: %s\n", ts, d.myName, text)
	}
	d.lineCounter++
	return d.lineCounter
}

// ShowSystemMessage 显示系统消息（成员加入/离开、房间关闭等）。
// 使用 *** 前缀和暗淡颜色与用户消息视觉区分。
// 格式: *** message (dimmed)
func (d *Display) ShowSystemMessage(msg string) {
	if d.colorSupport {
		fmt.Printf("%s*** %s%s\n", ansiDim, msg, ansiReset)
	} else {
		fmt.Printf("*** %s\n", msg)
	}
	d.lineCounter++
}

// ShowError 显示错误消息到 stderr。
// 错误消息始终输出到 stderr，不污染 stdout，便于管道操作。
// 格式: Error: <message>
func (d *Display) ShowError(msg string) {
	fmt.Fprintf(os.Stderr, "Error: %s\n", msg)
}

// ShowMembers 显示房间当前成员列表。
// 每个成员名使用其分配的颜色渲染，便于用户识别。
//
// 输出格式:
//
//	Members in room:
//	  • <colored_name>
//	  • <colored_name>
func (d *Display) ShowMembers(members []protocol.MemberInfo) {
	fmt.Println("Members in room:")
	d.lineCounter++
	for _, m := range members {
		if d.colorSupport {
			colorSeq := HexToANSI256(m.Color)
			fmt.Printf("  • %s%s%s\n", colorSeq, m.Name, ansiReset)
		} else {
			fmt.Printf("  • %s\n", m.Name)
		}
		d.lineCounter++
	}
}

// ShowShareCode 显示分享码，使用高亮颜色引起用户注意。
// 分享码是加入房间的唯一凭证，需要醒目展示以便用户复制分发。
func (d *Display) ShowShareCode(code string) {
	if d.colorSupport {
		fmt.Printf("\nShare this code to invite others:\n  %s%s%s\n\n", ansiCyan, code, ansiReset)
	} else {
		fmt.Printf("\nShare this code to invite others:\n  %s\n\n", code)
	}
	d.lineCounter += 4 // 空行 + 提示行 + 分享码行 + 空行
}

// ShowReplyContext 显示引用回复的上下文信息（在消息正文之前输出）。
// 格式: ↩ Re: <senderName>: <preview> (dimmed)
//
// 📚 学习要点: 引用回复的显示策略
// Web 客户端使用气泡样式展示引用，终端无法实现复杂布局。
// CLI 采用单行前缀方式：在消息正文上方显示被引用消息的摘要，
// 使用暗淡颜色和 ↩ 符号表示这是引用上下文而非独立消息。
func (d *Display) ShowReplyContext(senderName, preview string) {
	if d.colorSupport {
		fmt.Printf("%s  ↩ Re: %s: %s%s\n", ansiDim, senderName, preview, ansiReset)
	} else {
		fmt.Printf("  ↩ Re: %s: %s\n", senderName, preview)
	}
	d.lineCounter++
}

// ---------------------------------------------------------------------------
// 阅后即焚（Ephemeral）支持
// ---------------------------------------------------------------------------

// ExpireMessage 处理阅后即焚消息过期。
// 使用 ANSI 清屏序列清除终端所有内容，模拟消息"消失"的效果。
//
// 📚 学习要点: 终端中的阅后即焚实现策略
// Web 客户端可以精确地让单条消息淡出消失（DOM 操作）。
// 终端无法精确控制单行的显示/隐藏，可选方案：
//
// 方案 A: ANSI 光标移动覆盖单行 — 不可靠（行偏移受用户输入影响）
// 方案 B: 每条过期打印通知 — 刷屏（N 条消息 = N 条通知）
// 方案 C: 清屏 — 简单粗暴但有效，所有过期消息一次性"消失"
//
// 采用方案 C：当消息过期时清除终端屏幕。
// 效果：用户看到屏幕被清空，之后只显示新消息。
// 这与 Web 端"消息逐条消失"的体验不同，但在终端中是最实用的方案。
// 使用 \033[2J（清除整个屏幕）+ \033[H（光标移到左上角）。
//
// 参数:
//   - messageLine: 未使用（保留以维持接口兼容）
func (d *Display) ExpireMessage(messageLine int) {
	_ = messageLine
	// 清屏 + 光标归位
	fmt.Print("\033[2J\033[H")
	// 显示提示信息
	if d.colorSupport {
		fmt.Printf("%s*** ⏱ Previous messages expired (ephemeral mode)%s\n", ansiDim, ansiReset)
	} else {
		fmt.Println("*** Previous messages expired (ephemeral mode)")
	}
	// 重置行计数器（屏幕已清空）
	d.lineCounter = 1
}

// GetLineCounter 返回当前行计数器值。
// 用于 session 层在显示消息后记录行号，以便后续过期时计算偏移。
func (d *Display) GetLineCounter() int {
	return d.lineCounter
}

// TrackInputLine 在用户输入一行文本后调用，递增行计数器。
//
// 📚 学习要点: 为什么需要手动追踪用户输入行？
// 当用户在终端输入文本并按回车时，终端会回显该行（stdin echo）。
// 这行文本占据了终端的一行空间，但不是由 Display 的 Show* 方法输出的，
// 因此 lineCounter 不会自动递增。如果不追踪这些行，
// ExpireMessage 计算的光标偏移会少于实际行数，导致覆盖错误的行。
func (d *Display) TrackInputLine() {
	d.lineCounter++
}

// FormatTimestamp 将 Unix 毫秒时间戳转换为本地时区的 HH:MM 格式字符串。
//
// 📚 学习要点: 为什么使用 time.UnixMilli 而非手动计算？
// Go 1.17+ 提供 time.UnixMilli() 直接从毫秒时间戳创建 Time 值，
// 避免了手动除以 1000 再处理余数的错误风险。
// .Local() 确保使用用户系统的本地时区（与 Web 客户端行为一致）。
// "15:04" 是 Go 的时间格式模板（参考时间: Mon Jan 2 15:04:05 MST 2006）。
func FormatTimestamp(unixMs int64) string {
	return time.UnixMilli(unixMs).Local().Format("15:04")
}

// detectColorSupport 检测当前终端是否支持 ANSI 颜色转义序列。
//
// 检测逻辑：
//  1. NO_COLOR 环境变量非空 → 不支持（遵循 no-color.org 标准）
//  2. TERM=dumb → 不支持（哑终端）
//  3. Windows 平台 → 调用平台特定检测（见 display_windows.go / display_other.go）
//  4. 默认 → 支持
func detectColorSupport() bool {
	// NO_COLOR 标准: 如果设置了 NO_COLOR 环境变量（任何非空值），禁用颜色
	if noColor := os.Getenv("NO_COLOR"); noColor != "" {
		return false
	}

	// TERM=dumb 表示哑终端（如 Emacs shell-mode），不支持转义序列
	if strings.EqualFold(os.Getenv("TERM"), "dumb") {
		return false
	}

	// 平台特定检测（Windows VTP 或 Unix 默认支持）
	return detectPlatformColorSupport()
}
