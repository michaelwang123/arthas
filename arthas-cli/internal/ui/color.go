// color.go 负责将 CSS hex 颜色值转换为 ANSI 256-color 终端转义序列。
//
// 📚 学习要点: ANSI 256-color 调色板结构
// ANSI 256-color 调色板分为三个区域：
//   - 索引 0-15:   标准 16 色（终端主题可自定义，不可靠）
//   - 索引 16-231: 6×6×6 RGB 色立方体（216 色）
//     每个 R/G/B 分量有 6 个级别: 0, 95, 135, 175, 215, 255
//     索引计算公式: index = 16 + 36*r + 6*g + b （r,g,b ∈ [0,5]）
//   - 索引 232-255: 24 级灰度（从深灰到浅灰）
//
// 本实现仅使用 16-231 区域（RGB 色立方体），因为：
// 1. 标准 16 色受终端主题影响，颜色不可预测
// 2. 灰度区域对彩色昵称没有意义
// 3. 6×6×6 色立方体提供足够的颜色精度来近似 CSS hex 颜色
//
// 转换算法使用最近邻匹配：将 0-255 的 RGB 分量映射到最接近的
// 6 级阈值（0, 95, 135, 175, 215, 255），选择距离最小的级别索引。
package ui

import (
	"fmt"
	"strconv"
	"strings"
)

// ansiCubeLevels 是 ANSI 256-color RGB 色立方体的 6 个分量级别值。
// 这些值对应 xterm-256color 标准中 6×6×6 色立方体的实际 RGB 值。
var ansiCubeLevels = [6]int{0, 95, 135, 175, 215, 255}

// HexToANSI256 将 CSS hex 颜色（如 "#4a7fbf"）转换为最接近的 ANSI 256-color 转义序列。
// 返回格式为 "\033[38;5;<index>m" 的前景色转义序列。
// 如果输入格式无效（不是 "#RRGGBB" 格式），返回空字符串。
//
// 转换步骤：
//  1. 解析 hex 字符串提取 R, G, B 分量（0-255）
//  2. 将每个分量映射到 6 级 ANSI 色立方体索引（0-5）
//  3. 计算调色板索引: 16 + 36*r + 6*g + b
//  4. 构造 ANSI 转义序列
func HexToANSI256(hex string) string {
	// 去除前导 '#' 并验证长度
	hex = strings.TrimPrefix(hex, "#")
	if len(hex) != 6 {
		return ""
	}

	// 解析 R, G, B 分量（各 2 位十六进制）
	r, err := strconv.ParseUint(hex[0:2], 16, 8)
	if err != nil {
		return ""
	}
	g, err := strconv.ParseUint(hex[2:4], 16, 8)
	if err != nil {
		return ""
	}
	b, err := strconv.ParseUint(hex[4:6], 16, 8)
	if err != nil {
		return ""
	}

	// 将 0-255 分量映射到 0-5 色立方体索引
	ri := colorToAnsiComponent(int(r))
	gi := colorToAnsiComponent(int(g))
	bi := colorToAnsiComponent(int(b))

	// 📚 学习要点: ANSI 256-color 索引计算
	// 色立方体从索引 16 开始，R 分量权重最高（×36），G 次之（×6），B 最低（×1）。
	// 这与 RGB 颜色空间中 R 在高位、B 在低位的惯例一致。
	index := 16 + 36*ri + 6*gi + bi

	// 构造 ANSI 前景色转义序列: ESC[38;5;<n>m
	// 38 = 前景色设置, 5 = 256-color 模式, <n> = 颜色索引
	return fmt.Sprintf("\033[38;5;%dm", index)
}

// Reset 返回 ANSI 重置序列，将终端颜色恢复为默认值。
// 应在每条彩色输出之后调用，避免颜色"泄漏"到后续输出。
func Reset() string {
	return "\033[0m"
}

// colorToAnsiComponent 将 0-255 范围的单个 RGB 分量映射到 0-5 的 ANSI 色立方体索引。
// 使用最近邻算法：计算输入值与每个级别值的绝对距离，选择距离最小的级别。
//
// 📚 学习要点: 为什么使用最近邻而非线性映射？
// 线性映射 (value * 5 / 255) 会产生不均匀的视觉效果，因为 ANSI 色立方体的
// 6 个级别值不是等间距的（0, 95, 135, 175, 215, 255）。
// 最近邻匹配确保选择视觉上最接近的颜色，即使输入值落在两个级别之间。
func colorToAnsiComponent(value int) int {
	bestIdx := 0
	bestDist := abs(value - ansiCubeLevels[0])

	for i := 1; i < 6; i++ {
		dist := abs(value - ansiCubeLevels[i])
		if dist < bestDist {
			bestDist = dist
			bestIdx = i
		}
	}

	return bestIdx
}

// abs 返回整数的绝对值。
func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
