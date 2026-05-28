# Technical Design: OpenClaw Channel Plugin

## Overview

本文档描述 Arthas OpenClaw Channel Plugin 的技术设计。该插件将 Arthas 的 E2EE 聊天能力暴露为 OpenClaw AI Agent 框架的通信通道，使 AI Agent 能够通过端到端加密房间与用户交互。

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                              │
│                                                                   │
│  ┌──────────────┐    ┌──────────────────────────────────────┐   │
│  │  AI Agent    │    │  @arthas/openclaw-channel             │   │
│  │  (LLM)       │◄──►│                                      │   │
│  │              │    │  ┌────────────┐  ┌────────────────┐  │   │
│  └──────────────┘    │  │ Adapter    │  │ Crypto Engine  │  │   │
│                      │  │ (msg flow) │  │ (AES-256-GCM)  │  │   │
│                      │  └─────┬──────┘  └───────┬────────┘  │   │
│                      │        │                  │            │   │
│                      │  ┌─────┴──────────────────┴────────┐  │   │
│                      │  │  WebSocket Client + msgpack      │  │   │
│                      │  └─────────────────┬───────────────┘  │   │
│                      └────────────────────┼──────────────────┘   │
└───────────────────────────────┼───────────────────────────────────┘
                                │ WSS (encrypted binary frames)
                                ▼
                    ┌───────────────────────┐
                    │   Arthas Server       │
                    │   (blind relay)       │
                    │   零知识中转           │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   User (Web/CLI)      │
                    │   端到端加密           │
                    └───────────────────────┘
```

## Project Structure

```
packages/openclaw-channel/
├── package.json              # npm 包配置 + openclaw plugin metadata
├── tsconfig.json             # TypeScript 配置
├── src/
│   ├── index.ts              # Plugin 入口，注册 channel adapter
│   ├── adapter.ts            # OpenClaw Channel Adapter 实现
│   ├── client.ts             # Arthas WebSocket 客户端
│   ├── crypto.ts             # AES-256-GCM 加密/解密（复用 arthas-client 逻辑）
│   ├── protocol.ts           # msgpack 编解码 + 消息类型定义
│   ├── config.ts             # 配置验证与加载
│   └── types.ts              # TypeScript 类型定义
├── tests/
│   ├── crypto.test.ts        # 加密兼容性测试
│   ├── protocol.test.ts      # 协议编解码测试
│   └── adapter.test.ts       # Adapter 集成测试
└── README.md                 # 使用文档
```

## SDK API 调研结论

> **调研日期：** Task 0.1 完成
> **结论：** `@openclaw/sdk` 尚未发布到 npm（假设中的包），因此我们在本地定义 SDK 类型。

### 类型定义位置

所有 OpenClaw SDK 类型定义在 `packages/openclaw-channel/src/types.ts` 中本地维护。
当真正的 `@openclaw/sdk` 发布后，只需将 import 路径替换为 `'@openclaw/sdk'`。

### definePlugin() 函数签名

```typescript
type DefinePluginFn = (definition: PluginDefinition) => Plugin;

interface PluginDefinition {
  name: string;           // npm 包名格式
  version: string;        // semver
  channels: ChannelRegistration[];
}

interface Plugin {
  definition: PluginDefinition;
  onInit?(): Promise<void>;
  onDestroy?(): Promise<void>;
}
```

### ChannelAdapter 接口方法

```typescript
interface ChannelAdapter {
  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  send(message: OutgoingMessage): Promise<void>;
  onMessage(callback: (message: IncomingMessage) => void): void;
  onStatusChange?(callback: (status: ConnectionStatus) => void): void;
}
```

### 消息格式

```typescript
// 用户 → Agent（解密后的标准化格式）
interface IncomingMessage {
  id: string;
  channelId: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: Date;
  attachments?: MessageAttachment[];
  metadata?: Record<string, unknown>;
}

// Agent → 用户（加密前的标准化格式）
interface OutgoingMessage {
  id: string;
  channelId: string;
  text: string;
  attachments?: MessageAttachment[];
  replyTo?: string;
  type?: MessageType;
}

interface MessageAttachment {
  fileName: string;
  mimeType: string;
  size: number;
  data: Buffer | Uint8Array;
}
```

### 与 design.md 原始假设的差异

| 项目 | 原始假设 | 最终定义 | 原因 |
|------|----------|----------|------|
| `ChannelAdapter.connect()` 参数 | `ArthasConfig` | `ChannelConfig`（通用） | Gateway 传递通用配置，adapter 内部解析为强类型 |
| 消息 ID | 无 | `IncomingMessage.id` / `OutgoingMessage.id` | Gateway 需要消息去重和引用 |
| 连接状态回调 | 无 | `onStatusChange?()` | 支持健康检查和可观测性（Requirement 6.2） |
| 消息类型 | 无 | `OutgoingMessage.type?: MessageType` | 支持 typing indicator（Requirement 4.6） |
| 附件格式 | `File[]` | `MessageAttachment[]` | Node.js 环境无 File API，使用 Buffer |

---

## Design Decisions

### D1: Monorepo 内独立 npm 包

**选择理由：**
- OpenClaw 插件通过 `npm install` 安装，需要独立发布
- 放在 Arthas 主仓库 `packages/openclaw-channel/` 目录（monorepo 模式）
- 可以直接引用 arthas-client 的加密代码（避免重写），通过 TypeScript project references 或构建时 bundle
- 独立 npm 发布（类似 `@astrojs/sitemap` 在 astro monorepo 中的模式）

**权衡：** monorepo 内开发意味着 CI 需要额外配置（只在 `packages/openclaw-channel/` 变更时触发发布）。但好处是加密逻辑可以直接复用 `arthas-client/src/crypto/` 而非重写。

**目录位置：** `packages/openclaw-channel/`（仓库根目录下新建 `packages/` 目录）

### D2: 复用 Web Crypto API 加密实现

**方案：** 从 `arthas-client/src/crypto/` 提取核心加密逻辑：
- `deriveKey(shareCode)` — 从分享码派生 AES-256 密钥
- `encrypt(plaintext, key)` — AES-256-GCM 加密（随机 IV）
- `decrypt(ciphertext, key, iv, tag)` — AES-256-GCM 解密

**Node.js 兼容性：** Node.js 内置 `crypto` 模块支持 AES-256-GCM，无需 polyfill。使用 `crypto.createCipheriv` / `crypto.createDecipheriv`。

### D3: OpenClaw Plugin API 集成

> **注意：** 由于 `@openclaw/sdk` 尚未发布，所有类型从本地 `./types` 导入。

```typescript
// src/index.ts — Plugin 入口
import { definePlugin } from './types';
import { ArthasChannelAdapter } from './adapter';

export default definePlugin({
  name: '@arthas/openclaw-channel',
  version: '1.0.0',
  
  channels: [
    {
      id: 'arthas',
      name: 'Arthas E2EE Chat',
      adapter: ArthasChannelAdapter,
    },
  ],
});
```

```typescript
// src/adapter.ts — Channel Adapter
import type {
  ChannelAdapter,
  ChannelConfig,
  IncomingMessage,
  OutgoingMessage,
  ConnectionStatus,
} from './types';

export class ArthasChannelAdapter implements ChannelAdapter {
  private client: ArthasClient;
  private cryptoEngine: CryptoEngine;

  async connect(config: ChannelConfig): Promise<void> { ... }
  async disconnect(): Promise<void> { ... }
  async send(message: OutgoingMessage): Promise<void> { ... }
  onMessage(callback: (msg: IncomingMessage) => void): void { ... }
  onStatusChange(callback: (status: ConnectionStatus) => void): void { ... }
}
```

### D4: 消息协议适配

Arthas 使用 msgpack 二进制协议，消息结构：

```typescript
// Arthas 协议消息格式
interface ArthasMessage {
  type: number;        // MSG_SEND=3, MSG_RELAY=4, etc.
  payload: {
    senderId: string;
    senderName: string;
    content: string;   // Base64 编码的加密数据
    iv: string;        // Base64 编码的 IV
    timestamp: number;
  };
}
```

适配为 OpenClaw 消息格式：

```typescript
// OpenClaw 消息格式
interface OpenClawMessage {
  channelId: 'arthas';
  userId: string;       // Arthas senderId
  userName: string;     // Arthas senderName
  text: string;         // 解密后的明文
  timestamp: Date;
  attachments?: MessageAttachment[]; // 解密后的文件（Buffer）
}
```

### D5: 配置方案

```json
// package.json 中的 openclaw 配置
{
  "openclaw": {
    "channels": {
      "arthas": {
        "serverUrl": "wss://your-arthas-server.com/ws",
        "shareCode": "roomId:encryptionKey:ephemeral:expiresAt",
        "displayName": "AI Assistant",
        "signingEnabled": false
      }
    }
  }
}
```

或通过环境变量：
```
ARTHAS_SERVER_URL=wss://your-arthas-server.com/ws
ARTHAS_SHARE_CODE=abc123:key456:0:0
ARTHAS_DISPLAY_NAME=AI Assistant
ARTHAS_SIGNING_ENABLED=false
ARTHAS_ROOM_PASSWORD=optional-room-password
```

### D6: 重连策略

```typescript
// 指数退避重连
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]; // ms

async function reconnect(attempt: number): Promise<void> {
  const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
  await sleep(delay);
  await this.connect();
}
```

### D7: 文件传输适配

Arthas 的文件传输使用分片协议（META → CHUNK × N → COMPLETE）。插件需要：

1. **接收文件：** 收集所有 CHUNK，解密重组，作为 Buffer 传给 OpenClaw
2. **发送文件：** 将 Agent 输出的文件分片加密，通过 CHUNK 协议发送

复用 `arthas-client/src/file-transfer/` 的逻辑，移植为 Node.js 版本。

## Performance Budget

| 指标 | 目标 | 说明 |
|------|------|------|
| 消息转发延迟 | < 50ms | 解密 + 转发，不应增加用户可感知延迟（LLM 响应本身 1-30s） |
| 重连时间 | < 5s | 首次重连（指数退避后续更长） |
| 内存占用 | < 50MB | 含 WebSocket buffer + 文件传输缓冲 |
| npm 包大小 | < 200KB | 不含 devDependencies，bundled 后 |

## Security Considerations

- 加密密钥仅存在于内存中，不写入磁盘
- 解密后的消息内容不写入日志（仅记录 metadata：时间戳、消息长度）
- WebSocket 连接强制使用 WSS（TLS 1.2+）
- 分享码通过环境变量传入（不硬编码在配置文件中）
- 插件进程退出时清零内存中的密钥材料
