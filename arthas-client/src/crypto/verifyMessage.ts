/**
 * 消息签名验证辅助模块 — 将验证逻辑从 chatStore 中提取出来。
 *
 * 职责：
 * - 验证单条消息的 Ed25519 签名
 * - 管理延迟验证队列（收到消息时发送方公钥尚未知晓的情况）
 * - 批量验证队列中的待验证消息
 *
 * 与其他模块的关系：
 * - 使用 `./signing.ts` 的 verifySignature、importVerifyKey 进行签名验证
 * - 使用 `./canonicalJson.ts` 的 computeSignableBytes 计算签名输入
 * - 被 `../stores/chatStore.ts` 调用（接收消息时的验证流程）
 *
 * 📚 学习要点: 为什么将验证逻辑提取到独立模块？
 * chatStore 已经承担了大量状态管理职责（连接、房间、消息、typing 等）。
 * 将验证逻辑委托给专用模块（类似 fileTransferStore 的委托模式），
 * 保持 chatStore 聚焦于状态管理，验证模块聚焦于密码学操作。
 * 这也使得验证逻辑可以独立于 Zustand store 进行单元测试。
 */

import { verifySignature } from './signing';
import { computeSignableBytes } from './canonicalJson';

// ─── Types ───────────────────────────────────────────────────────────────────

/** 消息签名验证结果 */
export type VerificationResult = 'verified' | 'failed';

/** 延迟验证队列中的待验证消息条目 */
export interface DeferredMessage {
  /** 消息的唯一 ID（用于后续更新 verificationStatus） */
  messageId: string;
  /** 解密后的完整 payload 对象（含 sig 字段） */
  payload: Record<string, unknown>;
  /** base64url 编码的签名字符串 */
  sig: string;
}

/** 每个发送方的待验证消息队列 */
interface SenderQueue {
  /** 待验证消息列表（最多 MAX_DEFERRED_PER_SENDER 条） */
  messages: DeferredMessage[];
  /** 60 秒超时定时器（超时后标记为 unknown） */
  timer: ReturnType<typeof setTimeout>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * 每个发送方最多缓存的待验证消息数量。
 * 超出此限制时，最早的消息将被标记为 'unknown' 并释放。
 *
 * 📚 学习要点: 为什么限制队列大小？
 * 防止恶意或异常情况下内存无限增长。正常场景中，
 * 公钥广播应在加入房间后很快到达（毫秒级），
 * 20 条消息的缓冲足以覆盖网络延迟窗口。
 */
const MAX_DEFERRED_PER_SENDER = 20;

/**
 * 延迟验证超时时间（毫秒）。
 * 如果 60 秒内未收到发送方的公钥广播，
 * 所有待验证消息标记为 'unknown'。
 */
const DEFERRED_TIMEOUT_MS = 60_000;

// ─── Verification Function ───────────────────────────────────────────────────

/**
 * 验证单条消息的 Ed25519 签名。
 *
 * 流程：
 * 1. 从 payload 中提取 sig 字段
 * 2. 计算 Signable_Bytes（移除 sig 后的 canonical JSON → UTF-8 bytes）
 * 3. 使用发送方的缓存 CryptoKey 验证签名
 *
 * @param publicKey - 发送方的已导入 CryptoKey（从 publicKeyMap 缓存获取）
 * @param payload - 解密后的完整消息 payload 对象（含 sig 字段）
 * @returns 'verified' 如果签名有效，'failed' 如果签名无效
 */
export async function verifyMessageSignature(
  publicKey: CryptoKey,
  payload: Record<string, unknown>
): Promise<VerificationResult> {
  try {
    const sig = payload.sig as string;
    if (!sig || typeof sig !== 'string') {
      return 'failed';
    }

    // 计算 Signable_Bytes：移除 sig 字段，canonical JSON 序列化，UTF-8 编码
    const signableBytes = computeSignableBytes(payload);

    // 使用缓存的 CryptoKey 验证签名
    const valid = await verifySignature(publicKey, signableBytes, sig);
    return valid ? 'verified' : 'failed';
  } catch {
    // 任何异常（格式错误、crypto 操作失败等）视为验证失败
    return 'failed';
  }
}

// ─── Deferred Verification Queue ─────────────────────────────────────────────

/**
 * 延迟验证队列 — 管理公钥未知时收到的签名消息。
 *
 * 📚 学习要点: 为什么需要延迟验证？
 * 在 TOFU（Trust On First Use）模型中，成员加入房间后会广播公钥。
 * 但由于网络延迟，可能在收到公钥广播之前就收到了该成员的签名消息。
 * 延迟验证队列暂存这些消息，等公钥到达后批量验证并更新状态。
 *
 * 安全约束：
 * - 每个发送方最多缓存 20 条消息（防止内存攻击）
 * - 60 秒超时后放弃等待（防止无限等待）
 * - 超时/溢出的消息标记为 'unknown'（不是 'failed'，因为无法确定）
 */
export class DeferredVerificationQueue {
  /** senderId → 待验证消息队列 */
  private queues: Map<string, SenderQueue> = new Map();

  /**
   * 超时回调 — 当某个发送方的队列超时时调用。
   * 调用方应将对应消息的 verificationStatus 设为 'unknown'。
   */
  private onTimeout: (senderId: string, messages: DeferredMessage[]) => void;

  constructor(onTimeout: (senderId: string, messages: DeferredMessage[]) => void) {
    this.onTimeout = onTimeout;
  }

  /**
   * 将消息添加到延迟验证队列。
   *
   * @param senderId - 消息发送方的 ID
   * @param message - 待验证消息条目
   * @returns 被溢出淘汰的消息（如果队列已满），否则为 null
   */
  add(senderId: string, message: DeferredMessage): DeferredMessage | null {
    let queue = this.queues.get(senderId);

    if (!queue) {
      // 首次为该发送方创建队列，启动超时定时器
      const timer = setTimeout(() => {
        const q = this.queues.get(senderId);
        if (q) {
          this.onTimeout(senderId, q.messages);
          this.queues.delete(senderId);
        }
      }, DEFERRED_TIMEOUT_MS);

      queue = { messages: [], timer };
      this.queues.set(senderId, queue);
    }

    let evicted: DeferredMessage | null = null;

    // 队列已满时淘汰最早的消息
    if (queue.messages.length >= MAX_DEFERRED_PER_SENDER) {
      evicted = queue.messages.shift() ?? null;
    }

    queue.messages.push(message);
    return evicted;
  }

  /**
   * 批量验证某个发送方的所有待验证消息。
   *
   * 当收到发送方的公钥广播后调用此方法：
   * 1. 导入公钥为 CryptoKey
   * 2. 逐条验证队列中的消息
   * 3. 返回验证结果数组
   * 4. 清理该发送方的队列和定时器
   *
   * @param senderId - 发送方 ID
   * @param publicKey - 已导入的 CryptoKey（发送方公钥）
   * @returns 每条消息的验证结果（messageId + result）
   */
  async processDeferredQueue(
    senderId: string,
    publicKey: CryptoKey
  ): Promise<Array<{ messageId: string; result: VerificationResult }>> {
    const queue = this.queues.get(senderId);
    if (!queue) return [];

    // 清理定时器
    clearTimeout(queue.timer);
    this.queues.delete(senderId);

    // 批量验证所有待验证消息
    const results: Array<{ messageId: string; result: VerificationResult }> = [];

    for (const msg of queue.messages) {
      const result = await verifyMessageSignature(publicKey, msg.payload);
      results.push({ messageId: msg.messageId, result });
    }

    return results;
  }

  /**
   * 检查某个发送方是否有待验证消息。
   */
  hasPending(senderId: string): boolean {
    return this.queues.has(senderId);
  }

  /**
   * 清空所有队列（离开房间时调用）。
   * 取消所有定时器，释放内存。
   */
  clear(): void {
    for (const [, queue] of this.queues) {
      clearTimeout(queue.timer);
    }
    this.queues.clear();
  }

  /**
   * 获取某个发送方的待验证消息数量（用于测试/调试）。
   */
  getPendingCount(senderId: string): number {
    return this.queues.get(senderId)?.messages.length ?? 0;
  }
}
