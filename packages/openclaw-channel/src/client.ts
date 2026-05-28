/**
 * @file client.ts - Arthas WebSocket 客户端
 *
 * 本文件实现与 Arthas 服务器的 WebSocket 通信层。
 * 职责：
 * 1. 建立 WSS 连接到 Arthas 服务器
 * 2. 发送 JOIN 消息加入房间
 * 3. 发送加密消息（MSG_SEND_MESSAGE）
 * 4. 接收并分发服务器推送的消息（MSG_RELAY_MESSAGE）
 * 5. 心跳机制（响应服务器 PING，检测连接存活）
 * 6. 优雅关闭连接（发送 LEAVE_ROOM 后关闭 WebSocket）
 *
 * 📚 学习要点: WebSocket 客户端设计
 * 与浏览器端不同，Node.js 环境需要使用 `ws` 库实现 WebSocket 客户端。
 * 关键设计决策：
 * - 使用二进制帧（非文本帧），因为 msgpack 编码为 Uint8Array
 * - 心跳机制防止 NAT/防火墙超时断开空闲连接
 * - 本模块只负责连接管理和消息收发，不处理重连（Task 4.2 负责）
 *
 * 📚 学习要点: 事件驱动架构（Event-Driven Architecture）
 * 客户端使用回调注册模式分发事件：
 * - onMessage: 收到解码后的协议消息时触发
 * - onStatusChange: 连接状态变化时触发
 * - onError: 发生错误时触发
 * 这种模式比 EventEmitter 更类型安全，且只有一个消费者（adapter 层）。
 *
 * @module openclaw-channel/client
 * @see design.md - D6: 重连策略
 * @see requirements.md - Requirement 1.2, 1.3, 1.7: WebSocket 连接
 * @see official_doc/protocol.md - 协议规范
 */

import WebSocket from 'ws';

import {
  encodeMessage,
  decodeMessage,
  MSG_JOIN_ROOM,
  MSG_SEND_MESSAGE,
  MSG_LEAVE_ROOM,
  MSG_TYPING,
  MSG_PONG,
  MSG_PING,
  MSG_ROOM_JOINED,
} from './protocol.js';

import type {
  Message,
  JoinRoomData,
  SendMessageData,
  LeaveRoomData,
  TypingData,
  PongData,
  PingData,
  RoomJoinedData,
} from './protocol.js';

import type { ConnectionStatus } from './types.js';


// ============================================================================
// 常量定义
// ============================================================================

/**
 * 心跳超时时间（毫秒）。
 *
 * 📚 学习要点: 心跳超时检测
 * Arthas 服务器每 25 秒发送一次 PING。如果 60 秒内未收到 PING，
 * 说明连接可能已经断开（网络故障、服务器崩溃等）。
 * 60s = 2.4 个 PING 周期，给予足够的容错空间（允许丢失 1-2 个 PING）。
 */
const HEARTBEAT_TIMEOUT_MS = 60_000;

/**
 * WebSocket 关闭码：正常关闭。
 * RFC 6455 定义的标准关闭码，表示连接正常终止。
 */
const WS_CLOSE_NORMAL = 1000;

// ============================================================================
// 客户端事件回调类型
// ============================================================================

/**
 * 消息接收回调类型。
 *
 * 当 WebSocket 收到服务器消息并完成 msgpack 解码后调用。
 * adapter 层根据 message.type 决定如何处理（解密、转发等）。
 */
export type MessageCallback = (message: Message) => void;

/**
 * 连接状态变化回调类型。
 *
 * 当连接状态发生变化时调用（connected → disconnected 等）。
 * adapter 层可以据此更新健康检查状态或触发重连。
 */
export type StatusCallback = (status: ConnectionStatus) => void;

/**
 * 错误回调类型。
 *
 * 当发生不可恢复的错误时调用（连接失败、协议错误等）。
 * error 参数包含错误详情，供日志记录和诊断使用。
 */
export type ErrorCallback = (error: Error) => void;

// ============================================================================
// 客户端配置接口
// ============================================================================

/**
 * ArthasClient 构造选项。
 *
 * 📚 学习要点: 配置与实现分离
 * 客户端的配置通过构造函数注入，而非从环境变量直接读取。
 * 这样做的好处：
 * - 可测试性：测试可以传入 mock 配置
 * - 灵活性：adapter 层可以从任何来源加载配置后传入
 * - 单一职责：client 只负责通信，不负责配置加载
 */
export interface ArthasClientOptions {
  /** Arthas 服务器 WebSocket URL（wss:// 或 ws://） */
  serverUrl: string;
}


// ============================================================================
// ArthasClient 类
// ============================================================================

/**
 * Arthas WebSocket 客户端。
 *
 * 负责与 Arthas 服务器的底层 WebSocket 通信，包括：
 * - 连接建立与关闭
 * - 消息编码（msgpack）与发送
 * - 消息接收与解码
 * - 心跳检测（响应服务器 PING）
 *
 * 📚 学习要点: 职责边界
 * ArthasClient 只负责「传输层」：
 * - 建立/关闭 WebSocket 连接
 * - 编码/解码 msgpack 消息
 * - 心跳保活
 * - 将解码后的消息分发给上层
 *
 * 它不负责：
 * - 加密/解密消息内容（由 adapter 层使用 crypto.ts 处理）
 * - 自动重连（由 Task 4.2 的重连模块处理）
 * - 消息过滤（由 adapter 层处理系统消息过滤和回环检测）
 *
 * 生命周期：
 * 1. 构造实例：new ArthasClient({ serverUrl })
 * 2. 注册回调：client.onMessage(cb), client.onStatusChange(cb), client.onError(cb)
 * 3. 建立连接：await client.connect()
 * 4. 加入房间：await client.join(roomId, displayName, password)
 * 5. 发送消息：client.sendMessage(iv, ciphertext)
 * 6. 断开连接：await client.disconnect()
 */
export class ArthasClient {
  // --------------------------------------------------------------------------
  // 私有属性
  // --------------------------------------------------------------------------

  /** WebSocket 实例（连接建立后赋值，断开后置 null） */
  private ws: WebSocket | null = null;

  /** 服务器 URL */
  private readonly serverUrl: string;

  /**
   * 服务器分配的客户端 ID。
   *
   * 📚 学习要点: 客户端 ID 的来源
   * 客户端 ID 由服务器在 ROOM_JOINED 响应中通过 members 列表间接提供。
   * 服务器在客户端连接时分配 UUID 前 8 位作为 clientId，
   * 客户端通过比较 ROOM_JOINED 中的 members 列表确定自己的 ID
   * （自己是最后加入的成员）。
   */
  private clientId: string | null = null;

  /** 当前连接状态 */
  private status: ConnectionStatus = 'disconnected';

  /** 消息接收回调 */
  private messageCallback: MessageCallback | null = null;

  /** 连接状态变化回调 */
  private statusCallback: StatusCallback | null = null;

  /** 错误回调 */
  private errorCallback: ErrorCallback | null = null;

  /**
   * 心跳超时定时器。
   *
   * 📚 学习要点: 心跳检测机制
   * Arthas 服务器每 25 秒发送 PING，客户端需要回复 PONG。
   * 本客户端使用「被动心跳检测」策略：
   * - 每次收到 PING 时重置 60 秒超时定时器
   * - 如果 60 秒内未收到 PING，认为连接已死
   * - 超时后触发 'disconnected' 状态变化，由上层决定是否重连
   *
   * 为什么不使用「主动心跳」（客户端定时发 PING）？
   * - Arthas 协议规定由服务器发起 PING，客户端只需回复 PONG
   * - 减少客户端的定时器数量，简化状态管理
   * - 服务器端已有超时检测，客户端无需重复实现
   */
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 当前已加入的房间 ID（用于重连后自动重新加入）。
   */
  private currentRoomId: string | null = null;

  /**
   * 当前显示名称（用于重连后自动重新加入）。
   */
  private currentDisplayName: string | null = null;

  /**
   * 当前房间密码（用于重连后自动重新加入）。
   */
  private currentPassword: string = '';

  // --------------------------------------------------------------------------
  // 构造函数
  // --------------------------------------------------------------------------

  /**
   * 创建 ArthasClient 实例。
   *
   * @param options - 客户端配置选项
   *
   * @example
   * ```typescript
   * const client = new ArthasClient({
   *   serverUrl: 'wss://your-arthas-server.com/ws',
   * });
   * ```
   */
  constructor(options: ArthasClientOptions) {
    this.serverUrl = options.serverUrl;
  }

  // --------------------------------------------------------------------------
  // 公共 API: 回调注册
  // --------------------------------------------------------------------------

  /**
   * 注册消息接收回调。
   *
   * 当 WebSocket 收到服务器消息并完成 msgpack 解码后，
   * 调用此回调将结构化消息传递给上层（adapter）。
   *
   * 📚 学习要点: 单回调 vs EventEmitter
   * 使用单回调而非 EventEmitter 的原因：
   * - 只有一个消费者（ArthasChannelAdapter），不需要多播
   * - 类型安全更好（回调参数有明确的 Message 类型）
   * - 更简单，不需要管理监听器的注册/注销
   * - 避免内存泄漏（EventEmitter 忘记 removeListener 会泄漏）
   *
   * @param callback - 消息到达时的回调函数
   */
  onMessage(callback: MessageCallback): void {
    this.messageCallback = callback;
  }

  /**
   * 注册连接状态变化回调。
   *
   * @param callback - 状态变化时的回调函数
   */
  onStatusChange(callback: StatusCallback): void {
    this.statusCallback = callback;
  }

  /**
   * 注册错误回调。
   *
   * @param callback - 错误发生时的回调函数
   */
  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }


  // --------------------------------------------------------------------------
  // 公共 API: 连接管理
  // --------------------------------------------------------------------------

  /**
   * 建立 WebSocket 连接到 Arthas 服务器。
   *
   * 连接流程：
   * 1. 创建 WebSocket 实例（ws 库）
   * 2. 等待 'open' 事件确认连接建立
   * 3. 注册 'message'、'close'、'error' 事件处理器
   * 4. 启动心跳超时检测
   * 5. 更新状态为 'connected'
   *
   * 📚 学习要点: Promise 包装事件驱动 API
   * WebSocket 连接是异步事件驱动的（open/error 事件），
   * 但调用方期望 async/await 风格的 API。
   * 使用 Promise 包装：resolve on 'open'，reject on 'error'。
   * 这是 Node.js 中将回调/事件 API 转换为 Promise 的标准模式。
   *
   * @throws 如果连接失败（服务器不可达、URL 无效、TLS 错误等）
   *
   * @example
   * ```typescript
   * const client = new ArthasClient({ serverUrl: 'wss://server.com/ws' });
   * await client.connect(); // 等待连接建立
   * ```
   */
  async connect(): Promise<void> {
    // 防止重复连接
    if (this.ws && this.status === 'connected') {
      return;
    }

    this.updateStatus('connecting');

    return new Promise<void>((resolve, reject) => {
      try {
        // 📚 学习要点: ws 库的 WebSocket 构造
        // ws 库是 Node.js 最流行的 WebSocket 实现，API 与浏览器 WebSocket 类似。
        // 构造时传入 URL，自动发起 HTTP Upgrade 握手。
        // 对于 wss:// URL，ws 库自动使用 TLS（通过 Node.js 的 tls 模块）。
        this.ws = new WebSocket(this.serverUrl);

        // 设置二进制类型为 Buffer（Node.js 环境默认）
        this.ws.binaryType = 'nodebuffer';

        // 连接成功
        this.ws.once('open', () => {
          this.updateStatus('connected');
          this.startHeartbeatTimer();
          resolve();
        });

        // 连接失败（仅在连接阶段触发）
        this.ws.once('error', (err: Error) => {
          // ISSUE-5 修复：连接失败时清理 WebSocket 和监听器
          if (this.ws) {
            this.ws.removeAllListeners();
            this.ws = null;
          }
          this.updateStatus('error');
          reject(new Error(`WebSocket 连接失败: ${err.message}`));
        });

        // 注册持久事件处理器
        this.ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
          this.handleRawMessage(data);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.handleClose(code, reason.toString('utf8'));
        });

        // 连接建立后的错误处理（替换 once error）
        this.ws.on('error', (err: Error) => {
          // 连接建立后的错误（非初始连接错误）
          if (this.status === 'connected') {
            this.emitError(new Error(`WebSocket 错误: ${err.message}`));
          }
        });
      } catch (err) {
        this.updateStatus('error');
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * 加入 Arthas 房间。
   *
   * 发送 MSG_JOIN_ROOM 消息到服务器，包含房间 ID、显示名称和密码哈希。
   * 服务器响应 MSG_ROOM_JOINED 表示加入成功。
   *
   * 📚 学习要点: 加入房间的认证流程
   * Arthas 的房间认证是「知识证明」模式：
   * - 客户端持有分享码 = 证明有权加入房间
   * - 密码保护的房间需要额外提供密码的 SHA-256 哈希
   * - 服务器验证 roomId 存在 + 密码哈希匹配后允许加入
   * - 加密密钥不发送给服务器（零知识）
   *
   * @param roomId - 房间 ID（21 字符 NanoID）
   * @param displayName - 在房间中显示的名称
   * @param password - 房间密码的 SHA-256 哈希（空字符串表示无密码）
   *
   * @example
   * ```typescript
   * await client.join('V1StGXR8_Z5jdHi6B-myT', 'AI Assistant', '');
   * ```
   */
  async join(roomId: string, displayName: string, password: string = ''): Promise<void> {
    if (!this.ws || this.status !== 'connected') {
      throw new Error('无法加入房间: WebSocket 未连接');
    }

    // 保存加入信息（供重连后使用）
    this.currentRoomId = roomId;
    this.currentDisplayName = displayName;
    this.currentPassword = password;

    // 构造 JOIN 消息
    const joinData: JoinRoomData = {
      roomId,
      name: displayName,
      password,
    };

    // 编码并发送
    this.sendRaw(encodeMessage(MSG_JOIN_ROOM, joinData));
  }


  /**
   * 发送加密聊天消息。
   *
   * 将已加密的消息内容（iv + ciphertext）通过 MSG_SEND_MESSAGE 发送到服务器。
   * 服务器会将消息原样中转给房间内其他成员（零知识中转）。
   *
   * 📚 学习要点: 加密消息的传输格式
   * iv 和 ciphertext 都使用 base64url 编码传输（与 Web/CLI 客户端一致）。
   * 服务器对这两个字段完全不透明处理，只做转发。
   * 加密/解密逻辑在 adapter 层完成，client 层只负责传输。
   *
   * @param iv - 加密 IV 的 base64url 编码字符串（12 字节 → 16 字符）
   * @param ciphertext - 加密密文 + GCM auth tag 的 base64url 编码字符串
   * @throws 如果 WebSocket 未连接
   *
   * @example
   * ```typescript
   * const { ciphertext, iv } = encrypt(plaintext, key);
   * client.sendMessage(toBase64Url(iv), toBase64Url(ciphertext));
   * ```
   */
  sendMessage(iv: string, ciphertext: string): void {
    if (!this.ws || this.status !== 'connected') {
      throw new Error('无法发送消息: WebSocket 未连接');
    }

    const sendData: SendMessageData = { iv, ciphertext };
    this.sendRaw(encodeMessage(MSG_SEND_MESSAGE, sendData));
  }

  /**
   * 发送输入状态通知。
   *
   * 通知房间内其他成员当前的输入状态（正在输入/停止输入）。
   * 注意：typing 状态是未加密的元数据，服务器可见。
   *
   * @param typing - true 表示正在输入，false 表示停止输入
   */
  sendTyping(typing: boolean): void {
    if (!this.ws || this.status !== 'connected') {
      return; // typing 状态丢失不影响功能，静默忽略
    }

    const typingData: TypingData = { typing };
    this.sendRaw(encodeMessage(MSG_TYPING, typingData));
  }

  /**
   * 发送原始 msgpack 编码的二进制数据。
   *
   * 供 adapter 层直接发送已编码的消息（如文件传输消息）。
   * 这是一个低级 API，通常应使用 sendMessage() 等高级方法。
   *
   * @param data - msgpack 编码后的二进制数据
   * @throws 如果 WebSocket 未连接
   */
  sendBinary(data: Uint8Array): void {
    if (!this.ws || this.status !== 'connected') {
      throw new Error('无法发送数据: WebSocket 未连接');
    }

    this.sendRaw(data);
  }

  /**
   * 优雅关闭连接。
   *
   * 关闭流程：
   * 1. 发送 MSG_LEAVE_ROOM 通知服务器（如果已加入房间）
   * 2. 停止心跳定时器
   * 3. 关闭 WebSocket 连接（正常关闭码 1000）
   * 4. 清理内部状态
   *
   * 📚 学习要点: 优雅关闭 vs 强制关闭
   * 优雅关闭（graceful shutdown）确保：
   * - 服务器知道客户端主动离开（而非网络故障）
   * - 房间内其他成员收到 MemberLeft 通知
   * - 服务器可以立即清理资源（而非等待超时）
   *
   * 如果 WebSocket 已经断开（网络故障），LEAVE 消息发送会静默失败，
   * 服务器会在心跳超时后自动清理。
   *
   * @example
   * ```typescript
   * await client.disconnect();
   * // 连接已关闭，所有资源已清理
   * ```
   */
  async disconnect(): Promise<void> {
    // 停止心跳检测
    this.stopHeartbeatTimer();

    // 如果已加入房间，发送 LEAVE 消息
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentRoomId) {
      try {
        const leaveData: LeaveRoomData = {};
        this.sendRaw(encodeMessage(MSG_LEAVE_ROOM, leaveData));
      } catch {
        // LEAVE 发送失败不影响关闭流程（服务器会超时清理）
      }
    }

    // 关闭 WebSocket 连接
    if (this.ws) {
      // 移除所有事件监听器，防止 close 事件触发状态变化
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(WS_CLOSE_NORMAL, 'client disconnect');
      }
      this.ws = null;
    }

    // 清理状态
    this.clientId = null;
    this.currentRoomId = null;
    this.currentDisplayName = null;
    this.currentPassword = '';
    this.updateStatus('disconnected');
  }


  // --------------------------------------------------------------------------
  // 公共 API: 状态查询
  // --------------------------------------------------------------------------

  /**
   * 获取当前连接状态。
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * 获取服务器分配的客户端 ID。
   * 在收到 ROOM_JOINED 响应后可用。
   */
  getClientId(): string | null {
    return this.clientId;
  }

  /**
   * 获取当前已加入的房间 ID。
   */
  getRoomId(): string | null {
    return this.currentRoomId;
  }

  /**
   * 获取当前显示名称。
   */
  getDisplayName(): string | null {
    return this.currentDisplayName;
  }

  /**
   * 检查 WebSocket 是否处于打开状态。
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // --------------------------------------------------------------------------
  // 私有方法: 消息处理
  // --------------------------------------------------------------------------

  /**
   * 处理 WebSocket 收到的原始二进制消息。
   *
   * 流程：
   * 1. 将 Buffer/ArrayBuffer 转换为 Uint8Array
   * 2. 使用 msgpack 解码为结构化消息 { type, data }
   * 3. 根据消息类型执行内部处理（如 PING → 回复 PONG）
   * 4. 将消息分发给上层回调
   *
   * 📚 学习要点: 消息分层处理
   * client 层处理的消息类型（内部消费，不转发给上层）：
   * - MSG_PING: 自动回复 PONG（心跳保活）
   * - MSG_ROOM_JOINED: 提取 clientId（自身标识）
   *
   * client 层转发给上层的消息类型（adapter 层处理）：
   * - MSG_RELAY_MESSAGE: 需要解密
   * - MSG_MEMBER_JOINED/LEFT: 系统通知
   * - MSG_ERROR: 错误处理
   * - MSG_ROOM_CLOSED: 房间关闭
   * - 文件传输相关消息
   *
   * @param rawData - WebSocket 收到的原始数据
   */
  private handleRawMessage(rawData: Buffer | ArrayBuffer | Buffer[]): void {
    try {
      // 1. 统一转换为 Uint8Array
      let buffer: Uint8Array;
      if (Buffer.isBuffer(rawData)) {
        buffer = rawData;
      } else if (rawData instanceof ArrayBuffer) {
        buffer = new Uint8Array(rawData);
      } else {
        // Buffer[] 情况：合并为单个 Buffer
        buffer = Buffer.concat(rawData);
      }

      // 2. msgpack 解码
      const message = decodeMessage(buffer);

      // 3. 内部处理特定消息类型
      this.handleInternalMessage(message);

      // 4. 分发给上层回调
      if (this.messageCallback) {
        this.messageCallback(message);
      }
    } catch (err) {
      // 解码失败不应该导致连接断开，记录错误并继续
      this.emitError(
        new Error(`消息解码失败: ${err instanceof Error ? err.message : String(err)}`)
      );
    }
  }

  /**
   * 处理需要客户端内部响应的消息类型。
   *
   * @param message - 解码后的协议消息
   */
  private handleInternalMessage(message: Message): void {
    switch (message.type) {
      case MSG_PING:
        this.handlePing(message.data as PingData);
        break;

      case MSG_ROOM_JOINED:
        this.handleRoomJoined(message.data as RoomJoinedData);
        break;

      default:
        // 其他消息类型由上层处理，此处不做额外操作
        break;
    }
  }

  /**
   * 处理服务器心跳请求（MSG_PING）。
   *
   * 📚 学习要点: PING/PONG 心跳协议
   * Arthas 服务器每 25 秒发送 PING（包含服务器时间戳 t）。
   * 客户端必须回复 PONG（原样返回时间戳 t）。
   * 服务器通过 PONG 的时间戳计算 RTT（Round-Trip Time）。
   *
   * 如果客户端 45 秒内未回复 PONG，服务器会断开连接。
   * 因此客户端收到 PING 后应立即回复，不做延迟。
   *
   * @param data - PING 消息数据（包含服务器时间戳）
   */
  private handlePing(data: PingData): void {
    // 回复 PONG（原样返回时间戳）
    const pongData: PongData = { t: data.t };
    try {
      this.sendRaw(encodeMessage(MSG_PONG, pongData));
    } catch {
      // PONG 发送失败说明连接已断开，会通过 close 事件处理
    }

    // 重置心跳超时定时器
    this.resetHeartbeatTimer();
  }

  /**
   * 处理加入房间成功响应（MSG_ROOM_JOINED）。
   *
   * 📚 学习要点: 确定自身 clientId
   * 服务器不会直接告诉客户端"你的 ID 是 xxx"。
   * 客户端通过 ROOM_JOINED 响应中的 members 列表推断自己的 ID：
   * - 自己是最后加入的成员（列表中最后一个元素）
   * 这是 Arthas 协议的约定，Web 和 CLI 客户端都使用相同的逻辑。
   *
   * @param data - ROOM_JOINED 响应数据
   */
  private handleRoomJoined(data: RoomJoinedData): void {
    // 自己是最后加入的成员（members 列表的最后一个）
    if (data.members && data.members.length > 0) {
      const lastMember = data.members[data.members.length - 1];
      if (lastMember) {
        this.clientId = lastMember.id;
      }
    }
  }


  // --------------------------------------------------------------------------
  // 私有方法: 连接事件处理
  // --------------------------------------------------------------------------

  /**
   * 处理 WebSocket 关闭事件。
   *
   * 📚 学习要点: WebSocket 关闭码语义
   * - 1000: 正常关闭（客户端主动断开）
   * - 1001: Going Away（服务器关闭）
   * - 1006: 异常关闭（网络中断，无 close frame）
   * - 1011: 服务器内部错误
   *
   * 对于非正常关闭（code !== 1000），上层可能需要触发重连。
   * 本方法只负责清理状态和通知上层，不做重连决策。
   *
   * @param code - WebSocket 关闭码
   * @param reason - 关闭原因描述
   */
  private handleClose(code: number, reason: string): void {
    // 停止心跳检测
    this.stopHeartbeatTimer();

    // 清理 WebSocket 引用
    this.ws = null;

    // 更新状态
    this.updateStatus('disconnected');

    // 如果是非正常关闭，通知上层
    if (code !== WS_CLOSE_NORMAL) {
      this.emitError(
        new Error(`WebSocket 连接关闭: code=${code}, reason="${reason || 'unknown'}"`)
      );
    }
  }

  // --------------------------------------------------------------------------
  // 私有方法: 心跳机制
  // --------------------------------------------------------------------------

  /**
   * 启动心跳超时检测定时器。
   *
   * 在连接建立后调用。如果 60 秒内未收到服务器 PING，
   * 认为连接已死，触发断开处理。
   */
  private startHeartbeatTimer(): void {
    this.stopHeartbeatTimer();
    this.heartbeatTimer = setTimeout(() => {
      this.handleHeartbeatTimeout();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  /**
   * 重置心跳超时定时器。
   *
   * 每次收到服务器 PING 时调用，重新开始 60 秒倒计时。
   */
  private resetHeartbeatTimer(): void {
    this.startHeartbeatTimer();
  }

  /**
   * 停止心跳超时定时器。
   *
   * 在断开连接或关闭时调用，清理定时器资源。
   */
  private stopHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 处理心跳超时。
   *
   * 📚 学习要点: 心跳超时的处理策略
   * 心跳超时意味着连接可能已经断开（但 TCP 层尚未检测到）。
   * 常见原因：
   * - 网络中断（WiFi 断开、移动网络切换）
   * - NAT 超时（长时间无数据传输，NAT 表项过期）
   * - 服务器崩溃（无法发送 PING）
   *
   * 处理方式：主动关闭 WebSocket，触发 close 事件，
   * 由上层（重连模块）决定是否重连。
   */
  private handleHeartbeatTimeout(): void {
    this.emitError(new Error('心跳超时: 60 秒内未收到服务器 PING'));

    // 主动关闭连接（触发 close 事件 → handleClose → 状态变为 disconnected）
    if (this.ws) {
      this.ws.close(4000, 'heartbeat timeout');
    }
  }

  // --------------------------------------------------------------------------
  // 私有方法: 工具函数
  // --------------------------------------------------------------------------

  /**
   * 发送原始二进制数据到 WebSocket。
   *
   * 📚 学习要点: WebSocket 发送模式
   * ws 库的 send() 方法支持 Buffer、ArrayBuffer、Uint8Array 等类型。
   * 对于 Uint8Array，ws 库会自动以 Binary Frame 发送（opcode 0x02）。
   * 这与 Arthas 服务器期望的格式一致（msgpack 二进制帧）。
   *
   * @param data - 要发送的二进制数据
   */
  private sendRaw(data: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接，无法发送数据');
    }

    this.ws.send(data);
  }

  /**
   * 更新连接状态并通知上层。
   *
   * @param newStatus - 新的连接状态
   */
  private updateStatus(newStatus: ConnectionStatus): void {
    if (this.status === newStatus) {
      return; // 状态未变化，不触发回调
    }

    this.status = newStatus;

    if (this.statusCallback) {
      this.statusCallback(newStatus);
    }
  }

  /**
   * 触发错误回调。
   *
   * @param error - 错误对象
   */
  private emitError(error: Error): void {
    if (this.errorCallback) {
      this.errorCallback(error);
    }
  }
}
