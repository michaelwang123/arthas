import { useState, useEffect, useRef, type RefObject } from 'react'
import { emojiCategories, getRecentEmojis, addRecentEmoji } from '../utils/emojiData'
import { useTranslation } from '../i18n'

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
  excludeRef: RefObject<HTMLElement | null>
}

/**
 * Emoji 选择面板 — 分类 Tab + 网格布局。
 *
 * 特性：
 * - 点击 emoji 插入（不关闭面板，允许连续选择）
 * - 外部点击关闭（排除 emoji 按钮本身）
 * - 移动端底部全宽，桌面端向上弹出
 * - 最近使用 emoji 持久化
 */
export function EmojiPicker({ onSelect, onClose, excludeRef }: EmojiPickerProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(0)
  const [recentEmojis, setRecentEmojis] = useState<string[]>(getRecentEmojis())
  const pickerRef = useRef<HTMLDivElement>(null)

  // 外部点击关闭
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (pickerRef.current?.contains(target)) return
      if (excludeRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose, excludeRef])

  const handleEmojiClick = (emoji: string) => {
    onSelect(emoji)
    addRecentEmoji(emoji)
    setRecentEmojis(getRecentEmojis())
  }

  // 构建分类列表（动态填充"最近"）
  const categories = emojiCategories.map((cat, i) => {
    if (i === 0) return { ...cat, emojis: recentEmojis }
    return cat
  })

  const activeCategory = categories[activeTab]

  return (
    <div
      ref={pickerRef}
      role="dialog"
      aria-label={t('emoji.select')}
      className="fixed bottom-16 left-0 right-0 z-30 mx-2 md:absolute md:bottom-full md:left-auto md:right-0 md:mx-0 md:mb-2 md:w-80
                 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden"
    >
      {/* 分类 Tab 栏 */}
      <div className="flex overflow-x-auto border-b border-gray-700 px-1 py-1 gap-0.5 scrollbar-none">
        {categories.map((cat, i) => (
          <button
            key={cat.nameKey}
            onClick={() => setActiveTab(i)}
            aria-label={t(cat.nameKey)}
            className={`shrink-0 w-8 h-8 flex items-center justify-center rounded text-lg
              ${activeTab === i ? 'bg-gray-600' : 'hover:bg-gray-700'}`}
          >
            {cat.icon}
          </button>
        ))}
      </div>

      {/* Emoji 网格 */}
      <div className="h-48 overflow-y-auto p-2">
        {activeCategory.emojis.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-500">
            {activeTab === 0 ? t('emoji.noRecent') : ''}
          </div>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {activeCategory.emojis.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                onClick={() => handleEmojiClick(emoji)}
                className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-gray-700 transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
