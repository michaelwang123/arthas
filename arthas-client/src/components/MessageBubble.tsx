import { useState } from 'react'
import { linkify, truncateUrl } from '../utils/linkify'

interface MessageBubbleProps {
  text: string
  isOwn: boolean
  canCopy: boolean
  isDecryptFailed: boolean
}

/**
 * 消息气泡组件 — 封装链接识别和桌面端复制功能。
 *
 * 特性：
 * - 自动识别 URL 并渲染为可点击链接
 * - 桌面端 hover 显示复制按钮
 * - 移动端依赖浏览器原生长按复制（不阻止 user-select）
 * - 解密失败消息显示红色斜体
 */
export function MessageBubble({ text, isOwn, canCopy, isDecryptFailed }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!canCopy) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API 可能在非 HTTPS 环境下失败
    }
  }

  const bgClass = isOwn ? 'bg-indigo-600' : 'bg-gray-700'
  const roundedClass = isOwn ? 'rounded-lg rounded-br-sm' : 'rounded-lg rounded-bl-sm'

  return (
    <div className={`relative group ${bgClass} text-white px-3 py-2 ${roundedClass}`}>
      {isDecryptFailed ? (
        <span className={`italic ${isOwn ? 'text-red-300' : 'text-red-400'}`}>{text}</span>
      ) : (
        <RichText text={text} />
      )}

      {/* Desktop-only copy button (hover reveal) */}
      {canCopy && (
        <button
          onClick={handleCopy}
          aria-label="复制消息"
          className="absolute -top-2 -right-2 w-6 h-6 items-center justify-center
                     bg-gray-600 rounded-full text-xs opacity-0 group-hover:opacity-100
                     transition-opacity duration-150 hover:bg-gray-500
                     hidden md:flex"
        >
          {copied ? '✓' : '📋'}
        </button>
      )}

      {/* Copied toast */}
      {copied && (
        <span className="absolute -top-6 right-0 text-xs text-green-400 bg-gray-900 px-1.5 py-0.5 rounded whitespace-nowrap">
          已复制
        </span>
      )}
    </div>
  )
}

/**
 * 富文本渲染 — 将消息文本中的 URL 渲染为可点击链接。
 */
function RichText({ text }: { text: string }) {
  const segments = linkify(text)

  if (segments.length === 1 && segments[0].type === 'text') {
    // 纯文本快速路径
    return <span className="break-words">{text}</span>
  }

  return (
    <span className="break-words">
      {segments.map((seg, i) =>
        seg.type === 'link' ? (
          <a
            key={i}
            href={seg.content}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 underline hover:text-blue-300"
            title={seg.content}
          >
            {truncateUrl(seg.content)}
          </a>
        ) : (
          <span key={i}>{seg.content}</span>
        )
      )}
    </span>
  )
}
