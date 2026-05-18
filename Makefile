# ============================================================================
# Arthas Build System — Cross-Compilation Makefile
# ============================================================================
# 📚 学习要点: Makefile 在项目根目录的作用
# Makefile 提供统一的构建入口，开发者无需记忆复杂的 go build 命令。
# 所有目标从项目根目录执行，使用 go build -C 指定模块目录（Go 1.21+ 特性）。
# 这避免了 cd 到子目录的麻烦，也让 CI/CD 脚本更简洁。
# ============================================================================

# 📚 学习要点: 版本号注入策略
# VERSION 通过 git describe --tags 获取最近的 tag（如 v1.2.3）。
# --always 确保即使没有 tag 也返回 commit hash（如 abc1234）。
# ?= 语法允许外部覆盖：VERSION=v2.0.0 make build-all
# 最终通过 -ldflags "-X main.Version=..." 在编译时注入到二进制中。
VERSION ?= $(shell git describe --tags --always 2>/dev/null || echo "dev")

BINARY_NAME = arthas-server
SERVER_DIR  = arthas-server
CLIENT_DIR  = arthas-client
STATIC_DIR  = $(SERVER_DIR)/internal/static/dist

# 📚 学习要点: ldflags 链接器标志
# -s: 去除符号表（symbol table），减小二进制体积
# -w: 去除 DWARF 调试信息，进一步减小体积（约 30% 压缩）
# -X main.Version=$(VERSION): 在编译时设置 main 包的 Version 变量
# 这三个标志组合可将二进制从 ~20MB 压缩到 ~12MB，且不影响运行时行为。
LDFLAGS = -s -w -X main.Version=$(VERSION)

.PHONY: build-all build-frontend dev-server clean

# ============================================================================
# build-all: 生产构建 — 前端 + 多平台交叉编译
# ============================================================================
# 📚 学习要点: 交叉编译（Cross-Compilation）
# Go 原生支持交叉编译，只需设置 GOOS 和 GOARCH 环境变量。
# CGO_ENABLED=0 禁用 CGO（C 语言绑定），确保生成纯静态链接的二进制。
# 纯静态二进制无需目标系统安装任何共享库（如 libc），可直接运行。
#
# 支持的平台组合：
# - linux/amd64:   标准 x86_64 服务器（AWS EC2, DigitalOcean 等）
# - linux/arm64:   ARM 服务器（Raspberry Pi 4/5, AWS Graviton）
# - darwin/amd64:  Intel Mac
# - darwin/arm64:  Apple Silicon Mac (M1/M2/M3)
# - windows/amd64: Windows 桌面/服务器
#
# go build -C $(SERVER_DIR) 是 Go 1.21+ 的特性：
# 在指定目录中执行构建，等价于 cd $(SERVER_DIR) && go build ...
# -o ../dist/... 输出到项目根目录的 dist/ 文件夹（相对于 -C 指定的目录）
# ============================================================================
build-all: build-frontend
	@echo "Cross-compiling $(BINARY_NAME) $(VERSION) for all platforms..."
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -C $(SERVER_DIR) -ldflags "$(LDFLAGS)" -o ../dist/$(BINARY_NAME)-linux-amd64 ./cmd/server
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -C $(SERVER_DIR) -ldflags "$(LDFLAGS)" -o ../dist/$(BINARY_NAME)-linux-arm64 ./cmd/server
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -C $(SERVER_DIR) -ldflags "$(LDFLAGS)" -o ../dist/$(BINARY_NAME)-darwin-amd64 ./cmd/server
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -C $(SERVER_DIR) -ldflags "$(LDFLAGS)" -o ../dist/$(BINARY_NAME)-darwin-arm64 ./cmd/server
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -C $(SERVER_DIR) -ldflags "$(LDFLAGS)" -o ../dist/$(BINARY_NAME)-windows-amd64.exe ./cmd/server
	@echo "Done! Binaries in dist/"

# ============================================================================
# build-frontend: 构建前端并复制到 Go embed 目标位置
# ============================================================================
# 📚 学习要点: 前端构建与 Go embed 的衔接
# Go 的 //go:embed dist 指令要求 dist/ 目录在编译时存在于源码树中。
# 此目标先用 npm 构建前端产物，再复制到 Go 包的 internal/static/dist/。
# npm ci（而非 npm install）确保使用 lockfile 中的精确版本，构建可复现。
# ============================================================================
build-frontend:
	@echo "Building frontend..."
	cd $(CLIENT_DIR) && npm ci && npm run build
	rm -rf $(STATIC_DIR)
	cp -r $(CLIENT_DIR)/dist $(STATIC_DIR)
	@echo "Frontend built and copied to $(STATIC_DIR)"

# ============================================================================
# dev-server: 开发模式构建（无需前端）
# ============================================================================
# 📚 学习要点: Build Tags 条件编译
# -tags dev 激活 static_dev.go（返回 501 提示用 Vite），
# 同时排除 static_prod.go（包含 //go:embed dist 指令）。
# 这让开发者无需先构建前端就能编译运行后端，
# 前端开发使用 Vite dev server (localhost:5173) 独立运行。
# ============================================================================
dev-server:
	@echo "Building dev server (no embedded frontend)..."
	go build -C $(SERVER_DIR) -tags dev -ldflags "$(LDFLAGS)" -o ../dist/$(BINARY_NAME) ./cmd/server
	@echo "Dev server built: dist/$(BINARY_NAME)"

# ============================================================================
# clean: 清理所有构建产物
# ============================================================================
clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist/ $(STATIC_DIR)
	@echo "Clean complete"
