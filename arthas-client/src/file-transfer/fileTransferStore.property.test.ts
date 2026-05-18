/**
 * 属性测试：文件传输队列不变量（Transfer Queue Invariant Property Test）。
 *
 * 本文件使用 fast-check 属性测试框架验证 fileTransferStore 的队列管理核心不变量：
 * - 同一时间最多 1 个传输处于 'sending' 状态
 * - 待发送队列最多 3 个传输；超出部分被拒绝（返回 null）
 * - 队列按 FIFO 顺序处理（先发起的传输先变为 'sending'）
 *
 * 📚 学习要点: 状态机属性测试
 * 对于有状态的系统（如 Zustand store），属性测试的策略是：
 * 1. 生成随机的操作序列（如多次 initiateTransfer）
 * 2. 执行操作序列后，验证系统不变量仍然成立
 * 这比固定的 example-based 测试能覆盖更多状态组合，
 * 特别适合发现并发和边界条件下的 bug。
 *
 * @module file-transfer/fileTransferStore.property.test
 * @see fileTransferStore.ts — 传输队列管理实现
 * @see Requirements 3.7, 4.9, 11.3, 11.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { useFileTransferStore } from './fileTransferStore';
import { useChatStore } from '../stores/chatStore';

/**
 * 辅助函数：创建指定大小的 mock File 对象。
 *
 * 📚 学习要点: 为什么使用 1024 字节？
 * 文件大小只需满足 initiateTransfer 的验证条件（0 < size <= 5MB）。
 * 1024 字节足够小以保持测试快速，又满足最小大小要求。
 */
function createMockFile(name: string = 'test.bin', size: number = 1024): File {
  return new File(
    [new Uint8Array(size)],
    name,
    { type: 'application/octet-stream' }
  );
}

/**
 * 辅助函数：重置 store 到初始状态。
 *
 * 📚 学习要点: 测试隔离
 * 每个测试用例之间必须重置 store 状态，
 * 否则前一个测试的副作用会影响后续测试结果。
 * Zustand 的 setState 允许直接覆盖整个状态。
 *
 * 同时需要设置 chatStore 的 roomKey，因为 processQueue 在没有 roomKey 时
 * 会立即将传输标记为 failed 并递归处理队列（导致队列永远不会满）。
 */
function resetStore(): void {
  useFileTransferStore.setState({
    transfers: new Map(),
    sendQueue: [],
    activeSendId: null,
    activeReceiveCount: 0,
  });
  // 设置一个 mock roomKey，防止 processQueue 因缺少 roomKey 而立即失败
  // 这使得 activeSendId 保持为第一个传输的 ID（模拟真实的发送中状态）
  useChatStore.setState({
    roomKey: {} as CryptoKey, // mock CryptoKey — processQueue 只检查是否为 null
  });
}

/**
 * **Validates: Requirements 3.7, 4.9, 11.3, 11.4**
 *
 * Property 7: Transfer queue invariant
 * - At most 1 transfer in 'sending' status at any time
 * - At most 3 transfers in 'pending' status; excess rejected with error
 * - Queue processes in FIFO order
 */
describe('Property: Transfer queue invariant', () => {
  beforeEach(() => {
    resetStore();
  });

  it('at most 1 transfer has sending status after any sequence of initiateTransfer calls', () => {
    fc.assert(
      fc.property(
        // 📚 学习要点: 生成器设计
        // 生成 1-10 次 initiateTransfer 调用的序列。
        // 每次调用都使用合法大小的文件（1KB-5MB）。
        // 测试验证无论调用多少次，sending 状态的传输最多 1 个。
        fc.integer({ min: 1, max: 10 }),
        (numCalls) => {
          resetStore();

          // 执行 N 次 initiateTransfer
          for (let i = 0; i < numCalls; i++) {
            const file = createMockFile(`file-${i}.bin`);
            useFileTransferStore.getState().initiateTransfer(file);
          }

          // 验证不变量：最多 1 个传输处于 'sending' 状态
          const { transfers } = useFileTransferStore.getState();
          let sendingCount = 0;
          for (const [, transfer] of transfers) {
            if (transfer.status === 'sending') {
              sendingCount++;
            }
          }

          expect(sendingCount).toBeLessThanOrEqual(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sendQueue length never exceeds 3 after any sequence of initiateTransfer calls', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (numCalls) => {
          resetStore();

          // 执行 N 次 initiateTransfer
          for (let i = 0; i < numCalls; i++) {
            const file = createMockFile(`file-${i}.bin`);
            useFileTransferStore.getState().initiateTransfer(file);
          }

          // 验证不变量：sendQueue 长度 ≤ 3
          const { sendQueue } = useFileTransferStore.getState();
          expect(sendQueue.length).toBeLessThanOrEqual(3);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('initiateTransfer returns null when queue is full (3 pending + 1 active = 4 total)', () => {
    fc.assert(
      fc.property(
        // 生成 5-15 次调用，确保超过队列容量
        fc.integer({ min: 5, max: 15 }),
        (numCalls) => {
          resetStore();

          const results: (string | null)[] = [];

          for (let i = 0; i < numCalls; i++) {
            const file = createMockFile(`file-${i}.bin`);
            const result = useFileTransferStore.getState().initiateTransfer(file);
            results.push(result);
          }

          // 前 4 个应该成功（1 个变为 sending + 3 个在 sendQueue 中 pending）
          // 第 5 个及之后应该返回 null（队列已满）
          for (let i = 0; i < Math.min(numCalls, 4); i++) {
            expect(results[i]).not.toBeNull();
          }

          for (let i = 4; i < numCalls; i++) {
            expect(results[i]).toBeNull();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('queue processes in FIFO order — first initiated becomes first to send', () => {
    fc.assert(
      fc.property(
        // 生成 2-4 次调用（确保有队列排队的情况）
        fc.integer({ min: 2, max: 4 }),
        (numCalls) => {
          resetStore();

          const transferIds: string[] = [];

          // 发起多个传输
          for (let i = 0; i < numCalls; i++) {
            const file = createMockFile(`file-${i}.bin`);
            const id = useFileTransferStore.getState().initiateTransfer(file);
            if (id !== null) {
              transferIds.push(id);
            }
          }

          // 第一个发起的传输应该是当前活跃发送的（FIFO）
          const { activeSendId, sendQueue } = useFileTransferStore.getState();

          // 第一个传输应该已经变为 sending（activeSendId）
          expect(activeSendId).toBe(transferIds[0]);

          // 队列中的传输应该按发起顺序排列（FIFO）
          for (let i = 0; i < sendQueue.length; i++) {
            expect(sendQueue[i]).toBe(transferIds[i + 1]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('combined invariant: sending + pending counts are bounded after random operations', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        (numCalls) => {
          resetStore();

          for (let i = 0; i < numCalls; i++) {
            const file = createMockFile(`file-${i}.bin`);
            useFileTransferStore.getState().initiateTransfer(file);
          }

          const { transfers, sendQueue, activeSendId } = useFileTransferStore.getState();

          // 不变量 1: 最多 1 个 sending
          let sendingCount = 0;
          let pendingCount = 0;
          for (const [, transfer] of transfers) {
            if (transfer.status === 'sending') sendingCount++;
            if (transfer.status === 'pending') pendingCount++;
          }
          expect(sendingCount).toBeLessThanOrEqual(1);

          // 不变量 2: pending 数量 ≤ 3（sendQueue 长度）
          expect(pendingCount).toBeLessThanOrEqual(3);
          expect(sendQueue.length).toBeLessThanOrEqual(3);

          // 不变量 3: sendQueue 中的传输状态应该都是 pending
          for (const id of sendQueue) {
            const transfer = transfers.get(id);
            expect(transfer).toBeDefined();
            expect(transfer!.status).toBe('pending');
          }

          // 不变量 4: activeSendId 对应的传输状态应该是 sending
          if (activeSendId !== null) {
            const activeTransfer = transfers.get(activeSendId);
            expect(activeTransfer).toBeDefined();
            expect(activeTransfer!.status).toBe('sending');
          }

          // 不变量 5: sendQueue 中的 ID 不应该与 activeSendId 相同
          if (activeSendId !== null) {
            expect(sendQueue).not.toContain(activeSendId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
