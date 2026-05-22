/**
 * VoiceMessage 语音气泡组件的属性测试（Property-Based Test）。
 *
 * 📚 学习要点: 组件渲染完整性的属性测试
 * VoiceMessage 组件需要在"就绪可播放"状态下正确显示三个核心元素：
 * 1. 发送者名称（通过 aria-label 传达，用于无障碍访问）
 * 2. 格式化后的时长字符串（如 "0:05"）
 * 3. 播放/暂停按钮（▶️ 或 ⏸️）
 *
 * 属性测试验证：对于**任意**合法的 senderName（1-20 字符）和 duration（1-60 秒），
 * 渲染输出始终包含这三个核心元素。这比手动列举几个 example 更有说服力——
 * fast-check 会自动探索各种字符串长度和数值组合，发现潜在的渲染遗漏。
 *
 * 📚 学习要点: 组件测试的 Mock 策略
 * VoiceMessage 依赖两个 Zustand Store：
 * - fileTransferStore: 提供传输状态（status, receivedChunks, totalChunks）
 * - voiceStore: 提供播放状态（playbackStates）和 Blob 缓存（blobCache）
 *
 * 为了让组件渲染到"就绪可播放"状态（显示播放按钮和时长），需要：
 * - fileTransferStore 中有 status='complete' 的传输记录
 * - voiceStore 的 blobCache 中有对应 transferId 的条目（表示 Blob 已缓存，非过期）
 * - voiceStore 的 playbackStates 中有 idle 状态（未在播放）
 *
 * **Validates: Requirements 5.2**
 *
 * Feature: voice-push-to-talk, Property 3: Voice bubble rendering completeness
 *
 * @module voice/__tests__/VoiceMessage.property.test
 * @see VoiceMessage.tsx — 语音消息气泡组件
 * @see design.md — Property 3: Voice bubble rendering completeness
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { render, screen, cleanup } from '@testing-library/react';
import { formatDuration } from '../formatDuration';

// ============================================================================
// Mock 设置
// ============================================================================

/**
 * 📚 学习要点: Mock i18n 模块
 * VoiceMessage 组件使用 useTranslation() hook 获取翻译函数。
 * 在测试中 mock i18n 模块，让 t() 直接返回 key 本身，
 * 这样断言时可以检查 key 是否出现在渲染输出中。
 */
vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

/**
 * 📚 学习要点: Mock voiceStore 和 fileTransferStore
 * VoiceMessage 组件内部通过 Zustand 的 useStore(selector) 模式订阅状态。
 * 我们 mock 这两个 store 模块，让 selector 函数从可控的 mock 状态中提取值。
 *
 * 为什么 mock 整个 store 模块而非操作真实 store？
 * - voiceStore 的创建依赖 recorder 和 player 模块（需要 MediaRecorder 等浏览器 API）
 * - 直接 mock 整个模块更简洁，避免级联 mock 依赖
 * - 属性测试关注的是渲染输出，不需要真实的 store 逻辑
 */
const mockPlayVoice = vi.fn();
const mockPauseVoice = vi.fn();

// 模块级变量：控制 mock store 返回的状态
let mockBlobCache = new Map<string, string>();
let mockPlaybackStates = new Map<string, { state: string; currentTime: number; duration: number }>();

vi.mock('../voiceStore', () => ({
  useVoiceStore: (selector: (state: unknown) => unknown) => {
    const mockState = {
      playbackStates: mockPlaybackStates,
      blobCache: mockBlobCache,
      playVoice: mockPlayVoice,
      pauseVoice: mockPauseVoice,
    };
    return selector(mockState);
  },
}));

// 模块级变量：控制 fileTransferStore mock 返回的传输状态
let mockTransfers = new Map<string, unknown>();

vi.mock('../../file-transfer/fileTransferStore', () => ({
  useFileTransferStore: (selector: (state: unknown) => unknown) => {
    const mockState = {
      transfers: mockTransfers,
    };
    return selector(mockState);
  },
}));

// ============================================================================
// 测试
// ============================================================================

describe('Property 3: Voice bubble rendering completeness', () => {
  beforeEach(() => {
    // 重置 mock 状态
    mockBlobCache = new Map();
    mockPlaybackStates = new Map();
    mockTransfers = new Map();
    mockPlayVoice.mockClear();
    mockPauseVoice.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * 属性 3a: 对于任意合法的 senderName 和 duration，
   * 渲染的语音气泡包含格式化后的时长字符串。
   *
   * 📚 学习要点: 生成器策略 — 受限字符集
   * senderName 使用 fc.stringMatching(/^[a-zA-Z0-9]+$/) 生成 1-20 字符的字母数字字符串。
   * 这避免了特殊字符（如 <, >, &）在 DOM 中被转义后导致断言失败的问题。
   * 实际场景中用户名通常也是字母数字组合。
   *
   * duration 使用 fc.integer({ min: 1, max: 60 }) 生成整数秒数。
   * 范围 [1, 60] 对应语音消息的有效时长（最短 1 秒，最长 60 秒）。
   *
   * **Validates: Requirements 5.2**
   */
  it('rendered bubble contains formatted duration for any valid senderName and duration', async () => {
    const { VoiceMessage } = await import('../components/VoiceMessage');

    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9]+$/).filter(s => s.length >= 1 && s.length <= 20),
        fc.integer({ min: 1, max: 60 }),
        (senderName, duration) => {
          // Arrange: 设置 "就绪可播放" 状态
          const transferId = `test-transfer-${senderName}-${duration}`;

          // fileTransferStore: 传输已完成
          mockTransfers = new Map();
          mockTransfers.set(transferId, {
            transferId,
            direction: 'receive',
            status: 'complete',
            fileName: 'voice.webm',
            fileSize: 1024,
            mimeType: 'audio/webm',
            totalChunks: 1,
            receivedChunks: 1,
            lastReceivedIndex: 0,
            chunks: [],
            startTime: Date.now(),
            lastChunkTime: Date.now(),
            senderId: 'sender-1',
            senderName,
            ackCount: 0,
            totalReceivers: 1,
            chatMessageId: 'msg-1',
          });

          // voiceStore: blobCache 有该 transferId（表示 Blob 已缓存，非过期）
          mockBlobCache = new Map([[transferId, `blob:${transferId}`]]);
          // playbackState: idle（未在播放）
          mockPlaybackStates = new Map([[transferId, { state: 'idle', currentTime: 0, duration }]]);

          // Act: 渲染组件
          cleanup();
          render(
            React.createElement(VoiceMessage, { transferId, duration, senderName, isMine: false })
          );

          // Assert: 渲染输出包含格式化后的时长
          const expectedDuration = formatDuration(duration);
          const durationElement = screen.getByText(expectedDuration);
          expect(durationElement).toBeInTheDocument();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 3b: 对于任意合法的 senderName 和 duration，
   * 渲染的语音气泡包含播放/暂停按钮（▶️ 或 ⏸️）。
   *
   * 📚 学习要点: 按钮存在性验证
   * 在"就绪可播放"（idle）状态下，按钮显示 ▶️（播放图标）。
   * 通过 aria-label="Play" 查找按钮元素，这是更可靠的查询方式：
   * - 不依赖 emoji 的具体渲染（不同平台可能显示不同）
   * - 符合无障碍最佳实践（按钮应有 aria-label）
   * - 即使 UI 文案变化，aria-label 通常保持稳定
   *
   * **Validates: Requirements 5.2**
   */
  it('rendered bubble contains play/pause button for any valid senderName and duration', async () => {
    const { VoiceMessage } = await import('../components/VoiceMessage');

    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9]+$/).filter(s => s.length >= 1 && s.length <= 20),
        fc.integer({ min: 1, max: 60 }),
        (senderName, duration) => {
          // Arrange: 设置 "就绪可播放" 状态
          const transferId = `test-transfer-${senderName}-${duration}`;

          // fileTransferStore: 传输已完成
          mockTransfers = new Map();
          mockTransfers.set(transferId, {
            transferId,
            direction: 'receive',
            status: 'complete',
            fileName: 'voice.webm',
            fileSize: 1024,
            mimeType: 'audio/webm',
            totalChunks: 1,
            receivedChunks: 1,
            lastReceivedIndex: 0,
            chunks: [],
            startTime: Date.now(),
            lastChunkTime: Date.now(),
            senderId: 'sender-1',
            senderName,
            ackCount: 0,
            totalReceivers: 1,
            chatMessageId: 'msg-1',
          });

          // voiceStore: blobCache 有该 transferId
          mockBlobCache = new Map([[transferId, `blob:${transferId}`]]);
          mockPlaybackStates = new Map([[transferId, { state: 'idle', currentTime: 0, duration }]]);

          // Act: 渲染组件
          cleanup();
          render(
            React.createElement(VoiceMessage, { transferId, duration, senderName, isMine: false })
          );

          // Assert: 存在播放按钮（aria-label="Play"）
          const playButton = screen.getByRole('button', { name: /Play/i });
          expect(playButton).toBeInTheDocument();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 3c: 对于任意合法的 senderName 和 duration（isMine=false），
   * 渲染的语音气泡的 aria-label 包含 senderName。
   *
   * 📚 学习要点: 无障碍属性验证
   * VoiceMessage 组件在正常播放状态下使用 aria-label 传达语义信息：
   * `aria-label={`${senderName} ${t('voice.recording')} ${formatDuration(duration)}`}`
   *
   * 对于 isMine=false 的消息，senderName 出现在 aria-label 中，
   * 让屏幕阅读器用户知道这条语音消息来自谁。
   *
   * 属性测试验证：对于任意 senderName，aria-label 始终包含该名称。
   * 这确保了无障碍信息不会因为特定字符组合而丢失。
   *
   * **Validates: Requirements 5.2**
   */
  it('rendered bubble aria-label contains senderName for isMine=false', async () => {
    const { VoiceMessage } = await import('../components/VoiceMessage');

    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9]+$/).filter(s => s.length >= 1 && s.length <= 20),
        fc.integer({ min: 1, max: 60 }),
        (senderName, duration) => {
          // Arrange: 设置 "就绪可播放" 状态
          const transferId = `test-transfer-${senderName}-${duration}`;

          // fileTransferStore: 传输已完成
          mockTransfers = new Map();
          mockTransfers.set(transferId, {
            transferId,
            direction: 'receive',
            status: 'complete',
            fileName: 'voice.webm',
            fileSize: 1024,
            mimeType: 'audio/webm',
            totalChunks: 1,
            receivedChunks: 1,
            lastReceivedIndex: 0,
            chunks: [],
            startTime: Date.now(),
            lastChunkTime: Date.now(),
            senderId: 'sender-1',
            senderName,
            ackCount: 0,
            totalReceivers: 1,
            chatMessageId: 'msg-1',
          });

          // voiceStore: blobCache 有该 transferId
          mockBlobCache = new Map([[transferId, `blob:${transferId}`]]);
          mockPlaybackStates = new Map([[transferId, { state: 'idle', currentTime: 0, duration }]]);

          // Act: 渲染组件（isMine=false，显示 senderName）
          cleanup();
          render(
            React.createElement(VoiceMessage, { transferId, duration, senderName, isMine: false })
          );

          // Assert: aria-label 包含 senderName
          const article = screen.getByRole('article');
          expect(article).toHaveAttribute('aria-label', expect.stringContaining(senderName));
        }
      ),
      { numRuns: 100 }
    );
  });
});
