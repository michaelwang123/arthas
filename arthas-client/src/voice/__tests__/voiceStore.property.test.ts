/**
 * voiceStore 状态管理的属性测试（Property-Based Test）。
 *
 * 本文件使用 fast-check 验证 voiceStore 的核心不变量：
 * - Property 5: 录音互斥性 — 当文件传输正在进行时，录音请求被拒绝
 *
 * 📚 学习要点: 为什么需要互斥性属性测试？
 * 语音消息和文件传输共享同一个 WebSocket 传输通道（activeSendId 互斥锁）。
 * 如果允许在文件传输进行中启动录音，录音完成后的发送会因为 activeSendId
 * 已被占用而失败，浪费用户的录音时间。因此在录音**开始前**就检查互斥条件，
 * 给用户即时反馈（"请等待当前传输完成"），这是更好的用户体验。
 *
 * 属性测试验证：对于**任意**非空 activeSendId 字符串，startRecording 都会被拒绝。
 * 这比手动列举几个 example 更有说服力——fast-check 会自动探索各种字符串值。
 *
 * **Validates: Requirements 7.3**
 *
 * Feature: voice-push-to-talk, Property 5: Recording mutual exclusion
 *
 * @module voice/__tests__/voiceStore.property.test
 * @see voiceStore.ts — 录音状态管理
 * @see design.md — Property 5: Recording mutual exclusion
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { useFileTransferStore } from '../../file-transfer/fileTransferStore';

/**
 * 📚 学习要点: Mock 策略 — 隔离被测模块的外部依赖
 *
 * voiceStore.startRecording() 内部会：
 * 1. 检查 fileTransferStore.getState().activeSendId（互斥检查）
 * 2. 调用 recorder.start()（启动 MediaRecorder）
 * 3. 使用 i18n translate() 生成错误消息
 *
 * 对于 Property 5（互斥性），我们只关心步骤 1 的行为：
 * - 当 activeSendId !== null 时，startRecording 应该被拒绝
 * - 不应该调用 recorder.start()（因为在步骤 1 就被拦截了）
 *
 * 因此 mock recorder 和 i18n 模块，让测试聚焦于互斥逻辑本身。
 */

// Mock recorder 模块 — 防止真实的 MediaRecorder 调用
vi.mock('../recorder', () => ({
  createVoiceRecorder: () => ({
    state: 'idle' as const,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(null),
    cancel: vi.fn(),
    dispose: vi.fn(),
  }),
}));

// Mock i18n translate 模块 — 返回 key 本身作为翻译结果（便于断言）
// 📚 学习要点: 必须 mock voiceStore 实际 import 的路径
// voiceStore 从 '../i18n/translate' 和 '../i18n/store' 分别导入，
// 因此需要 mock 这两个具体路径，而非 barrel export '../../i18n'。
vi.mock('../../i18n/translate', () => ({
  translate: (_locale: string, key: string) => key,
}));

vi.mock('../../i18n/store', () => ({
  useI18nStore: {
    getState: () => ({ locale: 'en' }),
  },
}));

// ============================================================================
// 共享 Mock 设置（Property 5 和 Property 7 共用）
// ============================================================================

describe('Property 5: Recording mutual exclusion', () => {
  beforeEach(async () => {
    // 重置 fileTransferStore 状态
    useFileTransferStore.setState({
      transfers: new Map(),
      sendQueue: [],
      activeSendId: null,
      activeReceiveCount: 0,
    });

    // 动态导入 voiceStore 并重置（避免模块缓存问题）
    const { useVoiceStore } = await import('../voiceStore');
    useVoiceStore.setState({
      recordingState: 'idle',
      recordingStartTime: null,
      recordingElapsed: 0,
      voiceError: null,
    });
  });

  /**
   * 属性 5a: 对于任意非空 activeSendId，startRecording 被拒绝且状态保持 idle。
   *
   * 📚 学习要点: 生成器策略
   * 使用 fc.string({ minLength: 1 }) 生成任意非空字符串作为 activeSendId。
   * 这覆盖了各种可能的 transferId 格式（NanoID 21 chars、UUID、短字符串等），
   * 确保互斥逻辑不依赖于 activeSendId 的具体格式，只检查是否为 null。
   *
   * **Validates: Requirements 7.3**
   */
  it('rejects startRecording when activeSendId is any non-null string', async () => {
    const { useVoiceStore } = await import('../voiceStore');

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (activeSendId) => {
          // Arrange: 设置 fileTransferStore 有活跃传输
          useFileTransferStore.setState({ activeSendId });

          // 重置 voiceStore 到 idle 状态
          useVoiceStore.setState({
            recordingState: 'idle',
            recordingStartTime: null,
            recordingElapsed: 0,
            voiceError: null,
          });

          // Act: 尝试开始录音
          await useVoiceStore.getState().startRecording();

          // Assert: 录音状态应保持 idle（被拒绝）
          const state = useVoiceStore.getState();
          expect(state.recordingState).toBe('idle');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 5b: 当 startRecording 因互斥被拒绝时，recordingError 被设置为正确的 i18n key。
   *
   * 📚 学习要点: 错误反馈验证
   * 用户需要知道为什么录音没有开始。recordingError 应该被设置为
   * 'voice.error.transferBusy' 对应的翻译文案（"请等待当前传输完成"）。
   * 由于我们 mock 了 translate 返回 key 本身，断言 recordingError 包含该 key。
   *
   * **Validates: Requirements 7.3**
   */
  it('sets recordingError to transferBusy i18n key when rejected', async () => {
    const { useVoiceStore } = await import('../voiceStore');

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (activeSendId) => {
          // Arrange: 设置 fileTransferStore 有活跃传输
          useFileTransferStore.setState({ activeSendId });

          // 重置 voiceStore
          useVoiceStore.setState({
            recordingState: 'idle',
            recordingStartTime: null,
            recordingElapsed: 0,
            voiceError: null,
          });

          // Act: 尝试开始录音
          await useVoiceStore.getState().startRecording();

          // Assert: recordingError 应包含 transferBusy 错误信息
          const state = useVoiceStore.getState();
          expect(state.voiceError).toContain('voice.error.transferBusy');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 5c: 互斥拒绝不影响 fileTransferStore 的活跃传输状态。
   *
   * 📚 学习要点: 副作用隔离验证
   * startRecording 被拒绝时，不应该修改 fileTransferStore 的任何状态。
   * 这确保了语音模块的错误处理不会干扰正在进行的文件传输。
   * 属性测试验证：对于任意 activeSendId，拒绝后该值保持不变。
   *
   * **Validates: Requirements 7.3**
   */
  it('does not modify fileTransferStore activeSendId when rejected', async () => {
    const { useVoiceStore } = await import('../voiceStore');

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (activeSendId) => {
          // Arrange: 设置 fileTransferStore 有活跃传输
          useFileTransferStore.setState({ activeSendId });

          // 重置 voiceStore
          useVoiceStore.setState({
            recordingState: 'idle',
            recordingStartTime: null,
            recordingElapsed: 0,
            voiceError: null,
          });

          // Act: 尝试开始录音
          await useVoiceStore.getState().startRecording();

          // Assert: fileTransferStore 的 activeSendId 未被修改
          expect(useFileTransferStore.getState().activeSendId).toBe(activeSendId);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ============================================================================
// Property 7: LRU cache invariant
// ============================================================================

/**
 * 📚 学习要点: LRU 缓存不变量的属性测试
 *
 * 语音消息解密后生成 Blob URL 存储在 voiceStore 的 blobCache 中。
 * 为了控制内存使用（NFR-7: ≤ 2.5MB），缓存最多保存 MAX_VOICE_CACHE (10) 条。
 * 当缓存满时，新消息进入会淘汰最久未使用的（LRU = Least Recently Used）。
 *
 * 属性测试验证两个核心不变量：
 * 1. 缓存大小永远不超过 MAX_VOICE_CACHE（无论注册多少条消息）
 * 2. 被淘汰的 Blob URL 会被 URL.revokeObjectURL 精确释放一次（防止内存泄漏）
 *
 * 📚 学习要点: 为什么用属性测试而非手动 example？
 * LRU 缓存的正确性取决于操作序列的顺序和内容。
 * 手动编写的 example 只能覆盖有限的序列模式（如"连续插入 11 条"）。
 * fast-check 会自动生成各种长度、各种 transferId 重复模式的序列，
 * 包括：重复注册同一 transferId、交替注册不同 ID、大量连续注册等。
 * 这些边界情况很难手动枚举，但属性测试能自动发现。
 *
 * **Validates: Requirements NFR-6, NFR-7**
 *
 * Feature: voice-push-to-talk, Property 7: LRU cache invariant
 */
describe('Property 7: LRU cache invariant', () => {
  /**
   * 📚 学习要点: Mock URL.revokeObjectURL
   * 在 Node.js 测试环境中，URL.revokeObjectURL 不存在。
   * 我们需要 mock 它来：
   * 1. 防止测试报错（ReferenceError）
   * 2. 追踪调用次数和参数，验证淘汰时是否正确释放资源
   *
   * 使用 vi.fn() 创建 spy，每个测试前重置调用记录。
   */
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Mock URL.revokeObjectURL 以追踪调用
    revokeObjectURLSpy = vi.fn();
    vi.stubGlobal('URL', {
      ...globalThis.URL,
      revokeObjectURL: revokeObjectURLSpy,
      createObjectURL: vi.fn(() => 'blob:mock'),
    });

    // 重置 voiceStore 的 LRU 缓存状态
    const { useVoiceStore } = await import('../voiceStore');
    useVoiceStore.setState({
      blobCache: new Map(),
      lruOrder: [],
    });
  });

  /**
   * 属性 7a: 对于任意长度的 registerVoiceBlob 调用序列，
   * blobCache.size 永远不超过 MAX_VOICE_CACHE (10)。
   *
   * 📚 学习要点: 生成器策略 — 操作序列
   * 使用 fc.array() 生成一个 registerVoiceBlob 调用序列。
   * 每个元素是一个 { transferId, blobUrl } 对象。
   * transferId 使用 fc.string({ minLength: 1 }) 生成任意非空字符串，
   * 模拟真实场景中的 NanoID（21 chars）。
   *
   * 序列长度范围 [1, 30]：
   * - 最少 1 次调用（基本情况）
   * - 最多 30 次调用（超过 MAX_VOICE_CACHE 的 3 倍，充分测试淘汰逻辑）
   *
   * **Validates: Requirements NFR-6, NFR-7**
   */
  it('blobCache size never exceeds MAX_VOICE_CACHE for any sequence of registrations', async () => {
    const { useVoiceStore } = await import('../voiceStore');
    const MAX_VOICE_CACHE = 10;

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            transferId: fc.string({ minLength: 1, maxLength: 30 }),
            blobUrl: fc.string({ minLength: 1, maxLength: 50 }).map(s => `blob:${s}`),
          }),
          { minLength: 1, maxLength: 30 }
        ),
        async (operations) => {
          // 重置缓存状态
          useVoiceStore.setState({
            blobCache: new Map(),
            lruOrder: [],
          });
          revokeObjectURLSpy.mockClear();

          // 执行所有 registerVoiceBlob 操作
          for (const op of operations) {
            useVoiceStore.getState().registerVoiceBlob(op.transferId, op.blobUrl);
          }

          // 断言：缓存大小永远不超过 MAX_VOICE_CACHE
          const state = useVoiceStore.getState();
          expect(state.blobCache.size).toBeLessThanOrEqual(MAX_VOICE_CACHE);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 7b: 当缓存已满（10 条）且注册新 blob 时，
   * 被淘汰的 blob 的 URL.revokeObjectURL 被精确调用一次。
   *
   * 📚 学习要点: 精确一次释放的重要性
   * - 如果 revokeObjectURL 未被调用 → 内存泄漏（Blob 数据永远不会被 GC）
   * - 如果 revokeObjectURL 被调用多次 → 虽然不会报错，但说明逻辑有 bug
   *
   * 测试策略：
   * 1. 先填满缓存（注册 10 条唯一的 blob）
   * 2. 注册第 11 条（触发淘汰）
   * 3. 验证 revokeObjectURL 被调用恰好 1 次
   * 4. 验证调用参数是被淘汰的那条 blob 的 URL
   *
   * 使用 fc.uniqueArray 确保 10 条初始 blob 的 transferId 互不相同，
   * 避免重复 ID 导致缓存实际未满的情况。
   *
   * **Validates: Requirements NFR-6, NFR-7**
   */
  it('evicted blob has URL.revokeObjectURL called exactly once when cache overflows', async () => {
    const { useVoiceStore } = await import('../voiceStore');
    const MAX_VOICE_CACHE = 10;

    await fc.assert(
      fc.asyncProperty(
        // 生成 MAX_VOICE_CACHE 个唯一的 transferId 用于填满缓存
        fc.uniqueArray(
          fc.string({ minLength: 1, maxLength: 20 }),
          { minLength: MAX_VOICE_CACHE, maxLength: MAX_VOICE_CACHE }
        ),
        // 生成一个新的 transferId（确保与已有的不同）
        fc.string({ minLength: 21, maxLength: 30 }),
        async (initialIds, newId) => {
          // 确保 newId 不在 initialIds 中（避免覆盖而非淘汰）
          if (initialIds.includes(newId)) return; // skip this case

          // 重置缓存状态
          useVoiceStore.setState({
            blobCache: new Map(),
            lruOrder: [],
          });
          revokeObjectURLSpy.mockClear();

          // 填满缓存：注册 MAX_VOICE_CACHE 条 blob
          for (let i = 0; i < initialIds.length; i++) {
            useVoiceStore.getState().registerVoiceBlob(
              initialIds[i],
              `blob:initial-${i}`
            );
          }

          // 此时缓存应该恰好满
          expect(useVoiceStore.getState().blobCache.size).toBe(MAX_VOICE_CACHE);

          // 记录淘汰前的 revokeObjectURL 调用次数（填满过程中不应有淘汰）
          const callsBeforeOverflow = revokeObjectURLSpy.mock.calls.length;

          // 注册第 11 条 → 触发 LRU 淘汰
          const newBlobUrl = `blob:new-${newId}`;
          useVoiceStore.getState().registerVoiceBlob(newId, newBlobUrl);

          // 断言：revokeObjectURL 被多调用了恰好 1 次（淘汰了 1 条）
          const callsAfterOverflow = revokeObjectURLSpy.mock.calls.length;
          expect(callsAfterOverflow - callsBeforeOverflow).toBe(1);

          // 断言：被淘汰的是最早注册的那条（LRU 策略：lruOrder[0]）
          // 被淘汰的 URL 应该是 initialIds[0] 对应的 blob URL
          const evictedUrl = revokeObjectURLSpy.mock.calls[callsBeforeOverflow][0];
          expect(evictedUrl).toBe('blob:initial-0');

          // 断言：缓存大小仍然是 MAX_VOICE_CACHE（淘汰 1 条 + 新增 1 条）
          expect(useVoiceStore.getState().blobCache.size).toBe(MAX_VOICE_CACHE);

          // 断言：新注册的 blob 在缓存中
          expect(useVoiceStore.getState().blobCache.has(newId)).toBe(true);

          // 断言：被淘汰的 blob 不在缓存中
          expect(useVoiceStore.getState().blobCache.has(initialIds[0])).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 7c: evictBlob 显式调用时，URL.revokeObjectURL 被精确调用一次。
   *
   * 📚 学习要点: 显式淘汰 vs 自动淘汰
   * evictBlob 有两种触发方式：
   * 1. 自动触发：registerVoiceBlob 发现缓存满时内部调用（属性 7b 测试）
   * 2. 显式触发：ephemeral 超时或用户离开房间时外部调用（本测试）
   *
   * 两种方式都必须确保 revokeObjectURL 被精确调用一次。
   * 本测试验证显式调用路径的正确性。
   *
   * **Validates: Requirements NFR-6, NFR-7**
   */
  it('evictBlob calls URL.revokeObjectURL exactly once for the evicted blob', async () => {
    const { useVoiceStore } = await import('../voiceStore');

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 50 }).map(s => `blob:${s}`),
        async (transferId, blobUrl) => {
          // 重置缓存状态
          useVoiceStore.setState({
            blobCache: new Map(),
            lruOrder: [],
          });
          revokeObjectURLSpy.mockClear();

          // 先注册一条 blob
          useVoiceStore.getState().registerVoiceBlob(transferId, blobUrl);

          // 确认已注册
          expect(useVoiceStore.getState().blobCache.has(transferId)).toBe(true);

          // 显式淘汰
          useVoiceStore.getState().evictBlob(transferId);

          // 断言：revokeObjectURL 被调用恰好 1 次
          expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);

          // 断言：调用参数是被淘汰的 blobUrl
          expect(revokeObjectURLSpy).toHaveBeenCalledWith(blobUrl);

          // 断言：blob 已从缓存中移除
          expect(useVoiceStore.getState().blobCache.has(transferId)).toBe(false);

          // 断言：lruOrder 中不再包含该 transferId
          expect(useVoiceStore.getState().lruOrder).not.toContain(transferId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
