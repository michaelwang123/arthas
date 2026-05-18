import { useEffect, useRef, type RefObject } from 'react'
import { useTranslation } from '../i18n'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉']

interface ReactionPanelProps {
  onReact: (emoji: string) => void
  onClose: () => void
  triggerRef: RefObject<HTMLElement | null>
  position: 'above' | 'below'
}

/**
 * 快速反应面板 — 6 个常用 emoji 的圆角胶囊。
 *
 * 特性：
 * - 动态定位（above/below 基于视口空间）
 * - 外部点击关闭（排除触发按钮）
 * - hover 放大效果（尊重 prefers-reduced-motion）
 */
export function ReactionPanel({ onReact, onClose, triggerRef, position }: ReactionPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose, triggerRef])

  const posClass = position === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label={t('message.addReaction')}
      className={`absolute ${posClass} left-0 flex gap-1 p-1.5 bg-gray-700 rounded-full shadow-lg border border-gray-600 z-50`}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => { onReact(emoji); onClose() }}
          role="menuitem"
          aria-label={emoji}
          className="w-9 h-9 flex items-center justify-center text-lg rounded-full hover:bg-gray-600 hover:scale-110 transition-transform motion-reduce:hover:scale-100"
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}

/**
 * 计算反应面板应该显示在消息上方还是下方。
 */
export function getReactionPanelPosition(triggerEl: HTMLElement): 'above' | 'below' {
  const rect = triggerEl.getBoundingClientRect()
  const panelHeight = 48
  return rect.top > panelHeight + 16 ? 'above' : 'below'
}
