# Requirements Document: OpenClaw Channel Plugin

## Introduction

Arthas OpenClaw Channel Plugin 是一个 TypeScript/JavaScript 插件，将 Arthas 的端到端加密聊天能力作为 OpenClaw AI Agent 框架的通信通道暴露出来。

通过此插件，OpenClaw 用户可以通过 Arthas 加密房间与 AI Agent 进行零知识通信 — 服务器无法观察用户与 AI 的交互内容，实现"连 AI 对话都是端到端加密的"独特卖点。

## Core Value Proposition

- **唯一的 E2EE AI 通道** — 市面上所有 AI Agent 通道（Telegram、Slack、Discord）都是明文传输，Arthas 是唯一提供端到端加密的选项
- **零知识 AI 交互** — 服务器无法观察用户发给 AI 的指令和 AI 的回复
- **复用现有基础设施** — 复用 Arthas 的 WebSocket + msgpack + AES-256-GCM 加密层
- **自托管友好** — 用户可以同时自托管 Arthas 服务器和 OpenClaw Gateway

## Technical Constraints

1. **OpenClaw Plugin SDK** — 必须遵循 OpenClaw 的 Plugin API 规范（TypeScript 模块，注册 channel adapter）
2. **E2EE 密钥管理** — AI Agent 作为房间参与者，需要持有独立的 AES 密钥（从分享码派生）
3. **WebSocket 客户端** — 插件需要实现 WebSocket 客户端连接到 Arthas 服务器
4. **msgpack 编解码** — 遵循 Arthas 的二进制协议（MessagePack 格式）
5. **无服务器端改动** — Arthas 服务器不需要任何修改，AI Agent 就是一个普通的房间参与者
6. **npm 发布** — 最终以 `@arthas/openclaw-channel` npm 包形式发布
7. **Monorepo 内开发** — 代码位于 Arthas 主仓库 `packages/openclaw-channel/` 目录，独立 npm 发布

## Non-Goals (v1 不做)

- **多房间支持** — v1 只连接一个 Arthas 房间，不支持同时监听多个房间
- **Agent 主动创建房间** — Agent 不会自动创建房间，需要用户先创建并提供分享码
- **消息历史回放** — Arthas 不存储历史消息，Agent 不需要处理历史回放
- **@mention 过滤** — v1 中 Agent 响应房间内所有非系统消息，不做 @mention 区分
- **语音消息处理** — v1 不处理语音消息（仅文本和文件）
- **房间过期自动续期** — 分享码过期后需要运维手动更新配置

## Glossary

- **OpenClaw** — 开源自托管 AI Agent 框架，连接聊天平台到 AI 编码代理
- **Channel Plugin** — OpenClaw 的通道插件，负责消息的收发适配
- **Gateway** — OpenClaw 的核心网关进程，管理 Agent 生命周期和消息路由
- **Share Code** — Arthas 的房间分享码，包含 roomId + 加密密钥 + 配置
- **Turn** — OpenClaw 中一次完整的用户输入 → Agent 处理 → 回复的交互周期

## Requirements

### Requirement 1: Channel Adapter 基础实现

**User Story:** As an OpenClaw operator, I want to configure Arthas as a channel so that my AI agent can communicate through end-to-end encrypted rooms.

#### Acceptance Criteria

1. THE plugin SHALL register an Arthas channel adapter with OpenClaw's Plugin API
2. THE plugin SHALL connect to an Arthas server via WebSocket using a configured server URL
3. THE plugin SHALL join an Arthas room using a share code provided in the plugin configuration
4. THE plugin SHALL derive the AES-256-GCM encryption key from the share code (matching Web/CLI client behavior)
5. THE plugin SHALL decrypt incoming messages from the room and forward them to the OpenClaw Gateway as user turns
6. THE plugin SHALL encrypt outgoing agent responses and send them to the room as chat messages
7. THE plugin SHALL maintain a persistent WebSocket connection with automatic reconnection on disconnect
8. THE plugin SHALL support the Arthas msgpack binary protocol for all message encoding/decoding

### Requirement 2: 加密与安全

**User Story:** As a security-conscious user, I want my AI interactions to be end-to-end encrypted so that no server can observe my prompts or the AI's responses.

#### Acceptance Criteria

1. THE plugin SHALL implement AES-256-GCM encryption/decryption compatible with Arthas Web and CLI clients
2. THE plugin SHALL generate a unique IV (Initialization Vector) for each outgoing message
3. THE plugin SHALL verify message integrity via GCM authentication tags on incoming messages
4. THE plugin SHALL NOT log or persist decrypted message content in any form
5. THE plugin SHALL support Ed25519 message signing (optional, configurable) for agent responses
6. IF Ed25519 signing is enabled, THEN THE plugin SHALL generate a keypair on first run and broadcast the public key to the room

### Requirement 3: 配置与部署

**User Story:** As an OpenClaw operator, I want simple configuration to connect Arthas as a channel.

#### Acceptance Criteria

1. THE plugin SHALL be configurable via OpenClaw's standard plugin configuration (package.json `openclaw` field or environment variables)
2. THE plugin SHALL require at minimum: `ARTHAS_SERVER_URL` and `ARTHAS_SHARE_CODE`
3. THE plugin SHALL support optional configuration: `ARTHAS_DISPLAY_NAME` (agent's display name in the room), `ARTHAS_SIGNING_ENABLED` (Ed25519 signing), `ARTHAS_ROOM_PASSWORD` (for password-protected rooms)
4. THE plugin SHALL validate configuration on startup and provide clear error messages for missing/invalid values
5. THE plugin SHALL be installable via `npm install @arthas/openclaw-channel`
6. IF `ARTHAS_ROOM_PASSWORD` is configured, THEN THE plugin SHALL include the SHA-256 password hash in the JOIN request to authenticate with password-protected rooms

### Requirement 4: 消息生命周期

**User Story:** As a user chatting with an AI agent through Arthas, I want the experience to feel natural and responsive.

#### Acceptance Criteria

1. WHEN a user sends a message in the Arthas room, THE plugin SHALL forward it to the OpenClaw Gateway without adding perceptible latency (target < 50ms for decryption + forwarding)
2. WHEN the AI agent produces a response, THE plugin SHALL encrypt and send it to the Arthas room without adding perceptible latency (target < 50ms for encryption + sending)
3. THE plugin SHALL support multi-line agent responses (sent as a single message)
4. THE plugin SHALL ignore system messages (join/leave notifications) and not forward them to the agent
5. THE plugin SHALL ignore its own messages (prevent echo loops)
6. THE plugin SHALL support typing indicators (send encrypted typing status while agent is processing)
7. IF the agent response exceeds 4000 characters, THEN THE plugin SHALL split it into multiple messages
8. IN multi-user rooms, THE plugin SHALL respond to all non-system messages from any participant (v1 does not implement @mention filtering)
9. WHEN the plugin is the only participant remaining in the room, THE plugin SHALL remain connected and wait for new users to join

### Requirement 5: 文件传输支持

**User Story:** As a user, I want to send files to the AI agent through the encrypted channel for analysis.

#### Acceptance Criteria

1. THE plugin SHALL receive encrypted file transfers from users (using Arthas's chunked file transfer protocol)
2. THE plugin SHALL reassemble and decrypt received files
3. THE plugin SHALL forward received files to the OpenClaw Gateway as file attachments in the user turn
4. THE plugin SHALL support sending files from the agent back to the user (encrypt + chunked transfer)
5. THE plugin SHALL respect the 5MB file size limit

### Requirement 6: 错误处理与可观测性

**User Story:** As an operator, I want visibility into the plugin's health and behavior.

#### Acceptance Criteria

1. THE plugin SHALL emit structured log events for: connection established, connection lost, reconnection attempt, message received, message sent, error occurred
2. THE plugin SHALL expose a health check endpoint (or status callback) indicating connection state
3. IF the WebSocket connection is lost, THEN THE plugin SHALL attempt reconnection with exponential backoff (1s, 2s, 4s, 8s, max 30s)
4. IF the share code is invalid or the room no longer exists, THEN THE plugin SHALL log an error and enter a dormant state (not crash the Gateway)
5. THE plugin SHALL handle graceful shutdown (close WebSocket, flush pending messages)
