/**
 * @file reconnect.ts — 自动重连管理器
 *
 * 本文件实现 WebSocket 连接的自动重连逻辑，包装 ArthasClient 提供：
 * 1. 指数退避重连（1s → 2s → 4s → 8s → 16s → 30s max）
 * 2. 重连后自动重新加入房间（使用保存的 roomId、displayName、password）
 * 3. 连接状态事件分发（connected、disconnected、reconnecting）
 * 4. 可配置的最大重连次数（默认无限重试）
 * 5. 不可恢复错误检测（无效分享码、房间不存在时进入休眠状态）
 *
 * 📚 学习要点: 重连策略设计
 * 自动重连是长连接应用的核心可靠性机制。关键设计决策：
 * - 指数退避（Exponential Backoff）：避免服务器恢复时被大量客户端同时重连压垮
 * - 最大延迟上限（30s）：避免退避时间无限增长导致用户体验过差
 * - 不可恢复错误检测：避免对永远不会成功的连接无限重试（浪费资源）
 * - 重连后自动重新加入房间：对上层透明，减少 adapter 层的复杂度
 *
 * 📚 学习要点: 职责分离
 * ReconnectManager 只负责「何时重连」和「重连后恢复状态」，
 * 不负责「如何连接」（由 ArthasClient 处理）。
 * 这种分层设计让每个模块都可以独立测试和替换。
 *
 * @module openclaw-channel/reconnect
 * @see design.md — D6: 重连策略
 * @see requirements.md — Requirement 6.3, 6.4: 重连与错误处理
 */

import { ArthasClient } from './client';
import type { ConnectionStatus } from './types';

// ============================================================================
// 常量定义
// ============================================================================

/**
 * 指数退避延迟序列（毫秒）。
 *
 * 📚 学习要点: 指数退避（Exponential Backoff）
 * 退避延迟按 2 的幂次增长：1s, 2s, 4s, 8s, 16s, 30s。
 * 为什么使用固定序列而非公式计算？
 * - 可读性更好（一眼看出所有可能的延迟值）
 * - 最大值 30s 是硬编码的上限（不会因为计算错误超出）
 * - 便于测试（可以直接断言延迟值）
 *
 * 为什么最大延迟是 30s 而非更长？
 * - 用户体验：30s 是用户愿意等待重连的心理上限
 * - 服务器恢复：大多数短暂故障在 30s 内恢复
 * - 如果 30s 后仍无法连接，持续以 30s 间隔重试（不放弃）
 */
const BACKOFF_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 16000, 30000];

/**
 * 不可恢复的错误关键词列表。
 *
 * 📚 学习要点: 不可恢复错误检测
 * 某些错误表明重连永远不会成功（如房间已删除、分享码无效）。
 * 对这些错误继续重试是浪费资源，应该进入休眠状态。
 * 检测方式：匹配错误消息中的关键词（服务器返回的错误描述）。
 *
 * 注意：这种基于字符串匹配的检测方式不够健壮（服务器可能改变错误消息），
 * 但在没有结构化错误码的情况下，这是最实用的方案。
 * 未来可以通过协议升级添加错误码来改进。
 */
const UNRECOVERABLE_ERROR_PATTERNS: readonly string[] = [
  'invalid share code',
  'room not found',
  'room does not exist',
  'invalid room',
  'share code expired',
];

// ============================================================================
// 重连管理器配置接口
// ============================================================================

/**
 * ReconnectManager 构造选项。
 *
 * 📚 学习要点: 可配置性设计
 * 将重连行为的关键参数暴露为配置选项，让使用方可以根据场景调整：
 * - 开发环境：可能设置较小的 maxRetries 避免无限重试干扰调试
 * - 生产环境：使用默认的无限重试，确保最大可用性
 * - 测试环境：可以设置 maxRetries=0 禁用重连，简化测试
 */
export interface ReconnectManagerOptions {
  /**
   * 最大重连尝试次数。
   * - Infinity（默认）：无限重试，永不放弃
   * - 0：禁用自动重连
   * - N > 0：最多重试 N 次后进入 error 状态
   */
  maxRetries?: number;
}

// ============================================================================
// 重连状态回调类型
// ============================================================================

/**
 * 重连状态变化回调类型。
 *
 * ReconnectManager 在以下状态转换时触发此回调：
 * - 'connected': 连接建立成功（首次连接或重连成功）
 * - 'disconnected': 连接断开（正常关闭或被 stop() 停止）
 * - 'reconnecting': 正在尝试重连（包含当前尝试次数信息）
 */
export type ReconnectStatusCallback = (status: ConnectionStatus) => void;

// ============================================================================
// ReconnectManager 类
// ============================================================================

/**
 * WebSocket 自动重连管理器。
 *
 * 包装 ArthasClient，在连接断开时自动执行指数退避重连，
 * 并在重连成功后自动重新加入房间。对上层（adapter）透明，
 * adapter 只需要关注消息收发，不需要处理重连逻辑。
 *
 * 📚 学习要点: 装饰器模式（Decorator Pattern）
 * ReconnectManager 是 ArthasClient 的装饰器：
 * - 不修改 ArthasClient 的行为（开放-封闭原则）
 * - 在 ArthasClient 之上添加重连能力
 * - 对上层暴露相同的状态查询接口
 *
 * 为什么不把重连逻辑直接放在 ArthasClient 中？
 * - 单一职责：ArthasClient 只负责连接管理和消息收发
 * - 可测试性：可以单独测试重连逻辑（mock ArthasClient）
 * - 可选性：某些场景不需要自动重连（如一次性脚本）
 *
 * 生命周期：
 * 1. 构造实例：new ReconnectManager(client, options)
 * 2. 注册状态回调：manager.onStatusChange(cb)
 * 3. 首次连接并加入房间：await manager.connectAndJoin(roomId, name, password)
 * 4. 运行期间：连接断开时自动重连 + 重新加入
 * 5. 停止重连：manager.stop()（取消所有待处理的重连定时器）
 *
 * 状态转换图：
 * ```
 * [disconnected] ──connect()──→ [connecting] ──success──→ [connected]
 *                                    │                         │
 *                                    │ fail                    │ disconnect
 *                                    ▼                         ▼
 *                              [reconnecting] ←──────── [disconnected]
 *                                    │                         ▲
 *                                    │ success                 │ stop() / maxRetries
 *                                    ▼                         │
 *                              [connected]              [error/disconnected]
 * ```
 */
export class ReconnectManager {
  // --------------------------------------------------------------------------
  // 私有属性
  // --------------------------------------------------------------------------

  /** 被包装的 ArthasClient 实例 */
  private readonly client: ArthasClient;

  /**
   * 最大重连尝试次数。
   * Infinity 表示无限重试（默认行为）。
   */
  private readonly maxRetries: number;

  /** 当前重连尝试次数（成功连接后重置为 0） */
  private attemptCount: number = 0;

  /**
   * 当前重连延迟定时器。
   *
   * 📚 学习要点: 定时器引用管理
   * 保存 setTimeout 的返回值，以便在 stop() 时取消待处理的重连。
   * 如果不保存引用，stop() 后仍会触发重连（资源泄漏 + 状态不一致）。
   * 使用 ReturnType<typeof setTimeout> 类型确保跨平台兼容
   * （Node.js 返回 Timeout 对象，浏览器返回 number）。
   */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** 是否已被手动停止（stop() 调用后为 true） */
  private stopped: boolean = false;

  /**
   * 是否处于休眠状态（不可恢复错误后为 true）。
   *
   * 📚 学习要点: 休眠状态（Dormant State）
   * 当检测到不可恢复的错误（如房间不存在）时，进入休眠状态：
   * - 不再尝试重连（避免无意义的重试）
   * - 不崩溃 Gateway 进程（Requirement 6.4）
   * - 状态变为 'error'，上层可以通过状态回调感知
   * - 需要外部干预（更新配置后重启）才能恢复
   */
  private dormant: boolean = false;

  /** 保存的房间 ID（用于重连后自动重新加入） */
  private roomId: string | null = null;

  /** 保存的显示名称（用于重连后自动重新加入） */
  private displayName: string | null = null;

  /** 保存的房间密码（用于重连后自动重新加入） */
  private password: string = '';

  /** 状态变化回调 */
  private statusCallback: ReconnectStatusCallback | null = null;

  /** 当前连接状态（由 ReconnectManager 维护，独立于 ArthasClient 的状态） */
  private currentStatus: ConnectionStatus = 'disconnected';

  // --------------------------------------------------------------------------
  // 构造函数
  // --------------------------------------------------------------------------

  /**
   * 创建 ReconnectManager 实例。
   *
   * @param client - 要包装的 ArthasClient 实例
   * @param options - 重连配置选项
   *
   * @example
   * ```typescript
   * const client = new ArthasClient({ serverUrl: 'wss://server.com/ws' });
   * const manager = new ReconnectManager(client, { maxRetries: 10 });
   * ```
   */
  constructor(client: ArthasClient, options: ReconnectManagerOptions = {}) {
    this.client = client;
    this.maxRetries = options.maxRetries ?? Infinity;

    // 监听 ArthasClient 的状态变化，检测断开事件
    this.client.onStatusChange((status) => {
      this.handleClientStatusChange(status);
    });
  }

  // --------------------------------------------------------------------------
  // 公共 API
  // --------------------------------------------------------------------------

  /**
   * 注册连接状态变化回调。
   *
   * 当 ReconnectManager 的状态发生变化时调用此回调。
   * 状态包括：connected、disconnected、reconnecting、error。
   *
   * @param callback - 状态变化时的回调函数
   */
  onStatusChange(callback: ReconnectStatusCallback): void {
    this.statusCallback = callback;
  }

  /**
   * 建立连接并加入房间。
   *
   * 这是 ReconnectManager 的主入口方法。执行：
   * 1. 保存房间信息（供重连后使用）
   * 2. 建立 WebSocket 连接
   * 3. 加入指定房间
   * 4. 开始监听断开事件（自动触发重连）
   *
   * 📚 学习要点: 首次连接 vs 重连
   * connectAndJoin() 用于首次连接，如果失败会直接抛出异常（让调用方处理）。
   * 重连逻辑只在「已经成功连接过一次后断开」时触发。
   * 这种设计确保配置错误（如无效 URL）在启动时就被发现，
   * 而非被重连逻辑静默吞掉。
   *
   * @param roomId - 要加入的房间 ID
   * @param displayName - 在房间中的显示名称
   * @param password - 房间密码的 SHA-256 哈希（空字符串表示无密码）
   * @throws 如果首次连接或加入房间失败
   *
   * @example
   * ```typescript
   * await manager.connectAndJoin('V1StGXR8_Z5jdHi6B-myT', 'AI Assistant', '');
   * ```
   */
  async connectAndJoin(roomId: string, displayName: string, password: string = ''): Promise<void> {
    // 保存房间信息（供重连后自动重新加入）
    this.roomId = roomId;
    this.displayName = displayName;
    this.password = password;

    // 重置状态
    this.stopped = false;
    this.dormant = false;
    this.attemptCount = 0;

    // 首次连接（失败直接抛出，不触发重连）
    await this.client.connect();
    await this.client.join(roomId, displayName, password);

    // 首次连接成功，更新状态
    this.updateStatus('connected');
  }

  /**
   * 停止自动重连并断开连接。
   *
   * 调用后：
   * - 取消所有待处理的重连定时器
   * - 断开当前 WebSocket 连接
   * - 不再自动重连（即使连接断开）
   * - 状态变为 'disconnected'
   *
   * 📚 学习要点: 优雅停止（Graceful Stop）
   * stop() 确保所有异步操作被正确取消：
   * - clearTimeout 取消待处理的重连定时器
   * - stopped 标志防止正在执行的重连逻辑继续
   * - disconnect() 关闭 WebSocket 连接
   * 这避免了「停止后仍然触发重连」的竞态条件。
   *
   * @example
   * ```typescript
   * // 优雅关闭
   * await manager.stop();
   * // 此后不会再自动重连
   * ```
   */
  async stop(): Promise<void> {
    this.stopped = true;

    // 取消待处理的重连定时器
    this.cancelReconnectTimer();

    // 断开当前连接
    await this.client.disconnect();

    // 更新状态
    this.updateStatus('disconnected');
  }

  /**
   * 获取当前连接状态。
   */
  getStatus(): ConnectionStatus {
    return this.currentStatus;
  }

  /**
   * 获取当前重连尝试次数。
   * 成功连接后重置为 0。
   */
  getAttemptCount(): number {
    return this.attemptCount;
  }

  /**
   * 检查是否处于休眠状态（不可恢复错误）。
   */
  isDormant(): boolean {
    return this.dormant;
  }

  /**
   * 获取被包装的 ArthasClient 实例。
   *
   * 上层（adapter）需要直接访问 client 来发送消息、注册消息回调等。
   * ReconnectManager 不代理这些操作，只负责连接生命周期管理。
   */
  getClient(): ArthasClient {
    return this.client;
  }

  // --------------------------------------------------------------------------
  // 私有方法: 状态监听与重连触发
  // --------------------------------------------------------------------------

  /**
   * 处理 ArthasClient 的状态变化事件。
   *
   * 📚 学习要点: 重连触发条件
   * 只有在以下条件全部满足时才触发重连：
   * 1. 状态变为 'disconnected'（连接断开）
   * 2. 未被手动停止（stopped === false）
   * 3. 未处于休眠状态（dormant === false）
   * 4. 有保存的房间信息（说明之前成功连接过）
   *
   * 如果状态变为 'connected'（由 ArthasClient 内部触发），
   * 不在此处处理（重连成功的状态更新在 attemptReconnect 中处理）。
   *
   * @param status - ArthasClient 报告的新状态
   */
  private handleClientStatusChange(status: ConnectionStatus): void {
    if (status === 'disconnected' && !this.stopped && !this.dormant && this.roomId) {
      // 连接断开且未被手动停止，触发自动重连
      this.scheduleReconnect();
    }
  }

  // --------------------------------------------------------------------------
  // 私有方法: 重连逻辑
  // --------------------------------------------------------------------------

  /**
   * 调度下一次重连尝试。
   *
   * 根据当前尝试次数计算退避延迟，设置定时器在延迟后执行重连。
   * 如果已达到最大重连次数，进入 error 状态并停止重试。
   *
   * 📚 学习要点: 调度 vs 立即执行
   * 为什么不立即重连，而是先等待一段时间？
   * 1. 避免服务器过载：如果服务器刚崩溃，所有客户端同时重连会加重负担
   * 2. 等待网络恢复：网络中断后通常需要几秒钟才能恢复
   * 3. 指数退避：每次失败后等待更长时间，给服务器更多恢复时间
   * 4. 用户体验：给用户时间看到 "reconnecting" 状态提示
   */
  private scheduleReconnect(): void {
    // 检查是否超过最大重连次数
    if (this.attemptCount >= this.maxRetries) {
      this.updateStatus('error');
      return;
    }

    // 更新状态为 reconnecting
    this.updateStatus('reconnecting');

    // 计算退避延迟
    const delay = this.getBackoffDelay(this.attemptCount);

    // 设置重连定时器
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.attemptReconnect();
    }, delay);
  }

  /**
   * 执行一次重连尝试。
   *
   * 流程：
   * 1. 检查是否已被停止（竞态条件防护）
   * 2. 递增尝试计数
   * 3. 尝试建立 WebSocket 连接
   * 4. 尝试重新加入房间
   * 5. 成功：重置计数，更新状态为 connected
   * 6. 失败：检查是否为不可恢复错误，否则调度下一次重连
   *
   * 📚 学习要点: 异步重连的错误处理
   * 重连过程中可能发生多种错误：
   * - 网络不可达（connect 失败）→ 继续重试
   * - 服务器拒绝连接（TLS 错误等）→ 继续重试
   * - 房间不存在（join 失败）→ 不可恢复，进入休眠
   * - 分享码无效（join 失败）→ 不可恢复，进入休眠
   *
   * 使用 try/catch 统一处理所有错误类型，
   * 通过 isUnrecoverableError() 区分是否应该继续重试。
   */
  private async attemptReconnect(): Promise<void> {
    // 竞态条件防护：定时器触发时可能已经被 stop()
    if (this.stopped || this.dormant) {
      return;
    }

    this.attemptCount++;

    try {
      // 尝试建立连接
      await this.client.connect();

      // 连接成功，尝试重新加入房间
      if (this.roomId && this.displayName) {
        await this.client.join(this.roomId, this.displayName, this.password);
      }

      // 重连成功！重置计数，更新状态
      this.attemptCount = 0;
      this.updateStatus('connected');
    } catch (error) {
      // 重连失败，检查是否为不可恢复错误
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.isUnrecoverableError(errorMessage)) {
        // 不可恢复错误：进入休眠状态，不再重试
        this.dormant = true;
        this.updateStatus('error');
        return;
      }

      // 可恢复错误：调度下一次重连（如果未被停止）
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    }
  }

  // --------------------------------------------------------------------------
  // 私有方法: 工具函数
  // --------------------------------------------------------------------------

  /**
   * 计算指定尝试次数对应的退避延迟。
   *
   * 📚 学习要点: 退避延迟计算策略
   * 使用预定义的延迟数组而非公式计算（如 Math.pow(2, attempt) * 1000）：
   * - 延迟值明确可控（不会因为 attempt 过大导致溢出）
   * - 最大延迟有硬上限（数组最后一个元素 = 30000ms）
   * - 超过数组长度后，始终使用最大延迟（30s 间隔持续重试）
   *
   * 延迟序列：1s, 2s, 4s, 8s, 16s, 30s, 30s, 30s, ...
   *
   * @param attempt - 当前尝试次数（从 0 开始）
   * @returns 退避延迟（毫秒）
   */
  private getBackoffDelay(attempt: number): number {
    const index = Math.min(attempt, BACKOFF_DELAYS_MS.length - 1);
    const baseDelay = BACKOFF_DELAYS_MS[index] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1]!;
    // ISSUE-3 修复：添加 ±20% 随机抖动，避免多实例同时重连（惊群效应）
    const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
    return Math.max(100, Math.round(baseDelay + jitter));
  }

  /**
   * 检查错误是否为不可恢复错误。
   *
   * 📚 学习要点: 错误分类策略
   * 将错误分为两类：
   * 1. 可恢复错误（transient）：网络超时、服务器暂时不可用 → 继续重试
   * 2. 不可恢复错误（permanent）：房间不存在、分享码无效 → 停止重试
   *
   * 判断依据：错误消息中是否包含特定关键词。
   * 使用 toLowerCase() 进行大小写不敏感匹配，提高鲁棒性。
   *
   * @param errorMessage - 错误消息字符串
   * @returns true 表示不可恢复，应进入休眠状态
   */
  private isUnrecoverableError(errorMessage: string): boolean {
    const lowerMessage = errorMessage.toLowerCase();
    return UNRECOVERABLE_ERROR_PATTERNS.some((pattern) => lowerMessage.includes(pattern));
  }

  /**
   * 取消待处理的重连定时器。
   *
   * 在 stop() 和状态重置时调用，确保不会有悬挂的定时器。
   */
  private cancelReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * 更新连接状态并通知上层。
   *
   * 📚 学习要点: 状态去重
   * 只有在状态实际发生变化时才触发回调，避免：
   * - 上层收到重复的状态通知（导致不必要的 UI 更新）
   * - 日志中出现大量重复的状态变化记录
   * - 回调中的副作用被重复执行
   *
   * @param newStatus - 新的连接状态
   */
  private updateStatus(newStatus: ConnectionStatus): void {
    if (this.currentStatus === newStatus) {
      return; // 状态未变化，不触发回调
    }

    this.currentStatus = newStatus;

    if (this.statusCallback) {
      this.statusCallback(newStatus);
    }
  }
}
