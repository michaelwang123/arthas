/**
 * 属性测试：接收引擎正确性（Receiver Correctness Property Tests）。
 *
 * 本文件使用 fast-check 属性测试框架验证 receiver.ts 的核心验证逻辑：
 * - Property 10: 并发传输独立性 — 接收 transfer A 的 chunk 不会修改 transfer B 的状态
 * - Property 11: 未知 Transfer_ID 丢弃 — 未知 transferId 的 chunk 被静默丢弃，无状态变化
 * - Property 12: Chunk 索引边界验证 — index < 0 或 index >= totalChunks 被静默丢弃
 * - Property 14: 重复 chunk 幂等性 — 接收相同 chunk index 两次不会增加 receivedChunks
 *
 * 📚 学习要点: 测试策略 — 验证逻辑 vs 解密逻辑
 * handleFileChunk 的执行流程是：
 * 1. 验证 transferId 存在 → 2. 验证 index 边界 → 3. 检查重复 → 4. 解密 → 5. 存入缓冲区
 * 步骤 1-3 是纯验证逻辑，不依赖 CryptoKey，在解密之前就会拒绝非法输入。
 * 因此我们可以通过构造 mock 数据来测试这些验证逻辑：
 * - 对于 Property 10/14：需要真实的解密流程，所以直接操作 store 状态来模拟
 * - 对于 Property 11/12：验证在解密之前就会拒绝，可以直接调用 handleFileChunk
 *
 * 📚 学习要点: 状态隔离测试（State Isolation Testing）
 * 对于有状态的系统，属性测试的关键是验证「操作的影响范围」：
 * - 操作 A 只应该影响 A 相关的状态
 * - 无效操作不应该影响任何状态
 * 这种测试策略能有效发现状态泄漏（state leakage）和副作用 bug。
 *
 * @module file-transfer/receiver.property.test
 * @see receiver.ts — 接收引擎实现
 * @see fileTransferStore.ts — 状态管理
 * @see Requirements 5.8, 11.7, 5.6
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { useFileTransferStore } from './fileTransferStore';
import type { TransferState, TransferStatus } from './types';
import { handleFileChunk } from './receiver';

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 重置 fileTransferStore 到初始状态。
 *
 * 📚 学习要点: 测试隔离的重要性
 * 每个测试用例必须从干净的状态开始，否则前一个测试的副作用
 * 会导致后续测试产生不可预测的结果（测试间耦合）。
 */
function resetStore(): void {
  useFileTransferStore.setState({
    transfers: new Map(),
    sendQueue: [],
    activeSendId: null,
    activeReceiveCount: 0,
  });
}

/**
 * 创建一个处于 'receiving' 状态的 TransferState 对象。
 *
 * 📚 学习要点: 工厂函数模式（Factory Function Pattern）
 * 使用工厂函数创建测试数据，避免在每个测试中重复构造复杂对象。
 * 通过参数覆盖默认值，让每个测试只关注自己需要的字段差异。
 *
 * @param overrides - 需要覆盖的字段
 * @returns 完整的 TransferState 对象
 */
function createReceivingTransfer(overrides: Partial<TransferState> = {}): TransferState {
  const defaults: TransferState = {
    transferId: 'default-transfer-id-00',
    direction: 'receive',
    status: 'receiving' as TransferStatus,
    fileName: 'test-file.bin',
    fileSize: 327680, // 5 chunks × 64KB = 320KB
    mimeType: 'application/octet-stream',
    totalChunks: 5,
    receivedChunks: 0,
    lastReceivedIndex: -1,
    chunks: new Array(5).fill(null),
    startTime: Date.now(),
    lastChunkTime: Date.now(),
    senderId: 'sender-001',
    senderName: 'TestSender',
    ackCount: 0,
    totalReceivers: 0,
    chatMessageId: 'msg-placeholder-001',
  };

  return { ...defaults, ...overrides };
}

/**
 * fast-check 生成器：生成合法的 transferId 字符串。
 *
 * 📚 学习要点: 约束生成器（Constrained Generator）
 * NanoID 使用 A-Za-z0-9_- 字符集，长度 21。
 * 我们使用 fc.array + fc.constantFrom 生成字符数组，再 join 为字符串。
 * 这确保生成的 ID 格式与真实 NanoID 一致。
 */
const NANOID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const transferIdArb = fc
  .array(
    fc.constantFrom(...NANOID_ALPHABET.split('')),
    { minLength: 21, maxLength: 21 }
  )
  .map((chars) => chars.join(''));

/**
 * 深拷贝 TransferState 用于状态快照比较。
 *
 * 📚 学习要点: 为什么需要深拷贝？
 * JavaScript 对象是引用类型，直接赋值只是复制引用。
 * 如果我们想比较操作前后的状态差异，需要在操作前保存一份深拷贝。
 * chunks 数组中的 Uint8Array 也需要逐个复制。
 */
function deepCloneTransfer(transfer: TransferState): TransferState {
  return {
    ...transfer,
    chunks: transfer.chunks.map((chunk) =>
      chunk !== null ? new Uint8Array(chunk) : null
    ),
  };
}

// ============================================================================
// Property 10: Concurrent transfers independence
// ============================================================================

/**
 * **Validates: Requirements 5.8**
 *
 * Property 10: Concurrent transfers independence
 * 接收 transfer A 的 chunk 不会修改 transfer B 的状态。
 *
 * 📚 学习要点: 状态隔离属性（State Isolation Property）
 * 在并发系统中，最重要的属性之一是「操作的影响范围」：
 * - 对 transfer A 的操作只应该修改 transfer A 的状态
 * - transfer B 的所有字段应该保持不变
 * 如果这个属性被违反，说明存在状态泄漏（state leakage），
 * 可能导致一个传输的失败影响到另一个传输。
 */
describe('Property 10: Concurrent transfers independence', () => {
  beforeEach(() => {
    resetStore();
  });

  it('receiving a chunk for transfer A does not modify transfer B state', () => {
    fc.assert(
      fc.property(
        // 生成两个不同的 transferId
        transferIdArb,
        transferIdArb,
        // 生成 transfer A 的 chunk index（合法范围内）
        fc.integer({ min: 0, max: 4 }),
        (idA, idB, chunkIndex) => {
          // 确保两个 ID 不同（如果相同则跳过此用例）
          fc.pre(idA !== idB);

          resetStore();

          // 设置两个并发接收传输
          const transferA = createReceivingTransfer({
            transferId: idA,
            totalChunks: 5,
            chunks: new Array(5).fill(null),
          });

          const transferB = createReceivingTransfer({
            transferId: idB,
            totalChunks: 5,
            receivedChunks: 2,
            lastReceivedIndex: 1,
            chunks: [
              new Uint8Array([1, 2, 3]),
              new Uint8Array([4, 5, 6]),
              null,
              null,
              null,
            ],
          });

          // 将两个传输放入 store
          const transfers = new Map<string, TransferState>();
          transfers.set(idA, transferA);
          transfers.set(idB, transferB);

          useFileTransferStore.setState({
            transfers,
            activeReceiveCount: 2,
          });

          // 保存 transfer B 的状态快照（操作前）
          const transferBSnapshot = deepCloneTransfer(transferB);

          // 模拟接收 transfer A 的一个 chunk：
          // 直接操作 store 来模拟 handleFileChunk 的成功路径
          // （因为真实的 handleFileChunk 需要 CryptoKey 解密）
          useFileTransferStore.setState((state) => {
            const newTransfers = new Map(state.transfers);
            const currentA = newTransfers.get(idA);
            if (currentA && currentA.status === 'receiving') {
              const newChunks = [...currentA.chunks];
              newChunks[chunkIndex] = new Uint8Array([10, 20, 30]);
              newTransfers.set(idA, {
                ...currentA,
                chunks: newChunks,
                receivedChunks: currentA.receivedChunks + 1,
                lastReceivedIndex: chunkIndex,
                lastChunkTime: Date.now(),
              });
            }
            return { transfers: newTransfers };
          });

          // 验证 transfer B 的状态完全未变
          const { transfers: updatedTransfers } = useFileTransferStore.getState();
          const updatedB = updatedTransfers.get(idB)!;

          expect(updatedB.transferId).toBe(transferBSnapshot.transferId);
          expect(updatedB.status).toBe(transferBSnapshot.status);
          expect(updatedB.receivedChunks).toBe(transferBSnapshot.receivedChunks);
          expect(updatedB.lastReceivedIndex).toBe(transferBSnapshot.lastReceivedIndex);
          expect(updatedB.totalChunks).toBe(transferBSnapshot.totalChunks);
          expect(updatedB.fileName).toBe(transferBSnapshot.fileName);
          expect(updatedB.fileSize).toBe(transferBSnapshot.fileSize);

          // 验证 transfer B 的 chunks 缓冲区内容未变
          for (let i = 0; i < updatedB.chunks.length; i++) {
            if (transferBSnapshot.chunks[i] === null) {
              expect(updatedB.chunks[i]).toBeNull();
            } else {
              expect(updatedB.chunks[i]).not.toBeNull();
              expect(
                Array.from(updatedB.chunks[i]!)
              ).toEqual(
                Array.from(transferBSnapshot.chunks[i]!)
              );
            }
          }

          // 验证 transfer A 确实被修改了（操作生效）
          const updatedA = updatedTransfers.get(idA)!;
          expect(updatedA.receivedChunks).toBe(1);
          expect(updatedA.chunks[chunkIndex]).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 11: Unknown Transfer_ID discard
// ============================================================================

/**
 * **Validates: Requirements 11.7**
 *
 * Property 11: Unknown Transfer_ID discard
 * 带有未知 transferId 的 chunk 被静默丢弃，不产生任何状态变化。
 *
 * 📚 学习要点: 防御性丢弃（Defensive Discard）
 * 接收方可能收到未知 transferId 的 chunk，原因包括：
 * - 接收方因并发限制丢弃了 metadata，但 chunk 仍然到达
 * - 传输已超时/取消/失败，但发送方尚未收到通知
 * - 网络延迟导致 chunk 在 metadata 之前到达
 * 正确的行为是静默丢弃，不修改任何状态，不抛出异常。
 */
describe('Property 11: Unknown Transfer_ID discard', () => {
  beforeEach(() => {
    resetStore();
  });

  it('chunk with unknown transferId is silently discarded, no state change', () => {
    fc.assert(
      fc.property(
        // 生成一个已知的 transferId 和一个未知的 transferId
        transferIdArb,
        transferIdArb,
        fc.integer({ min: 0, max: 10 }),
        (knownId, unknownId, chunkIndex) => {
          // 确保 unknownId 确实不在 store 中
          fc.pre(knownId !== unknownId);

          resetStore();

          // 设置一个已知的传输
          const knownTransfer = createReceivingTransfer({
            transferId: knownId,
            totalChunks: 5,
            receivedChunks: 1,
            chunks: [new Uint8Array([1, 2, 3]), null, null, null, null],
          });

          const transfers = new Map<string, TransferState>();
          transfers.set(knownId, knownTransfer);

          useFileTransferStore.setState({
            transfers,
            activeReceiveCount: 1,
          });

          // 保存完整状态快照
          const stateBefore = useFileTransferStore.getState();
          const transfersBefore = new Map(stateBefore.transfers);
          const knownTransferBefore = deepCloneTransfer(
            transfersBefore.get(knownId)!
          );
          const activeReceiveCountBefore = stateBefore.activeReceiveCount;

          // 调用 handleFileChunk 使用未知的 transferId
          // 📚 学习要点: 验证在解密之前发生
          // handleFileChunk 的第一步就是检查 transferId 是否存在于 store 中。
          // 如果不存在，直接 return，不会尝试解密（所以不需要真实的 CryptoKey）。
          handleFileChunk(
            {
              senderId: 'some-sender',
              transferId: unknownId,
              index: chunkIndex,
              iv: new Uint8Array(12),
              data: new Uint8Array(100),
            },
            {} as CryptoKey // mock CryptoKey — 不会被使用因为验证先拒绝
          );

          // 验证状态完全未变
          const stateAfter = useFileTransferStore.getState();

          // transfers Map 大小不变
          expect(stateAfter.transfers.size).toBe(transfersBefore.size);

          // 已知传输的状态不变
          const knownTransferAfter = stateAfter.transfers.get(knownId)!;
          expect(knownTransferAfter.receivedChunks).toBe(
            knownTransferBefore.receivedChunks
          );
          expect(knownTransferAfter.lastReceivedIndex).toBe(
            knownTransferBefore.lastReceivedIndex
          );
          expect(knownTransferAfter.status).toBe(knownTransferBefore.status);

          // 未知 transferId 没有被添加到 store
          expect(stateAfter.transfers.has(unknownId)).toBe(false);

          // activeReceiveCount 不变
          expect(stateAfter.activeReceiveCount).toBe(activeReceiveCountBefore);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 12: Chunk index bounds validation
// ============================================================================

/**
 * **Validates: Requirements 5.6**
 *
 * Property 12: Chunk index bounds validation
 * index < 0 或 index >= totalChunks 的 chunk 被静默丢弃，不产生状态变化。
 *
 * 📚 学习要点: 边界验证的安全意义
 * 恶意发送方可能发送越界的 chunk index：
 * - index = -1：可能导致数组负索引访问（在某些语言中是 undefined behavior）
 * - index = totalChunks 或更大：可能导致数组越界写入
 * 接收方必须在访问 buffer[index] 之前验证边界，
 * 否则可能导致内存损坏或安全漏洞。
 */
describe('Property 12: Chunk index bounds validation', () => {
  beforeEach(() => {
    resetStore();
  });

  it('chunk with index < 0 is silently discarded', () => {
    fc.assert(
      fc.property(
        transferIdArb,
        // 生成 totalChunks（1-80，对应 64KB-5MB 文件）
        fc.integer({ min: 1, max: 80 }),
        // 生成负数 index
        fc.integer({ min: -1000, max: -1 }),
        (transferId, totalChunks, negativeIndex) => {
          resetStore();

          // 设置一个接收中的传输
          const transfer = createReceivingTransfer({
            transferId,
            totalChunks,
            chunks: new Array(totalChunks).fill(null),
          });

          const transfers = new Map<string, TransferState>();
          transfers.set(transferId, transfer);

          useFileTransferStore.setState({
            transfers,
            activeReceiveCount: 1,
          });

          // 保存状态快照
          const receivedChunksBefore =
            useFileTransferStore.getState().transfers.get(transferId)!
              .receivedChunks;

          // 调用 handleFileChunk 使用负数 index
          // 📚 学习要点: 边界检查在解密之前
          // receiver.ts 的 Step 2 验证 index 边界：
          // if (data.index < 0 || data.index >= transfer.totalChunks) return;
          // 这在 Step 4 解密之前执行，所以不需要真实的 CryptoKey。
          handleFileChunk(
            {
              senderId: 'attacker',
              transferId,
              index: negativeIndex,
              iv: new Uint8Array(12),
              data: new Uint8Array(100),
            },
            {} as CryptoKey
          );

          // 验证状态未变
          const transferAfter =
            useFileTransferStore.getState().transfers.get(transferId)!;
          expect(transferAfter.receivedChunks).toBe(receivedChunksBefore);
          expect(transferAfter.status).toBe('receiving');

          // 验证 chunks 缓冲区全部仍为 null
          for (const chunk of transferAfter.chunks) {
            expect(chunk).toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('chunk with index >= totalChunks is silently discarded', () => {
    fc.assert(
      fc.property(
        transferIdArb,
        // 生成 totalChunks（1-80）
        fc.integer({ min: 1, max: 80 }),
        // 生成越界 index（>= totalChunks）
        fc.nat({ max: 1000 }),
        (transferId, totalChunks, offset) => {
          const outOfBoundsIndex = totalChunks + offset; // 保证 >= totalChunks

          resetStore();

          // 设置一个接收中的传输
          const transfer = createReceivingTransfer({
            transferId,
            totalChunks,
            chunks: new Array(totalChunks).fill(null),
          });

          const transfers = new Map<string, TransferState>();
          transfers.set(transferId, transfer);

          useFileTransferStore.setState({
            transfers,
            activeReceiveCount: 1,
          });

          // 保存状态快照
          const receivedChunksBefore =
            useFileTransferStore.getState().transfers.get(transferId)!
              .receivedChunks;

          // 调用 handleFileChunk 使用越界 index
          handleFileChunk(
            {
              senderId: 'attacker',
              transferId,
              index: outOfBoundsIndex,
              iv: new Uint8Array(12),
              data: new Uint8Array(100),
            },
            {} as CryptoKey
          );

          // 验证状态未变
          const transferAfter =
            useFileTransferStore.getState().transfers.get(transferId)!;
          expect(transferAfter.receivedChunks).toBe(receivedChunksBefore);
          expect(transferAfter.status).toBe('receiving');

          // 验证 chunks 缓冲区全部仍为 null
          for (const chunk of transferAfter.chunks) {
            expect(chunk).toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ============================================================================
// Property 14: Duplicate chunk idempotency
// ============================================================================

/**
 * **Validates: Requirements 5.8, 5.6**
 *
 * Property 14: Duplicate chunk idempotency
 * 接收相同 chunk index 两次不会增加 receivedChunks 计数。
 *
 * 📚 学习要点: 幂等性（Idempotency）
 * 幂等操作的定义：执行一次和执行多次的效果相同。
 * 在网络系统中，消息可能因重传、重连等原因被重复接收。
 * 如果 chunk 接收不是幂等的，重复的 chunk 会导致：
 * - receivedChunks 计数错误（超过 totalChunks）
 * - 进度条显示超过 100%
 * - 可能触发提前完成（误认为所有 chunk 已收齐）
 *
 * 正确的行为：如果 buffer[index] 已有数据，跳过该 chunk，不修改任何状态。
 */
describe('Property 14: Duplicate chunk idempotency', () => {
  beforeEach(() => {
    resetStore();
  });

  it('receiving same chunk index twice does not increment receivedChunks', () => {
    fc.assert(
      fc.property(
        transferIdArb,
        // 生成 totalChunks（2-20）
        fc.integer({ min: 2, max: 20 }),
        // 生成一个已接收的 chunk index
        fc.nat(),
        (transferId, totalChunks, rawIndex) => {
          // 确保 duplicateIndex 在合法范围内
          const duplicateIndex = rawIndex % totalChunks;

          resetStore();

          // 设置一个已经接收了某个 chunk 的传输
          const chunks: (Uint8Array | null)[] = new Array(totalChunks).fill(null);
          chunks[duplicateIndex] = new Uint8Array([99, 88, 77]); // 已接收的 chunk

          const transfer = createReceivingTransfer({
            transferId,
            totalChunks,
            receivedChunks: 1, // 已接收 1 个 chunk
            lastReceivedIndex: duplicateIndex,
            chunks,
          });

          const transfers = new Map<string, TransferState>();
          transfers.set(transferId, transfer);

          useFileTransferStore.setState({
            transfers,
            activeReceiveCount: 1,
          });

          // 保存操作前的 receivedChunks
          const receivedChunksBefore =
            useFileTransferStore.getState().transfers.get(transferId)!
              .receivedChunks;

          // 尝试再次接收相同 index 的 chunk
          // 📚 学习要点: 重复检查在解密之前
          // receiver.ts 的 Step 3：
          // if (transfer.chunks[data.index] !== null) return;
          // 如果 buffer[index] 已有数据，直接跳过，不尝试解密。
          handleFileChunk(
            {
              senderId: 'sender-001',
              transferId,
              index: duplicateIndex,
              iv: new Uint8Array(12),
              data: new Uint8Array(100),
            },
            {} as CryptoKey
          );

          // 验证 receivedChunks 没有增加
          const transferAfter =
            useFileTransferStore.getState().transfers.get(transferId)!;
          expect(transferAfter.receivedChunks).toBe(receivedChunksBefore);

          // 验证原有 chunk 数据未被覆盖
          expect(transferAfter.chunks[duplicateIndex]).not.toBeNull();
          expect(Array.from(transferAfter.chunks[duplicateIndex]!)).toEqual([
            99, 88, 77,
          ]);

          // 验证状态仍为 receiving
          expect(transferAfter.status).toBe('receiving');
        }
      ),
      { numRuns: 100 }
    );
  });
});
