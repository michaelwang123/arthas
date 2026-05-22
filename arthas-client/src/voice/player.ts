/**
 * 语音消息播放控制器 — HTML5 Audio 封装。
 *
 * 本文件实现了语音消息的播放引擎，提供 play/pause/resume/stop 操作，
 * 并通过回调通知 voiceStore 更新播放状态和进度。
 *
 * 📚 学习要点: 为什么使用 HTML5 Audio 而非 Web Audio API？
 * 浏览器提供两种音频播放方案：
 *
 * 1. HTML5 Audio（<audio> 元素 / new Audio()）：
 *    - 优点：API 简单、自动处理音频解码、原生支持 pause()/play() 恢复
 *    - 优点：支持所有浏览器原生支持的音频格式（WebM/Opus, MP4/AAC 等）
 *    - 优点：内存效率高（流式解码，不需要将整个音频加载到内存）
 *    - 缺点：延迟较高（~50-100ms），无法做实时音频处理
 *
 * 2. Web Audio API（AudioContext + AudioBufferSourceNode）：
 *    - 优点：超低延迟（<10ms），可编程（混音、特效、频谱分析）
 *    - 缺点：AudioBufferSourceNode 是一次性的 — 不支持暂停/恢复！
 *      调用 stop() 后必须重新创建节点并从头播放或手动 seek
 *    - 缺点：需要将整个音频解码到内存（decodeAudioData），大文件占用大量 RAM
 *    - 缺点：API 复杂度高，需要管理 AudioContext 生命周期
 *
 * 语音消息场景的需求：
 * - 需要暂停/恢复功能 ✅ HTML5 Audio 原生支持
 * - 不需要低延迟（不是实时对讲）
 * - 不需要音频处理（不做波形可视化、混音等）
 * - 需要播放进度追踪 ✅ HTML5 Audio 的 timeupdate 事件
 *
 * 结论：HTML5 Audio 的简单性和暂停/恢复支持完美匹配语音消息播放需求。
 * Web Audio API 的优势（低延迟、可编程）在此场景中用不到，
 * 而其劣势（不支持暂停、内存占用高）反而是硬伤。
 *
 * @module voice/player
 * @see design.md — Voice Player 接口定义
 * @see requirements.md — Requirements 4.3, 4.4, 4.5, 4.6
 */

import type { PlaybackState, VoicePlaybackState } from './types';
import { translate } from '../i18n';
import { useI18nStore } from '../i18n';

// ============================================================================
// 接口定义
// ============================================================================

/**
 * 语音播放器接口。
 *
 * 📚 学习要点: 为什么使用接口 + 工厂函数而非 class？
 * 1. 工厂函数返回接口，隐藏内部实现细节（闭包中的私有状态）
 * 2. 与项目其他模块保持一致的代码风格
 * 3. 更容易在测试中 mock（直接替换工厂函数的返回值）
 * 4. 避免 class 的 this 绑定问题（箭头函数闭包天然绑定）
 */
export interface VoicePlayer {
  /**
   * 播放指定语音消息。
   *
   * 📚 学习要点: 单例播放策略（Singleton Playback）
   * 同一时间只允许一条语音消息播放。调用 play() 时：
   * - 如果有其他语音正在播放，自动 stop() 前一条
   * - 更新 activeTransferId 为新的 transferId
   * 这避免了多条语音同时播放的混乱体验（类似微信行为）。
   *
   * @param transferId - 语音消息的唯一传输标识符
   * @param blobUrl - 解密后音频数据的 Blob URL（由 URL.createObjectURL 创建）
   */
  play(transferId: string, blobUrl: string): void;

  /** 暂停当前正在播放的语音消息 */
  pause(): void;

  /** 恢复已暂停的语音消息播放 */
  resume(): void;

  /**
   * 停止当前播放并重置进度。
   * 与 pause() 的区别：stop() 将 currentTime 重置为 0，
   * 下次 play() 同一条消息会从头开始。
   */
  stop(): void;

  /**
   * 获取指定语音消息的播放状态。
   * 如果该消息从未被播放过，返回默认的 idle 状态。
   *
   * @param transferId - 语音消息的唯一传输标识符
   * @returns 该消息的当前播放状态
   */
  getState(transferId: string): VoicePlaybackState;

  /**
   * 销毁播放器，释放所有资源。
   * 在用户离开房间或组件卸载时调用。
   */
  dispose(): void;
}

/**
 * 播放器配置选项。
 *
 * 📚 学习要点: 回调模式解耦
 * player.ts 不直接 import voiceStore（避免循环依赖）。
 * 通过回调函数将状态变化通知给调用方（voiceStore），
 * 调用方负责更新 Zustand store 触发 UI 重渲染。
 * 这是一种「控制反转」（Inversion of Control）模式。
 */
export interface VoicePlayerOptions {
  /** 播放状态变化回调：当 playing/paused/idle 状态切换时触发 */
  onStateChange?: (transferId: string, state: PlaybackState) => void;
  /** 播放进度更新回调：由 audio.timeupdate 事件驱动，约每 250ms 触发一次 */
  onTimeUpdate?: (transferId: string, currentTime: number) => void;
  /**
   * 播放错误回调：当播放失败时触发（如 autoplay policy 阻止）。
   *
   * 📚 学习要点: 为什么需要 onError 回调？
   * player.ts 不能直接 import voiceStore（循环依赖），
   * 但播放错误需要通知 UI 显示 toast（通过 voiceStore.recordingError）。
   * 通过 onError 回调，voiceStore 在创建 player 时注入错误处理逻辑，
   * player 只负责检测错误并调用回调，不关心错误如何展示。
   *
   * @param errorMessage - 已通过 i18n 翻译的错误消息文本
   */
  onError?: (errorMessage: string) => void;
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建语音播放器实例。
 *
 * 📚 学习要点: 工厂函数模式（Factory Function Pattern）
 * 使用闭包封装私有状态（currentAudio, activeTransferId），
 * 只暴露接口定义的公共方法。这比 class 更轻量：
 * - 无需 new 关键字
 * - 无 prototype 链开销
 * - 私有状态真正不可访问（闭包 vs class 的 #private 语法）
 * - 返回的对象可以直接解构使用
 *
 * @param options - 可选的回调配置
 * @returns VoicePlayer 接口实例
 *
 * @example
 * ```typescript
 * const player = createVoicePlayer({
 *   onStateChange: (id, state) => voiceStore.setState({ ... }),
 *   onTimeUpdate: (id, time) => voiceStore.setState({ ... }),
 * });
 *
 * player.play('transfer-123', 'blob:http://localhost/abc');
 * player.pause();
 * player.resume();
 * player.stop();
 * ```
 */
export function createVoicePlayer(options: VoicePlayerOptions = {}): VoicePlayer {
  const { onStateChange, onTimeUpdate, onError } = options;

  // === 私有状态（闭包封装） ===

  /** 当前正在使用的 Audio 元素（null = 无播放） */
  let currentAudio: HTMLAudioElement | null = null;

  /** 当前正在播放的语音消息 transferId（null = 无活跃播放） */
  let activeTransferId: string | null = null;

  /**
   * 播放状态缓存：transferId → VoicePlaybackState
   *
   * 📚 学习要点: 为什么在 player 内部也维护状态？
   * voiceStore 是状态的权威来源（供 UI 订阅），但 player 内部也需要
   * 快速判断当前播放状态（如 resume() 需要知道是否处于 paused 状态）。
   * 内部缓存避免了 player → voiceStore 的反向依赖。
   * 两者通过 onStateChange 回调保持同步。
   */
  const stateMap = new Map<string, VoicePlaybackState>();

  // === 私有辅助函数 ===

  /**
   * 获取或创建指定 transferId 的播放状态。
   * 如果该消息从未被播放过，创建默认的 idle 状态。
   */
  function getOrCreateState(transferId: string, duration: number = 0): VoicePlaybackState {
    const existing = stateMap.get(transferId);
    if (existing) return existing;

    const defaultState: VoicePlaybackState = {
      state: 'idle',
      currentTime: 0,
      duration,
    };
    stateMap.set(transferId, defaultState);
    return defaultState;
  }

  /**
   * 更新指定消息的播放状态并通知回调。
   *
   * 📚 学习要点: 不可变更新模式
   * 创建新的状态对象而非修改现有对象，确保 React/Zustand 的
   * 浅比较（shallow comparison）能检测到变化并触发重渲染。
   */
  function updateState(transferId: string, newState: PlaybackState, currentTime?: number): void {
    const existing = getOrCreateState(transferId);
    const updated: VoicePlaybackState = {
      ...existing,
      state: newState,
      currentTime: currentTime ?? existing.currentTime,
    };
    stateMap.set(transferId, updated);
    onStateChange?.(transferId, newState);
  }

  /**
   * 清理当前 Audio 元素的事件监听器并释放资源。
   *
   * 📚 学习要点: 事件监听器泄漏防护
   * HTMLAudioElement 在被垃圾回收前，其事件监听器会一直存在。
   * 如果不手动移除监听器，旧的 Audio 元素可能在 GC 前继续触发事件，
   * 导致状态更新指向已过期的 transferId。
   * 使用 null 赋值清除所有 on* 事件处理器。
   */
  function cleanupAudio(): void {
    if (!currentAudio) return;

    // 移除事件监听器（防止 GC 前的幽灵事件）
    currentAudio.ontimeupdate = null;
    currentAudio.onended = null;
    currentAudio.onerror = null;

    // 暂停播放并释放资源
    currentAudio.pause();

    /**
     * 📚 学习要点: 为什么设置 src = '' ？
     * 仅调用 pause() 不会释放音频解码器占用的资源。
     * 设置 src = '' 告诉浏览器释放与该 Audio 元素关联的所有媒体资源
     * （解码缓冲区、网络连接等）。这是 HTML5 规范推荐的资源释放方式。
     * 注意：不需要 revokeObjectURL — 那是 voiceStore 的职责（LRU 淘汰时）。
     */
    currentAudio.src = '';
    currentAudio = null;
  }

  /**
   * 停止当前播放并重置状态。
   * 内部实现，供 play() 和 stop() 复用。
   */
  function stopInternal(): void {
    if (!activeTransferId) return;

    const transferId = activeTransferId;
    cleanupAudio();
    updateState(transferId, 'idle', 0);
    activeTransferId = null;
  }

  // === 公共接口实现 ===

  const player: VoicePlayer = {
    play(transferId: string, blobUrl: string): void {
      /**
       * 📚 学习要点: 单例播放实现
       * 1. 如果有其他语音正在播放 → 先停止它
       * 2. 创建新的 Audio 元素
       * 3. 设置事件监听器
       * 4. 调用 audio.play()（返回 Promise）
       * 5. 处理 autoplay policy 错误
       *
       * 为什么每次 play() 都创建新的 Audio 元素？
       * - 复用同一个 Audio 元素切换 src 时，某些浏览器会有短暂的静音/卡顿
       * - 新建 Audio 元素确保干净的播放状态（无残留的 buffered ranges）
       * - Audio 元素非常轻量（不像 AudioContext 那样有全局限制）
       */

      // 1. 停止当前播放（如果有）
      if (activeTransferId) {
        stopInternal();
      }

      // 2. 创建新的 Audio 元素
      const audio = new Audio(blobUrl);
      currentAudio = audio;
      activeTransferId = transferId;

      // 3. 设置 timeupdate 事件监听器（追踪播放进度）
      /**
       * 📚 学习要点: timeupdate 事件的触发频率
       * HTML5 规范没有规定 timeupdate 的精确触发频率，
       * 但大多数浏览器实现为每 250ms 左右触发一次。
       * 对于语音消息的进度条显示来说，这个频率已经足够流畅。
       * 不需要使用 requestAnimationFrame（那是 60fps 动画的需求）。
       */
      audio.ontimeupdate = () => {
        if (activeTransferId === transferId && currentAudio === audio) {
          const state = stateMap.get(transferId);
          if (state) {
            const updated: VoicePlaybackState = {
              ...state,
              currentTime: audio.currentTime,
              duration: audio.duration || state.duration,
            };
            stateMap.set(transferId, updated);
          }
          onTimeUpdate?.(transferId, audio.currentTime);
        }
      };

      // 4. 设置 ended 事件监听器（播放完成时重置状态）
      /**
       * 📚 学习要点: ended 事件 vs timeupdate 判断
       * 不要通过 currentTime >= duration 来判断播放结束，因为：
       * - 浮点数精度问题（currentTime 可能永远不会精确等于 duration）
       * - 某些浏览器的 duration 值不精确（特别是 WebM 容器）
       * ended 事件是浏览器明确告知"播放已结束"的可靠信号。
       */
      audio.onended = () => {
        if (activeTransferId === transferId && currentAudio === audio) {
          cleanupAudio();
          updateState(transferId, 'idle', 0);
          activeTransferId = null;
        }
      };

      // 5. 设置 error 事件监听器
      audio.onerror = () => {
        if (activeTransferId === transferId && currentAudio === audio) {
          cleanupAudio();
          updateState(transferId, 'idle', 0);
          activeTransferId = null;
        }
      };

      // 6. 开始播放（处理 autoplay policy）
      /**
       * 📚 学习要点: 浏览器 Autoplay Policy
       * 现代浏览器（Chrome 66+, Safari 11+）限制自动播放音频：
       * - 用户必须先与页面交互（click, tap, keydown）后才能播放音频
       * - 如果用户未交互就调用 audio.play()，Promise 会被 reject
       * - 错误类型为 NotAllowedError（DOMException.name === 'NotAllowedError'）
       *
       * 在聊天应用中，用户点击播放按钮本身就是一次交互，
       * 所以 autoplay policy 通常不会阻止播放。
       * 但在某些边缘情况下（如页面刚加载、iframe 中）可能触发，
       * 因此需要捕获错误并给出友好提示。
       */
      const playPromise = audio.play();

      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // 播放成功启动
            // 从 audio.duration 获取实际时长（可能比 metadata 中的更精确）
            const duration = audio.duration && isFinite(audio.duration)
              ? audio.duration
              : (stateMap.get(transferId)?.duration ?? 0);

            const state: VoicePlaybackState = {
              state: 'playing',
              currentTime: 0,
              duration,
            };
            stateMap.set(transferId, state);
            onStateChange?.(transferId, 'playing');
          })
          .catch((error: DOMException) => {
            /**
             * 📚 学习要点: NotAllowedError 处理
             * 当 autoplay policy 阻止播放时：
             * 1. 清理已创建的 Audio 元素
             * 2. 通过 i18n 获取本地化的错误提示
             * 3. 通过 onError 回调通知 voiceStore 显示错误 toast
             *
             * 用户看到提示后，下次点击播放按钮时（已有交互），
             * autoplay policy 不再阻止，播放会正常进行。
             *
             * 📚 学习要点: 为什么通过 onError 回调而非直接 import voiceStore？
             * player.ts 通过回调模式与 voiceStore 解耦（避免循环依赖）。
             * onError 回调在 voiceStore 创建 player 时注入，
             * player 只负责检测错误并调用回调，不关心错误如何展示给用户。
             * 这保持了 player 的单一职责：只管播放，不管 UI 通知。
             */
            if (activeTransferId === transferId && currentAudio === audio) {
              cleanupAudio();
              activeTransferId = null;

              // 保持 idle 状态（用户可以重试）
              updateState(transferId, 'idle', 0);

              // 通过 onError 回调通知 UI 显示错误 toast
              if (error.name === 'NotAllowedError') {
                const locale = useI18nStore.getState().locale;
                const message = translate(locale, 'voice.error.autoplayBlocked');
                console.warn(`[VoicePlayer] Autoplay blocked: ${message}`);
                onError?.(message);
              } else {
                console.warn(`[VoicePlayer] Play failed:`, error.message);
              }
            }
          });
      } else {
        // 旧浏览器 play() 不返回 Promise（同步播放）
        const duration = audio.duration && isFinite(audio.duration)
          ? audio.duration
          : (stateMap.get(transferId)?.duration ?? 0);

        const state: VoicePlaybackState = {
          state: 'playing',
          currentTime: 0,
          duration,
        };
        stateMap.set(transferId, state);
        onStateChange?.(transferId, 'playing');
      }
    },

    pause(): void {
      /**
       * 📚 学习要点: pause() vs stop() 的语义区别
       * - pause(): 暂停播放，保留 currentTime 位置，可以 resume() 继续
       * - stop(): 停止播放，重置 currentTime 为 0，下次从头开始
       *
       * HTML5 Audio 原生支持 pause()（保留播放位置），
       * 这是选择 HTML5 Audio 而非 Web Audio API 的关键原因之一。
       * Web Audio API 的 AudioBufferSourceNode 调用 stop() 后节点就废了，
       * 必须重新创建节点并手动 seek 到之前的位置。
       */
      if (!currentAudio || !activeTransferId) return;

      const state = stateMap.get(activeTransferId);
      if (!state || state.state !== 'playing') return;

      currentAudio.pause();
      updateState(activeTransferId, 'paused', currentAudio.currentTime);
    },

    resume(): void {
      if (!currentAudio || !activeTransferId) return;

      const state = stateMap.get(activeTransferId);
      if (!state || state.state !== 'paused') return;

      /**
       * 📚 学习要点: resume 时的 autoplay policy
       * 如果用户之前已经成功播放过（触发了交互），
       * resume() 通常不会被 autoplay policy 阻止。
       * 但为了健壮性，仍然捕获 play() 的 rejection。
       */
      const transferId = activeTransferId;
      const audio = currentAudio;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            updateState(transferId, 'playing');
          })
          .catch((error: DOMException) => {
            if (activeTransferId === transferId && currentAudio === audio) {
              // resume 失败，保持 paused 状态（用户可以再次尝试）
              if (error.name === 'NotAllowedError') {
                const locale = useI18nStore.getState().locale;
                const message = translate(locale, 'voice.error.autoplayBlocked');
                console.warn(`[VoicePlayer] Resume blocked: ${message}`);
              }
            }
          });
      } else {
        updateState(transferId, 'playing');
      }
    },

    stop(): void {
      stopInternal();
    },

    getState(transferId: string): VoicePlaybackState {
      return stateMap.get(transferId) ?? {
        state: 'idle',
        currentTime: 0,
        duration: 0,
      };
    },

    dispose(): void {
      /**
       * 📚 学习要点: 资源释放的重要性
       * 用户离开房间时必须调用 dispose()：
       * 1. 停止正在播放的音频（避免离开房间后还能听到声音）
       * 2. 清理 Audio 元素（释放解码器资源）
       * 3. 清空状态缓存（释放内存）
       *
       * 注意：Blob URL 的释放（revokeObjectURL）不在 player 的职责范围内，
       * 那是 voiceStore 的 LRU 缓存管理逻辑负责的。
       * player 只负责"播放"这一件事（单一职责原则）。
       */
      stopInternal();
      stateMap.clear();
    },
  };

  return player;
}
