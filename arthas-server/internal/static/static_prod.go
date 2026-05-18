// 📚 学习要点: Build Tags 条件编译
// Go 的 //go:build 指令控制文件是否参与编译。
// !dev 表示「当 -tags 中不包含 dev 时编译此文件」。
// 生产构建不加任何 tag，所以此文件默认参与编译。
// 开发构建使用 go build -tags dev，此文件被排除，static_dev.go 生效。
//
// 📚 学习要点: 为什么需要 Build Tags？
// Go 的 //go:embed 指令要求目标目录在编译时存在。
// 开发时前端 dist/ 通常不存在（开发者使用 Vite dev server）。
// 如果没有 build tag 机制，开发者每次编译后端都必须先构建前端，
// 这会严重拖慢开发迭代速度。通过 -tags dev 跳过 embed，
// 开发者可以独立编译运行后端。

//go:build !dev

// Package static 提供嵌入式前端静态文件服务。
//
// 生产模式下，此包将 Vite 构建产物（dist/ 目录）嵌入到 Go 二进制中，
// 实现单文件部署：一个可执行文件同时服务前端页面和 WebSocket 后端。
//
// 📚 学习要点: 单二进制部署的优势
// 传统部署需要 Nginx/Caddy 服务前端 + 独立后端进程，增加运维复杂度。
// Go embed 将前端文件编译进二进制，用户下载一个文件即可运行完整应用。
// 这是 Arthas 自托管 Tier 1（零依赖部署）的核心技术基础。
package static

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

// 📚 学习要点: Go embed 指令
// //go:embed dist 告诉编译器将 dist/ 目录的所有文件打包进二进制。
// embed.FS 实现了 fs.FS 接口，可以像普通文件系统一样读取。
// 编译后二进制体积会增加（约等于 dist/ 目录大小，通常 1-3MB），
// 但换来的是零依赖部署——不需要额外的文件服务器或挂载卷。
//
// 注意：如果 dist/ 目录不存在，go build 会报错：
//   pattern dist: no matching files found
// 这是预期行为——生产构建前必须先执行 npm run build 生成前端产物。

//go:embed dist
var distFS embed.FS

// Handler 返回一个 http.Handler，服务嵌入的前端静态文件。
//
// 路由逻辑：
//   - 如果请求路径对应一个真实文件（如 /assets/app-abc123.js），直接返回该文件
//   - 如果请求路径不匹配任何文件，返回 index.html（SPA fallback）
//
// 缓存策略：
//   - /assets/* 路径：Cache-Control: public, immutable, max-age=31536000（1年）
//     因为 Vite 构建的 assets 文件名包含内容哈希，内容变化时文件名也变
//   - SPA fallback（index.html）：Cache-Control: no-cache
//     确保用户总是获取最新版本的入口文件
//
// 📚 学习要点: SPA Fallback 原理
// 单页应用（SPA）使用客户端路由（如 React Router）。
// 用户直接访问 /room/abc123 时，服务器上不存在这个文件，
// 但我们不应返回 404，而是返回 index.html 让前端路由器处理。
// 这就是 SPA fallback：所有未匹配的路径都回退到 index.html。
//
// 📚 学习要点: 缓存策略设计
// Vite 构建产物分两类：
//  1. 带哈希的资源文件（/assets/app-abc123.js）：内容不变，可永久缓存
//     max-age=31536000（1年）+ immutable 告诉浏览器和 CDN 永不重新验证
//  2. 入口文件（index.html）：引用最新的哈希资源，必须每次检查更新
//     no-cache 表示每次使用前必须向服务器验证（不是"不缓存"）
//
// 这种策略兼顾了性能（资源文件零网络请求）和正确性（入口文件总是最新）。
func Handler() http.Handler {
	// 📚 学习要点: fs.Sub 去除路径前缀
	// embed.FS 中文件路径带有 "dist/" 前缀（如 "dist/index.html"）。
	// fs.Sub 创建一个子文件系统，去除 "dist/" 前缀，
	// 使得 "dist/index.html" 变为 "index.html"，匹配 HTTP 请求路径。
	subFS, _ := fs.Sub(distFS, "dist")
	fileServer := http.FileServer(http.FS(subFS))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// 尝试打开请求路径对应的文件
		// strings.TrimPrefix 去除开头的 "/"，因为 fs.FS 不使用前导斜杠
		f, err := subFS.Open(strings.TrimPrefix(path, "/"))
		if err == nil {
			f.Close()

			// 文件存在：设置缓存头并返回文件内容
			if strings.HasPrefix(path, "/assets/") {
				// 📚 学习要点: immutable 缓存指令
				// immutable 是 Cache-Control 的扩展指令（RFC 8246）。
				// 它告诉浏览器：即使用户按 F5 刷新，也不要发送条件请求。
				// 配合内容哈希文件名，可以完全消除不必要的网络往返。
				w.Header().Set("Cache-Control", "public, immutable, max-age=31536000")
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		// 📚 学习要点: SPA Fallback 实现
		// 文件不存在时，将请求路径重写为 "/"，让 fileServer 返回 index.html。
		// 设置 no-cache 确保浏览器每次都验证 index.html 是否有更新。
		// 注意：这里修改的是 r.URL.Path（请求对象），不影响客户端 URL。
		w.Header().Set("Cache-Control", "no-cache")
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}
