# Requirements Document

## Introduction

本文档定义 Arthas E2EE 聊天室 Phase 4 上线验证的**代码需求**。目标是完成将系统部署到公网所需的所有代码变更和配置文件，使真实用户可以通过浏览器（桌面和移动端）进行端到端加密聊天。

部署架构：前端静态资源托管于 Vercel（HTTPS），后端 Docker 容器部署于容器平台（HF Spaces / Railway / Fly.io），通过 WSS 进行安全通信。

**范围说明：** 本文档聚焦于需要编写代码或创建配置文件的需求。平台操作步骤（如 Vercel 部署、cron-job 配置）列于附录 A，上线验证步骤列于附录 B。

## Glossary

- **Backend_Server**: Go 1.22 编写的 WebSocket 中继服务器，纯转发设计（zero-knowledge），监听 `PORT` 环境变量指定的端口
- **Frontend_App**: React + Vite 构建的单页应用，构建产物为 `dist/` 目录下的静态文件
- **Health_Check_Endpoint**: Backend_Server 提供的 HTTP GET `/ping` 端点，用于监控和保活
- **Container_Platform**: 运行 Backend_Server Docker 容器的云平台（HF Spaces、Railway 或 Fly.io）
- **Static_Hosting**: 托管 Frontend_App 构建产物的静态网站服务（Vercel）
- **ALLOWED_ORIGINS**: 环境变量，逗号分隔的允许连接的前端域名列表

---

## Requirements

### Requirement 1: 健康检查与优雅关闭

**User Story:** As a 运维人员, I want Backend_Server 提供健康检查端点并支持优雅关闭, so that 外部保活服务可以验证存活状态，且容器重启时不会丢失正在进行的连接。

#### Acceptance Criteria

1. WHEN an HTTP GET request is sent to `/ping`, THE Backend_Server SHALL respond with HTTP status code 200 and plain text body `"pong"`, within 100ms under normal operating conditions
2. THE `/ping` endpoint SHALL be served on the same port and HTTP handler as the WebSocket `/ws` endpoint, without requiring authentication
3. WHEN the Backend_Server process receives a SIGTERM signal, THE server SHALL stop accepting new WebSocket connections immediately
4. WHEN the Backend_Server process receives a SIGTERM signal, THE server SHALL wait up to 5 seconds for existing WebSocket connections to close gracefully (or exit immediately once all connections have closed before the timeout expires), THEN exit with code 0
5. WHEN the Backend_Server starts successfully, THE server SHALL log a startup message to stdout containing: listening port, server version string, and RFC 3339 timestamp

### Requirement 2: 生产环境配置

**User Story:** As a 开发者, I want 通过环境变量和配置文件管理生产环境, so that 同一份代码可以在开发和生产环境中运行而无需修改源码。

#### Acceptance Criteria

1. THE Backend_Server SHALL read the `PORT` environment variable to determine the listening port; WHEN `PORT` is unset, THE server SHALL default to port 8080
2. THE Backend_Server SHALL read the `ALLOWED_ORIGINS` environment variable (逗号分隔的域名列表) for CORS 控制; WHEN unset, THE server SHALL allow all origins
3. THE Frontend_App SHALL read the `VITE_WS_URL` environment variable at build time to determine the WebSocket server address; WHEN unset, THE app SHALL default to `ws://localhost:8080/ws`
4. THE project SHALL include a `arthas-client/vercel.json` file that configures: (a) SPA fallback — all routes rewrite to `/index.html`; (b) cache headers — hashed static assets (JS/CSS) with `immutable, max-age=31536000`
5. THE project SHALL include a `arthas-client/.env.production.example` file documenting the required production environment variable (`VITE_WS_URL=wss://your-backend-domain/ws`), with a README note that the actual value should be set as a Vercel Environment Variable (not committed to git)

### Requirement 3: CORS 与 Origin 控制

**User Story:** As a 安全工程师, I want Backend_Server 在生产环境限制 WebSocket 连接来源, so that 只有授权的前端域名可以建立 WebSocket 连接。

#### Acceptance Criteria

1. WHEN the `ALLOWED_ORIGINS` environment variable is set (非空), THE Backend_Server SHALL validate the `Origin` header of every WebSocket upgrade request against the allowed list
2. IF a WebSocket upgrade request arrives with an Origin not in the `ALLOWED_ORIGINS` list, THEN THE Backend_Server SHALL reject the connection with HTTP status 403 and log a warning containing the rejected origin
3. WHEN the `ALLOWED_ORIGINS` environment variable is empty or unset, THE Backend_Server SHALL accept WebSocket connections from all origins (开发模式行为，向后兼容)
4. THE `ALLOWED_ORIGINS` value SHALL support multiple domains separated by commas (e.g., `https://arthas.vercel.app,https://arthas.dev`), with leading/trailing whitespace trimmed per entry

### Requirement 4: 结构化日志

**User Story:** As a 运维人员, I want Backend_Server 输出结构化日志, so that 生产环境中可以快速定位问题并确认服务状态。

#### Acceptance Criteria

1. WHEN the Backend_Server logs any event, THE log entry SHALL include: timestamp in RFC 3339 format (e.g., `2026-05-13T14:30:00+08:00`), log level (INFO/WARN/ERROR), and human-readable message
2. WHEN a client connects or disconnects, THE Backend_Server SHALL log an INFO entry containing the client ID and current total connection count
3. WHEN a room is created or destroyed, THE Backend_Server SHALL log an INFO entry containing the room ID and current total room count
4. WHEN an error occurs (CORS rejection, message parse failure, rate limit), THE Backend_Server SHALL log a WARN entry containing the client ID and error description
5. THE Backend_Server SHALL NOT log any message content (iv, ciphertext) at any log level — this is a security invariant of the zero-knowledge design
6. THE Backend_Server SHALL include a `VERSION` constant (e.g., `"1.0.0"`) that is logged at startup and can be used to verify deployed version; this value SHALL be overridable at build time via Go linker flags (`-ldflags "-X main.Version=..."`) for CI/CD integration

### Requirement 5: 部署产物与可移植性

**User Story:** As a 开发者, I want 确保部署产物（Docker 镜像和前端构建）可以在任何支持的平台上运行, so that 平台迁移只需更改环境变量。

#### Acceptance Criteria

1. THE Backend_Server Dockerfile SHALL produce a multi-stage build: Go 1.22 Alpine builder → Alpine runtime, with final image size under 30MB
2. THE Backend_Server Dockerfile SHALL expose port 7860 and set `ENV PORT=7860` as default
3. WHEN `npm run build` is executed in `arthas-client/`, THE build SHALL produce a complete static site in `dist/` with all assets self-contained (no external CDN dependencies at runtime)
4. THE Backend_Server SHALL be deployable to any platform that supports Docker containers and HTTP/WebSocket proxying, without code changes — only the `PORT` and `ALLOWED_ORIGINS` environment variables need to be set
5. WHEN migrating between Container_Platforms, THE only required Frontend_App change SHALL be updating the `VITE_WS_URL` value and triggering a rebuild

---

## Appendix A: 部署操作指南（非代码步骤）

以下为手动操作步骤，不生成代码任务，供部署时参考：

### A1. Vercel 前端部署

1. 在 Vercel Dashboard 中导入 `arthas-client` 目录
2. 设置 Framework Preset 为 Vite
3. 添加环境变量 `VITE_WS_URL = wss://<backend-domain>/ws`
4. 部署，验证 HTTPS 访问正常

### A2. 后端容器部署 (HF Spaces)

1. 创建 HF Space（Docker 类型）
2. 上传 `arthas-server/` 内容
3. 设置环境变量 `ALLOWED_ORIGINS = https://<frontend-domain>`
4. 等待构建完成，验证 `/ping` 返回 200

### A3. 保活配置 (cron-job.org)

1. 注册 cron-job.org 账号
2. 创建任务：GET `https://<backend-domain>/ping`
3. 间隔：每 10 分钟
4. 超时：30 秒
5. 失败重试：1 次

### A4. 备选平台 (Railway)

如 HF Spaces WebSocket 不稳定（断连 > 3 次/小时）：
1. `railway init` + `railway up` 部署后端
2. 更新 Vercel 环境变量 `VITE_WS_URL` 指向新域名
3. 触发 Vercel 重新部署

---

## Appendix B: 上线验证清单（手动测试）

部署完成后，执行以下验证：

| # | 验证项 | 方法 | 预期结果 |
|---|--------|------|----------|
| 1 | 健康检查 | `curl https://<backend>/ping` | 200 + "pong" |
| 2 | WSS 连接 | 浏览器打开前端，检查 Network 面板 | WebSocket 连接使用 wss:// |
| 3 | 跨网络加密聊天 | 两台不同网络的设备创建/加入房间 | 消息正常加解密 |
| 4 | 服务器日志无明文 | 查看后端日志 | 无任何消息内容出现 |
| 5 | 断线重连 | 手动断开网络 5 秒后恢复 | 自动重连成功 |
| 6 | 房间销毁 | 所有人离开房间 | 使用相同分享码加入返回"房间不存在" |
| 7 | 移动端基本功能 | iOS Safari + Android Chrome | 创建/加入/聊天/离开正常 |
| 8 | CORS 拦截 | 从非授权域名尝试 WebSocket 连接 | 返回 403 |
| 9 | 保活有效 | 等待 30 分钟后访问 | 服务仍然响应 |

---

## 正确性属性 (Correctness Properties)

| ID | 属性 | 验证方式 |
|----|------|----------|
| P1 | `/ping` 端点在服务运行时始终返回 200 | 自动化：HTTP GET 断言 |
| P2 | SIGTERM 后 5 秒内进程退出 | 自动化：发送信号 + 计时 |
| P3 | `ALLOWED_ORIGINS` 设置后，非授权 Origin 被拒绝 | 自动化：伪造 Origin 请求 |
| P4 | 日志中不存在任何 base64url 编码的密文内容 | 代码审查 + grep 日志 |
| P5 | Docker 镜像大小 < 30MB | 自动化：`docker images` 检查 |
| P6 | 前端构建产物无外部运行时依赖 | 自动化：离线打开 dist/index.html |

---

## 技术约束

- 后端不引入新的第三方依赖（使用标准库 `net/http` 的 `Server.Shutdown`）
- 前端不引入新的运行时依赖
- Dockerfile 保持 multi-stage build（构建阶段 + 运行阶段）
- 日志使用标准库 `log` 包（不引入 zap/logrus 等），格式为 `[时间] [级别] [模块] 消息`；时间戳通过 `time.Now().Format(time.RFC3339)` 生成，使用 `log.SetFlags(0)` 禁用默认前缀以实现自定义格式
- `vercel.json` 保持最小化配置
