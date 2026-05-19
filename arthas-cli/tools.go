//go:build tools

// This file ensures dependencies are tracked in go.mod before they are
// imported by implementation code. It uses a build constraint ("tools")
// so it is never compiled into the final binary.
//
// 📚 学习要点: tools.go 模式
// Go 的 go mod tidy 会移除未被任何 .go 文件导入的依赖。
// 在项目初期（实现代码尚未编写时），使用 tools.go + build tag
// 可以保留 go.mod 中的依赖声明，确保 go.sum 包含正确的校验和。
// 当后续任务添加实际导入后，此文件可以删除。

package tools

import (
	_ "github.com/gorilla/websocket"
	_ "github.com/vmihailenco/msgpack/v5"
	_ "pgregory.net/rapid"
)
