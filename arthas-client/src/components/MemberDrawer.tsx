import { useEffect, useRef, type RefObject } from 'react'
import type { Member } from '../stores/chatStore'
import { MemberList } from './MemberList'
import { useTranslation } from '../i18n'
import { LanguageSwitcher } from '../i18n/components/LanguageSwitcher'

interface MemberDrawerProps {
  open: boolean
  onClose: () => void
  members: Member[]
  triggerRef: RefObject<HTMLButtonElement | null>
}

/**
 * 移动端成员列表抽屉 — 从右侧滑入的 overlay 面板。
 *
 * 无障碍特性：
 * - role="dialog" + aria-modal 标识模态对话框
 * - 打开时焦点移到关闭按钮，关闭后焦点回到触发按钮
 * - Tab/Shift+Tab 在抽屉内循环（焦点陷阱）
 * - Escape 键关闭
 * - Body scroll lock 防止背景滚动
 */
export function MemberDrawer({ open, onClose, members, triggerRef }: MemberDrawerProps) {
  const { t } = useTranslation();
  const drawerRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // 焦点陷阱 + Escape + scroll lock
  useEffect(() => {
    if (!open) return

    // 聚焦关闭按钮
    closeBtnRef.current?.focus()

    // Escape 关闭
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }

      // Tab 循环焦点陷阱
      if (e.key === 'Tab' && drawerRef.current) {
        const focusableSelector =
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        const focusables = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(focusableSelector)
        )
        if (focusables.length === 0) return

        const first = focusables[0]
        const last = focusables[focusables.length - 1]

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    // Body scroll lock
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = prevOverflow
      // 关闭后焦点回到触发按钮
      triggerRef.current?.focus()
    }
  }, [open, onClose, triggerRef])

  if (!open) return null

  return (
    <div ref={drawerRef} role="dialog" aria-modal="true" aria-label={t('member.drawer.title')}>
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 面板 */}
      <div className="fixed top-0 right-0 h-full w-64 bg-gray-800 border-l border-gray-700 z-50 animate-slide-in-right motion-reduce:animate-none overflow-y-auto">
        <div className="flex items-center justify-between p-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-300">{t('member.drawer.title')}</h2>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label={t('member.close')}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>
        <MemberList members={members} />
        {/* Language switcher (mobile) */}
        <div className="border-t border-gray-700 p-4">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}
