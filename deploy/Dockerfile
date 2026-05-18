# ============================================================================
# Arthas Self-Hosted — Three-Stage Dockerfile
# ============================================================================
#
# 📚 学习要点: 三阶段构建的设计动机
# 自托管模式下，Go 二进制通过 embed 包嵌入前端 dist/ 文件。
# 这意味着 Docker 构建需要三个阶段：
#   Stage 1 (frontend): Node.js 构建前端 → 产出 dist/
#   Stage 2 (builder):  Go 编译器将 dist/ 嵌入二进制 → 产出单一可执行文件
#   Stage 3 (runtime):  最小化 Alpine 镜像 + 二进制 → 最终镜像 < 30MB
#
# 每个阶段只保留下一阶段需要的产物，最终镜像不包含 Node.js、Go 编译器、
# 源码或 node_modules，大幅减小体积并减少攻击面。
#
# 📚 学习要点: 与 arthas-server/Dockerfile 的区别
# 项目中存在两个 Dockerfile，服务不同的部署场景：
#   - arthas-server/Dockerfile: HF Spaces 部署，端口 7860，不含前端
#   - deploy/Dockerfile (本文件): 自托管部署，端口 8080，嵌入前端
# 两者互不影响，共存于同一仓库中。
#
# 📚 学习要点: Build Args — VERSION 和 TARGETARCH
# VERSION: 通过 --build-arg 或 CI/CD 注入版本号（如 v1.2.3）
# TARGETARCH: Docker Buildx 自动注入目标架构（amd64 或 arm64）
#   - 构建 linux/amd64 时 TARGETARCH=amd64
#   - 构建 linux/arm64 时 TARGETARCH=arm64
# 这使得同一 Dockerfile 可以构建多架构镜像（覆盖 x86 服务器和 Raspberry Pi）
# ============================================================================

# ─── Stage 1: Frontend Build ─────────────────────────────────────────────────
# 使用 Node.js 构建 React 前端，产出优化后的 dist/ 静态文件
#
# 📚 学习要点: 为什么选择 node:20-alpine？
# - Node 20 是当前 LTS 版本，与项目 package.json 的 engines 兼容
# - Alpine 变体体积仅 ~50MB（vs 完整版 ~350MB），加速 CI 拉取
# - 此阶段的产物只有 dist/ 目录，Node.js 本身不会进入最终镜像
#
# 📚 学习要点: 不设置 VITE_WS_URL 的原因
# 自托管模式下，前端使用相对 WebSocket URL（wss://${location.host}/ws）。
# 这是通过 getDefaultWsUrl() 函数实现的：当 VITE_WS_URL 未设置时，
# 自动从 window.location 推导 WebSocket 地址。
# 因此构建时不注入 VITE_WS_URL，使同一镜像可部署在任何域名上。
FROM node:20-alpine AS frontend

WORKDIR /app/client

# 📚 学习要点: 分层复制 — 依赖文件优先
# 先复制 package.json 和 lock 文件，再执行 npm ci。
# 只要这两个文件不变，Docker 层缓存命中，跳过 npm ci（节省 30-60 秒）。
# 源码变化频率远高于依赖变化，这种分层策略最大化缓存利用率。
COPY arthas-client/package.json arthas-client/package-lock.json ./
RUN npm ci --ignore-scripts

COPY arthas-client/ ./

# 构建前端（不设置 VITE_WS_URL，使用相对 URL 模式）
RUN npm run build

# ─── Stage 2: Go Build with Embedded Frontend ────────────────────────────────
# 将 Stage 1 产出的 dist/ 复制到 Go embed 目标位置，编译为静态链接二进制
#
# 📚 学习要点: 为什么选择 golang:1.22-alpine？
# - Go 1.22 与项目 go.mod 中声明的版本一致
# - Alpine 变体减小基础镜像体积（此阶段也不进入最终镜像）
# - CGO_ENABLED=0 确保纯静态编译，不依赖 Alpine 的 musl libc
FROM golang:1.22-alpine AS builder

WORKDIR /app/server

# 📚 学习要点: Go 依赖缓存优化
# 与 npm ci 类似，先复制 go.mod/go.sum 并下载依赖。
# Go module 缓存在 /go/pkg/mod，只要 go.mod 不变就命中缓存。
COPY arthas-server/go.mod arthas-server/go.sum ./
RUN go mod download

COPY arthas-server/ ./

# 📚 学习要点: COPY --from 跨阶段复制
# 从 Stage 1 (frontend) 复制构建产物到 Go 项目的 embed 目标目录。
# internal/static/dist/ 是 static_prod.go 中 //go:embed dist 指令的目标路径。
# 这个目录必须存在且包含文件，否则 go build 会报错：
#   "pattern dist: no matching files found"
COPY --from=frontend /app/client/dist ./internal/static/dist/

# 📚 学习要点: ARG 指令的作用域
# ARG 声明构建参数，可通过 docker build --build-arg 覆盖。
# VERSION 默认为 "latest"，CI/CD 中通常注入 git tag（如 v1.2.3）。
# TARGETARCH 由 Docker Buildx 自动注入，无需手动指定。
ARG VERSION=latest
ARG TARGETARCH

# 📚 学习要点: 静态编译与交叉编译
# CGO_ENABLED=0: 禁用 CGO，生成纯静态二进制（不依赖任何 C 库）
# GOOS=linux: 目标操作系统（容器始终是 Linux）
# GOARCH=${TARGETARCH}: 目标 CPU 架构（由 buildx 注入 amd64 或 arm64）
#
# -ldflags 参数说明：
#   -s: 去除符号表（减小二进制约 20%）
#   -w: 去除 DWARF 调试信息（再减小约 10%）
#   -X main.Version=${VERSION}: 编译时注入版本号到 main.Version 变量
#
# 最终二进制约 8-10MB，包含完整的前端静态文件和 WebSocket 服务器。
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build \
    -ldflags "-s -w -X main.Version=${VERSION}" \
    -o server ./cmd/server

# ─── Stage 3: Minimal Runtime ────────────────────────────────────────────────
# 最小化运行环境：仅包含 Alpine 基础系统 + 编译后的二进制
#
# 📚 学习要点: 为什么选择 alpine:3.23？
# - Alpine 基础镜像仅 ~5MB，加上二进制后总镜像 < 30MB
# - 包含 BusyBox（提供 wget 用于 HEALTHCHECK）
# - 不包含编译器、包管理器等不必要的工具（减少攻击面）
# - 固定版本号（3.23）确保构建可重现
#
# 📚 学习要点: 安全最佳实践 — 非 root 用户
# 生产容器不应以 root 运行（最小权限原则）。
# 如果进程被攻破，攻击者只能获得受限用户权限：
#   - 无法修改系统文件（/etc/passwd 等）
#   - 无法安装后门软件
#   - 无法访问其他用户的文件
# UID 1000 是 Linux 系统中第一个普通用户的标准 UID。
FROM alpine:3.23

# 创建非 root 用户
# -D: 不设置密码（无法通过密码登录容器）
# -u 1000: 指定 UID（与宿主机文件权限兼容）
RUN adduser -D -u 1000 appuser

WORKDIR /home/appuser

# 从 builder 阶段复制编译好的二进制
COPY --from=builder /app/server/server .

# 确保 appuser 拥有二进制文件的执行权限
RUN chown appuser:appuser ./server

# 切换到非 root 用户运行（此后所有操作以 appuser 身份执行）
USER appuser

# 📚 学习要点: EXPOSE 指令的文档性质
# EXPOSE 不实际开放端口，它是一种文档声明：
# "这个容器内的进程监听 8080 端口"
# 实际端口映射由 docker-compose.yml 或 docker run -p 控制。
# 在自托管架构中，8080 仅暴露给 Docker 内部网络（Caddy 反向代理访问）。
EXPOSE 8080

# 设置默认端口环境变量（Go 服务器读取 PORT 环境变量）
ENV PORT=8080

# 📚 学习要点: HEALTHCHECK 指令
# Docker 健康检查让编排器自动检测容器是否正常运行。
# --interval=30s: 每 30 秒检查一次
# --timeout=3s: 单次检查超时时间（超时视为失败）
# 连续 3 次失败后容器标记为 unhealthy，配合 restart: unless-stopped 自动重启。
#
# 使用 BusyBox wget（Alpine 默认包含），无需安装 curl 等额外工具。
# /ping 端点返回 "pong"（HTTP 200），任何非 200 响应触发 exit 1（不健康）。
HEALTHCHECK --interval=30s --timeout=3s \
    CMD wget -qO- http://localhost:8080/ping || exit 1

# 启动服务器
CMD ["./server"]
