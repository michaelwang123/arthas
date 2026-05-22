/**
 * 语音播放器（VoicePlayer）单元测试。
 *
 * 📚 学习要点: 浏览器 Audio API 的 Mock 策略
 * Node.js 测试环境中没有 HTMLAudioElement，需要完整 mock：
 * - 使用 vi.stubGlobal('Audio', MockAudioConstructor) 替换全局 Audio 构造函数
 * - Mock 的 Audio 实例需要模拟 play/pause 方法和 ontimeupdate/onended/onerror 事件
 * - play() 返回 Promise（模拟现代浏览器行为）
 * - 通过手动调用 ontimeupdate/onended 来模拟浏览器事件触发
 *
 * 📚 学习要点: 回调验证模式
 * player.ts 通过 onStateChange 和 onTimeUpdate 回调通知外部状态变化。
 * 测试中使用 vi.fn() 创建 spy 函数，验证回调被正确调用（参数和次数）。
 * 这比直接检查内部状态更符合"测试行为而非实现"的原则。
 *
 * @module voice/__tests__/player.test
 * @see player.ts — 被测模块
 * @see requirements.md — Requirements 4.4, 4.5, 4.6, 7.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createVoicePlayer, type VoicePlayer } from '../player';

// ============================================================================
// Mock 设置
// ============================================================================

/**
 * 📚 学习要点: Mock i18n 模块
 * player.ts 在 autoplay policy 错误时调用 translate() 和 useI18nStore。
 * 测试中 mock 整个 i18n 模块，避免依赖真实的翻译文件和 Zustand store。
 */
vi.mock('../../i18n', () => ({
  translate: vi.fn((_locale: string, key: string) => `[${key}]`),
  useI18nStore: {
    getState: () => ({ locale: 'zh' }),
  },
}));

/**
 * Mock Audio 实例的类型定义。
 * 包含所有 player.ts 使用的 Audio 属性和方法。
 */
interface MockAudioInstance {
  src: string;
  currentTime: number;
  duration: number;
  ontimeupdate: (() => void) | null;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

/** 当前活跃的 Mock Audio 实例（用于在测试中模拟事件） */
let mockAudioInstance: MockAudioInstance | null = null;

/** play() 返回的 Promise 的 resolve/reject 控制器 */
let playResolve: (() => void) | null = null;
let playReject: ((error: DOMException) => void) | null = null;

/**
 * 创建 Mock Audio 构造函数。
 *
 * 📚 学习要点: 为什么使用 class 而非 vi.fn() 返回对象？
 * `new Audio(src)` 需要一个真正的构造函数（function 或 class）。
 * vi.fn(() => obj) 返回的是普通函数，不能用 new 调用。
 * 使用 class 语法确保 Mock 可以被 new 关键字正确实例化。
 *
 * 📚 学习要点: 为什么每个测试都重新创建 Mock？
 * 每个测试需要独立的 Audio 实例状态，避免测试间相互污染。
 * beforeEach 中重新 stubGlobal 确保每个测试从干净状态开始。
 */
function createMockAudioClass() {
  return class MockAudio {
    src: string;
    currentTime: number;
    duration: number;
    ontimeupdate: (() => void) | null;
    onended: (() => void) | null;
    onerror: (() => void) | null;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;

    constructor(src?: string) {
      this.src = src || '';
      this.currentTime = 0;
      this.duration = 10; // 默认 10 秒时长
      this.ontimeupdate = null;
      this.onended = null;
      this.onerror = null;
      this.play = vi.fn(() => {
        return new Promise<void>((resolve, reject) => {
          playResolve = resolve;
          playReject = reject;
        });
      });
      this.pause = vi.fn();

      // 保存引用供测试访问
      mockAudioInstance = this as unknown as MockAudioInstance;
    }
  };
}

// ============================================================================
// 测试套件
// ============================================================================

describe('createVoicePlayer', () => {
  let player: VoicePlayer;
  let onStateChange: ReturnType<typeof vi.fn>;
  let onTimeUpdate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // 重置 mock 状态
    mockAudioInstance = null;
    playResolve = null;
    playReject = null;

    // 注入 Mock Audio 类（必须是 class/function 才能被 new 调用）
    vi.stubGlobal('Audio', createMockAudioClass());

    // 创建回调 spy
    onStateChange = vi.fn();
    onTimeUpdate = vi.fn();

    // 创建播放器实例
    player = createVoicePlayer({ onStateChange, onTimeUpdate });
  });

  afterEach(() => {
    player.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ==========================================================================
  // 单例播放行为测试 — Requirements 4.4
  // ==========================================================================

  describe('singleton playback behavior', () => {
    it('playing a new message stops the previous one', async () => {
      // 播放第一条消息
      player.play('transfer-1', 'blob:http://localhost/audio1');
      await playResolve?.();

      // 记录第一个 Audio 实例
      const firstAudio = mockAudioInstance;
      expect(firstAudio).not.toBeNull();

      // 播放第二条消息（应自动停止第一条）
      player.play('transfer-2', 'blob:http://localhost/audio2');
      await playResolve?.();

      // 验证第一个 Audio 实例被清理
      expect(firstAudio!.pause).toHaveBeenCalled();
      expect(firstAudio!.src).toBe('');
      expect(firstAudio!.ontimeupdate).toBeNull();
      expect(firstAudio!.onended).toBeNull();
      expect(firstAudio!.onerror).toBeNull();

      // 验证第一条消息状态被重置为 idle
      expect(onStateChange).toHaveBeenCalledWith('transfer-1', 'idle');
    });

    it('only one Audio instance is active at a time', () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      const firstAudio = mockAudioInstance;

      player.play('transfer-2', 'blob:http://localhost/audio2');
      const secondAudio = mockAudioInstance;

      // 两次 play 创建了两个不同的 Audio 实例
      expect(firstAudio).not.toBe(secondAudio);
      // 第一个被清理
      expect(firstAudio!.src).toBe('');
    });

    it('playing the same message again restarts from beginning', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      // 模拟播放到一半
      mockAudioInstance!.currentTime = 5;

      // 再次播放同一条消息
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      // 新的 Audio 实例 currentTime 从 0 开始
      expect(mockAudioInstance!.currentTime).toBe(0);
    });
  });

  // ==========================================================================
  // 播放状态转换测试 — Requirements 4.4, 4.5, 4.6
  // ==========================================================================

  describe('play → pause → resume → stop transitions', () => {
    it('play() transitions state to playing', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');

      // resolve play promise
      playResolve?.();
      await Promise.resolve();

      expect(onStateChange).toHaveBeenCalledWith('transfer-1', 'playing');
      expect(player.getState('transfer-1').state).toBe('playing');
    });

    it('pause() transitions state from playing to paused', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      // 模拟播放进度
      mockAudioInstance!.currentTime = 3.5;

      player.pause();

      expect(mockAudioInstance!.pause).toHaveBeenCalled();
      expect(onStateChange).toHaveBeenCalledWith('transfer-1', 'paused');
      expect(player.getState('transfer-1').state).toBe('paused');
      expect(player.getState('transfer-1').currentTime).toBe(3.5);
    });

    it('resume() transitions state from paused to playing', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      player.pause();

      // resume
      player.resume();
      playResolve?.();
      await Promise.resolve();

      expect(onStateChange).toHaveBeenCalledWith('transfer-1', 'playing');
      expect(player.getState('transfer-1').state).toBe('playing');
    });

    it('stop() transitions state to idle and resets currentTime', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      // 模拟播放进度
      mockAudioInstance!.currentTime = 5;

      player.stop();

      expect(onStateChange).toHaveBeenCalledWith('transfer-1', 'idle');
      expect(player.getState('transfer-1').state).toBe('idle');
      expect(player.getState('transfer-1').currentTime).toBe(0);
    });

    it('pause() does nothing when not playing', () => {
      player.pause();
      expect(onStateChange).not.toHaveBeenCalled();
    });

    it('resume() does nothing when not paused', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      // 清除之前的调用记录
      onStateChange.mockClear();

      // resume 在 playing 状态下不应生效
      player.resume();
      // resume 内部会调用 play()，但由于状态不是 paused，不会执行
      expect(onStateChange).not.toHaveBeenCalledWith('transfer-1', 'playing');
    });

    it('stop() does nothing when no active playback', () => {
      player.stop();
      expect(onStateChange).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // ended 事件测试 — Requirements 4.4
  // ==========================================================================

  describe('ended event resets state to idle', () => {
    it('onended resets state to idle and currentTime to 0', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      // 清除 play 产生的调用记录
      onStateChange.mockClear();

      // 模拟播放完成
      mockAudioInstance!.onended?.();

      expect(onStateChange).toHaveBeenCalledWith('transfer-1', 'idle');
      expect(player.getState('transfer-1').state).toBe('idle');
      expect(player.getState('transfer-1').currentTime).toBe(0);
    });

    it('onended cleans up Audio element', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      const audio = mockAudioInstance!;

      // 模拟播放完成
      audio.onended?.();

      // Audio 元素应被清理
      expect(audio.src).toBe('');
      expect(audio.ontimeupdate).toBeNull();
      expect(audio.onended).toBeNull();
      expect(audio.onerror).toBeNull();
    });

    it('onended from stale Audio instance is ignored', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      const firstAudio = mockAudioInstance!;

      // 播放新消息（停止第一条）
      player.play('transfer-2', 'blob:http://localhost/audio2');
      playResolve?.();
      await Promise.resolve();

      onStateChange.mockClear();

      // 第一个 Audio 的 onended 不应影响当前播放
      // 注意：cleanupAudio 已将 firstAudio.onended 设为 null
      // 所以这个调用不会执行任何逻辑
      if (firstAudio.onended) {
        firstAudio.onended();
      }

      // 第二条消息的状态不应被影响
      expect(player.getState('transfer-2').state).toBe('playing');
    });
  });

  // ==========================================================================
  // timeupdate 事件测试
  // ==========================================================================

  describe('timeupdate event updates progress', () => {
    it('ontimeupdate calls onTimeUpdate callback', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      // 模拟 timeupdate 事件
      mockAudioInstance!.currentTime = 2.5;
      mockAudioInstance!.ontimeupdate?.();

      expect(onTimeUpdate).toHaveBeenCalledWith('transfer-1', 2.5);
    });

    it('ontimeupdate updates internal state', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      mockAudioInstance!.currentTime = 7.3;
      mockAudioInstance!.duration = 10;
      mockAudioInstance!.ontimeupdate?.();

      const state = player.getState('transfer-1');
      expect(state.currentTime).toBe(7.3);
      expect(state.duration).toBe(10);
    });
  });

  // ==========================================================================
  // Autoplay policy 错误处理测试 — Requirements 7.5
  // ==========================================================================

  describe('autoplay policy error handling', () => {
    it('handles NotAllowedError from play() rejection', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      player.play('transfer-1', 'blob:http://localhost/audio1');

      // 模拟 autoplay policy 拒绝
      const notAllowedError = new DOMException('Autoplay is not allowed', 'NotAllowedError');
      playReject?.(notAllowedError);
      await Promise.resolve();
      // 需要额外的 microtask 让 catch 处理完成
      await Promise.resolve();

      // 状态应回到 idle（用户可以重试）
      expect(player.getState('transfer-1').state).toBe('idle');
      expect(player.getState('transfer-1').currentTime).toBe(0);

      // 应输出警告日志
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VoicePlayer] Autoplay blocked')
      );

      consoleWarnSpy.mockRestore();
    });

    it('handles generic play() error', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      player.play('transfer-1', 'blob:http://localhost/audio1');

      // 模拟其他类型的播放错误
      const genericError = new DOMException('Playback failed', 'AbortError');
      playReject?.(genericError);
      await Promise.resolve();
      await Promise.resolve();

      // 状态应回到 idle
      expect(player.getState('transfer-1').state).toBe('idle');

      // 应输出不同的警告日志
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VoicePlayer] Play failed:'),
        expect.any(String)
      );

      consoleWarnSpy.mockRestore();
    });

    it('cleans up Audio element on autoplay error', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      const audio = mockAudioInstance!;

      const notAllowedError = new DOMException('Autoplay is not allowed', 'NotAllowedError');
      playReject?.(notAllowedError);
      await Promise.resolve();
      await Promise.resolve();

      // Audio 元素应被清理
      expect(audio.src).toBe('');
      expect(audio.ontimeupdate).toBeNull();
      expect(audio.onended).toBeNull();
    });
  });

  // ==========================================================================
  // getState 测试
  // ==========================================================================

  describe('getState', () => {
    it('returns default idle state for unknown transferId', () => {
      const state = player.getState('unknown-id');
      expect(state).toEqual({
        state: 'idle',
        currentTime: 0,
        duration: 0,
      });
    });

    it('returns current state for active playback', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      const state = player.getState('transfer-1');
      expect(state.state).toBe('playing');
      expect(state.currentTime).toBe(0);
    });
  });

  // ==========================================================================
  // dispose 测试
  // ==========================================================================

  describe('dispose', () => {
    it('stops active playback and clears state', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      player.dispose();

      // 播放应被停止
      expect(mockAudioInstance!.src).toBe('');
      // 状态应被清空（getState 返回默认值）
      expect(player.getState('transfer-1')).toEqual({
        state: 'idle',
        currentTime: 0,
        duration: 0,
      });
    });

    it('is safe to call multiple times', () => {
      expect(() => {
        player.dispose();
        player.dispose();
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // onerror 事件测试
  // ==========================================================================

  describe('error event handling', () => {
    it('onerror resets state to idle', async () => {
      player.play('transfer-1', 'blob:http://localhost/audio1');
      playResolve?.();
      await Promise.resolve();

      onStateChange.mockClear();

      // 模拟音频加载/解码错误
      mockAudioInstance!.onerror?.();

      expect(onStateChange).toHaveBeenCalledWith('transfer-1', 'idle');
      expect(player.getState('transfer-1').state).toBe('idle');
      expect(player.getState('transfer-1').currentTime).toBe(0);
    });
  });
});
