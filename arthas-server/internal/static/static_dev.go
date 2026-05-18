// 📚 学习要点: Build Tags 条件编译（开发模式）
// Go 的 //go:build 指令是编译时条件开关，控制哪些文件参与编译。
// `dev` 标签表示「当 -tags 中包含 dev 时编译此文件」。
//
// 为什么需要开发模式？
// 生产构建中，static_prod.go 使用 //go:embed dist 嵌入前端文件。
// 但开发时 dist/ 目录可能不存在（前端还没构建），直接 go build 会报错：
//   pattern dist: no matching files found
// 通过 `go build -tags dev ./cmd/server`，编译器选择此文件而非 static_prod.go，
// 跳过 embed 指令，让后端可以独立编译和运行。
// 前端开发者同时运行 Vite dev server（:5173）处理前端热更新。
//
// 使用方式：
//   go build -tags dev ./cmd/server   → 编译此文件（无需 dist/）
//   go build ./cmd/server             → 编译 static_prod.go（需要 dist/）

//go:build dev

// Package static 提供前端静态文件的 HTTP 服务。
// 开发模式下，此包返回 501 提示，引导开发者使用 Vite dev server。
package static

import "net/http"

// Handler 返回开发模式下的 HTTP 处理器。
// 该处理器对所有请求返回 HTTP 501 (Not Implemented)，
// 提示开发者前端文件未嵌入，应使用 Vite dev server（默认端口 :5173）。
//
// 📚 学习要点: 为什么返回 501 而非 404？
// 501 Not Implemented 语义上表示「服务器不支持此功能」，
// 比 404 更准确地传达「此路径在开发模式下故意不提供服务」的含义。
// 开发者看到 501 会立即意识到这是预期行为，而非路由配置错误。
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "static files not embedded in dev mode, use Vite dev server on :5173", http.StatusNotImplemented)
	})
}
