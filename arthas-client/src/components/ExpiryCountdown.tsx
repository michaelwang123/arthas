/**
 * @file 房间过期倒计时组件 — 显示房间剩余有效时间并在临近过期时警告用户
 *
 * 本组件在房间头部区域渲染，根据服务器提供的 expiresAt 时间戳计算剩余时间。
 * 职责边界：负责 timer 管理、频率切换和 UI 渲染，格式化逻辑委托给 timeFormat 工具模块。
 *
 * 📚 学习要点: Tab 可见性处理
 * 浏览器会节流后台 tab 的 setInterval（Chrome 限制为每分钟一次）。
 * 使用 visibilitychange 事件监听 tab 恢复前台，立即重新计算剩余时间，
 * 确保用户切回 tab 时看到准确的倒计时而非过时的值。
 *
 * 📚 学习要点: 客户端-服务器时钟偏差
 * 倒计时使用 server-provided expiresAt 减去客户端本地 Date.now()/1000。
 * 如果客户端时钟偏快，显示的剩余时间会偏少（保守方向，可接受）。
 * 服务器是过期的唯一权威 — 即使客户端倒计时到零，也等待服务器 MsgRoomClosed，
 * 不主动断开连接。这避免了因时钟偏差导致的误断线。
 *
 * 📚 学习要点: setTimeout 递归模式 vs setInterval
 * 使用 setTimeout 递归替代 setInterval 的优势：
 * - 每次 tick 自然选择正确的延迟（>1h → 60s, <=1h → 1s），无需频率切换逻辑
 * - 不存在两个 interval 同时运行的风险窗口
 * - 更容易推理正确性：每次只有一个 pending timeout
 * - visibilitychange 恢复时只需 cancel 一个 timeout 并重新 schedule
 *
 * @module components/ExpiryCountdown
 * @see utils/timeFormat.ts — 时间格式化和警告判断
 * @see stores/chatStore.ts — expiresAt 状态来源
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { formatRemainingTime, isExpiryWarning } from '../utils/timeFormat'
import { useTranslation } from '../i18n'

/**
 * ExpiryCountdown 组件的 Props 接口。
 */
interface ExpiryCountdownProps {
  /** 过期时间戳（Unix 秒），0 表示无过期（组件不渲染） */
  expiresAt: number
}

/**
 * 计算当前剩余秒数。
 * 使用 Math.floor 确保与服务器端 Unix 秒精度一致。
 *
 * @param expiresAt - 过期时间戳（Unix 秒）
 * @returns 剩余秒数（可能为负数，表示已过期）
 */
function calcRemaining(expiresAt: number): number {
  return expiresAt - Math.floor(Date.now() / 1000)
}

/**
 * 根据剩余时间决定下一次 tick 的延迟（毫秒）。
 * - remaining > 3600s（1小时）: 60000ms（每分钟更新，节省 CPU）
 * - remaining <= 3600s: 1000ms（每秒更新，提供精确倒计时）
 * - remaining <= 0: 不再调度（倒计时结束）
 *
 * @param remaining - 剩余秒数
 * @returns 下一次 tick 的延迟毫秒数，0 表示不再调度
 */
function getNextDelay(remaining: number): number {
  if (remaining <= 0) return 0
  return remaining > 3600 ? 60000 : 1000
}

/**
 * 房间过期倒计时组件。
 *
 * 功能：
 * - remaining > 1h: 显示小时数，每 60s 更新
 * - remaining <= 1h: 显示分钟数，每秒更新
 * - remaining <= 5min: 警告色高亮（amber/red）
 * - expiresAt === 0: 不渲染（return null）
 * - 倒计时到零: 显示最小值，不主动断开连接
 *
 * @param props - 组件属性
 * @param props.expiresAt - 过期时间戳（Unix 秒），0 表示无过期
 */
export function ExpiryCountdown({ expiresAt }: ExpiryCountdownProps) {
  const { locale } = useTranslation()
  const [remaining, setRemaining] = useState<number>(() =>
    expiresAt > 0 ? calcRemaining(expiresAt) : 0
  )
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * 清除当前 pending timeout。
   */
  const clearTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  /**
   * 调度下一次 tick。
   *
   * 📚 学习要点: setTimeout 递归模式
   * 每次 tick 执行时：
   * 1. 重新计算 remaining（使用最新的 Date.now()）
   * 2. 更新 state 触发 UI 重渲染
   * 3. 根据新的 remaining 决定下一次延迟（60s 或 1s）
   * 4. 调度下一次 setTimeout
   *
   * 这种模式天然处理了频率切换：当 remaining 从 >3600 跨越到 <=3600 时，
   * 下一次 tick 自动使用 1s 延迟，无需显式的 clearInterval + setInterval 切换。
   */
  const scheduleNext = useCallback(() => {
    const newRemaining = calcRemaining(expiresAt)
    setRemaining(newRemaining)

    const delay = getNextDelay(newRemaining)
    if (delay > 0) {
      timeoutRef.current = setTimeout(scheduleNext, delay)
    }
  }, [expiresAt])

  /**
   * 处理 visibilitychange 事件 — tab 恢复前台时重新计算并重新调度。
   *
   * 📚 学习要点: 为什么需要 visibilitychange 处理？
   * 浏览器对后台 tab 的 setTimeout 有节流策略：
   * - Chrome: 后台 tab 的 timer 最低间隔为 1 分钟
   * - Firefox: 类似行为
   * 用户切回 tab 时，显示的倒计时可能已经过时。
   * 通过监听 visibilitychange，在 tab 恢复可见时：
   * 1. 取消当前 pending timeout（可能已经过时）
   * 2. 立即重新计算 remaining 并更新显示
   * 3. 重新调度下一次 tick（使用正确的延迟）
   */
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible' && expiresAt > 0) {
      clearTimer()
      scheduleNext()
    }
  }, [expiresAt, clearTimer, scheduleNext])

  // 主 effect：管理 timer 生命周期和 visibilitychange 监听
  useEffect(() => {
    if (expiresAt === 0) return

    // 初始计算并启动 timer 链
    clearTimer()
    scheduleNext()

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimer()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [expiresAt, scheduleNext, handleVisibilityChange, clearTimer])

  // expiresAt === 0 表示无过期，不渲染任何内容
  if (expiresAt === 0) {
    return null
  }

  // 确保显示值不为负数（倒计时到零后保持显示最小值）
  const displayRemaining = Math.max(0, remaining)
  const warning = isExpiryWarning(displayRemaining)
  const text = formatRemainingTime(displayRemaining, locale)

  return (
    <span
      className={`text-xs font-medium transition-colors duration-300 ${
        warning ? 'text-amber-400 animate-pulse' : 'text-gray-400'
      }`}
      role="timer"
      aria-live="polite"
      aria-label={text}
    >
      ⏱ {text}
    </span>
  )
}
