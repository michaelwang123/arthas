/**
 * @file adapter.ts — OpenClaw Channel Adapter 实现
 *
 * 本文件实现 OpenClaw ChannelAdapter 接口，是插件的核心集成模块。
 * 它将 Arthas 的 WebSocket + msgpack + AES-256-GCM 加密协议适配为
 * OpenClaw Gateway 期望的统一 ChannelAdapter 接口。
 *
 * 职责：
 * 1. connect(config) — 加载配置 → 派生密钥 → 创建客户端 → 连接 → 加入房间
 * 2. send(message) — 加密文本 → 长消息分割 → 逐条发送
 * 3. onMessage(callback) — 注册回调，解密收到的消息 → 过滤 → 转发给 Gateway
 * 4. disconnect() — 断开连接 → 清零密钥 → 释放资源
 * 5. 消息过滤 — 忽略系统消息（join/leave）、自己的消息（防回环）、公钥广播
 * 6. 文件传输 — 接收用户文件（FileReceiver）、发送 Agent 文件（FileSender）
 * 7. Typing indicator — Agent 处理时发送加密 typing 状态
 *
 * 📚 学习要点: 适配器模式（Adapter Pattern）
 * ArthasChannelAdapter 是经典的适配器模式实现：
 * - 目标接口（Target）：OpenClaw Gateway 期望的 ChannelAdapter 接口
 * - 被适配者（Adaptee）：Arthas WebSocket + msgpack + AES-GCM 协议栈
 * - 适配器（Adapter）：本类，将复杂的加密通信协议转换为简单的 send/onMessage API
 *
 * Gateway 不需要知道底层的加密协议细节，只需调用标准的 send()/onMessage()。
 * 同样的模式也用于 DingTalk、Slack、Discord 等其他通道插件。
 *
 * 📚 学习要点: 模块依赖关系
 * adapter.ts 是所有底层模块的集成点：
 * - config.ts: loadConfig() — 配置加载与验证
 * - crypto.ts: deriveKey(), encrypt(), decrypt(), toBase64Url(), fromBase64Url() — 加密引擎
 * - signing.ts: generateSigningKeyPair(), formatPublicKeyMessage(),
 *              parsePublicKeyMessage(), zeroKeyPair() — 消息签名（可选）
 * - reconnect.ts: ReconnectManager — 自动重连管理器
 * - client.ts: ArthasClient — WebSocket 客户端
 * - file-transfer.ts: FileReceiver, FileSender — 文件传输协议
 * - protocol.ts: 消息类型常量和数据接口
 * - types.ts: ChannelAdapter, IncomingMessage, OutgoingMessage 等类型定义
 *
 * @module openclaw-channel/adapter
 * @see design.md — D3: OpenClaw Plugin API 集成
 * @see requirements.md — Requirement 1: Channel Adapter 基础实现
 * @see requirements.md — Requirement 4: 消息生命周期
 */

import { createHash, randomUUID } from 'node:crypto';

import { loadConfig } from './config.js';
import { deriveKey, encrypt, decrypt, toBase64Url, fromBase64Url } from './crypto.js';
import {
  generateSigningKeyPair,
  formatPublicKeyMessage,
  parsePublicKeyMessage,
  zeroKeyPair,
} from './signing.js';
import type { SigningKeyPair } from './signing.js';
import { ArthasClient } from './client.js';
import { ReconnectManager } from './reconnect.js';
import { FileReceiver, FileSender } from './file-transfer.js';
import { encodeMessage } from './protocol.js';
import {
  MSG_RELAY_MESSAGE,
  MSG_MEMBER_JOINED,
  MSG_MEMBER_LEFT,
  MSG_RELAY_FILE_META,
  MSG_RELAY_FILE_CHUNK,
  MSG_RELAY_FILE_COMPLETE,
  MSG_RELAY_FILE_CANCEL,
} from './protocol.js';
import type {
  Message,
  RelayMessageData,
  RelayFileMetaData,
  RelayFileChunkData,
  RelayFileCompleteData,
  RelayFileCancelData,
} from './protocol.js';
import type {
  ChannelAdapter,
  ChannelConfig,
  ArthasChannelConfig,
  IncomingMessage,
  OutgoingMessage,
  ConnectionStatus,
  MessageAttachment,
} from './types.js';


// ============================================================================
// 常量定义
// ============================================================================

/**
 * 单条消息最大字符数。
 *
 * 📚 学习要点: 为什么限制 4000 字符？
 * - Arthas 服务器的 maxMessageSize 限制了 WebSocket 帧大小
 * - AES-GCM 加密后密文比明文长（+16 字节 auth tag + base64 膨胀 33%）
 * - 4000 字符 UTF-8 最多 16000 字节，加密 + base64 后约 21KB
 * - 留出余量确保不超过服务器限制
 * - 与 Web 客户端的消息长度限制保持一致
 */
const MAX_MESSAGE_LENGTH = 4000;

/**
 * 通道 ID 常量。
 * 用于 IncomingMessage.channelId 和 OutgoingMessage.channelId。
 */
const CHANNEL_ID = 'arthas';


// ============================================================================
// ArthasChannelAdapter 类
// ============================================================================

/**
 * Arthas E2EE Channel Adapter — OpenClaw 通道适配器实现。
 *
 * 将 Arthas 的端到端加密聊天协议适配为 OpenClaw Gateway 的标准通道接口。
 * Gateway 通过此适配器与 Arthas 房间中的用户进行加密通信。
 *
 * 📚 学习要点: 类的生命周期管理
 * Gateway 管理 adapter 的完整生命周期：
 * 1. `new ArthasChannelAdapter()` — 创建实例（无参构造，延迟初始化）
 * 2. `adapter.onMessage(callback)` — 注册消息回调
 * 3. `adapter.onStatusChange(callback)` — 注册状态回调
 * 4. `await adapter.connect(config)` — 建立连接（所有初始化在此完成）
 * 5. 运行期间：Gateway 调用 `adapter.send()` 发送 Agent 回复
 * 6. 运行期间：adapter 通过 callback 将用户消息传递给 Gateway
 * 7. `await adapter.disconnect()` — 关闭连接，清理资源
 *
 * 📚 学习要点: 延迟初始化模式（Lazy Initialization）
 * 构造函数不执行任何 I/O 操作（不连接 WebSocket、不读取配置）。
 * 所有初始化逻辑集中在 connect() 方法中。这样做的好处：
 * - Gateway 可以先创建实例、注册回调，再决定何时连接
 * - 构造函数不会抛出异步错误（简化错误处理）
 * - 支持 Gateway 的延迟加载策略（按需连接通道）
 */
export class ArthasChannelAdapter implements ChannelAdapter {
  // --------------------------------------------------------------------------
  // 私有属性
  // --------------------------------------------------------------------------

  /** AES-256 加密密钥（从分享码派生，connect() 时初始化） */
  private key: Buffer | null = null;

  /** Arthas WebSocket 客户端实例 */
  private client: ArthasClient | null = null;

  /** 自动重连管理器 */
  private reconnectManager: ReconnectManager | null = null;

  /** 文件接收器（处理入站文件传输） */
  private fileReceiver: FileReceiver | null = null;

  /** 文件发送器（处理出站文件传输） */
  private fileSender: FileSender | null = null;

  /**
   * Ed25519 签名密钥对（可选，signingEnabled=true 时生成）。
   *
   * 📚 学习要点: 可选功能的内存管理
   * 签名密钥对仅在 signingEnabled=true 时创建。
   * disconnect() 时调用 zeroKeyPair() 清零内存，减少密钥暴露窗口。
   */
  private signingKeyPair: SigningKeyPair | null = null;

  /** 已验证的配置（connect() 时加载） */
  private config: ArthasChannelConfig | null = null;

  /**
   * 消息接收回调（由 Gateway 通过 onMessage() 注册）。
   *
   * 📚 学习要点: 回调注册时序
   * Gateway 的调用顺序是：onMessage(cb) -> connect(config)。
   * 因此回调在 connect() 之前就已注册，确保连接建立后的第一条消息不会丢失。
   */
  private messageCallback: ((message: IncomingMessage) => void) | null = null;

  /** 连接状态变化回调（由 Gateway 通过 onStatusChange() 注册） */
  private statusCallback: ((status: ConnectionStatus) => void) | null = null;

  /**
   * 其他成员的公钥映射（senderId -> publicKey）。
   * 用于验证收到消息的签名（当 signingEnabled=true 时）。
   */
  private publicKeyMap: Map<string, Buffer> = new Map();


  // --------------------------------------------------------------------------
  // 公共 API: ChannelAdapter 接口实现
  // --------------------------------------------------------------------------

  /**
   * 建立与 Arthas 服务器的连接并加入房间。
   *
   * 完整初始化流程：
   * 1. 加载并验证配置（环境变量 + ChannelConfig 合并）
   * 2. 从分享码派生 AES-256 加密密钥
   * 3. 解析分享码获取 roomId
   * 4. 创建 ArthasClient 和 ReconnectManager
   * 5. 创建 FileSender 和 FileReceiver
   * 6. 注册消息处理回调
   * 7. 连接 WebSocket 并加入房间
   * 8. 如果 signingEnabled，生成密钥对并广播公钥
   *
   * 📚 学习要点: Fail-Fast 初始化
   * 如果配置无效（分享码格式错误、URL 不合法等），connect() 会立即抛出错误。
   * 这确保运维在部署时就能发现配置问题，而非在运行时才出现难以诊断的错误。
   *
   * @param config - Gateway 传入的通道配置
   * @throws 如果配置无效、连接失败或加入房间失败
   */
  async connect(config: ChannelConfig): Promise<void> {
    // 1. 加载并验证配置
    this.config = loadConfig(config);

    // 2. 从分享码派生 AES-256 密钥
    this.key = deriveKey(this.config.shareCode);

    // 3. 解析分享码获取 roomId（第一段）
    const roomId = this.config.shareCode.split(':')[0]!;

    // 4. 计算房间密码哈希（如果配置了密码）
    // 📚 学习要点: 密码哈希传输
    // Arthas 服务器期望收到密码的 SHA-256 哈希（64 hex chars），
    // 而非明文密码。这样即使 WebSocket 帧被截获，也无法获取原始密码。
    let passwordHash = '';
    if (this.config.roomPassword) {
      passwordHash = createHash('sha256')
        .update(this.config.roomPassword)
        .digest('hex');
    }

    // 5. 创建 ArthasClient
    this.client = new ArthasClient({ serverUrl: this.config.serverUrl });

    // 6. 创建 ReconnectManager（包装 client，提供自动重连能力）
    this.reconnectManager = new ReconnectManager(this.client);

    // 7. 转发 ReconnectManager 的状态变化给上层 Gateway
    this.reconnectManager.onStatusChange((status) => {
      if (this.statusCallback) {
        this.statusCallback(status);
      }
    });

    // 8. 创建文件传输模块
    this.fileSender = new FileSender(this.key);
    this.fileReceiver = new FileReceiver(this.key);

    // 9. 注册消息处理回调（在连接之前注册，确保不丢消息）
    this.client.onMessage((message) => {
      this.handleProtocolMessage(message);
    });

    // 10. 连接并加入房间（通过 ReconnectManager）
    await this.reconnectManager.connectAndJoin(
      roomId,
      this.config.displayName,
      passwordHash,
    );

    // 11. 如果启用签名，生成密钥对并广播公钥
    if (this.config.signingEnabled) {
      this.signingKeyPair = generateSigningKeyPair();
      this.broadcastPublicKey(); // ISSUE-6 修复：去掉无效的 await
    }
  }


  /**
   * 断开连接并清理所有资源。
   *
   * 清理流程：
   * 1. 停止 ReconnectManager（取消重连定时器 + 断开 WebSocket）
   * 2. 清零签名密钥对（安全擦除内存中的私钥）
   * 3. 清理 FileReceiver（释放未完成传输的缓冲区）
   * 4. 清零加密密钥
   * 5. 重置所有内部状态
   *
   * 📚 学习要点: 资源清理顺序
   * 清理顺序与初始化顺序相反（LIFO），确保：
   * - 先停止网络活动（不再收发消息）
   * - 再清理加密材料（密钥清零）
   * - 最后重置状态（允许重新 connect）
   */
  async disconnect(): Promise<void> {
    // 1. 停止重连管理器（断开 WebSocket）
    if (this.reconnectManager) {
      await this.reconnectManager.stop();
    }

    // 2. 清零签名密钥对
    if (this.signingKeyPair) {
      zeroKeyPair(this.signingKeyPair);
      this.signingKeyPair = null;
    }

    // 3. 清理文件接收器
    if (this.fileReceiver) {
      this.fileReceiver.cleanup();
    }

    // 4. 清零加密密钥
    if (this.key) {
      this.key.fill(0);
      this.key = null;
    }

    // 5. 重置状态
    this.client = null;
    this.reconnectManager = null;
    this.fileReceiver = null;
    this.fileSender = null;
    this.config = null;
    this.publicKeyMap.clear();
  }


  /**
   * 将 Agent 的回复发送到 Arthas 房间。
   *
   * 发送流程：
   * 1. 检查消息类型（typing indicator 特殊处理）
   * 2. 如果有文件附件，通过 FileSender 发送
   * 3. 如果文本超过 4000 字符，拆分为多条消息
   * 4. 对每条消息：加密 -> 编码为 base64url -> 发送
   *
   * 📚 学习要点: 长消息分割策略（Requirement 4.7）
   * 为什么在 4000 字符处分割而非让客户端处理？
   * - Arthas 客户端 UI 对超长消息的渲染性能较差
   * - 分割后每条消息独立加密，单条消息损坏不影响其他部分
   * - 4000 字符约等于 2-3 屏内容，用户阅读体验更好
   * - 与 Telegram Bot API 的 4096 字符限制类似（行业惯例）
   *
   * @param message - Gateway 构造的出站消息
   * @throws 如果未连接或加密失败
   */
  async send(message: OutgoingMessage): Promise<void> {
    if (!this.client || !this.key) {
      throw new Error('无法发送消息: 适配器未连接');
    }

    // 处理 typing indicator（Requirement 4.6）
    if (message.type === 'typing') {
      this.client.sendTyping(true);
      return;
    }

    // 处理文件附件（Requirement 5.4）
    if (message.attachments && message.attachments.length > 0) {
      this.sendFileAttachments(message.attachments);
    }

    // 处理文本消息
    if (message.text) {
      // 拆分长消息（Requirement 4.7: > 4000 字符拆分）
      const parts = this.splitMessage(message.text);

      for (const part of parts) {
        this.sendEncryptedText(part);
      }
    }
  }

  /**
   * 注册消息接收回调。
   *
   * Gateway 在 connect() 之前调用此方法注册回调。
   * 当 Arthas 房间中有用户发送消息时，adapter 解密后通过此回调通知 Gateway。
   *
   * @param callback - 消息到达时的回调函数
   */
  onMessage(callback: (message: IncomingMessage) => void): void {
    this.messageCallback = callback;
  }

  /**
   * 注册连接状态变化回调。
   *
   * Gateway 通过此方法监听连接状态，用于健康检查和日志记录。
   * 状态值：'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'error'
   *
   * @param callback - 状态变化时的回调函数
   */
  onStatusChange(callback: (status: ConnectionStatus) => void): void {
    this.statusCallback = callback;
  }


  // --------------------------------------------------------------------------
  // 私有方法: 消息处理（入站）
  // --------------------------------------------------------------------------

  /**
   * 处理从 WebSocket 收到的协议消息。
   *
   * 📚 学习要点: 消息分发策略
   * 根据消息类型（message.type）分发到不同的处理器：
   * - MSG_RELAY_MESSAGE -> 聊天消息（需要解密 + 转发）
   * - MSG_MEMBER_JOINED/LEFT -> 系统消息（忽略，不转发给 Agent）
   * - MSG_RELAY_FILE_* -> 文件传输消息（收集 + 解密 + 重组）
   *
   * 系统消息（join/leave）被静默忽略（Requirement 4.4），因为：
   * - Agent 不需要知道谁加入/离开了房间（v1 不做 @mention 过滤）
   * - 转发系统消息会干扰 Agent 的对话上下文
   *
   * @param message - 解码后的协议消息
   */
  private handleProtocolMessage(message: Message): void {
    switch (message.type) {
      case MSG_RELAY_MESSAGE:
        this.handleRelayMessage(message.data as RelayMessageData);
        break;

      case MSG_RELAY_FILE_META:
        this.handleFileMeta(message.data as RelayFileMetaData);
        break;

      case MSG_RELAY_FILE_CHUNK:
        this.handleFileChunk(message.data as RelayFileChunkData);
        break;

      case MSG_RELAY_FILE_COMPLETE:
        this.handleFileComplete(message.data as RelayFileCompleteData);
        break;

      case MSG_RELAY_FILE_CANCEL:
        this.handleFileCancel(message.data as RelayFileCancelData);
        break;

      case MSG_MEMBER_JOINED:
      case MSG_MEMBER_LEFT:
        // 📚 学习要点: 系统消息过滤（Requirement 4.4）
        // join/leave 通知是系统消息，不转发给 Agent。
        // Agent 响应房间内所有非系统消息（Requirement 4.8）。
        break;

      default:
        // 其他消息类型（PING/PONG/ROOM_JOINED 等）由 client 层内部处理
        break;
    }
  }


  /**
   * 处理中转的加密聊天消息。
   *
   * 流程：
   * 1. 回环检测 — 跳过自己发送的消息（防止 Agent 回复自己的消息）
   * 2. 解密消息内容（AES-256-GCM）
   * 3. 公钥消息检测 — 如果是 PUBLIC_KEY 广播，存储公钥但不转发
   * 4. 构造 IncomingMessage 并调用 Gateway 回调
   *
   * 📚 学习要点: 回环检测（Echo Prevention, Requirement 4.5）
   * 当 Agent 发送消息到房间时，服务器会将消息中转给所有成员（包括发送者自己）。
   * 如果不过滤自己的消息，会形成无限循环：
   *   Agent 发送 -> 服务器中转 -> Agent 收到 -> Agent 回复 -> ...
   * 通过比较 senderId 和自己的 clientId 来检测并丢弃回环消息。
   *
   * @param data - 中转消息数据（包含 senderId、iv、ciphertext 等）
   */
  private handleRelayMessage(data: RelayMessageData): void {
    if (!this.key || !this.client) {
      return;
    }

    // 1. 回环检测：跳过自己发送的消息（Requirement 4.5）
    const myClientId = this.client.getClientId();
    if (data.senderId === myClientId) {
      return;
    }

    // 2. 解密消息
    let plaintext: string;
    try {
      const ivBuffer = fromBase64Url(data.iv);
      const ciphertextBuffer = fromBase64Url(data.ciphertext);
      plaintext = decrypt(ciphertextBuffer, ivBuffer, this.key);
    } catch {
      // 📚 学习要点: 解密失败的安全处理
      // 不抛出错误、不崩溃，只是忽略无法解密的消息。
      // 可能原因：密钥轮换期间的旧消息、恶意构造的消息、网络损坏。
      return;
    }

    // 3. 公钥消息检测（内部处理，不转发给 Agent）
    const publicKey = parsePublicKeyMessage(plaintext);
    if (publicKey) {
      // ISSUE-7 修复：限制 publicKeyMap 最大 50 条，防止无界增长
      if (this.publicKeyMap.size >= 50) {
        const firstKey = this.publicKeyMap.keys().next().value;
        if (firstKey) this.publicKeyMap.delete(firstKey);
      }
      this.publicKeyMap.set(data.senderId, publicKey);
      return;
    }

    // 4. 构造 IncomingMessage 并转发给 Gateway
    if (this.messageCallback) {
      const incomingMessage: IncomingMessage = {
        id: this.generateMessageId(),
        channelId: CHANNEL_ID,
        userId: data.senderId,
        userName: data.senderName,
        text: plaintext,
        timestamp: new Date(data.t),
        metadata: {
          serverTimestamp: data.t,
        },
      };

      this.messageCallback(incomingMessage);
    }
  }


  // --------------------------------------------------------------------------
  // 私有方法: 文件传输处理（入站）
  // --------------------------------------------------------------------------

  /**
   * 处理文件元数据消息（传输开始）。
   * 跳过自己发送的文件，委托给 FileReceiver 处理。
   */
  private handleFileMeta(data: RelayFileMetaData): void {
    if (!this.fileReceiver || !this.client) {
      return;
    }

    // 跳过自己发送的文件（回环检测）
    const myClientId = this.client.getClientId();
    if (data.senderId === myClientId) {
      return;
    }

    try {
      this.fileReceiver.handleMeta(data);
    } catch {
      // 元数据解密失败，静默忽略
    }
  }

  /**
   * 处理文件分片消息。
   * 跳过自己发送的文件，委托给 FileReceiver 处理。
   */
  private handleFileChunk(data: RelayFileChunkData): void {
    if (!this.fileReceiver || !this.client) {
      return;
    }

    const myClientId = this.client.getClientId();
    if (data.senderId === myClientId) {
      return;
    }

    try {
      this.fileReceiver.handleChunk(data);
    } catch {
      // 分片解密失败，静默忽略
    }
  }

  /**
   * 处理文件传输完成消息。
   * 当所有分片收齐后，重组文件并作为 IncomingMessage 的附件转发给 Gateway。
   */
  private handleFileComplete(data: RelayFileCompleteData): void {
    if (!this.fileReceiver || !this.client || !this.messageCallback) {
      return;
    }

    const myClientId = this.client.getClientId();
    if (data.senderId === myClientId) {
      return;
    }

    const receivedFile = this.fileReceiver.handleComplete(data);
    if (!receivedFile) {
      return; // 文件不完整，丢弃
    }

    // 构造带附件的 IncomingMessage 转发给 Gateway
    const attachment: MessageAttachment = {
      fileName: receivedFile.name,
      mimeType: receivedFile.mimeType,
      size: receivedFile.size,
      data: receivedFile.data,
    };

    const incomingMessage: IncomingMessage = {
      id: this.generateMessageId(),
      channelId: CHANNEL_ID,
      userId: data.senderId,
      userName: receivedFile.senderName,
      text: `[文件] ${receivedFile.name}`,
      timestamp: new Date(),
      attachments: [attachment],
    };

    this.messageCallback(incomingMessage);
  }

  /**
   * 处理文件传输取消消息。
   * 委托给 FileReceiver 清理缓冲区。
   */
  private handleFileCancel(data: RelayFileCancelData): void {
    if (!this.fileReceiver) {
      return;
    }
    this.fileReceiver.handleCancel(data);
  }


  // --------------------------------------------------------------------------
  // 私有方法: 消息发送（出站）
  // --------------------------------------------------------------------------

  /**
   * 加密并发送单条文本消息。
   *
   * 📚 学习要点: 加密发送流程
   * 1. encrypt(plaintext, key) -> { ciphertext, iv }
   * 2. toBase64Url(iv) -> base64url 编码的 IV 字符串
   * 3. toBase64Url(ciphertext) -> base64url 编码的密文字符串
   * 4. client.sendMessage(ivBase64, ciphertextBase64) -> 通过 WebSocket 发送
   *
   * @param text - 待发送的明文字符串
   */
  private sendEncryptedText(text: string): void {
    if (!this.client || !this.key) {
      throw new Error('无法发送消息: 适配器未连接');
    }

    const { ciphertext, iv } = encrypt(text, this.key);
    const ivBase64 = toBase64Url(iv);
    const ciphertextBase64 = toBase64Url(ciphertext);

    this.client.sendMessage(ivBase64, ciphertextBase64);
  }

  /**
   * 发送文件附件。
   *
   * 使用 FileSender 将文件分片加密，生成消息序列后逐条发送。
   *
   * 📚 学习要点: 文件发送流程
   * 1. FileSender.prepareTransfer() 生成 META + CHUNK*N + COMPLETE 消息序列
   * 2. 对每条消息调用 encodeMessage() 编码为 msgpack 二进制
   * 3. 通过 client.sendBinary() 发送原始二进制帧
   *
   * @param attachments - 要发送的文件附件列表
   */
  private sendFileAttachments(attachments: MessageAttachment[]): void {
    if (!this.fileSender || !this.client) {
      return;
    }

    for (const attachment of attachments) {
      const fileData = Buffer.isBuffer(attachment.data)
        ? attachment.data
        : Buffer.from(attachment.data);

      const messages = this.fileSender.prepareTransfer(fileData, {
        name: attachment.fileName,
        size: attachment.size,
        mimeType: attachment.mimeType,
      });

      for (const msg of messages) {
        const binary = encodeMessage(msg.type, msg.data);
        this.client.sendBinary(binary);
      }
    }
  }

  /**
   * 广播 Agent 的 Ed25519 公钥到房间。
   *
   * 📚 学习要点: 公钥广播时机（Requirement 2.6）
   * 在 connect() 成功后立即广播，确保：
   * - 房间内已有的成员能立即获取 Agent 的公钥
   * - 公钥通过加密消息发送（与普通聊天消息相同的加密流程）
   * - 服务器无法知道这是公钥广播（零知识）
   */
  private broadcastPublicKey(): void {
    if (!this.signingKeyPair) {
      return;
    }

    const publicKeyMessage = formatPublicKeyMessage(this.signingKeyPair.publicKey);
    this.sendEncryptedText(publicKeyMessage);
  }


  // --------------------------------------------------------------------------
  // 私有方法: 工具函数
  // --------------------------------------------------------------------------

  /**
   * 将长消息拆分为多个不超过 MAX_MESSAGE_LENGTH 的片段。
   *
   * 📚 学习要点: 分割策略
   * 优先在换行符处分割（保持可读性），如果没有合适的换行符则按固定长度分割。
   * 这比简单的 substring 分割更友好，避免在单词或代码块中间断开。
   *
   * @param text - 原始消息文本
   * @returns 分割后的消息片段数组（每片 <= 4000 字符）
   */
  private splitMessage(text: string): string[] {
    if (text.length <= MAX_MESSAGE_LENGTH) {
      return [text];
    }

    const parts: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= MAX_MESSAGE_LENGTH) {
        parts.push(remaining);
        break;
      }

      // 尝试在换行符处分割（更好的可读性）
      let splitIndex = remaining.lastIndexOf('\n', MAX_MESSAGE_LENGTH);
      if (splitIndex <= 0 || splitIndex < MAX_MESSAGE_LENGTH * 0.5) {
        // 没有合适的换行符，或换行符太靠前，直接按长度分割
        splitIndex = MAX_MESSAGE_LENGTH;
      }

      parts.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex);

      // 如果在换行符处分割，跳过换行符本身（避免空行）
      if (remaining.startsWith('\n')) {
        remaining = remaining.slice(1);
      }
    }

    return parts;
  }

  /**
   * 生成唯一消息 ID。
   *
   * 📚 学习要点: 消息 ID 生成策略
   * 使用 Node.js 内置的 randomUUID() 生成 UUID v4。
   * 这提供了足够的唯一性（碰撞概率约 2^(-122)），且不依赖外部库。
   * Gateway 使用此 ID 进行消息去重和引用追踪。
   *
   * @returns UUID v4 格式的消息 ID
   */
  private generateMessageId(): string {
    return randomUUID();
  }
}
