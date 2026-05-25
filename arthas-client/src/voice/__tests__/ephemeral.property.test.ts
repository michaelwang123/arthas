/**
 * 语音消息阅后即焚清理的属性测试（Property-Based Test）。
 *
 * 本文件使用 fast-check 验证 voiceStore 的 ephemeral 清理行为：
 * - Property 6: Ephemeral voice cleanup
 *
 * 📚 学习要点: 为什么需要 ephemeral 清理属性测试？
 * 在阅后即焚（ephemeral）模式下，语音消息气泡在超时后会从 UI 中消失。
 * 消失时必须同时释放关联的 Blob URL（调用 URL.revokeObjectURL），
 * 否则音频数据会永远留在内存中（内存泄漏）。
 *
 * 属性测试验证：对于**任意** transferId 和 blobUrl 组合，
 * 当 evictBlob 被调用时（模拟 ephemeral 超时触发），
 * 1. URL.revokeObjectURL 被调用且参数正确
 * 2. blob 从 blobCache 中移除
 * 3. transferId 从 lruOrder 中移除
 *
 * 这比手动列举几个 example 更有说服力——fast-check 会自动探索各种字符串值，
 * 包括特殊字符、空格、Unicode 等边界情况。
 *
 * **Validates: Requirements 8.3**
 *
 * Feature: voice-push-to-talk, Property 6: Ephemeral voice cleanup
 *
 * @module voice/__tests__/ephemeral.property.test
 * @see voiceStore.ts — evictBlob, registerVoiceBlob, blobCache, lruOrder
 * @see design.md — Property 6: Ephemeral voice cleanup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

/**
 * 📚 学习要点: Mock 策略 — 隔离 voiceStore 的外部依赖
 *
 * voiceStore 在模块加载时会：
 * 1. import recorder（创建 MediaRecorder 封装实例）
 * 2. import player（创建 Audio 播放控制实例）
 * 3. import i18n 模块（用于错误消息翻译）
 *
 * 对于 Property 6（ephemeral 清理），我们只关心 blobCache 和 lruOrder 的行为，
 * 不涉及录音或播放功能。因此 mock 这些依赖以隔离测试范围。
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

// Mock player 模块 — 防止真实的 Audio 元素创建
vi.mock('../player', () => ({
  createVoicePlayer: () => ({
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    getState: vi.fn(() => ({ state: 'idle', currentTime: 0, duration: 0 })),
  }),
}));

// Mock i18n translate 模块 — 返回 key 本身作为翻译结果
vi.mock('../../i18n/translate', () => ({
  translate: (_locale: string, key: string) => key,
}));

vi.mock('../../i18n/store', () => ({
  useI18nStore: {
    getState: () => ({ locale: 'en' }),
  },
}));

// ============================================================================
// Property 6: Ephemeral voice cleanup
// ============================================================================

describe('Property 6: Ephemeral voice cleanup', () => {
  /**
   * 📚 学习要点: Mock URL.revokeObjectURL
   * 在 Node.js 测试环境中，URL.revokeObjectURL 不存在。
   * 我们需要 mock 它来：
   * 1. 防止测试报错（ReferenceError）
   * 2. 追踪调用次数和参数，验证 ephemeral 清理时是否正确释放资源
   */
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Mock URL.revokeObjectURL 以追踪调用
    // 📚 学习要点: 保留 URL 构造函数
    // happy-dom 环境提供完整的 URL 类（包括构造函数 new URL(...)）。
    // 不能用 vi.stubGlobal 替换整个 URL 对象，否则 new URL() 会失败。
    // 只需要 spy on URL.revokeObjectURL 和 URL.createObjectURL 静态方法。
    revokeObjectURLSpy = vi.fn();
    globalThis.URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock') as unknown as typeof URL.createObjectURL;

    // 重置 voiceStore 的 LRU 缓存状态
    const { useVoiceStore } = await import('../voiceStore');
    useVoiceStore.setState({
      blobCache: new Map(),
      lruOrder: [],
      activePlaybackId: null,
      playbackStates: new Map(),
    });
  });

  /**
   * 属性 6a: 对于任意 transferId 和 blobUrl，当 evictBlob 被调用时
   * （模拟 ephemeral 超时），URL.revokeObjectURL 被调用且参数为正确的 blobUrl。
   *
   * 📚 学习要点: 模拟 ephemeral 超时的清理流程
   * 在实际应用中，ephemeral 超时由 EphemeralWrapper 组件的定时器触发，
   * 定时器到期后调用 voiceStore.evictBlob(transferId)。
   * 本测试直接调用 evictBlob 来模拟这个触发时机，
   * 验证 evictBlob 内部正确调用了 URL.revokeObjectURL。
   *
   * 生成器策略：
   * - transferId: 任意非空字符串（模拟 NanoID 格式的传输标识符）
   * - blobUrl: 以 "blob:" 前缀开头的字符串（模拟 URL.createObjectURL 的返回值）
   *
   * **Validates: Requirements 8.3**
   */
  it('URL.revokeObjectURL is called with correct blobUrl when evictBlob is triggered', async () => {
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

          // Arrange: 注册一条语音 blob（模拟接收到语音消息后的缓存）
          useVoiceStore.getState().registerVoiceBlob(transferId, blobUrl);

          // 确认已注册
          expect(useVoiceStore.getState().blobCache.has(transferId)).toBe(true);

          // Act: 模拟 ephemeral 超时触发 evictBlob
          useVoiceStore.getState().evictBlob(transferId);

          // Assert: URL.revokeObjectURL 被调用且参数正确
          expect(revokeObjectURLSpy).toHaveBeenCalledWith(blobUrl);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 6b: 对于任意 transferId 和 blobUrl，当 evictBlob 被调用时，
   * blob 从 blobCache 中被完全移除。
   *
   * 📚 学习要点: 缓存一致性验证
   * evictBlob 不仅要释放内存（revokeObjectURL），还要从 blobCache Map 中
   * 删除对应条目。如果只释放了 URL 但没有从 Map 中删除，
   * 后续 playVoice 会尝试使用已失效的 URL 播放，导致播放失败。
   *
   * **Validates: Requirements 8.3**
   */
  it('blob is removed from blobCache after evictBlob', async () => {
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

          // Arrange: 注册一条语音 blob
          useVoiceStore.getState().registerVoiceBlob(transferId, blobUrl);

          // Act: 模拟 ephemeral 超时触发 evictBlob
          useVoiceStore.getState().evictBlob(transferId);

          // Assert: blob 已从 blobCache 中移除
          expect(useVoiceStore.getState().blobCache.has(transferId)).toBe(false);
          expect(useVoiceStore.getState().blobCache.get(transferId)).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 6c: 对于任意 transferId 和 blobUrl，当 evictBlob 被调用时，
   * transferId 从 lruOrder 数组中被完全移除。
   *
   * 📚 学习要点: LRU 顺序一致性
   * lruOrder 数组追踪所有缓存条目的访问顺序（用于 LRU 淘汰决策）。
   * evictBlob 必须同时从 lruOrder 中移除对应的 transferId，
   * 否则后续的 LRU 淘汰逻辑会尝试淘汰一个已不存在的条目，
   * 导致 blobCache 和 lruOrder 之间的不一致（数据结构损坏）。
   *
   * **Validates: Requirements 8.3**
   */
  it('transferId is removed from lruOrder after evictBlob', async () => {
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

          // Arrange: 注册一条语音 blob
          useVoiceStore.getState().registerVoiceBlob(transferId, blobUrl);

          // 确认 transferId 在 lruOrder 中
          expect(useVoiceStore.getState().lruOrder).toContain(transferId);

          // Act: 模拟 ephemeral 超时触发 evictBlob
          useVoiceStore.getState().evictBlob(transferId);

          // Assert: transferId 已从 lruOrder 中移除
          expect(useVoiceStore.getState().lruOrder).not.toContain(transferId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 6d: 对于任意 transferId 和 blobUrl，ephemeral 清理后
   * 三个条件同时满足（原子性验证）。
   *
   * 📚 学习要点: 原子性不变量
   * ephemeral 清理必须是"原子"操作 — 三个清理步骤必须全部完成：
   * 1. URL.revokeObjectURL 被调用（释放内存）
   * 2. blobCache 中移除条目（防止使用失效 URL）
   * 3. lruOrder 中移除条目（保持数据结构一致性）
   *
   * 如果任何一步缺失，都会导致不一致状态：
   * - 缺少 1: 内存泄漏
   * - 缺少 2: 播放失效 URL 导致错误
   * - 缺少 3: LRU 淘汰逻辑异常
   *
   * 本测试将三个断言合并在一个属性中，验证它们作为整体的正确性。
   *
   * **Validates: Requirements 8.3**
   */
  it('ephemeral cleanup atomically revokes URL, removes from cache, and removes from lruOrder', async () => {
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

          // Arrange: 注册一条语音 blob
          useVoiceStore.getState().registerVoiceBlob(transferId, blobUrl);

          // Act: 模拟 ephemeral 超时触发 evictBlob
          useVoiceStore.getState().evictBlob(transferId);

          // Assert: 三个清理条件同时满足
          const state = useVoiceStore.getState();

          // 1. URL.revokeObjectURL 被调用且参数正确
          expect(revokeObjectURLSpy).toHaveBeenCalledWith(blobUrl);

          // 2. blob 已从 blobCache 中移除
          expect(state.blobCache.has(transferId)).toBe(false);

          // 3. transferId 已从 lruOrder 中移除
          expect(state.lruOrder).not.toContain(transferId);
        }
      ),
      { numRuns: 100 }
    );
  });
});
