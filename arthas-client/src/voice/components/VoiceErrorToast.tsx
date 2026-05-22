/**
 * @file 语音错误 Toast 通知 — 显示语音模块的错误信息
 *
 * 本组件订阅 voiceStore.recordingError，当有错误时显示一个自动消失的 toast 通知。
 * 错误信息已通过 i18n translate() 本地化，直接显示即可。
 *
 * 📚 学习要点: 为什么需要独立的 Toast 组件？
 * RecordingIndicator 只在 recordingState === 'recording' 时渲染，
 * 但大多数错误发生后 recordingState 会回到 'idle'（如权限被拒绝、传输互斥）。
 * 此时 RecordingIndicator 已经消失，用户看不到错误信息。
 *
 * VoiceErrorToast 独立于录音状态，只要 recordingError 非 null 就显示。
 * 它使用 setTimeout 自动清除错误（3 秒后消失），提供非阻塞的错误反馈。
 *
 * 📚 学习要点: 错误不阻塞文本消息功能
 * VoiceErrorToast 是纯展示组件，不修改任何其他模块的状态。
 * 语音错误被隔离在 voiceStore.recordingError 中：
 * - 文本输入框（MessageInput）不订阅此字段
 * - 发送按钮的 disabled 状态不受此字段影响
 * - 用户可以在看到语音错误的同时继续发送文本消息
 *
 * 这满足 Requirements 7.x 的核心原则：语音错误不影响聊天体验。
 *
 * 📚 学习要点: 与项目现有错误显示模式的一致性
 * 项目中已有类似的 inline toast 模式：
 * - MessageBubble.tsx 中的 "已复制" toast（copied 状态 + 绝对定位 + 自动消失）
 * - ConnectionBanner 中的连接状态提示
 * VoiceErrorToast 采用相同的设计语言（暗色背景 + 圆角 + 自动消失）。
 *
 * @module voice/components/VoiceErrorToast
 * @see voiceStore.ts — recordingError 状态
 * @see requirements.md — Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { useEffect, useRef } from 'react';
import { useVoiceStore } from '../voiceStore';

/**
 * 错误 toast 自动消失的延迟时间（毫秒）。
 *
 * 📚 学习要点: 为什么选择 3 秒？
 * - 太短（1-2 秒）：用户可能来不及阅读错误信息
 * - 太长（5+ 秒）：占据屏幕空间过久，影响体验
 * - 3 秒是 toast 通知的行业标准时长（Material Design 推荐 2-4 秒）
 * - 语音错误信息通常很短（如"录音时间太短"），3 秒足够阅读
 */
const TOAST_DURATION_MS = 3000;

/**
 * 语音错误 Toast 组件。
 *
 * 📚 学习要点: 组件的生命周期与错误清除
 * 1. voiceStore.recordingError 被设置（非 null）→ Toast 显示
 * 2. 3 秒后 useEffect 的 setTimeout 触发 → 清除 recordingError → Toast 消失
 * 3. 用户下次 startRecording 时也会清除 recordingError（防御性清理）
 *
 * 为什么在 Toast 组件内部清除错误，而非在 voiceStore 中设置定时器？
 * - 关注点分离：voiceStore 管理状态，UI 组件管理显示时长
 * - 如果 Toast 组件未挂载（如用户离开页面），不需要清除定时器
 * - 组件卸载时 useEffect cleanup 自动取消定时器（防止内存泄漏）
 *
 * @returns JSX 元素（有错误时）或 null（无错误时）
 */
export function VoiceErrorToast() {
  const recordingError = useVoiceStore((s) => s.recordingError);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 📚 学习要点: useEffect 管理自动消失定时器
  // 当 recordingError 变化时（从 null → 有值），启动 3 秒定时器。
  // 定时器到期后清除 recordingError，触发 Toast 消失。
  // 如果在 3 秒内 recordingError 再次变化（新错误），
  // useEffect cleanup 会取消旧定时器，重新开始 3 秒倒计时。
  useEffect(() => {
    if (!recordingError) return;

    // 清除之前的定时器（如果有）
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 3 秒后自动清除错误
    timerRef.current = setTimeout(() => {
      useVoiceStore.setState({ recordingError: null });
      timerRef.current = null;
    }, TOAST_DURATION_MS);

    // Cleanup：组件卸载或 recordingError 变化时取消定时器
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [recordingError]);

  // 无错误时不渲染
  if (!recordingError) {
    return null;
  }

  return (
    // 📚 学习要点: Toast 的定位与样式
    // 使用 absolute 定位，显示在 MessageInput 容器的上方（与 RecordingIndicator 相同位置）。
    // 当 RecordingIndicator 不显示时（recordingState !== 'recording'），
    // VoiceErrorToast 占据相同的视觉位置，保持一致的信息展示区域。
    //
    // role="alert" + aria-live="assertive"：
    // 告诉屏幕阅读器这是一条重要的即时通知，应立即播报（不等待当前内容读完）。
    // 这确保视障用户能及时感知语音操作的错误。
    <div
      className="absolute bottom-full left-0 right-0 mb-2 flex items-center justify-center"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-2 px-4 py-2 bg-red-900/90 border border-red-700 rounded-full shadow-lg animate-in fade-in duration-200">
        {/* 错误图标 */}
        <span className="text-red-400 text-sm" aria-hidden="true">⚠️</span>

        {/* 📚 学习要点: 错误文本已经是本地化的
          * recordingError 的值来自 translate(locale, 'voice.error.xxx')，
          * 已经是用户当前语言的文本，直接显示即可。
          * 不需要在这里再次调用 t() 翻译。
          */}
        <span className="text-sm text-red-200">
          {recordingError}
        </span>
      </div>
    </div>
  );
}
