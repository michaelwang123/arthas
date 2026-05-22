/**
 * VoiceRecorder 单元测试 — MediaRecorder 封装的行为验证
 *
 * 📚 学习要点: 浏览器 API Mock 策略
 * 语音录音模块依赖多个浏览器原生 API（MediaRecorder, getUserMedia, isTypeSupported）。
 * 在 Node.js/happy-dom 测试环境中，这些 API 不存在，需要通过 vi.stubGlobal() 模拟。
 *
 * Mock 层次：
 * 1. MediaRecorder 构造函数 — 使用 function 关键字定义（支持 new 调用）
 * 2. navigator.mediaDevices.getUserMedia — 模拟麦克风权限授予/拒绝
 * 3. MediaRecorder.isTypeSupported — 模拟 MIME 类型支持检测
 * 4. i18n 模块 — 避免测试依赖翻译文件加载
 *
 * 每个测试后通过 vi.restoreAllMocks() 清理，确保测试隔离。
 *
 * @module voice/__tests__/recorder.test
 * @see recorder.ts — 被测模块
 * @see Requirements 1.3, 1.4, 1.7, 1.8, 7.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVoiceRecorder, type VoiceRecorder } from '../recorder';

// ============================================================================
// Mock i18n 模块
// ============================================================================

vi.mock('../../i18n', () => ({
  translate: (_locale: string, key: string) => key,
  useI18nStore: {
    getState: () => ({ locale: 'zh' }),
  },
}));

// ============================================================================
// Mock 工具函数
// ============================================================================

/**
 * 创建一个模拟的 MediaStream 对象。
 *
 * 📚 学习要点: MediaStream Mock 设计
 * getUserMedia 返回 MediaStream，其中包含 audio tracks。
 * 我们需要模拟 getTracks() 和 getAudioTracks() 方法，
 * 以及 track.stop() 来验证资源释放行为。
 */
function createMockStream(): MediaStream {
  const mockTrack = {
    stop: vi.fn(),
    kind: 'audio',
    onended: null as ((this: MediaStreamTrack) => void) | null,
  };

  return {
    getTracks: vi.fn(() => [mockTrack]),
    getAudioTracks: vi.fn(() => [mockTrack]),
  } as unknown as MediaStream;
}

// ============================================================================
// 全局 Mock 设置
// ============================================================================

/** 保存最近创建的 MediaRecorder 实例，用于在测试中触发事件 */
let lastRecorderInstance: {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  state: string;
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
} | null = null;

let mockGetUserMedia: ReturnType<typeof vi.fn>;
let mockIsTypeSupported: ReturnType<typeof vi.fn>;
let mockMediaRecorderConstructor: ReturnType<typeof vi.fn>;

beforeEach(() => {
  lastRecorderInstance = null;
  mockGetUserMedia = vi.fn();
  mockIsTypeSupported = vi.fn();

  // 默认行为：权限授予，支持 webm/opus
  mockGetUserMedia.mockResolvedValue(createMockStream());
  mockIsTypeSupported.mockImplementation((mime: string) => mime === 'audio/webm;codecs=opus');

  /**
   * 📚 学习要点: 为什么使用 function 而非箭头函数？
   * JavaScript 中 `new` 操作符只能用于 function 声明/表达式，
   * 箭头函数没有 [[Construct]] 内部方法，不能被 new 调用。
   * vi.fn() 的实现如果是箭头函数，vitest 会发出警告。
   */
  mockMediaRecorderConstructor = vi.fn(function MockMediaRecorder(
    this: Record<string, unknown>,
    _stream: MediaStream,
    options?: MediaRecorderOptions
  ) {
    const instance = {
      start: vi.fn(function (this: { state: string }) {
        instance.state = 'recording';
      }),
      stop: vi.fn(function () {
        instance.state = 'inactive';
        // 模拟异步事件触发（微任务队列）
        Promise.resolve().then(() => {
          if (instance.ondataavailable) {
            instance.ondataavailable({
              data: new Blob(['audio-data'], { type: options?.mimeType || 'audio/webm' }),
            });
          }
          if (instance.onstop) {
            instance.onstop();
          }
        });
      }),
      state: 'inactive',
      mimeType: options?.mimeType || 'audio/webm;codecs=opus',
      ondataavailable: null as ((event: { data: Blob }) => void) | null,
      onstop: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };

    lastRecorderInstance = instance;

    // 将属性赋值到 this（模拟构造函数行为）
    Object.assign(this, instance);
    // 同时返回 instance 以便测试中引用
    return instance;
  });

  mockMediaRecorderConstructor.isTypeSupported = mockIsTypeSupported;
  vi.stubGlobal('MediaRecorder', mockMediaRecorderConstructor);

  // Mock navigator.mediaDevices.getUserMedia
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: mockGetUserMedia,
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================================
// 测试用例
// ============================================================================

describe('VoiceRecorder', () => {
  // ==========================================================================
  // 状态转换测试
  // ==========================================================================

  describe('state transitions: idle → requesting → recording → processing → idle', () => {
    it('starts in idle state', () => {
      const recorder = createVoiceRecorder();
      expect(recorder.state).toBe('idle');
    });

    it('transitions to requesting when start() is called', async () => {
      // 使用一个不会立即 resolve 的 promise 来捕获 requesting 状态
      let resolveGetUserMedia!: (stream: MediaStream) => void;
      mockGetUserMedia.mockReturnValue(
        new Promise<MediaStream>((resolve) => {
          resolveGetUserMedia = resolve;
        })
      );

      const recorder = createVoiceRecorder();
      const startPromise = recorder.start();

      // 在 getUserMedia resolve 之前，状态应该是 requesting
      expect(recorder.state).toBe('requesting');

      // Resolve getUserMedia 让 start 完成
      resolveGetUserMedia(createMockStream());
      await startPromise;

      expect(recorder.state).toBe('recording');
    });

    it('transitions to recording after getUserMedia resolves', async () => {
      const recorder = createVoiceRecorder();
      await recorder.start();
      expect(recorder.state).toBe('recording');
    });

    it('transitions to processing then idle when stop() is called with sufficient duration', async () => {
      const recorder = createVoiceRecorder();
      await recorder.start();

      // 模拟经过 600ms（超过 500ms 最小时长）
      const startTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 600);

      const resultPromise = recorder.stop();

      // stop() 调用后，在 onstop 触发前状态应为 processing
      expect(recorder.state).toBe('processing');

      const result = await resultPromise;

      // onstop 触发后状态回到 idle
      expect(recorder.state).toBe('idle');
      expect(result).not.toBeNull();
      expect(result!.blob).toBeInstanceOf(Blob);
      expect(result!.duration).toBeGreaterThanOrEqual(1);
      expect(result!.mimeType).toBe('audio/webm;codecs=opus');
    });

    it('returns null from stop() when not in recording state', async () => {
      const recorder = createVoiceRecorder();
      // Still in idle state
      const result = await recorder.stop();
      expect(result).toBeNull();
      expect(recorder.state).toBe('idle');
    });
  });

  // ==========================================================================
  // 权限拒绝测试
  // ==========================================================================

  describe('permission denied error path', () => {
    it('throws error with i18n key when getUserMedia is rejected', async () => {
      mockGetUserMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));

      const recorder = createVoiceRecorder();
      await expect(recorder.start()).rejects.toThrow('voice.error.micDenied');
      expect(recorder.state).toBe('idle');
    });

    it('releases stream and resets state on permission denial', async () => {
      mockGetUserMedia.mockRejectedValue(new DOMException('Not found', 'NotFoundError'));

      const recorder = createVoiceRecorder();
      await expect(recorder.start()).rejects.toThrow('voice.error.micDenied');
      expect(recorder.state).toBe('idle');
    });

    it('does not start recording if already in non-idle state', async () => {
      const recorder = createVoiceRecorder();
      await recorder.start();
      expect(recorder.state).toBe('recording');

      // Calling start again should be a no-op
      await recorder.start();
      expect(recorder.state).toBe('recording');
      // getUserMedia should only have been called once
      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // 最短录音时长测试
  // ==========================================================================

  describe('minimum duration rejection (< 500ms)', () => {
    it('returns null when recording duration is less than 500ms', async () => {
      const recorder = createVoiceRecorder();
      await recorder.start();

      // 模拟只经过 300ms（低于 500ms 阈值）
      const startTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 300);

      const result = await recorder.stop();

      expect(result).toBeNull();
      expect(recorder.state).toBe('idle');
    });

    it('cleans up stream tracks when recording is too short', async () => {
      const mockStream = createMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const recorder = createVoiceRecorder();
      await recorder.start();

      // 模拟只经过 200ms
      const startTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 200);

      await recorder.stop();

      // 验证 stream tracks 被释放
      const tracks = mockStream.getTracks();
      expect(tracks[0].stop).toHaveBeenCalled();
    });

    it('returns valid result when duration is exactly 500ms', async () => {
      const recorder = createVoiceRecorder();
      await recorder.start();

      // 模拟经过恰好 500ms
      const startTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 500);

      const result = await recorder.stop();

      expect(result).not.toBeNull();
      expect(result!.duration).toBeGreaterThanOrEqual(1);
    });
  });

  // ==========================================================================
  // 最大录音时长自动停止测试
  // ==========================================================================

  describe('maximum duration auto-stop (60s)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('automatically stops recording after 60 seconds', async () => {
      const recorder = createVoiceRecorder();
      await recorder.start();
      expect(recorder.state).toBe('recording');

      // 模拟 Date.now 返回 60 秒后的时间
      const startTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 60_000);

      // 推进定时器 60 秒触发自动停止
      vi.advanceTimersByTime(60_000);

      // 等待异步事件处理完成
      await vi.waitFor(() => {
        expect(recorder.state).toBe('idle');
      });
    });

    it('clears max duration timer when manually stopped before 60s', async () => {
      const recorder = createVoiceRecorder();
      await recorder.start();

      // 模拟经过 5 秒后手动停止
      const startTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 5000);

      await recorder.stop();

      // 推进定时器到 60 秒 — 不应有任何副作用
      vi.advanceTimersByTime(60_000);
      expect(recorder.state).toBe('idle');
    });
  });

  // ==========================================================================
  // MIME 类型回退链测试
  // ==========================================================================

  describe('MIME type fallback chain', () => {
    it('uses audio/webm;codecs=opus when supported', async () => {
      mockIsTypeSupported.mockImplementation(
        (mime: string) => mime === 'audio/webm;codecs=opus'
      );

      const recorder = createVoiceRecorder();
      await recorder.start();

      // MediaRecorder 应该用 webm/opus 创建
      expect(mockMediaRecorderConstructor).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mimeType: 'audio/webm;codecs=opus' })
      );
    });

    it('falls back to audio/mp4;codecs=opus when webm is not supported', async () => {
      mockIsTypeSupported.mockImplementation(
        (mime: string) => mime === 'audio/mp4;codecs=opus'
      );

      const recorder = createVoiceRecorder();
      await recorder.start();

      expect(mockMediaRecorderConstructor).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mimeType: 'audio/mp4;codecs=opus' })
      );
    });

    it('uses browser default (no mimeType option) when no preferred format is supported', async () => {
      mockIsTypeSupported.mockReturnValue(false);

      const recorder = createVoiceRecorder();
      await recorder.start();

      // 空字符串 mimeType 意味着不传 mimeType 选项（使用浏览器默认）
      // The constructor should be called with options that do NOT contain mimeType
      expect(mockMediaRecorderConstructor).toHaveBeenCalledWith(
        expect.anything(),
        {} // empty options object (no mimeType key)
      );
    });
  });

  // ==========================================================================
  // Stream track 清理测试
  // ==========================================================================

  describe('stream track cleanup on all error paths', () => {
    it('releases stream tracks on successful stop', async () => {
      const mockStream = createMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const recorder = createVoiceRecorder();
      await recorder.start();

      const startTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 1000);

      await recorder.stop();

      const tracks = mockStream.getTracks();
      expect(tracks[0].stop).toHaveBeenCalled();
    });

    it('releases stream tracks on cancel()', async () => {
      const mockStream = createMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const recorder = createVoiceRecorder();
      await recorder.start();
      recorder.cancel();

      const tracks = mockStream.getTracks();
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(recorder.state).toBe('idle');
    });

    it('releases stream tracks on dispose()', async () => {
      const mockStream = createMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const recorder = createVoiceRecorder();
      await recorder.start();
      recorder.dispose();

      const tracks = mockStream.getTracks();
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(recorder.state).toBe('idle');
    });

    it('releases stream tracks when recording is too short', async () => {
      const mockStream = createMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const recorder = createVoiceRecorder();
      await recorder.start();

      const startTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 100);

      await recorder.stop();

      const tracks = mockStream.getTracks();
      expect(tracks[0].stop).toHaveBeenCalled();
    });

    it('releases stream tracks on MediaRecorder error', async () => {
      const mockStream = createMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const recorder = createVoiceRecorder();
      await recorder.start();

      // 模拟 MediaRecorder 错误
      if (lastRecorderInstance?.onerror) {
        lastRecorderInstance.onerror();
      }

      const tracks = mockStream.getTracks();
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(recorder.state).toBe('idle');
    });

    it('releases stream tracks when audio track ends (mic disconnected)', async () => {
      const mockStream = createMockStream();
      mockGetUserMedia.mockResolvedValue(mockStream);

      const recorder = createVoiceRecorder();
      await recorder.start();

      // 模拟麦克风断开 — 触发 audio track 的 onended
      const audioTrack = mockStream.getAudioTracks()[0];
      if (audioTrack.onended) {
        (audioTrack.onended as () => void)();
      }

      const tracks = mockStream.getTracks();
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(recorder.state).toBe('idle');
    });

    it('cancel() is safe to call when already idle', () => {
      const recorder = createVoiceRecorder();
      expect(recorder.state).toBe('idle');

      // Should not throw
      recorder.cancel();
      expect(recorder.state).toBe('idle');
    });

    it('dispose() is safe to call when already idle', () => {
      const recorder = createVoiceRecorder();
      expect(recorder.state).toBe('idle');

      // Should not throw
      recorder.dispose();
      expect(recorder.state).toBe('idle');
    });
  });
});
