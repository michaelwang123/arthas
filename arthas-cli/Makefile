# Makefile for arthas-cli — cross-platform build targets
#
# 📚 学习要点: Go 交叉编译
# Go 原生支持交叉编译：只需设置 GOOS 和 GOARCH 环境变量即可为目标平台生成二进制。
# CGO_ENABLED=0 确保生成纯静态二进制（不依赖 C 库），便于在容器和无 libc 环境中运行。
# -ldflags "-X main.version=$(VERSION)" 在编译时注入版本号，避免硬编码。

# VERSION 默认从 git tag 获取，如果没有 tag 则使用 "dev"
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")

# 二进制输出目录
BINARY_NAME := arthas-cli
BUILD_DIR := build

# Go 编译参数
LDFLAGS := -ldflags "-X main.version=$(VERSION)"
GO_BUILD := CGO_ENABLED=0 go build $(LDFLAGS)

.PHONY: build build-all clean

# build 编译当前平台的二进制
build:
	$(GO_BUILD) -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/arthas-cli/

# build-all 编译所有目标平台的二进制
build-all: \
	$(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 \
	$(BUILD_DIR)/$(BINARY_NAME)-linux-arm64 \
	$(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64 \
	$(BUILD_DIR)/$(BINARY_NAME)-darwin-arm64 \
	$(BUILD_DIR)/$(BINARY_NAME)-windows-amd64.exe

$(BUILD_DIR)/$(BINARY_NAME)-linux-amd64:
	GOOS=linux GOARCH=amd64 $(GO_BUILD) -o $@ ./cmd/arthas-cli/

$(BUILD_DIR)/$(BINARY_NAME)-linux-arm64:
	GOOS=linux GOARCH=arm64 $(GO_BUILD) -o $@ ./cmd/arthas-cli/

$(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64:
	GOOS=darwin GOARCH=amd64 $(GO_BUILD) -o $@ ./cmd/arthas-cli/

$(BUILD_DIR)/$(BINARY_NAME)-darwin-arm64:
	GOOS=darwin GOARCH=arm64 $(GO_BUILD) -o $@ ./cmd/arthas-cli/

$(BUILD_DIR)/$(BINARY_NAME)-windows-amd64.exe:
	GOOS=windows GOARCH=amd64 $(GO_BUILD) -o $@ ./cmd/arthas-cli/

# clean 删除所有编译产物
clean:
	rm -rf $(BUILD_DIR)
