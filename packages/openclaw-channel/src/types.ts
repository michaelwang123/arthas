/**
 * @file types.ts — OpenClaw SDK 类型定义（本地定义）
 *
 * 本文件定义了 OpenClaw Plugin SDK 的核心类型接口。
 * 由于 @openclaw/sdk 是一个假设中的包（尚未发布到 npm），
 * 我们基于 design.md 中的 API 假设和参考 openclaw-channel-dingtalk 的模式，
 * 在本地定义这些类型。
 *
 * 📚 学习要点: 面向接口编程（Programming to Interfaces）
 * 即使 SDK 尚未发布，我们也可以先定义接口契约，然后针对接口编程。
 * 当真正的 @openclaw/sdk 发布后，只需要：
 * 1. 安装 @openclaw/sdk
 * 2. 将本文件的 import 替换为 `import { ... } from '@openclaw/sdk'`
 * 3. 验证类型兼容性（TypeScript 编译器会自动检查）
 * 这种方式让我们可以并行开发，不被 SDK 发布进度阻塞。
 *
 * 📚 学习要点: 类型定义的来源分析
 * 这些类型定义基于以下信息源：
 * - design.md D3 节：definePlugin() 和 ChannelAdapter 的代码示例
 * - design.md D4 节：消息格式适配（ArthasMessage ↔ OpenClawMessage）
 * - 参考模式：类似 Slack/Discord bot SDK 的 Channel Adapter 模式
 * - Arthas 协议：arthas-client/src/network/protocol.ts 的消息结构
 *
 * @module openclaw-channel/types
 * @see design.md — D3: OpenClaw Plugin API 集成
 * @see design.md — D4: 消息协议适配
 */

// ============================================================================
// OpenClaw Plugin SDK 核心类型
// ============================================================================

/**
 * OpenClaw 插件定义选项。
 *
 * 传递给 definePlugin() 函数，用于向 OpenClaw Gateway 注册插件。
 * Gateway 在启动时加载所有已安装的插件，读取其 channels 配置，
 * 并为每个 channel 创建 adapter 实例。
 *
 * 📚 学习要点: 插件注册模式（Plugin Registration Pattern）
 * OpenClaw 采用声明式插件注册：
 * - 插件通过 default export 导出 definePlugin() 的返回值
 * - Gateway 通过 require/import 加载插件模块
 * - Gateway 读取 channels 数组，为每个 channel 实例化 adapter
 * 这种模式类似于 Vite 插件、Rollup 插件的注册方式。
 */
export interface PluginDefinition {
  /** 插件唯一标识符（npm 包名格式，如 '@arthas/openclaw-channel'） */
  name: string;

  /** 插件版本号（遵循 semver，如 '1.0.0'） */
  version: string;

  /**
   * 插件提供的通道列表。
   * 一个插件可以注册多个通道（如同时支持多个 Arthas 服务器），
   * 但 v1 只注册一个 'arthas' 通道。
   */
  channels: ChannelRegistration[];
}

/**
 * 通道注册信息。
 *
 * 描述一个通信通道的元数据和 adapter 类引用。
 * Gateway 使用此信息创建 adapter 实例并管理其生命周期。
 */
export interface ChannelRegistration {
  /** 通道唯一 ID（在插件内唯一，如 'arthas'） */
  id: string;

  /** 通道显示名称（用于日志和管理界面，如 'Arthas E2EE Chat'） */
  name: string;

  /**
   * Adapter 类引用（非实例）。
   * Gateway 会调用 `new adapter()` 创建实例，然后调用 connect()。
   *
   * 📚 学习要点: 为什么传递类而非实例？
   * Gateway 需要控制 adapter 的生命周期（创建、连接、断开、销毁）。
   * 传递类引用让 Gateway 可以：
   * 1. 在需要时才创建实例（延迟初始化）
   * 2. 在重连时销毁旧实例、创建新实例（干净的状态重置）
   * 3. 管理多个实例（如果未来支持多房间）
   */
  adapter: new () => ChannelAdapter;
}

// ============================================================================
// Channel Adapter 接口
// ============================================================================

/**
 * OpenClaw Channel Adapter 接口。
 *
 * 所有通道插件必须实现此接口。Gateway 通过此接口与通道交互：
 * - connect(): 建立与外部平台的连接
 * - disconnect(): 断开连接并清理资源
 * - send(): 将 Agent 的回复发送到外部平台
 * - onMessage(): 注册消息回调，当用户发送消息时通知 Gateway
 *
 * 📚 学习要点: 适配器模式（Adapter Pattern）
 * ChannelAdapter 是经典的适配器模式：
 * - 目标接口（Target）：OpenClaw Gateway 期望的统一消息接口
 * - 被适配者（Adaptee）：Arthas WebSocket + msgpack + AES-GCM 协议
 * - 适配器（Adapter）：ArthasChannelAdapter 类
 *
 * 通过适配器，Gateway 不需要知道 Arthas 的加密协议细节，
 * 只需要调用标准的 send()/onMessage() 接口。
 * 同样的模式也用于 DingTalk、Slack、Discord 等其他通道插件。
 *
 * 生命周期：
 * 1. Gateway 调用 `new Adapter()` 创建实例
 * 2. Gateway 调用 `adapter.connect(config)` 建立连接
 * 3. Gateway 调用 `adapter.onMessage(callback)` 注册消息回调
 * 4. 运行期间：用户消息通过 callback 传递给 Gateway
 * 5. 运行期间：Agent 回复通过 `adapter.send(message)` 发送
 * 6. 关闭时 Gateway 调用 `adapter.disconnect()` 清理资源
 */
export interface ChannelAdapter {
  /**
   * 建立与外部平台的连接。
   *
   * 对于 Arthas 通道，此方法执行：
   * 1. 解析配置（从环境变量或 plugin config 加载）
   * 2. 从分享码派生 AES-256-GCM 密钥
   * 3. 建立 WebSocket 连接到 Arthas 服务器
   * 4. 发送 JOIN 消息加入房间
   * 5. 开始心跳机制
   *
   * @param config - 通道配置（由 Gateway 从插件配置中提取并传入）
   * @throws 如果连接失败（服务器不可达、分享码无效、房间不存在等）
   */
  connect(config: ChannelConfig): Promise<void>;

  /**
   * 断开连接并清理所有资源。
   *
   * 对于 Arthas 通道，此方法执行：
   * 1. 发送 LEAVE 消息通知房间
   * 2. 关闭 WebSocket 连接
   * 3. 停止心跳定时器
   * 4. 清零内存中的加密密钥
   * 5. 取消所有待处理的重连定时器
   */
  disconnect(): Promise<void>;

  /**
   * 将 Agent 的回复发送到外部平台。
   *
   * 对于 Arthas 通道，此方法执行：
   * 1. 将 OutgoingMessage.text 使用 AES-256-GCM 加密
   * 2. 通过 msgpack 编码为二进制帧
   * 3. 通过 WebSocket 发送到 Arthas 服务器
   * 4. 如果消息超过 4000 字符，自动分割为多条消息
   *
   * @param message - 要发送的消息（已由 Gateway 构造好）
   * @throws 如果发送失败（连接断开、加密错误等）
   */
  send(message: OutgoingMessage): Promise<void>;

  /**
   * 注册消息接收回调。
   *
   * Gateway 在 connect() 之后调用此方法注册回调。
   * 当外部平台有新消息到达时，adapter 应调用此回调将消息传递给 Gateway。
   *
   * 对于 Arthas 通道：
   * 1. WebSocket 收到 MSG_RELAY_MESSAGE
   * 2. msgpack 解码得到 { senderId, senderName, iv, ciphertext, t }
   * 3. AES-256-GCM 解密得到明文
   * 4. 构造 IncomingMessage 对象
   * 5. 调用 callback(incomingMessage)
   *
   * 📚 学习要点: 回调注册 vs 事件发射器
   * 使用简单的回调函数而非 EventEmitter，因为：
   * - 只有一个消费者（Gateway），不需要多播
   * - 类型安全更好（回调参数有明确类型）
   * - 更简单，不需要引入 EventEmitter 依赖
   *
   * @param callback - 消息到达时的回调函数
   */
  onMessage(callback: (message: IncomingMessage) => void): void;

  /**
   * 注册连接状态变化回调（可选）。
   *
   * Gateway 可以通过此方法监听连接状态变化，用于：
   * - 健康检查报告
   * - 日志记录
   * - 触发重连逻辑（如果 adapter 不自行处理重连）
   *
   * @param callback - 状态变化时的回调函数
   */
  onStatusChange?(callback: (status: ConnectionStatus) => void): void;
}

// ============================================================================
// 消息类型定义
// ============================================================================

/**
 * 从外部平台接收的用户消息（传递给 OpenClaw Gateway）。
 *
 * 📚 学习要点: 消息格式标准化
 * 不同平台的原始消息格式各不相同：
 * - Arthas: { senderId, senderName, iv, ciphertext, t } (加密的 msgpack)
 * - DingTalk: { senderStaffId, text: { content }, msgtype } (JSON)
 * - Slack: { user, text, ts, channel } (JSON)
 *
 * IncomingMessage 是 OpenClaw 的标准化格式，所有 adapter 都将平台特定格式
 * 转换为此格式后传递给 Gateway。Gateway 不需要知道消息来自哪个平台。
 */
export interface IncomingMessage {
  /** 消息唯一 ID（由 adapter 生成或从平台获取） */
  id: string;

  /** 通道 ID（与 ChannelRegistration.id 对应，如 'arthas'） */
  channelId: string;

  /** 发送者用户 ID（平台内唯一标识） */
  userId: string;

  /** 发送者显示名称 */
  userName: string;

  /** 消息文本内容（已解密的明文） */
  text: string;

  /** 消息时间戳 */
  timestamp: Date;

  /**
   * 附件列表（可选）。
   * 对于 Arthas 通道，这是解密后的文件传输内容。
   */
  attachments?: MessageAttachment[];

  /**
   * 平台特定的原始数据（可选）。
   * 用于 adapter 传递额外的平台特定信息给 Gateway，
   * 如 Arthas 的消息签名验证结果等。
   *
   * 📚 学习要点: 扩展点设计
   * metadata 字段允许 adapter 传递任意额外信息，
   * 而不需要修改 IncomingMessage 接口。
   * Gateway 可以选择性地使用这些信息（如日志记录）。
   */
  metadata?: Record<string, unknown>;
}

/**
 * 发送给外部平台的 Agent 回复消息。
 *
 * Gateway 在 Agent 产生回复后构造此对象，传递给 adapter.send()。
 * Adapter 负责将其转换为平台特定格式并发送。
 */
export interface OutgoingMessage {
  /** 消息唯一 ID（由 Gateway 生成） */
  id: string;

  /** 目标通道 ID */
  channelId: string;

  /** 回复的消息文本内容（Agent 生成的回复） */
  text: string;

  /**
   * 要发送的文件附件（可选）。
   * 对于 Arthas 通道，adapter 会加密并通过分片协议发送。
   */
  attachments?: MessageAttachment[];

  /**
   * 回复引用的原始消息 ID（可选）。
   * 用于支持"回复"功能的平台（Arthas v1 不使用此字段）。
   */
  replyTo?: string;

  /**
   * 消息类型标识（可选）。
   * 默认为 'text'，可扩展为 'typing'、'file' 等。
   */
  type?: MessageType;
}

/**
 * 消息附件（文件）。
 *
 * 对于 Arthas 通道：
 * - 接收方向：从加密文件传输协议重组并解密后的文件
 * - 发送方向：Agent 输出的文件，将被加密并通过分片协议发送
 */
export interface MessageAttachment {
  /** 文件名 */
  fileName: string;

  /** 文件 MIME 类型 */
  mimeType: string;

  /** 文件大小（字节） */
  size: number;

  /** 文件内容（Buffer 或 Uint8Array） */
  data: Buffer | Uint8Array;
}

// ============================================================================
// 配置类型
// ============================================================================

/**
 * 通道配置（由 Gateway 传递给 adapter.connect()）。
 *
 * 📚 学习要点: 配置来源优先级
 * OpenClaw Gateway 按以下优先级加载配置：
 * 1. 环境变量（最高优先级，适合生产部署）
 * 2. package.json 的 "openclaw" 字段（适合开发环境）
 * 3. 插件默认值（最低优先级）
 *
 * ChannelConfig 是一个通用的键值对容器，
 * 具体的 adapter 负责从中提取和验证所需的配置项。
 */
export interface ChannelConfig {
  [key: string]: unknown;
}

/**
 * Arthas 通道的具体配置接口。
 *
 * 从 ChannelConfig 中提取并验证后的强类型配置。
 * 在 adapter.connect() 内部使用。
 */
export interface ArthasChannelConfig {
  /**
   * Arthas 服务器 WebSocket URL。
   * 必须使用 wss:// 协议（强制 TLS）。
   * 示例: 'wss://your-arthas-server.com/ws'
   */
  serverUrl: string;

  /**
   * Arthas 房间分享码。
   * 格式: `{roomId}:{base64urlKey}:{ephemeral}:{expiresAt}`（2-4 段）
   * 包含加入房间所需的全部信息（房间 ID + 加密密钥）。
   *
   * 📚 学习要点: 安全传递分享码
   * 分享码包含加密密钥，必须通过安全渠道传递：
   * - 生产环境：通过环境变量 ARTHAS_SHARE_CODE 注入
   * - 开发环境：可以写在 .env 文件中（.gitignore 排除）
   * - 绝不应该硬编码在源代码或 package.json 中
   */
  shareCode: string;

  /**
   * Agent 在房间中的显示名称。
   * 其他用户会看到此名称作为 AI Agent 的身份标识。
   * 默认: 'AI Assistant'
   */
  displayName: string;

  /**
   * 是否启用 Ed25519 消息签名。
   * 启用后，Agent 的每条消息都会附带数字签名，
   * 用户客户端可以验证消息确实来自此 Agent（防伪造）。
   * 默认: false
   */
  signingEnabled: boolean;

  /**
   * 房间密码（可选）。
   * 如果 Arthas 房间设置了密码保护，需要提供此字段。
   * 插件会计算 SHA-256 hash 后包含在 JOIN 请求中。
   */
  roomPassword?: string;
}

// ============================================================================
// 连接状态类型
// ============================================================================

/**
 * 通道连接状态。
 *
 * 📚 学习要点: 有限状态机（FSM）
 * 连接状态遵循以下转换规则：
 * - disconnected → connecting → connected
 * - connected → disconnected（正常断开）
 * - connected → reconnecting → connected（自动重连成功）
 * - connected → reconnecting → error（重连失败）
 * - error → connecting（手动重试）
 *
 * 使用 union type 确保只有合法状态可以被赋值，
 * TypeScript 编译器会在 switch 语句中检查是否处理了所有状态。
 */
export type ConnectionStatus =
  | 'disconnected'   // 未连接（初始状态或正常断开后）
  | 'connecting'     // 正在建立连接
  | 'connected'      // 已连接并加入房间
  | 'reconnecting'   // 连接断开，正在自动重连
  | 'error';         // 连接错误（分享码无效、房间不存在等不可恢复错误）

// ============================================================================
// 消息类型枚举
// ============================================================================

/**
 * 消息类型标识。
 *
 * 用于区分不同类型的消息（文本、打字状态、文件等）。
 * Gateway 根据此类型决定如何处理消息。
 */
export type MessageType =
  | 'text'     // 普通文本消息
  | 'typing'   // 打字状态指示器
  | 'file';    // 文件消息

// ============================================================================
// definePlugin 函数类型
// ============================================================================

/**
 * OpenClaw 插件定义函数。
 *
 * 这是 OpenClaw SDK 的核心 API，用于声明式地定义一个插件。
 * 插件模块的 default export 应该是此函数的返回值。
 *
 * 📚 学习要点: 工厂函数模式（Factory Function Pattern）
 * definePlugin() 不是简单地返回传入的对象，它还会：
 * 1. 验证插件定义的完整性（必填字段检查）
 * 2. 注入 SDK 运行时上下文（如日志器、配置加载器）
 * 3. 返回一个增强后的 Plugin 对象（包含生命周期钩子）
 *
 * 使用工厂函数而非直接导出对象的好处：
 * - SDK 可以在不破坏 API 的情况下添加内部逻辑
 * - 提供更好的类型推断（TypeScript 可以从参数推断返回类型）
 * - 统一的入口点便于 SDK 版本升级时的兼容性处理
 *
 * @example
 * ```typescript
 * // src/index.ts
 * import { definePlugin } from '@openclaw/sdk';
 * import { ArthasChannelAdapter } from './adapter';
 *
 * export default definePlugin({
 *   name: '@arthas/openclaw-channel',
 *   version: '1.0.0',
 *   channels: [{
 *     id: 'arthas',
 *     name: 'Arthas E2EE Chat',
 *     adapter: ArthasChannelAdapter,
 *   }],
 * });
 * ```
 */
export type DefinePluginFn = (definition: PluginDefinition) => Plugin;

/**
 * OpenClaw 插件实例（definePlugin 的返回值）。
 *
 * 包含插件定义信息和 SDK 注入的运行时能力。
 * Gateway 通过此对象管理插件的生命周期。
 */
export interface Plugin {
  /** 插件定义（原始传入的配置） */
  definition: PluginDefinition;

  /**
   * 插件初始化钩子（可选）。
   * Gateway 在加载插件后、创建 adapter 之前调用。
   * 用于执行一次性的初始化逻辑（如验证外部服务可达性）。
   */
  onInit?(): Promise<void>;

  /**
   * 插件销毁钩子（可选）。
   * Gateway 在关闭时调用，用于清理全局资源。
   */
  onDestroy?(): Promise<void>;
}

// ============================================================================
// SDK 导出模拟
// ============================================================================

/**
 * 模拟 @openclaw/sdk 的 definePlugin 函数。
 *
 * 在真正的 SDK 发布前，我们使用此本地实现。
 * 它简单地将传入的定义包装为 Plugin 对象。
 *
 * 📚 学习要点: 最小可行实现（MVP Implementation）
 * 真正的 SDK 会在 definePlugin 中注入日志器、配置加载器等运行时能力。
 * 我们的本地实现只做最基本的包装，确保类型正确。
 * 当 SDK 发布后，替换 import 路径即可，无需修改业务逻辑。
 *
 * @param definition - 插件定义
 * @returns 包装后的 Plugin 对象
 */
export function definePlugin(definition: PluginDefinition): Plugin {
  return {
    definition,
  };
}
