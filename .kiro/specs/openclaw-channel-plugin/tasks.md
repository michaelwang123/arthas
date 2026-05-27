# Implementation Plan: OpenClaw Channel Plugin

## Overview

实现 Arthas OpenClaw Channel Plugin，使 AI Agent 能通过 Arthas 端到端加密房间与用户通信。插件以独立 npm 包形式发布，遵循 OpenClaw Plugin SDK 规范。

## Tasks

- [ ] 0. 前置调研：验证 OpenClaw SDK API (~1h)
  - [ ] 0.1 安装 @openclaw/sdk 并检查实际导出的类型
    - 确认 definePlugin() 函数签名
    - 确认 ChannelAdapter 接口的方法列表和参数类型
    - 确认消息格式（IncomingMessage / OutgoingMessage 的字段）
    - 参考 openclaw-channel-dingtalk 的实现模式
    - 如果 SDK API 与 design.md 中的假设不同，更新 design.md
    - _Requirements: 1.1_

- [ ] 1. 项目初始化与基础设施 (~2h)
  - [ ] 1.1 创建 `packages/openclaw-channel/` 目录结构
    - 初始化 package.json（name: @arthas/openclaw-channel, type: module）
    - 配置 tsconfig.json（strict, ESM output）
    - 添加 OpenClaw SDK 依赖（@openclaw/sdk）
    - 添加 msgpack 依赖（@msgpack/msgpack）
    - 配置 vitest 测试框架
    - _Requirements: 3.5_

  - [ ] 1.2 实现配置模块 (src/config.ts)
    - 定义 ArthasConfig 接口（serverUrl, shareCode, displayName, signingEnabled）
    - 从环境变量加载配置（ARTHAS_SERVER_URL, ARTHAS_SHARE_CODE 等）
    - 从 package.json openclaw 字段加载配置
    - 配置验证（必填字段检查、URL 格式验证、分享码格式验证）
    - 清晰的错误消息（指出哪个字段缺失/无效）
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 2. 加密引擎 (~3h)
  - [ ] 2.1 实现 AES-256-GCM 加密/解密 (src/crypto.ts)
    - deriveKey(shareCode) — 从分享码提取 Base64 密钥并导入为 CryptoKey
    - encrypt(plaintext, key) — 生成随机 12 字节 IV + AES-256-GCM 加密
    - decrypt(ciphertext, iv, key) — AES-256-GCM 解密 + GCM tag 验证
    - 使用 Node.js crypto 模块（非 Web Crypto API，因为运行在 Node 环境）
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 2.2 编写加密兼容性测试
    - 测试向量：使用 arthas-client 生成的已知密文，验证本插件能正确解密
    - 测试向量：本插件加密的消息，验证 arthas-client 能正确解密
    - 边界测试：空消息、超长消息、Unicode 内容
    - _Requirements: 2.1, 2.4_

  - [ ] 2.3 实现 Ed25519 签名（可选功能）
    - generateKeyPair() — 生成 Ed25519 密钥对
    - sign(message, privateKey) — 签名消息
    - 公钥广播逻辑（加入房间时发送 PUBLIC_KEY 消息）
    - 配置开关（signingEnabled: boolean）
    - _Requirements: 2.5, 2.6_

- [ ] 3. 协议层 (~2h)
  - [ ] 3.1 实现 msgpack 编解码 (src/protocol.ts)
    - 定义所有消息类型常量（MSG_JOIN=1, MSG_SEND=3, MSG_RELAY=4 等）
    - encodeMessage(type, payload) — 编码为 msgpack 二进制
    - decodeMessage(buffer) — 解码 msgpack 二进制为结构化消息
    - 类型安全的消息 payload 接口
    - _Requirements: 1.8_

  - [ ] 3.2 实现文件传输协议适配
    - FileReceiver — 收集 META/CHUNK/COMPLETE 消息，重组文件
    - FileSender — 将文件分片（64KB）+ 加密 + 发送 CHUNK 序列
    - 进度回调（用于日志）
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 4. WebSocket 客户端 (~3h)
  - [ ] 4.1 实现 Arthas WebSocket 客户端 (src/client.ts)
    - connect(serverUrl) — 建立 WebSocket 连接
    - join(roomId, displayName) — 发送 JOIN 消息加入房间
    - send(encryptedContent, iv) — 发送加密消息
    - onMessage(callback) — 注册消息接收回调
    - disconnect() — 优雅关闭连接
    - 心跳机制（30s 间隔 ping/pong）
    - _Requirements: 1.2, 1.3, 1.7_

  - [ ] 4.2 实现自动重连逻辑
    - 指数退避（1s, 2s, 4s, 8s, 16s, 30s max）
    - 重连后自动重新加入房间
    - 连接状态事件（connected, disconnected, reconnecting）
    - 最大重连次数限制（可配置，默认无限）
    - _Requirements: 6.3, 6.4_

- [ ] 5. OpenClaw Channel Adapter (~3h)
  - [ ] 5.1 实现 Channel Adapter (src/adapter.ts)
    - 实现 OpenClaw ChannelAdapter 接口
    - connect() — 初始化 WebSocket 客户端 + 加入房间
    - send(message) — 加密 + 发送 agent 回复
    - onMessage(callback) — 解密 + 转发用户消息到 Gateway
    - 过滤系统消息（join/leave）和自己的消息（防回环）
    - 支持 typing indicator（加密 typing 状态）
    - 长消息分割（> 4000 字符拆分为多条）
    - _Requirements: 1.5, 1.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ] 5.2 实现 Plugin 入口 (src/index.ts)
    - 使用 OpenClaw definePlugin() 注册插件
    - 注册 arthas channel adapter
    - 导出插件元数据（name, version, capabilities）
    - _Requirements: 1.1_

- [ ] 6. 测试与文档 (~2h)
  - [ ] 6.1 编写集成测试
    - 模拟 Arthas 服务器（WebSocket mock）
    - 测试完整消息流：用户发送 → 解密 → 转发 → Agent 回复 → 加密 → 发送
    - 测试重连逻辑
    - 测试文件传输
    - _Requirements: 1.1-6.5_

  - [ ] 6.2 编写 README.md
    - 安装指南（npm install）
    - 配置说明（环境变量 + package.json）
    - 使用示例（与 OpenClaw Gateway 集成）
    - 安全说明（E2EE 工作原理）
    - 故障排除（常见错误）
    - _Requirements: 3.5_

  - [ ] 6.3 准备 npm 发布
    - 配置 .npmignore（排除 tests、src、tsconfig）
    - 构建脚本（tsc → dist/）
    - package.json exports 字段
    - 版本号 1.0.0
    - _Requirements: 3.5_

## Notes

- 加密实现必须与 arthas-client（Web）和 arthas-cli（Go）完全兼容
- 使用 Node.js 内置 crypto 模块，不引入额外加密库
- 插件运行在 OpenClaw Gateway 进程内（Node.js 环境）
- 分享码格式：`roomId:base64Key:ephemeralFlag:expiresAt`（4 段，冒号分隔）
- 文件传输复用现有协议，无需服务器端改动
- 代码位于 `packages/openclaw-channel/`（monorepo 内独立 npm 包）

## Task Dependency Graph

```
Task 0 (SDK 调研)
  │
  ▼
Task 1 (项目初始化)
  │
  ├──────────────┐
  ▼              ▼
Task 2         Task 3
(加密引擎)     (协议层)
  │              │
  └──────┬───────┘
         ▼
       Task 4
    (WebSocket 客户端)
         │
         ▼
       Task 5
    (Channel Adapter)
         │
         ▼
       Task 6
    (测试与文档)
```

**可并行的任务：** Task 2（加密引擎）和 Task 3（协议层）互不依赖，可以并行开发。

**关键路径：** 0 → 1 → 2/3 → 4 → 5 → 6（约 16h 串行，并行可压缩到 ~13h）
