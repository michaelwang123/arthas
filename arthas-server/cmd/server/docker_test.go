//go:build integration

// 📚 学习要点: Build Tags（构建标签）
// `//go:build integration` 是 Go 1.17+ 的构建约束语法。
// 带有此标签的文件不会在普通 `go test` 中编译和运行。
// 只有显式指定 `-tags=integration` 时才会包含此文件：
//   go test -tags=integration ./cmd/server/ -run TestDockerImageSize
// 这适用于需要外部依赖（如 Docker）的集成测试，避免在 CI 单元测试阶段失败。

package main

import (
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

// TestDockerImageSize verifies that the production Docker image is under 30MB.
//
// 📚 学习要点: 集成测试 vs 单元测试
// 单元测试验证代码逻辑的正确性，不依赖外部系统。
// 集成测试验证系统与外部依赖（Docker、数据库等）的交互。
// 使用 build tag 将两者分离，确保 `go test ./...` 只运行快速的单元测试。
//
// 前置条件：
//  1. Docker 已安装并运行
//  2. 镜像已预先构建：docker build -t arthas-server .
//
// 运行方式：
//
//	go test -tags=integration ./cmd/server/ -run TestDockerImageSize
//
// Validates: Requirements 5.1
func TestDockerImageSize(t *testing.T) {
	// 30MB 上限（字节）
	// 📚 学习要点: 命名常量
	// 魔法数字必须定义为命名常量，说明其含义和来源。
	// 30MB 来自 Requirements 5.1: "final image size under 30MB"
	const maxSizeBytes int64 = 30 * 1024 * 1024 // 30MB = 31,457,280 bytes

	// 使用 docker inspect 获取精确的镜像大小（字节）
	// 📚 学习要点: docker inspect --format
	// Docker 的 Go 模板语法可以精确提取镜像元数据。
	// {{.Size}} 返回镜像的虚拟大小（字节），是精确的数值，
	// 比 `docker images --format "{{.Size}}"` 返回的人类可读格式（如 "15.2MB"）更易解析。
	cmd := exec.Command("docker", "inspect", "--format", "{{.Size}}", "arthas-server")
	output, err := cmd.Output()
	if err != nil {
		// 📚 学习要点: t.Skip vs t.Fatal
		// t.Skip 标记测试为「跳过」而非「失败」。
		// 当外部依赖不可用时（Docker 未安装、镜像未构建），
		// 跳过比失败更合理——这不是代码 bug，而是环境未就绪。
		t.Skipf("skipping: docker inspect failed (image may not be built): %v", err)
	}

	// 解析镜像大小
	sizeStr := strings.TrimSpace(string(output))
	size, err := strconv.ParseInt(sizeStr, 10, 64)
	if err != nil {
		t.Fatalf("failed to parse image size %q: %v", sizeStr, err)
	}

	// 断言镜像大小在限制范围内
	sizeMB := float64(size) / (1024 * 1024)
	if size > maxSizeBytes {
		t.Errorf("Docker image size %d bytes (%.1f MB) exceeds limit of 30MB",
			size, sizeMB)
	} else {
		t.Logf("Docker image size: %d bytes (%.1f MB) — within 30MB limit",
			size, sizeMB)
	}
}
