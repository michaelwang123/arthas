/**
 * voiceSender 语音发送协调器的属性测试（Property-Based Test）。
 *
 * 本文件使用 fast-check 验证 voiceSender 的核心不变量：
 * - Property 2: Voice metadata invariant — 对于任意有效录音参数，
 *   构造的 metadata 始终包含正确的 isVoice、duration、mimeType 和 totalChunks。
 *
 * 📚 学习要点: 为什么需要 metadata 不变量属性测试？
 * voiceSender 是语音录音和文件传输之间的「适配器」。它的核心职责是：
 * 1. 将 Audio_Blob 包装为 File 对象
 * 2. 通过 extraMetadata 注入 { isVoice: true, duration } 到加密 metadata
 *
 * 如果 metadata 构造有误（如 isVoice 缺失、duration 不匹配），
 * 接收方将无法正确识别语音消息（渲染为普通文件而非语音气泡）。
 * 属性测试验证：对于**任意**有效的录音参数组合，metadata 始终正确。
 *
 * **Validates: Requirements 3.3**
 *
 * Feature: voice-push-to-talk, Property 2: Voice metadata invariant
 *
 * @module voice/__tests__/voiceSender.property.test
 * @see voiceSender.ts — sendVoice 函数
 * @see design.md — Property 2: Voice metadata invariant
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

// ============================================================================
// Mock 设置
// ============================================================================

/**
 * 📚 学习要点: Mock 策略 — 捕获 initiateTransfer 的参数
 *
 * sendVoice 内部调用 fileTransferStore.initiateTransfer(file, { extraMetadata })。
 * 为了验证 metadata 不变量，我们需要捕获传递给 initiateTransfer 的参数：
 * 1. file 对象 — 验证 mimeType 和 size
 * 2. options.extraMetadata — 验证 isVoice 和 duration
 *
 * 同时需要 mock chatStore（插入聊天占位符）和 voiceStore（错误状态设置）。
 */

// 用于捕获 initiateTransfer 调用参数的 spy
const initiateTransferSpy = vi.fn();

// Mock fileTransferStore — 捕获 initiateTransfer 参数并返回有效 transferId
vi.mock('../../file-transfer/fileTransferStore', () => ({
  useFileTransferStore: {
    getState: () => ({
      initiateTransfer: initiateTransferSpy,
    }),
    setState: vi.fn(),
  },
}));

// Mock chatStore — 提供 myId 和 myName，接受 setState 调用
vi.mock('../../stores/chatStore', () => ({
  useChatStore: {
    getState: () => ({
      myId: 'test-user-id',
      myName: 'TestUser',
    }),
    setState: vi.fn(),
  },
}));

// Mock voiceStore — 接受错误状态设置
vi.mock('../voiceStore', () => ({
  useVoiceStore: {
    setState: vi.fn(),
    getState: () => ({
      registerVoiceBlob: vi.fn(),
    }),
  },
}));

// Mock i18n — 返回 key 本身作为翻译结果
vi.mock('../../i18n/translate', () => ({
  translate: (_locale: string, key: string) => key,
}));

vi.mock('../../i18n/store', () => ({
  useI18nStore: {
    getState: () => ({ locale: 'en' }),
  },
}));

// Mock URL.createObjectURL（sendVoice 中为发送方创建本地 Blob URL）
if (typeof globalThis.URL.createObjectURL !== 'function') {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-local-url');
} else {
  vi.spyOn(globalThis.URL, 'createObjectURL').mockReturnValue('blob:mock-local-url');
}

// ============================================================================
// Property 2: Voice metadata invariant
// ============================================================================

describe('Property 2: Voice metadata invariant', () => {
  /**
   * 📚 学习要点: CHUNK_SIZE 常量
   * 文件传输使用 64KB (65536 bytes) 分片。totalChunks = Math.ceil(fileSize / 65536)。
   * 语音消息通常 1-4 个 chunk（60 秒 Opus 约 60-240KB）。
   */
  const CHUNK_SIZE = 65536;

  /**
   * 📚 学习要点: 有效的 MIME 类型集合
   * MediaRecorder 根据浏览器支持选择 MIME 类型：
   * - Chrome/Firefox/Edge: audio/webm;codecs=opus
   * - Safari: audio/mp4;codecs=opus
   * - 回退: audio/webm（浏览器默认）
   */
  const VALID_MIME_TYPES = [
    'audio/webm;codecs=opus',
    'audio/mp4;codecs=opus',
    'audio/webm',
  ] as const;

  beforeEach(() => {
    // 重置所有 mock 调用记录
    initiateTransferSpy.mockClear();
    // 默认返回有效的 transferId（模拟 initiateTransfer 成功）
    initiateTransferSpy.mockReturnValue('mock-transfer-id-12345');
  });

  /**
   * 属性 2a: 对于任意有效录音参数，extraMetadata 始终包含 isVoice: true 和正确的 duration。
   *
   * 📚 学习要点: 生成器策略
   * - duration: fc.integer({ min: 1, max: 60 }) — 有效录音时长（秒）
   *   注意：设计文档中 500ms 最小时长由 recorder 层保证，到达 voiceSender 时
   *   duration 已经是 Math.round() 后的整数秒（最小 1 秒）
   * - blobSize: fc.integer({ min: 500, max: 245760 }) — 有效 Blob 大小（500B 到 240KB）
   * - mimeType: fc.constantFrom(...VALID_MIME_TYPES) — 三种有效 MIME 类型之一
   *
   * **Validates: Requirements 3.3**
   */
  it('extraMetadata always has isVoice: true and correct duration for any valid recording', async () => {
    const { sendVoice } = await import('../voiceSender');

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 500, max: 245760 }),
        fc.constantFrom(...VALID_MIME_TYPES),
        (duration, blobSize, mimeType) => {
          // Arrange: 创建指定大小的 Blob
          const blobData = new Uint8Array(blobSize);
          const blob = new Blob([blobData], { type: mimeType });

          // 重置 spy
          initiateTransferSpy.mockClear();
          initiateTransferSpy.mockReturnValue('mock-transfer-id-12345');

          // Act: 调用 sendVoice
          sendVoice(blob, duration, mimeType);

          // Assert: initiateTransfer 被调用
          expect(initiateTransferSpy).toHaveBeenCalledTimes(1);

          // 提取 initiateTransfer 的第二个参数（options）
          const [, options] = initiateTransferSpy.mock.calls[0];

          // Assert: extraMetadata 包含 isVoice: true
          expect(options).toBeDefined();
          expect(options.extraMetadata).toBeDefined();
          expect(options.extraMetadata.isVoice).toBe(true);

          // Assert: extraMetadata 包含正确的 duration
          expect(options.extraMetadata.duration).toBe(duration);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 2b: 对于任意有效录音参数，File 对象的 mimeType 始终以 'audio/' 开头。
   *
   * 📚 学习要点: mimeType 验证的重要性
   * 接收方根据 mimeType 判断文件类型。如果 mimeType 不以 'audio/' 开头，
   * 旧客户端可能无法正确识别为音频文件（优雅降级失败）。
   * voiceSender 将 mimeType 直接传递给 new File([blob], name, { type: mimeType })，
   * 因此输入的 mimeType 必须是有效的音频类型。
   *
   * **Validates: Requirements 3.3**
   */
  it('File object always has mimeType starting with audio/ for any valid recording', async () => {
    const { sendVoice } = await import('../voiceSender');

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 500, max: 245760 }),
        fc.constantFrom(...VALID_MIME_TYPES),
        (duration, blobSize, mimeType) => {
          // Arrange: 创建指定大小的 Blob
          const blobData = new Uint8Array(blobSize);
          const blob = new Blob([blobData], { type: mimeType });

          // 重置 spy
          initiateTransferSpy.mockClear();
          initiateTransferSpy.mockReturnValue('mock-transfer-id-12345');

          // Act: 调用 sendVoice
          sendVoice(blob, duration, mimeType);

          // Assert: initiateTransfer 被调用
          expect(initiateTransferSpy).toHaveBeenCalledTimes(1);

          // 提取 initiateTransfer 的第一个参数（File 对象）
          const [file] = initiateTransferSpy.mock.calls[0];

          // Assert: File 的 type 以 'audio/' 开头
          expect(file.type.startsWith('audio/')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 2c: 对于任意有效 Blob 大小，totalChunks 计算正确。
   *
   * 📚 学习要点: totalChunks 的计算
   * totalChunks = Math.ceil(fileSize / CHUNK_SIZE)
   * 这个值在 sender.ts 的 sendEncryptedMetadata 中计算并写入加密 metadata。
   * 但 File 对象的 size 属性决定了最终的 totalChunks。
   * 本测试验证 File.size 与输入 Blob 大小一致，从而确保 totalChunks 计算正确。
   *
   * 📚 学习要点: 为什么验证 File.size 而非直接验证 totalChunks？
   * totalChunks 的计算发生在 sender.ts（sendEncryptedMetadata 内部），
   * 不在 voiceSender 的职责范围内。voiceSender 的职责是确保 File.size 正确，
   * 这样 sender.ts 才能计算出正确的 totalChunks。
   * 我们在此验证 File.size === blob.size，并验证由此推导的 totalChunks 值。
   *
   * **Validates: Requirements 3.3**
   */
  it('File size matches blob size and implies correct totalChunks for any valid recording', async () => {
    const { sendVoice } = await import('../voiceSender');

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 500, max: 245760 }),
        fc.constantFrom(...VALID_MIME_TYPES),
        (duration, blobSize, mimeType) => {
          // Arrange: 创建指定大小的 Blob
          const blobData = new Uint8Array(blobSize);
          const blob = new Blob([blobData], { type: mimeType });

          // 重置 spy
          initiateTransferSpy.mockClear();
          initiateTransferSpy.mockReturnValue('mock-transfer-id-12345');

          // Act: 调用 sendVoice
          sendVoice(blob, duration, mimeType);

          // Assert: initiateTransfer 被调用
          expect(initiateTransferSpy).toHaveBeenCalledTimes(1);

          // 提取 File 对象
          const [file] = initiateTransferSpy.mock.calls[0];

          // Assert: File.size 与 Blob 大小一致
          expect(file.size).toBe(blobSize);

          // Assert: 由 File.size 推导的 totalChunks 正确
          const expectedTotalChunks = Math.ceil(blobSize / CHUNK_SIZE);
          const actualTotalChunks = Math.ceil(file.size / CHUNK_SIZE);
          expect(actualTotalChunks).toBe(expectedTotalChunks);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 2d: 对于任意有效录音参数，所有 metadata 不变量同时成立。
   *
   * 📚 学习要点: 组合属性验证
   * 前面的测试分别验证了 isVoice、duration、mimeType 和 totalChunks。
   * 本测试将所有不变量组合在一起验证，确保它们在同一次调用中同时成立。
   * 这比分开验证更强——它排除了"修复一个属性时破坏另一个"的可能性。
   *
   * **Validates: Requirements 3.3**
   */
  it('all metadata invariants hold simultaneously for any valid recording parameters', async () => {
    const { sendVoice } = await import('../voiceSender');

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 500, max: 245760 }),
        fc.constantFrom(...VALID_MIME_TYPES),
        (duration, blobSize, mimeType) => {
          // Arrange: 创建指定大小的 Blob
          const blobData = new Uint8Array(blobSize);
          const blob = new Blob([blobData], { type: mimeType });

          // 重置 spy
          initiateTransferSpy.mockClear();
          initiateTransferSpy.mockReturnValue('mock-transfer-id-12345');

          // Act: 调用 sendVoice
          sendVoice(blob, duration, mimeType);

          // Assert: initiateTransfer 被调用恰好一次
          expect(initiateTransferSpy).toHaveBeenCalledTimes(1);

          const [file, options] = initiateTransferSpy.mock.calls[0];

          // ─── 不变量 1: isVoice === true ───────────────────────────
          expect(options.extraMetadata.isVoice).toBe(true);

          // ─── 不变量 2: duration 匹配输入 ──────────────────────────
          expect(options.extraMetadata.duration).toBe(duration);

          // ─── 不变量 3: mimeType 以 'audio/' 开头 ──────────────────
          expect(file.type.startsWith('audio/')).toBe(true);

          // ─── 不变量 4: totalChunks = Math.ceil(fileSize / 65536) ──
          const expectedTotalChunks = Math.ceil(blobSize / CHUNK_SIZE);
          expect(Math.ceil(file.size / CHUNK_SIZE)).toBe(expectedTotalChunks);
        }
      ),
      { numRuns: 100 }
    );
  });
});
