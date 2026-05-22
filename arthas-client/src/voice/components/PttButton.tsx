/**
 * @file PttButton.tsx — Push-to-Talk 按钮组件
 *
 * 本组件是语音消息功能的主要交互入口。用户按住按钮开始录音，松开后自动发送。
 * 它是录音引擎（voiceStore）和发送引擎（voiceSender）之间的协调者。
 *
 * 📚 学习要点: PttButton 的协调者角色
 * PttButton 不直接操作 MediaRecorder 或 WebSocket，它的职责是：
 * 1. 检测用户的按下/松开手势（mouse + touch 事件）
 * 2. 按下时：调用 voiceStore.startRecording()
 * 3. 松开时：调用 voiceStore.stopRecording() 获取录音结果
 * 4. 如果有结果：调用 sendVoice() 将录音交给文件传输引擎
 *
 * 这种「协调者」模式的好处：
 * - voiceStore 不需要知道 voiceSender 的存在（无前向依赖）
 * - voiceSender 不需要知道 voiceStore 的内部状态（无状态耦合）
 * - PttButton 作为 UI 层的胶水代码，天然适合连接不同模块
 * - 更容易测试：每个模块可以独立 mock 和验证
 *
 * 📚 学习要点: 优雅降级（Graceful Degradation）
 * 如果浏览器不支持 MediaRecorder API（如旧版 Safari），
 * 组件返回 null（不渲染任何内容），不影响其他功能。
 * 检测方式：MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ||
 *           MediaRecorder.isTypeSupported('audio/mp4;codecs=opus')
 *
 * 📚 学习要点: 为什么同时处理 mouse 和 touch 事件？
 * - 桌面端：用户通过 mousedown/mouseup 交互
 * - 移动端：用户通过 touchstart/touchend 交互
 * - 问题：某些移动浏览器会同时触发 touch 和 mouse 事件（兼容性模拟）
 * - 解决：在 touchstart/touchend 中调用 e.preventDefault() 阻止后续 mouse 事件
 * - 这确保了每次交互只触发一次 startRecording/stopRecording
 *
 * 📚 学习要点: React.memo 性能优化
 * PttButton 使用 React.memo 包裹，避免父组件（MessageInput）重渲染时
 * 导致 PttButton 不必要的重渲染。PttButton 没有 props，
 * 所有状态通过 Zustand selector 订阅，只在相关状态变化时重渲染。
 *
 * @module voice/components/PttButton
 * @see voiceStore.ts — startRecording, stopRecording
 * @see voiceSender.ts — sendVoice
 * @see fileTransferStore.ts — activeSendId 互斥锁
 * @see design.md — PTT 按钮布局集成
 * @see requirements.md — Requirements 1.1, 1.2, 1.5, 1.9, NFR-11, NFR-12
 */

import { memo, useCallback, useRef } from 'react';
import { useVoiceStore } from '../voiceStore';
import { sendVoice } from '../voiceSender';
import { useFileTransferStore } from '../../file-transfer/fileTransferStore';
import { useTranslation } from '../../i18n';

// ============================================================================
// 浏览器支持检测
// ============================================================================

/**
 * 检测当前浏览器是否支持语音录制。
 *
 * 📚 学习要点: 为什么在模块级检测而非组件内？
 * MediaRecorder 的支持情况在页面生命周期内不会变化（不会动态加载/卸载）。
 * 在模块加载时检测一次即可，避免每次组件渲染都重复检测。
 *
 * 检测逻辑：
 * 1. 首先检查 MediaRecorder 全局对象是否存在
 * 2. 然后检查 isTypeSupported 方法是否存在
 * 3. 最后检查至少一种 Opus 容器格式被支持
 *    - audio/webm;codecs=opus（Chrome, Firefox, Edge）
 *    - audio/mp4;codecs=opus（Safari 14.1+）
 *
 * 如果都不支持，PttButton 返回 null（不渲染），实现优雅降级。
 */
const isMediaRecorderSupported: boolean = (() => {
  try {
    if (typeof MediaRecorder === 'undefined') return false;
    if (typeof MediaRecorder.isTypeSupported !== 'function') return false;
    return (
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ||
      MediaRecorder.isTypeSupported('audio/mp4;codecs=opus')
    );
  } catch {
    return false;
  }
})();

// ============================================================================
// PttButton 组件
// ============================================================================

/**
 * Push-to-Talk 按钮 — 按住录音，松开发送。
 *
 * 📚 学习要点: 组件状态订阅策略
 * 使用 Zustand selector 精确订阅需要的状态字段：
 * - recordingState: 控制按钮的视觉状态（录音中 → 红色脉冲）
 * - activeSendId: 控制禁用状态（有活跃传输时禁用）
 *
 * 不订阅 recordingElapsed 或 playbackStates 等无关字段，
 * 避免这些字段变化时触发 PttButton 重渲染。
 *
 * 📚 学习要点: 无障碍设计
 * - aria-label: 通过 i18n 提供本地化的按钮描述（"按住录音"）
 * - min-w-[44px] min-h-[44px]: 满足 WCAG 2.5.5 最小触摸目标 44px
 * - disabled 状态: 视觉反馈（opacity-50 + cursor-not-allowed）
 * - role="button": 语义化（虽然 <button> 自带，但明确声明更清晰）
 */
export const PttButton = memo(function PttButton() {
  // ─── 优雅降级：浏览器不支持时不渲染 ─────────────────────────────────
  if (!isMediaRecorderSupported) {
    return null;
  }

  // ─── 状态订阅 ──────────────────────────────────────────────────────
  const { t } = useTranslation();
  const recordingState = useVoiceStore((s) => s.recordingState);
  const activeSendId = useFileTransferStore((s) => s.activeSendId);

  /**
   * 📚 学习要点: 禁用条件
   * 按钮在以下情况下禁用（不可交互）：
   * 1. activeSendId !== null — 有文件/语音正在发送，互斥锁生效
   * 2. recordingState !== 'idle' — 正在录音或处理中，防止重复触发
   *
   * 为什么 recordingState !== 'idle' 也要禁用？
   * - 'requesting': 正在请求麦克风权限，用户不应再次按下
   * - 'recording': 已经在录音，松开才是正确操作（不是再次按下）
   * - 'processing': 正在生成 Blob，等待完成
   *
   * 视觉反馈：opacity-50 + cursor-not-allowed 让用户明确知道按钮不可用。
   */
  const isDisabled = activeSendId !== null || recordingState !== 'idle';
  const isRecording = recordingState === 'recording';

  // ─── Ref：防止 touch + mouse 双重触发 ─────────────────────────────
  /**
   * 📚 学习要点: 为什么需要 isTouchActiveRef？
   * 在触摸设备上，touchstart 事件后浏览器可能还会触发 mousedown 事件
   * （为了兼容不处理 touch 事件的旧网页）。
   * 即使我们在 touchstart 中调用了 preventDefault()，
   * 某些浏览器（特别是 Android WebView）仍可能触发 mousedown。
   *
   * 使用 ref 标记"当前交互来自 touch"，在 mousedown 中检查此标记：
   * - 如果 isTouchActive === true → 忽略 mousedown（已由 touch 处理）
   * - 如果 isTouchActive === false → 正常处理 mousedown（桌面端交互）
   *
   * 为什么用 useRef 而非 useState？
   * - 这个标记不需要触发重渲染（纯逻辑控制）
   * - useRef 的 .current 修改是同步的，适合事件处理器中的即时判断
   */
  const isTouchActiveRef = useRef(false);

  // ─── 事件处理器 ────────────────────────────────────────────────────

  /**
   * 按下处理：开始录音。
   *
   * 📚 学习要点: 为什么不在这里检查 isDisabled？
   * HTML button 的 disabled 属性会自动阻止所有事件触发。
   * 但 touch 事件在某些浏览器上可能绕过 disabled 检查，
   * 因此在处理器内部也做防御性检查。
   */
  const handlePressStart = useCallback(() => {
    if (isDisabled) return;
    useVoiceStore.getState().startRecording();
  }, [isDisabled]);

  /**
   * 松开处理：停止录音并发送。
   *
   * 📚 学习要点: async 事件处理器
   * stopRecording() 返回 Promise<RecordingResult | null>，
   * 因为 MediaRecorder.stop() 是异步的（需要等待最后一次 ondataavailable）。
   * 使用 async/await 让代码保持线性可读性。
   *
   * 📚 学习要点: 协调者模式的体现
   * handlePressEnd 是 PttButton 作为协调者的核心逻辑：
   * 1. 从 voiceStore 获取录音结果
   * 2. 如果有结果，传递给 voiceSender 发送
   * 这两步之间没有耦合 — voiceStore 不知道 voiceSender 的存在。
   */
  const handlePressEnd = useCallback(async () => {
    // 只有在录音状态下松开才有意义
    const currentState = useVoiceStore.getState().recordingState;
    if (currentState !== 'recording') return;

    const result = await useVoiceStore.getState().stopRecording();
    if (result) {
      sendVoice(result.blob, result.duration, result.mimeType);
    }
  }, []);

  // ─── Mouse 事件 ────────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 📚 学习要点: 防止 touch 后的 mouse 事件重复触发
    if (isTouchActiveRef.current) return;
    // 只响应左键（button === 0）
    if (e.button !== 0) return;
    handlePressStart();
  }, [handlePressStart]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isTouchActiveRef.current) return;
    if (e.button !== 0) return;
    handlePressEnd();
  }, [handlePressEnd]);

  /**
   * 📚 学习要点: mouseleave 处理
   * 如果用户按住按钮后鼠标移出按钮区域，应该停止录音并发送。
   * 这模拟了"松开"行为，避免用户困惑（按住后移开鼠标，录音一直持续）。
   * 只在录音状态下触发，避免非录音状态下的误触发。
   */
  const handleMouseLeave = useCallback(() => {
    if (isTouchActiveRef.current) return;
    if (useVoiceStore.getState().recordingState === 'recording') {
      handlePressEnd();
    }
  }, [handlePressEnd]);

  // ─── Touch 事件 ────────────────────────────────────────────────────

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    /**
     * 📚 学习要点: preventDefault 阻止 mouse 事件模拟
     * 在 touchstart 中调用 preventDefault() 告诉浏览器：
     * "我已经处理了这个触摸事件，不需要再模拟 mouse 事件"。
     * 这是防止 touch + mouse 双重触发的标准做法。
     *
     * 注意：preventDefault 也会阻止长按弹出上下文菜单（在移动端是期望行为）。
     */
    e.preventDefault();
    isTouchActiveRef.current = true;
    handlePressStart();
  }, [handlePressStart]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    /**
     * 📚 学习要点: touchend 的 preventDefault
     * 同样需要 preventDefault 阻止后续的 mouseup 事件模拟。
     * 同时重置 isTouchActiveRef，为下一次交互做准备。
     */
    e.preventDefault();
    isTouchActiveRef.current = false;
    handlePressEnd();
  }, [handlePressEnd]);

  /**
   * 📚 学习要点: touchcancel 处理
   * touchcancel 在以下情况触发：
   * - 来电打断触摸
   * - 系统手势覆盖（如 iOS 的从底部上滑）
   * - 触摸点数超过浏览器支持的最大值
   *
   * 此时应该取消录音（而非发送），因为用户的意图被打断了。
   */
  const handleTouchCancel = useCallback(() => {
    isTouchActiveRef.current = false;
    // 如果正在录音，取消录音（不发送）
    if (useVoiceStore.getState().recordingState === 'recording') {
      useVoiceStore.getState().cancelRecording();
    }
  }, []);

  // ─── 渲染 ──────────────────────────────────────────────────────────

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-label={t('voice.holdToRecord')}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      className={`
        min-h-[44px] min-w-[44px]
        flex items-center justify-center
        text-xl rounded-lg
        transition-colors select-none
        ${isRecording
          ? 'text-red-400 bg-red-500/20 animate-pulse motion-reduce:animate-none'
          : 'text-gray-400 hover:text-white focus:text-white'
        }
        ${isDisabled
          ? 'opacity-50 cursor-not-allowed'
          : 'cursor-pointer'
        }
        focus:outline-none focus:ring-2 focus:ring-indigo-500
        focus:ring-offset-1 focus:ring-offset-gray-800
      `}
    >
      🎤
    </button>
  );
});
