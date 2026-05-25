/**
 * @file 时间格式化工具 — 房间过期倒计时的显示逻辑
 *
 * 本模块为 ExpiryCountdown 组件提供时间格式化和警告判断功能。
 * 职责边界：仅负责"秒数 → 人类可读字符串"的转换，不涉及 timer 管理或 UI 渲染。
 *
 * 📚 学习要点: 为什么将格式化逻辑独立为工具函数？
 * 1. 单一职责 — 组件负责 timer 和渲染，工具函数负责纯计算
 * 2. 可测试性 — 纯函数无副作用，便于属性测试覆盖所有边界条件
 * 3. 复用性 — 其他模块（如系统消息生成）也可能需要格式化剩余时间
 *
 * 📚 学习要点: Translator 函数注入模式
 * formatRemainingTime 接受一个 translator 函数参数（而非直接依赖 i18n 模块），
 * 这使其保持纯函数特性（相同输入 → 相同输出），同时复用 i18n 系统的翻译字符串。
 * 调用方通过传入 useTranslation() 的 t 函数来注入翻译能力。
 * 如果不传 translator，则使用内置的 fallback 格式化（向后兼容）。
 *
 * 支持的 locale: zh（中文）、en（英文）、ja（日文）
 *
 * @module utils/timeFormat
 * @see components/ExpiryCountdown.tsx — 使用本模块的倒计时组件
 * @see i18n/store.ts — locale 状态管理
 */

/**
 * Translator 函数类型 — 接受 i18n key 和参数，返回本地化字符串。
 * 与 useTranslation() 返回的 t 函数签名兼容。
 */
export type Translator = (key: string, params?: Record<string, unknown>) => string;

/**
 * 格式化剩余时间为人类可读字符串。
 *
 * 📚 学习要点: 分段显示策略
 * - remaining > 3600s（1小时）: 显示小时数（Math.floor 向下取整）
 *   用户不需要精确到分钟的信息，小时级粒度足够做决策
 * - remaining <= 3600s: 显示分钟数（Math.ceil 向上取整，最少显示 1 分钟）
 *   向上取整避免显示"0 分钟"的困惑（实际还有几十秒）
 *   Math.max(1, ...) 确保即使只剩几秒也显示"1 分钟"而非"0 分钟"
 *
 * @param remainingSeconds - 剩余秒数（应为正数）
 * @param locale - 当前语言环境（'zh' | 'en' | 'ja'），当未提供 translator 时使用
 * @param translator - 可选的翻译函数，传入时使用 i18n 系统的 key 进行格式化
 * @returns 格式化后的字符串，如 "还剩 23 小时"、"45min remaining"、"残り45分"
 */
export function formatRemainingTime(
  remainingSeconds: number,
  locale: string,
  translator?: Translator
): string {
  if (remainingSeconds > 3600) {
    const hours = Math.floor(remainingSeconds / 3600)
    if (translator) {
      return translator('room.countdown.hours', { n: hours })
    }
    return formatHoursFallback(hours, locale)
  }

  const minutes = Math.max(1, Math.ceil(remainingSeconds / 60))
  if (translator) {
    return translator('room.countdown.minutes', { n: minutes })
  }
  return formatMinutesFallback(minutes, locale)
}

/**
 * 判断是否应显示过期警告状态。
 *
 * 📚 学习要点: 5 分钟警告阈值
 * 当剩余时间 ≤ 300 秒（5 分钟）时，UI 应切换为警告色（amber/red）。
 * 这个阈值给用户足够的时间保存重要信息或转移对话，
 * 同时不会过早触发警告导致用户焦虑。
 *
 * @param remainingSeconds - 剩余秒数
 * @returns true 表示应显示警告状态（剩余 ≤ 5 分钟）
 */
export function isExpiryWarning(remainingSeconds: number): boolean {
  return remainingSeconds <= 300
}

/**
 * Fallback: 格式化小时数为本地化字符串（无 translator 时使用）。
 *
 * @param hours - 小时数（正整数）
 * @param locale - 语言环境
 * @returns 本地化的小时格式字符串
 */
function formatHoursFallback(hours: number, locale: string): string {
  switch (locale) {
    case 'zh':
      return `还剩 ${hours} 小时`
    case 'ja':
      return `残り${hours}時間`
    case 'en':
    default:
      return `${hours}h remaining`
  }
}

/**
 * Fallback: 格式化分钟数为本地化字符串（无 translator 时使用）。
 *
 * @param minutes - 分钟数（正整数，最小为 1）
 * @param locale - 语言环境
 * @returns 本地化的分钟格式字符串
 */
function formatMinutesFallback(minutes: number, locale: string): string {
  switch (locale) {
    case 'zh':
      return `还剩 ${minutes} 分钟`
    case 'ja':
      return `残り${minutes}分`
    case 'en':
    default:
      return `${minutes}min remaining`
  }
}
