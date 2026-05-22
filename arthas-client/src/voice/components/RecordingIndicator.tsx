/**
 * @file 录音状态指示器 — 显示在消息输入区域上方的录音状态覆盖层
 *
 * 本组件在用户按住 PTT 按钮录音时显示，提供实时视觉反馈：
 * - 脉冲红点动画（表示正在录音）
 * - 已录制时长（"0:XX" 格式，每秒更新）
 * - "录音中" 文本提示（通过 i18n 国际化）
 *
 * 📚 学习要点: 为什么使用 absolute 定位覆盖层？
 * 录音指示器需要在录音期间显示在消息输入框上方，但不影响输入框的布局。
 * 使用 CSS absolute 定位，让指示器"浮动"在输入区域上方：
 * - 不占据文档流空间（不推挤其他元素）
 * - 视觉上与输入区域关联（用户知道这是录音状态）
 * - 录音结束后消失，输入区域恢复正常
 *
 * 📚 学习要点: prefers-reduced-motion 无障碍适配
 * 部分用户对动画敏感（前庭障碍、注意力障碍等），
 * 操作系统提供 "减少动画" 设置（macOS: 减少动态效果, Windows: 显示动画）。
 * CSS 媒体查询 `prefers-reduced-motion: reduce` 检测此设置。
 * Tailwind 的 `motion-reduce:` 变体让我们可以在减少动画模式下
 * 禁用脉冲动画，改为静态红点 — 仍然传达"正在录音"的信息，
 * 但不会引起视觉不适。这满足 WCAG 2.1 的 2.3.3 准则。
 *
 * 📚 学习要点: 录音计时器的精度策略
 * 本组件不自己维护计时器 — 它从 voiceStore 读取 recordingElapsed。
 * voiceStore 内部使用 setInterval(1000) + Date.now() 差值方案：
 * - setInterval 每秒触发一次，更新 store 中的 recordingElapsed
 * - recordingElapsed = Math.floor((Date.now() - startTime) / 1000)
 * - 即使浏览器节流 setInterval（标签页后台），恢复后数值仍然准确
 *
 * 组件通过 Zustand selector 订阅 recordingElapsed，
 * 每次 store 更新时自动重渲染，显示最新的时长。
 *
 * @module voice/components/RecordingIndicator
 * @see voiceStore.ts — recordingState, recordingElapsed 状态
 * @see formatDuration.ts — 时间格式化工具
 * @see design.md — Recording Indicator 设计
 * @see requirements.md — Requirement 1.6, 5.7, NFR-13
 */

import { useVoiceStore } from '../voiceStore';
import { formatDuration } from '../formatDuration';
import { useTranslation } from '../../i18n';

/**
 * 录音状态指示器组件。
 *
 * 仅在 recordingState === 'recording' 时渲染（条件渲染）。
 * 显示脉冲红点 + 已录制时长 + "录音中" 文本。
 *
 * 📚 学习要点: 条件渲染 vs CSS 隐藏
 * 选择条件渲染（return null）而非 CSS display:none 的原因：
 * 1. 不录音时完全不创建 DOM 节点（零内存开销）
 * 2. 不需要管理 aria-hidden 等无障碍属性
 * 3. 语义更清晰：组件不存在 = 没有录音状态
 * 4. 避免屏幕阅读器读取隐藏的录音指示器内容
 *
 * 📚 学习要点: 组件的数据流
 * RecordingIndicator 是一个纯展示组件（Presentational Component）：
 * - 输入：从 voiceStore 读取 recordingState 和 recordingElapsed
 * - 输出：渲染 UI（无副作用、无状态修改）
 * - 不接受 props（所有数据来自全局 store）
 *
 * 这种设计让组件可以在任何位置渲染（只要在 React 树中），
 * 不需要通过 props 层层传递录音状态。
 *
 * @returns JSX 元素（录音时）或 null（非录音时）
 */
export function RecordingIndicator() {
  const { t } = useTranslation();

  // 📚 学习要点: Zustand selector 精确订阅
  // 只订阅需要的字段，避免其他 store 字段变化时触发不必要的重渲染。
  // 例如 playbackStates 变化时，RecordingIndicator 不需要重渲染。
  const recordingState = useVoiceStore((s) => s.recordingState);
  const recordingElapsed = useVoiceStore((s) => s.recordingElapsed);

  // 📚 学习要点: 早期返回模式（Early Return Pattern）
  // 只在 recordingState === 'recording' 时渲染指示器。
  // 其他状态（idle, requesting, processing）不显示指示器：
  // - idle: 没有录音活动
  // - requesting: 正在请求权限（可能显示浏览器权限弹窗）
  // - processing: 录音已结束，正在生成 Blob（通常极短，< 100ms）
  if (recordingState !== 'recording') {
    return null;
  }

  return (
    // 📚 学习要点: absolute 定位与父容器的关系
    // 此元素使用 absolute 定位，相对于最近的 position: relative 祖先定位。
    // MessageInput 的外层 div 已经有 className="relative"，
    // 因此本指示器会相对于 MessageInput 容器定位。
    // bottom-full 将指示器放在父容器的正上方（bottom 边缘对齐父容器的 top 边缘）。
    // mb-2 添加 8px 间距，避免指示器紧贴输入框。
    <div
      className="absolute bottom-full left-0 right-0 mb-2 flex items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label={t('voice.recording')}
    >
      {/* 📚 学习要点: 内容容器的视觉设计
        * 使用半透明深色背景 + 圆角 + 内边距，创建"浮动卡片"效果。
        * bg-gray-800/90 = gray-800 颜色 + 90% 不透明度（backdrop 可见）
        * border-gray-700 = 细边框增加层次感（与暗色背景区分）
        * rounded-full = 完全圆角（胶囊形状，视觉上更柔和）
        * shadow-lg = 大阴影增加浮动感（暗示这是覆盖层）
        */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800/90 border border-gray-700 rounded-full shadow-lg">
        {/* 📚 学习要点: 脉冲红点动画
          * animate-pulse 是 Tailwind 内置的脉冲动画：
          * - 通过 opacity 在 1 和 0.5 之间循环变化
          * - 动画周期 2 秒，使用 cubic-bezier 缓动
          * - 视觉效果：红点"呼吸"般闪烁，暗示正在录音
          *
          * motion-reduce:animate-none 无障碍适配：
          * - 当用户系统设置了 "减少动画" 偏好时
          * - Tailwind 的 motion-reduce: 变体生效
          * - animate-none 覆盖 animate-pulse，红点变为静态
          * - 仍然通过红色传达"录音中"的语义，只是不闪烁
          *
          * 为什么选择 w-3 h-3（12px）？
          * - 足够大以被注意到（录音是重要状态）
          * - 不会过大以至于分散注意力
          * - 与旁边的文字大小（text-sm = 14px）视觉平衡
          */}
        <span
          className="w-3 h-3 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none"
          aria-hidden="true"
        />

        {/* 📚 学习要点: 时长显示
          * 使用 formatDuration 将秒数转为 "M:SS" 格式。
          * font-mono 使用等宽字体，防止数字变化时文本宽度跳动：
          * - 比例字体中 "1" 比 "0" 窄，导致 "0:01" → "0:10" 时宽度变化
          * - 等宽字体中所有数字等宽，时长变化时文本不会"抖动"
          *
          * text-sm = 14px 字号，与录音状态的次要信息定位匹配
          * text-white = 白色文字，在深色背景上高对比度可读
          */}
        <span className="text-sm font-mono text-white">
          {formatDuration(recordingElapsed)}
        </span>

        {/* 📚 学习要点: i18n 文本
          * 使用 t('voice.recording') 获取本地化文本：
          * - zh: "录音中"
          * - en: "Recording"
          * - ja: "録音中"
          *
          * text-gray-300 = 稍暗的白色，与时长数字形成层次：
          * - 时长是主要信息（text-white，更醒目）
          * - "录音中" 是辅助说明（text-gray-300，次要）
          */}
        <span className="text-sm text-gray-300">
          {t('voice.recording')}
        </span>
      </div>
    </div>
  );
}
