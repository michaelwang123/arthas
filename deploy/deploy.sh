#!/usr/bin/env bash
# ============================================================================
# Arthas Self-Hosted — One-Command Deploy Script
# ============================================================================
# 📚 学习要点: Bash 严格模式（Strict Mode）
# set -e: 任何命令返回非零退出码时立即终止脚本（fail-fast）
# set -u: 引用未定义变量时报错（防止拼写错误导致空值）
# set -o pipefail: 管道中任何命令失败时，整个管道返回失败
# 这三个选项组合是 Shell 脚本的最佳实践，等同于其他语言的严格类型检查。
# 没有它们，脚本会在错误发生后继续执行，可能造成不可预测的状态。
set -euo pipefail

# 📚 学习要点: 脚本目录定位
# $0 是脚本自身的路径，dirname 提取目录部分。
# cd 到脚本所在目录确保相对路径（如 docker-compose.yml、.env）始终正确。
# 无论用户从哪个目录调用脚本（如 ~/projects/arthas/deploy.sh 或 ./deploy.sh），
# docker compose 都能找到同目录下的 docker-compose.yml 和 .env 文件。
cd "$(dirname "$0")"

# ============================================================================
# 颜色和格式化输出
# ============================================================================
# 📚 学习要点: ANSI 转义序列
# \033[Xm 是终端颜色控制码，用于提升用户体验：
# - 绿色表示成功/通过
# - 红色表示错误/失败
# - 黄色表示警告/需要注意
# - 蓝色表示信息/提示
# \033[0m 重置所有格式，防止颜色"泄漏"到后续输出。
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 格式化输出函数
info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[⚠]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; }

# ============================================================================
# 前置条件检查（Prerequisite Checks）
# ============================================================================

# 📚 学习要点: 函数封装检查逻辑
# 将每个检查封装为独立函数，便于：
# 1. 单独测试每个检查
# 2. 清晰的错误信息（用户知道哪一步失败）
# 3. 未来扩展新的检查项

check_docker() {
    # 📚 学习要点: command -v 检查命令是否存在
    # 比 which 更可靠：which 在某些系统上是外部命令，可能不存在。
    # command -v 是 POSIX 标准的 shell 内建命令，所有 Bash 版本都支持。
    if ! command -v docker &>/dev/null; then
        error "未找到 docker 命令"
        echo "  请安装 Docker: https://docs.docker.com/get-docker/"
        exit 1
    fi
    ok "Docker 已安装"

    # 📚 学习要点: 检查 Docker daemon 是否运行
    # docker 命令存在不代表 daemon 在运行。
    # docker info 会尝试连接 daemon，失败说明 daemon 未启动。
    # 常见原因：Docker Desktop 未启动、systemd 服务未 enable。
    if ! docker info &>/dev/null; then
        error "Docker daemon 未运行"
        echo "  请启动 Docker:"
        echo "    Linux:  sudo systemctl start docker"
        echo "    macOS:  打开 Docker Desktop 应用"
        exit 1
    fi
    ok "Docker daemon 运行中"
}

check_compose() {
    # 📚 学习要点: Docker Compose v2 vs v1
    # v1: 独立的 docker-compose 二进制（Python 实现，已废弃）
    # v2: docker CLI 插件（Go 实现，命令为 docker compose）
    # 本脚本要求 v2，因为：
    # 1. v1 已于 2023 年 EOL（End of Life）
    # 2. v2 性能更好（Go vs Python）
    # 3. v2 支持 depends_on.condition: service_healthy
    if ! docker compose version &>/dev/null; then
        error "未找到 docker compose v2 插件"
        echo "  本脚本需要 Docker Compose v2（docker compose 命令，非 docker-compose）"
        echo "  安装指南: https://docs.docker.com/compose/install/"
        if command -v docker-compose &>/dev/null; then
            warn "检测到旧版 docker-compose (v1)，请升级到 v2"
        fi
        exit 1
    fi

    # 验证版本号以 2 开头
    local compose_version
    compose_version=$(docker compose version --short 2>/dev/null || echo "unknown")
    if [[ "$compose_version" != 2* ]]; then
        error "需要 Docker Compose v2，当前版本: $compose_version"
        exit 1
    fi
    ok "Docker Compose v2 ($compose_version)"
}

check_ports() {
    # 📚 学习要点: 平台感知的端口检测
    # 不同操作系统使用不同的网络工具：
    # - Linux: ss（iproute2 套件，现代替代 netstat）
    # - macOS: lsof（list open files，macOS 自带）
    # - 其他: 跳过检查并警告（不阻塞部署）
    # 这种 fallback 策略确保脚本在各种环境下都能运行。
    local port=$1
    local in_use=false

    case "$(uname -s)" in
        Linux)
            # 📚 学习要点: ss 命令解析
            # -t: 仅显示 TCP 连接
            # -l: 仅显示 LISTEN 状态（监听中的端口）
            # -n: 不解析服务名（显示端口号而非 http/https）
            # -p: 显示进程信息（哪个程序占用了端口）
            # grep ':80 ' 中的空格防止匹配 :8080 等端口
            if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
                in_use=true
            fi
            ;;
        Darwin)
            # 📚 学习要点: macOS lsof 端口检测
            # -i :PORT: 筛选指定端口的网络连接
            # -sTCP:LISTEN: 仅匹配 TCP LISTEN 状态
            # macOS 没有 ss 命令，lsof 是最可靠的替代方案。
            if lsof -i ":${port}" -sTCP:LISTEN &>/dev/null; then
                in_use=true
            fi
            ;;
        *)
            # 📚 学习要点: 优雅降级（Graceful Degradation）
            # 无法检测端口时不阻塞部署，而是发出警告。
            # 用户可能在 Windows WSL、FreeBSD 等环境运行。
            # 如果端口确实被占用，docker compose up 会报错，用户仍能诊断问题。
            warn "无法检测端口 ${port} 状态（不支持的操作系统: $(uname -s)）"
            return 0
            ;;
    esac

    if [ "$in_use" = true ]; then
        error "端口 ${port} 已被占用"
        echo "  请停止占用该端口的服务，或使用 --local 模式（仅需端口 80）"
        case "$(uname -s)" in
            Linux)
                echo "  查看占用进程: ss -tlnp | grep ':${port} '"
                ;;
            Darwin)
                echo "  查看占用进程: lsof -i :${port} -sTCP:LISTEN"
                ;;
        esac
        return 1
    fi
    return 0
}

check_port_availability() {
    # 📚 学习要点: 端口冲突是部署失败的最常见原因
    # 80 端口常被 Apache/Nginx 占用，443 被其他 HTTPS 服务占用。
    # 提前检测并给出明确的诊断命令，比 docker compose up 失败后再排查高效得多。
    local failed=false

    if ! check_ports 80; then
        failed=true
    fi
    if ! check_ports 443; then
        failed=true
    fi

    if [ "$failed" = true ]; then
        exit 1
    fi
    ok "端口 80/443 可用"
}

# ============================================================================
# 交互式配置（Interactive Configuration）
# ============================================================================

prompt_configuration() {
    # 📚 学习要点: 交互式配置的设计原则
    # 1. 仅在 .env 不存在时触发（幂等性：重复运行不会覆盖已有配置）
    # 2. 提供合理的默认值减少用户输入
    # 3. 验证关键输入（域名格式、邮箱格式）
    # 4. 生成完整的 .env 文件，后续运行直接使用

    info "首次部署，开始交互式配置..."
    echo ""

    # --- 域名配置 ---
    echo -e "${BLUE}域名配置${NC}"
    echo "  公网部署: 输入你的域名（如 chat.example.com）"
    echo "  本地测试: 输入 localhost"
    echo ""
    read -rp "请输入域名 [localhost]: " input_domain
    local domain="${input_domain:-localhost}"

    # --- 邮箱配置（仅公网模式需要）---
    local email=""
    if [ "$domain" != "localhost" ]; then
        echo ""
        echo -e "${BLUE}邮箱配置${NC}"
        echo "  用于 Let's Encrypt 证书注册和到期提醒"
        echo ""
        read -rp "请输入邮箱: " email
        # 📚 学习要点: 基本邮箱格式验证
        # 使用简单的 @ 符号检查，不做复杂的 RFC 5322 验证。
        # 过于严格的验证可能拒绝合法邮箱（如含 + 号的 Gmail 地址）。
        if [[ ! "$email" =~ .+@.+\..+ ]]; then
            error "邮箱格式无效: $email"
            exit 1
        fi
    fi

    # --- GitHub Owner 配置 ---
    echo ""
    echo -e "${BLUE}镜像仓库配置${NC}"
    echo "  Docker 镜像地址: ghcr.io/{GITHUB_OWNER}/arthas"
    echo "  填写发布镜像的 GitHub 用户名或组织名"
    echo ""
    read -rp "请输入 GitHub 用户名/组织名: " input_owner
    if [ -z "$input_owner" ]; then
        error "GITHUB_OWNER 不能为空"
        exit 1
    fi
    local github_owner="$input_owner"

    # --- 生成 .env 文件 ---
    generate_env_file "$domain" "$email" "$github_owner"

    # --- 生成 Caddyfile ---
    generate_caddyfile "$domain"

    ok "配置完成！"
    echo ""
}

# ============================================================================
# 文件生成（File Generation）
# ============================================================================

generate_env_file() {
    # 📚 学习要点: .env 文件生成策略
    # 使用 cat heredoc 生成完整的 .env 文件，包含注释说明。
    # 这比逐行 echo 更清晰，也比 sed 替换模板更可靠。
    local domain="$1"
    local email="$2"
    local github_owner="$3"

    # 确定 ALLOWED_ORIGINS
    local allowed_origins
    if [ "$domain" = "localhost" ]; then
        allowed_origins="*"
    else
        allowed_origins="https://${domain}"
    fi

    cat > .env << EOF
# --- Arthas Self-Hosted Configuration ---
# 由 deploy.sh 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')

# 域名
DOMAIN=${domain}

# Let's Encrypt 邮箱
EMAIL=${email}

# Docker 镜像版本
ARTHAS_VERSION=latest

# GitHub 用户名/组织名（镜像仓库前缀）
GITHUB_OWNER=${github_owner}

# WebSocket 允许的来源
ALLOWED_ORIGINS=${allowed_origins}
EOF

    ok "已生成 .env 配置文件"
}

generate_caddyfile() {
    # 📚 学习要点: 模式感知的 Caddyfile 生成
    # 根据 DOMAIN 值生成不同的 Caddyfile：
    # - localhost → :80 格式（纯 HTTP，不触发 Caddy 自动 HTTPS）
    # - 真实域名 → {$DOMAIN} 格式（自动 HTTPS + Let's Encrypt）
    # 这是 deploy.sh 的核心智能：用户只需输入域名，脚本处理所有配置差异。
    local domain="$1"

    if [ "$domain" = "localhost" ]; then
        # 📚 学习要点: localhost 模式使用 :80
        # Caddy 对 "localhost" 站点地址会自动生成本地 CA 证书（HTTPS）。
        # 使用 ":80" 明确告诉 Caddy 只监听 HTTP，不启用任何 TLS。
        cat > Caddyfile << 'EOF'
# Arthas Self-Hosted — Localhost Mode (HTTP-only)
# 由 deploy.sh 自动生成

:80 {
    reverse_proxy backend:8080

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy no-referrer
        -Server
    }
}
EOF
    else
        # 📚 学习要点: 生产模式使用 {$DOMAIN}
        # {$DOMAIN} 和 {$EMAIL} 是 Caddy 环境变量语法。
        # Docker Compose 通过 environment 字段将 .env 值传递给 Caddy 容器进程。
        cat > Caddyfile << 'EOF'
# Arthas Self-Hosted — Production Mode (HTTPS)
# 由 deploy.sh 自动生成

{
    email {$EMAIL}
}

{$DOMAIN} {
    reverse_proxy backend:8080

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy no-referrer
        -Server
    }
}
EOF
    fi

    ok "已生成 Caddyfile ($( [ "$domain" = "localhost" ] && echo "HTTP 模式" || echo "HTTPS 模式" ))"
}

generate_localhost_override() {
    # 📚 学习要点: Docker Compose Override 文件
    # docker compose 自动合并 docker-compose.yml 和 docker-compose.override.yml。
    # localhost 模式不需要 443 端口（没有 HTTPS），只暴露 80。
    # 使用 override 而非修改主文件，保持主文件的通用性。
    cat > docker-compose.override.yml << 'EOF'
# Arthas Self-Hosted — Localhost Override
# 由 deploy.sh --local 自动生成
# localhost 模式不需要 HTTPS，仅暴露端口 80
services:
  caddy:
    ports:
      - "80:80"
EOF
    ok "已生成 docker-compose.override.yml (仅端口 80)"
}

# ============================================================================
# 部署执行（Deploy Execution）
# ============================================================================

deploy() {
    # 📚 学习要点: 部署流程编排
    # 默认行为（无参数）执行完整部署流程：
    # 1. 前置检查 → 2. 配置生成 → 3. 启动服务 → 4. 显示访问信息
    # 每一步失败都会立即终止（set -e），避免在错误状态下继续。

    info "=== Arthas 自托管部署 ==="
    echo ""

    # Step 1: 前置条件检查
    info "检查前置条件..."
    check_docker
    check_compose
    check_port_availability
    echo ""

    # Step 2: 配置（仅首次）
    if [ ! -f .env ]; then
        prompt_configuration
    else
        ok "使用已有配置 (.env)"
        # 📚 学习要点: 幂等性保证
        # .env 已存在时不重新生成 Caddyfile，避免覆盖用户自定义修改。
        # 如果用户想重新配置，使用 --reconfigure 标志。
        if [ ! -f Caddyfile ]; then
            # .env 存在但 Caddyfile 不存在（可能被手动删除），重新生成
            # shellcheck source=/dev/null
            source .env
            generate_caddyfile "${DOMAIN}"
        fi
    fi

    # Step 3: 启动服务
    echo ""
    info "启动 Docker Compose 服务..."
    docker compose up -d
    echo ""

    # Step 4: 显示访问信息
    # shellcheck source=/dev/null
    source .env
    ok "部署完成！"
    echo ""
    if [ "${DOMAIN}" = "localhost" ]; then
        echo -e "  访问地址: ${GREEN}http://localhost${NC}"
    else
        echo -e "  访问地址: ${GREEN}https://${DOMAIN}${NC}"
    fi
    echo ""
    echo "  常用命令:"
    echo "    ./deploy.sh --status   查看服务状态"
    echo "    ./deploy.sh --logs     查看日志"
    echo "    ./deploy.sh --down     停止服务"
    echo "    ./deploy.sh --upgrade  升级到最新版本"
    echo ""
}

# ============================================================================
# 主入口（Main Entry Point）
# ============================================================================
# 📚 学习要点: 脚本参数解析
# 使用 ${1:-} 安全地获取第一个参数（set -u 下未传参不会报错）。
# 当前版本仅实现默认部署流程（无参数）。
# Task 6.2 将添加 --down, --status, --upgrade, --logs, --local, --reconfigure 子命令。

main() {
    local cmd="${1:-}"

    case "$cmd" in
        "")
            deploy
            ;;
        --local)
            # 📚 学习要点: --local 快捷模式
            # 自动设置 localhost 配置，跳过交互式提示。
            # 适用于本地开发测试，一键启动 HTTP-only 实例。
            info "=== Arthas 本地模式部署 ==="
            echo ""
            info "检查前置条件..."
            check_docker
            check_compose
            # localhost 模式只需要端口 80
            check_ports 80 || exit 1
            ok "端口 80 可用"
            echo ""

            if [ ! -f .env ]; then
                # 本地模式需要 GITHUB_OWNER
                echo -e "${BLUE}镜像仓库配置${NC}"
                echo "  Docker 镜像地址: ghcr.io/{GITHUB_OWNER}/arthas"
                echo ""
                read -rp "请输入 GitHub 用户名/组织名: " input_owner
                if [ -z "${input_owner:-}" ]; then
                    error "GITHUB_OWNER 不能为空"
                    exit 1
                fi
                generate_env_file "localhost" "" "$input_owner"
            else
                ok "使用已有配置 (.env)"
            fi

            generate_caddyfile "localhost"
            generate_localhost_override
            echo ""

            info "启动 Docker Compose 服务 (本地模式)..."
            docker compose up -d
            echo ""

            ok "本地部署完成！"
            echo ""
            echo -e "  访问地址: ${GREEN}http://localhost${NC}"
            echo ""
            echo "  常用命令:"
            echo "    ./deploy.sh --status   查看服务状态"
            echo "    ./deploy.sh --logs     查看日志"
            echo "    ./deploy.sh --down     停止服务"
            echo ""
            ;;
        --down)
            info "停止并移除容器..."
            docker compose down
            ok "服务已停止"
            ;;
        --status)
            info "服务状态:"
            docker compose ps
            ;;
        --upgrade)
            info "拉取最新镜像并重启..."
            docker compose pull
            docker compose up -d
            ok "升级完成"
            ;;
        --logs)
            docker compose logs --tail=50
            ;;
        --reconfigure)
            # 📚 学习要点: 重新配置流程
            # 删除所有生成的配置文件，重新进入交互式设置。
            # 不影响运行中的容器——用户需先 --down 再 --reconfigure。
            warn "将删除现有配置并重新设置"
            rm -f .env Caddyfile docker-compose.override.yml
            ok "配置已清除，请重新运行 ./deploy.sh 进行配置"
            ;;
        --help|-h)
            echo "用法: ./deploy.sh [选项]"
            echo ""
            echo "选项:"
            echo "  (无)            完整部署流程（检查 → 配置 → 启动）"
            echo "  --local         本地模式部署（HTTP-only, localhost）"
            echo "  --down          停止并移除所有容器"
            echo "  --status        显示服务健康状态"
            echo "  --upgrade       拉取最新镜像并重启"
            echo "  --logs          查看最近 50 行日志"
            echo "  --reconfigure   清除配置，重新交互式设置"
            echo "  --help, -h      显示此帮助信息"
            ;;
        *)
            error "未知选项: $cmd"
            echo "  使用 ./deploy.sh --help 查看可用选项"
            exit 1
            ;;
    esac
}

main "$@"
