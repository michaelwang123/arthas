import { useState, useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useTranslation } from '../i18n'

const GRACE_MS = 1500
const RECONNECTED_MS = 2000

type BannerState = 'grace' | 'hidden' | 'disconnected' | 'reconnected'

/**
 * 连接状态横幅 — 断线时显示黄色提示，重连后短暂显示绿色确认。
 *
 * 设计要点：
 * - 容器始终挂载（aria-live 区域），通过 max-height 控制可见性（零 CLS）
 * - 首次加载有 1.5s 宽限期，避免快速网络下的横幅闪烁
 * - 使用 connectedRef 同步追踪最新值，避免 setTimeout 闭包陈旧问题
 */
export function ConnectionBanner() {
  const { t } = useTranslation();
  const connected = useChatStore((s) => s.connected)
  const [state, setState] = useState<BannerState>('grace')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const graceOverRef = useRef(false)

  // 始终同步追踪最新 connected 值
  const connectedRef = useRef(connected)
  connectedRef.current = connected

  // 宽限期逻辑（仅 mount 时执行一次）
  useEffect(() => {
    if (connected) {
      setState('hidden')
      graceOverRef.current = true
      return
    }
    const graceTimer = setTimeout(() => {
      graceOverRef.current = true
      if (!connectedRef.current) {
        setState('disconnected')
      } else {
        setState('hidden')
      }
    }, GRACE_MS)
    return () => clearTimeout(graceTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 宽限期结束后的状态变化
  useEffect(() => {
    if (!graceOverRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!connected) {
      setState('disconnected')
    } else {
      setState('reconnected')
      timerRef.current = setTimeout(() => setState('hidden'), RECONNECTED_MS)
    }
  }, [connected])

  const isVisible = state === 'disconnected' || state === 'reconnected'

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`overflow-hidden transition-all duration-300 motion-reduce:duration-100 ease-in-out shrink-0
        ${isVisible ? 'max-h-10' : 'max-h-0'}`}
    >
      {state === 'disconnected' && (
        <div className="h-10 flex items-center justify-center bg-amber-600 text-white text-sm font-medium animate-pulse-banner motion-reduce:animate-none">
          {t('connection.reconnecting')}
        </div>
      )}
      {state === 'reconnected' && (
        <div className="h-10 flex items-center justify-center bg-green-600 text-white text-sm font-medium">
          {t('connection.reconnected')}
        </div>
      )}
    </div>
  )
}
