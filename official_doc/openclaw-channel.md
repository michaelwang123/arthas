# OpenClaw Channel 插件 �?AI Agent 加密通信通道

[English](openclaw-channel.en.md) | 中文

## 快速开�?

```typescript
import { ArthasChannelAdapter } from '@arthas-chat/openclaw-channel';
const adapter = new ArthasChannelAdapter();
adapter.onMessage(msg => console.log(`${msg.userName}: ${msg.text}`));
await adapter.connect({ serverUrl: 'wss://arthas100-arthas-server.hf.space/ws', shareCode: 'roomId:base64Key' });
await adapter.send({ text: 'Hello from AI!', id: '1', channelId: 'arthas' });
```

> 注：示例使用 ESM top-level await（需�?package.json �?`"type": "module"` �?Node.js �?18）�?

---

## 简�?

`@arthas-chat/openclaw-channel`（v1.0.0）是 Arthas 项目�?OpenClaw 通道插件，将 Arthas 端到端加密聊天室暴露�?AI Agent 通信通道�?

**核心价值：** Arthas 是目前唯一提供端到端加密（E2EE）的 AI Agent 通信通道。服务器仅作为密文中转站（blind relay），无法观察用户的提示词（prompts）或 AI 的回复内容（responses）。你的对话数据从发送端加密，到接收端解密，中间任何节点都无法窥探明文�?

适用场景�?
- 需要隐私保护的 AI 对话（医疗咨询、法律建议、财务分析）
- 企业内部 AI 助手（防止云服务商读取对话内容）
- 合规要求数据不落地的场景

---

## 安装

> ⚠️ `@arthas-chat/openclaw-channel` 尚未发布�?npm。当前请使用本地链接方式安装�?

### 本地安装（推荐）

```bash
# 1. 克隆 Arthas 仓库
git clone https://github.com/michaelwang123/arthas.git
cd arthas

# 2. 安装依赖并构�?
cd packages/openclaw-channel
npm install
npm run build

# 3. 在你的项目中链接
npm link
cd /path/to/your-project
npm link @arthas-chat/openclaw-channel
```

### 系统要求

- Node.js �?18.0.0
- ESM 模块支持（package.json �?`"type": "module"`�?

---

## 配置参�?

插件通过环境变量�?`ChannelConfig` 对象配置。优先级：环境变�?> ChannelConfig > 默认值�?

| 环境变量 | 必填 | 默认�?| 说明 |
|----------|------|--------|------|
| `ARTHAS_SERVER_URL` | �?�?| �?| Arthas WebSocket 服务器地址（必须以 `wss://` �?`ws://` 开头） |
| `ARTHAS_SHARE_CODE` | �?�?| �?| 房间分享码（格式：`roomId:base64Key[:ephemeral:expiresAt]`，最�?2 段，每段非空�?|
| `ARTHAS_DISPLAY_NAME` | �?�?| `AI Assistant` | Agent 在房间中的显示名�?|
| `ARTHAS_SIGNING_ENABLED` | �?�?| `false` | 是否启用 Ed25519 消息签名（`true` �?`1` 启用�?|
| `ARTHAS_ROOM_PASSWORD` | �?�?| �?| 密码保护房间的密码（传输时使�?SHA-256 哈希�?|

### 配置示例

```ini
# .env 文件示例
ARTHAS_SERVER_URL=wss://arthas100-arthas-server.hf.space/ws
ARTHAS_SHARE_CODE=X2-KtJ6oRzdxbguxl5DAR:AMVGFZBTFLeed7tVncI1oKoFUdNIv6goGz64x0cuU1M
ARTHAS_DISPLAY_NAME=Code Assistant
ARTHAS_SIGNING_ENABLED=true
ARTHAS_ROOM_PASSWORD=my-secret-password
```

> 📡 **公共演示服务器：** `wss://arthas100-arthas-server.hf.space/ws`
> 此服务器仅供体验和测试，生产环境请[自托管部署](self-hosting.md)�?

### 分享码格�?

```
roomId:base64Key[:ephemeral:expiresAt]
  �?      �?         �?         �?
  �?      �?         �?         └─ �?: 过期时间戳（Unix 秒，0=永不过期�?
  �?      �?         └─ �?: 临时房间标志�?=持久, 1=临时�?
  �?      └─ �?: base64url 编码�?AES-256 加密密钥
  └─ �?: 房间唯一标识�?
```

最少需�?2 段（roomId + key），�?3 和段 4 可选�?

---

## 使用示例

### 基本 Adapter 设置

```typescript
import { ArthasChannelAdapter } from '@arthas-chat/openclaw-channel';

// 📚 学习要点: 延迟初始化模�?
// 构造函数不执行任何 I/O 操作（不连接 WebSocket、不读取配置）�?
// 所有初始化逻辑集中�?connect() 方法中，支持 Gateway 的延迟加载策略�?
const adapter = new ArthasChannelAdapter();

// 📚 学习要点: 为什�?connect() 是异步的�?
// connect() 内部执行：配置验�?�?密钥派生 �?WebSocket 连接 �?加入房间�?
// 任何步骤失败都会抛出描述性错误（Fail-Fast 原则）�?
await adapter.connect({
  serverUrl: 'wss://arthas-chat.onrender.com/ws',
  shareCode: 'X2-KtJ6oRzdxbguxl5DAR:AMVGFZBTFLeed7tVncI1oKoFUdNIv6goGz64x0cuU1M',
  displayName: 'Code Assistant',
  signingEnabled: true,
});
```

### 消息处理回调

```typescript
// 📚 学习要点: 为什么使�?onMessage 回调而非 EventEmitter�?
// OpenClaw Gateway �?ChannelAdapter 接口规定使用回调模式�?
// 确保消息处理的顺序性（避免并发回调导致的竞态条件）�?
adapter.onMessage((message) => {
  console.log(`[${message.timestamp.toISOString()}] ${message.userName}: ${message.text}`);

  // message 结构:
  // - id: string          �?消息唯一 ID（UUID v4�?
  // - channelId: 'arthas' �?通道标识
  // - userId: string      �?发送�?ID
  // - userName: string    �?发送者显示名�?
  // - text: string        �?解密后的明文内容
  // - timestamp: Date     �?消息时间�?
  // - attachments?: []    �?文件附件（可选）
});
```

### 文件传输接收

```typescript
adapter.onMessage((message) => {
  // 📚 学习要点: 文件传输通过 attachments 字段传�?
  // FileReceiver 在内部收集所有分片、解密并重组文件�?
  // 最终作�?IncomingMessage �?attachments 传递给回调�?
  if (message.attachments && message.attachments.length > 0) {
    for (const file of message.attachments) {
      console.log(`收到文件: ${file.fileName} (${file.size} bytes, ${file.mimeType})`);
      // file.data: Buffer | Uint8Array �?解密后的文件内容
    }
  }
});
```

### 连接状态监�?

```typescript
// 📚 学习要点: 有限状态机（FSM�?
// 连接状态遵循转换规则：
// disconnected �?connecting �?connected �?reconnecting �?connected/error
adapter.onStatusChange((status) => {
  switch (status) {
    case 'connected':
      console.log('�?已连接到 Arthas 房间');
      break;
    case 'reconnecting':
      console.log('🔄 连接断开，正在自动重�?..');
      break;
    case 'error':
      console.log('�?连接错误（不可恢复）');
      break;
    case 'disconnected':
      console.log('�?已断开连接');
      break;
  }
});
```

---

## 安全模型

### AES-256-GCM 加密

所有消息在发送前使用 AES-256-GCM 对称加密�?

- **密钥派生**：从分享码的�?2 段（base64url 编码�?256-bit 密钥）派�?
- **IV 生成**：每条消息使�?`crypto.randomBytes(12)` 生成唯一�?12 字节 IV（初始化向量�?
- **GCM 认证标签**：AES-GCM 自动生成 16 字节认证标签（authentication tag），确保密文完整性——任何篡改都会导致解密失�?
- **编码格式**：IV 和密文均使用 base64url 编码后通过 WebSocket 传输

### 可�?Ed25519 签名

启用 `ARTHAS_SIGNING_ENABLED=true` 后：

- **密钥生成**：`connect()` 时生�?Ed25519 密钥�?
- **公钥广播**：连接成功后立即将公钥作为加密消息广播到房间
- **消息签名**：Agent 的每条消息附�?Ed25519 数字签名
- **验证**：其他客户端可验证消息确实来自此 Agent（防伪造）

### 密钥生命周期

```
connect()
  �?
  ├─ 从分享码派生 AES-256 密钥 �?存储在内存（this.key�?
  ├─ 生成 Ed25519 密钥对（如果启用）→ 存储在内存（this.signingKeyPair�?
  �?
  �? ... 运行期间：密钥仅存在于进程内�?...
  �?
disconnect()
  �?
  ├─ this.key.fill(0)           �?清零 AES 密钥内存
  ├─ zeroKeyPair(signingKeyPair) �?清零签名密钥对内�?
  └─ 密钥不持久化到磁盘、不传输到外�?
```

**安全属性：**
- 密钥仅存在于进程内存中（memory-only�?
- 断开连接时立即清零（zeroed on disconnect�?
- 服务器永远无法获取密钥（zero-knowledge relay�?

---

## 故障排除

### 缺少必填配置

```
[Arthas 配置错误] 缺少必填配置: serverUrl（Arthas 服务器地址�?
  设置方式:
    环境变量: ARTHAS_SERVER_URL=wss://your-server.com/ws
    �?ChannelConfig: { serverUrl: 'wss://your-server.com/ws' }
```

**原因**：未设置 `ARTHAS_SERVER_URL` 环境变量，也未在 `connect()` �?config 参数中提�?`serverUrl`�?

**修复**：在 `.env` 文件或系统环境变量中设置 `ARTHAS_SERVER_URL`�?

---

```
[Arthas 配置错误] 缺少必填配置: shareCode（房间分享码�?
  设置方式:
    环境变量: ARTHAS_SHARE_CODE=roomId:encryptionKey
    �?ChannelConfig: { shareCode: 'roomId:encryptionKey' }
  获取方式: �?Arthas 客户端中创建房间后，点击"分享"获取分享�?
```

**原因**：未设置 `ARTHAS_SHARE_CODE` 环境变量�?

**修复**：在 Arthas Web 客户端或 CLI 中创建房间，获取分享码后设置环境变量�?

### serverUrl 格式无效

```
[Arthas 配置错误] serverUrl 格式无效: "http://example.com"
  期望格式: wss://your-server.com/ws �?ws://localhost:9000/ws
  设置方式: 环境变量 ARTHAS_SERVER_URL=wss://your-server.com/ws
```

**原因**：URL 未使�?`wss://` �?`ws://` 协议前缀�?

**修复**：确�?URL �?`wss://`（生产环境）�?`ws://`（本地开发）开头�?

### shareCode 格式无效

```
[Arthas 配置错误] shareCode 格式无效: 需要至�?2 个冒号分隔的段（roomId:key），当前只有 1 �?
  期望格式: roomId:base64Key �?roomId:base64Key:ephemeral:expiresAt
  设置方式: 环境变量 ARTHAS_SHARE_CODE=your-room-id:your-encryption-key
```

**原因**：分享码格式不正确，缺少冒号分隔符�?

**修复**：确保完整复制了分享码（至少包含 `roomId:key` 两段）�?

### 非加密连接警�?

```
[Arthas 配置警告] serverUrl 使用了非加密�?ws:// 协议: "ws://example.com/ws"
  建议: 生产环境请使�?wss:// 确保传输层安�?
```

**原因**：使用了 `ws://` 而非 `wss://`，传输层未加密�?

**修复**：生产环境务必使�?`wss://`。`ws://` 仅用�?localhost 开发�?

---

## API 参�?

### 导出�?

#### `ArthasChannelAdapter`

实现 `ChannelAdapter` 接口的核心类�?

| 方法 | 签名 | 说明 |
|------|------|------|
| `connect` | `(config: ChannelConfig) => Promise<void>` | 加载配置、派生密钥、连�?WebSocket、加入房�?|
| `disconnect` | `() => Promise<void>` | 断开连接、清零密钥、释放资�?|
| `send` | `(message: OutgoingMessage) => Promise<void>` | 加密并发送消息（长消息自动分割为 �?000 字符的片段） |
| `onMessage` | `(callback: (msg: IncomingMessage) => void) => void` | 注册消息接收回调 |
| `onStatusChange` | `(callback: (status: ConnectionStatus) => void) => void` | 注册连接状态变化回�?|

### 导出函数

#### `definePlugin`

```typescript
function definePlugin(definition: PluginDefinition): Plugin
```

OpenClaw 插件定义函数，用于向 Gateway 注册插件�?

### 导出类型

| 类型 | 说明 |
|------|------|
| `PluginDefinition` | 插件定义选项（name, version, channels�?|
| `ChannelRegistration` | 通道注册信息（id, name, adapter�?|
| `ChannelAdapter` | 通道适配器接口（connect, disconnect, send, onMessage, onStatusChange�?|
| `ChannelConfig` | 通用配置容器（`Record<string, unknown>`�?|
| `ArthasChannelConfig` | Arthas 通道强类型配置（serverUrl, shareCode, displayName, signingEnabled, roomPassword�?|
| `IncomingMessage` | 入站消息（id, channelId, userId, userName, text, timestamp, attachments?, metadata?�?|
| `OutgoingMessage` | 出站消息（id, channelId, text, attachments?, replyTo?, type?�?|
| `MessageAttachment` | 消息附件（fileName, mimeType, size, data�?|
| `ConnectionStatus` | 连接状态联合类型：`'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'` |
| `MessageType` | 消息类型：`'text' | 'typing' | 'file'` |
| `Plugin` | 插件实例（definition, onInit?, onDestroy?�?|

---

## 完整示例：AI Agent 连接验证

以下是一个完整的可运行示例，展示如何连接�?Arthas 服务器、发送消息、监听回复并安全断开�?

```typescript
// verify-plugin.ts �?完整�?AI Agent 连接示例
// 运行方式：npx tsx verify-plugin.ts

import { ArthasChannelAdapter } from '@arthas-chat/openclaw-channel';

const SERVER_URL = 'wss://arthas100-arthas-server.hf.space/ws';
const SHARE_CODE = '你的分享�?;  // �?Arthas 客户端创建房间后获取

async function main() {
  const adapter = new ArthasChannelAdapter();

  // 📚 学习要点: 先注册回调，再连�?
  // Gateway 的调用顺序是 onMessage �?onStatusChange �?connect�?
  // 确保连接建立后的第一条消息不会丢失�?

  // 监听连接状态变�?
  adapter.onStatusChange((status) => {
    console.log(`连接状�? ${status}`);
  });

  // 监听用户消息（解密后的明文）
  adapter.onMessage(async (msg) => {
    console.log(`[${msg.userName}] ${msg.text}`);

    // 在这里调用你�?AI（如 OpenAI、Claude 等）
    const reply = `收到: "${msg.text}" �?这是 AI Agent 的自动回复`;

    // 加密回复给用�?
    await adapter.send({
      id: crypto.randomUUID(),
      channelId: 'arthas',
      text: reply,
    });
  });

  // 连接�?Arthas 加密房间
  await adapter.connect({
    serverUrl: SERVER_URL,
    shareCode: SHARE_CODE,
    displayName: 'AI Assistant',
    signingEnabled: true,  // 启用 Ed25519 消息签名
  });

  console.log('�?AI Agent 已上线，等待用户消息...');

  // 优雅关闭（Ctrl+C 时清零密钥）
  process.on('SIGINT', async () => {
    await adapter.disconnect();
    console.log('已断开，密钥已清零');
    process.exit(0);
  });
}

main().catch(console.error);
```

运行此脚本后，在 Arthas Web 客户端或 CLI 中用相同的分享码加入房间，发送消息即可看�?AI Agent 的自动回复�?

---

## 数据流架�?

```
User (Web/CLI)
    �?加密消息
    �?
Arthas Server (blind relay, 只转发密�?
    �?转发密文
    �?
@arthas-chat/openclaw-channel (解密 �?明文)
    �?IncomingMessage
    �?
OpenClaw Gateway (路由 + 上下文管�?
    �?prompt
    �?
AI Agent (LLM 推理)
    �?response
    �?
OpenClaw Gateway
    �?OutgoingMessage
    �?
@arthas-chat/openclaw-channel (加密 �?密文)
    �?加密消息
    �?
Arthas Server (blind relay)
    �?转发密文
    �?
User (解密 �?明文)
```

服务器在整个流程中仅充当密文中转站，无法解密任何消息内容�?

---

## 下一�?

- [系统架构](architecture.md) �?了解整体设计
- [协议规范](protocol.md) �?消息格式详解
- [自托管部署](self-hosting.md) �?部署自己的服务器
