# ============================================================================
# Arthas Server — Production Dockerfile (Multi-stage Build)
# ============================================================================
#
# 📚 学习要点: 多阶段构建 (Multi-stage Build)
# Docker 多阶段构建将「编译环境」和「运行环境」分离：
# - builder 阶段：包含 Go 编译器、源码、依赖（~800MB）
# - 运行阶段：只包含编译后的二进制文件 + 最小 Alpine 系统（~15MB）
# 最终镜像不包含编译工具链，大幅减小体积并减少攻击面。
#
# 📚 学习要点: ldflags 用于二进制瘦身和版本注入
# -s: 去除符号表（symbol table），减小二进制体积约 20%
# -w: 去除 DWARF 调试信息，进一步减小体积约 10%
# -X main.Version=${VERSION}: 在编译时将版本号注入到 main 包的 Version 变量
# 组合使用可将二进制从 ~12MB 减小到 ~8MB
#
# 📚 学习要点: 非 root 用户 (Security Best Practice)
# 生产容器不应以 root 运行，遵循最小权限原则（Principle of Least Privilege）。
# 如果进程被攻破，攻击者只能获得受限用户权限，无法修改系统文件或安装后门。
# UID 1000 是 HF Spaces 的默认用户 ID，确保平台兼容性。
#
# 📚 学习要点: HEALTHCHECK 指令
# Docker HEALTHCHECK 让容器编排器（Docker Compose、Kubernetes、HF Spaces）
# 自动检测容器是否健康。如果健康检查连续失败，编排器会自动重启容器。
# 使用 BusyBox wget（Alpine 默认包含），无需安装额外工具。
# ============================================================================

# ─── Stage 1: Builder ────────────────────────────────────────────────────────
# 编译 Go 源码为静态链接的 Linux 二进制文件
FROM golang:1.22-alpine AS builder

WORKDIR /app

# 先复制依赖文件，利用 Docker 层缓存
# 📚 学习要点: Docker 层缓存优化
# go.mod/go.sum 变化频率远低于源码。将 `go mod download` 单独作为一层，
# 只要依赖不变，后续构建可以跳过下载步骤（命中缓存），大幅加速构建。
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# VERSION 构建参数，可在 docker build 时通过 --build-arg VERSION=v1.2.3 覆盖
ARG VERSION=1.0.0

# 编译：静态链接 + 瘦身 + 版本注入
# CGO_ENABLED=0: 禁用 CGO，生成纯静态二进制（不依赖 glibc）
# GOOS=linux: 目标操作系统为 Linux
# -ldflags "-s -w": 去除符号表和调试信息，减小二进制体积
# -X main.Version=${VERSION}: 编译时注入版本号到 main.Version 变量
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-s -w -X main.Version=${VERSION}" \
    -o server ./cmd/server

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
# 最小化运行环境：Alpine Linux + 编译后的二进制
FROM alpine:latest

# ca-certificates: 支持 HTTPS 出站请求（如果未来需要调用外部 API）
RUN apk --no-cache add ca-certificates

# 创建非 root 用户（安全最佳实践）
# -D: 不设置密码（无法通过密码登录）
# -u 1000: 指定 UID 为 1000（HF Spaces 平台兼容性要求）
RUN adduser -D -u 1000 appuser

# 工作目录设为用户主目录
WORKDIR /home/appuser

# 从 builder 阶段复制编译好的二进制文件
COPY --from=builder /app/server .

# 确保 appuser 拥有二进制文件的所有权
RUN chown appuser:appuser ./server

# 切换到非 root 用户运行
USER appuser

# 声明容器监听端口（文档性质，不实际开放端口）
EXPOSE 7860

# 设置默认端口环境变量（应用读取 PORT 环境变量）
ENV PORT=7860

# 容器健康检查：每 30 秒检查一次 /ping 端点
# --interval=30s: 检查间隔
# --timeout=3s: 单次检查超时时间
# wget -qO-: 静默模式，输出到 stdout（BusyBox wget，Alpine 默认包含）
# || exit 1: 如果 wget 失败（非 200 响应或超时），返回不健康状态
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -qO- http://localhost:7860/ping || exit 1

# 启动服务器
CMD ["./server"]
