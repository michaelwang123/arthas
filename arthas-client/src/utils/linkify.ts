/**
 * URL 自动识别工具 — 将消息文本拆分为普通文本和链接片段。
 *
 * 特性：
 * - 仅识别 http:// 和 https:// 开头的 URL
 * - 括号平衡：正确处理 Wikipedia 风格 URL（如 /wiki/Foo_(bar)）
 * - 尾部标点剥离：避免 "https://x.com。" 包含中文句号
 * - 处理顺序：先平衡括号 → 再剥离尾部标点
 */

const URL_REGEX = /https?:\/\/[^\s<>"\u3000-\u303F\uFF00-\uFFEF]+/g
// 不含 ) 和 ]，这两个由 balanceParentheses 处理
const TRAILING_PUNCT = /[.,;:!?>'"。，；：！？】》]+$/

export interface TextSegment {
  type: 'text' | 'link'
  content: string
}

/**
 * 平衡括号：剥离多余的尾部 ) 和 ]。
 * - https://en.wikipedia.org/wiki/Foo_(bar) → 保留（平衡）
 * - https://example.com) → 剥离尾部 )（不平衡）
 */
function balanceParentheses(url: string): string {
  let result = url

  // 平衡 ()
  const opens = (result.match(/\(/g) || []).length
  const closes = (result.match(/\)/g) || []).length
  let excess = closes - opens
  while (excess > 0 && result.endsWith(')')) {
    result = result.slice(0, -1)
    excess--
  }

  // 平衡 []
  const openBrackets = (result.match(/\[/g) || []).length
  const closeBrackets = (result.match(/\]/g) || []).length
  let bracketExcess = closeBrackets - openBrackets
  while (bracketExcess > 0 && result.endsWith(']')) {
    result = result.slice(0, -1)
    bracketExcess--
  }

  return result
}

export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let lastIndex = 0

  URL_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_REGEX.exec(text)) !== null) {
    let url = match[0]

    // 顺序重要：先平衡括号，再剥离尾部标点
    url = balanceParentheses(url)
    const trailingMatch = url.match(TRAILING_PUNCT)
    if (trailingMatch) {
      url = url.slice(0, -trailingMatch[0].length)
    }

    const urlStart = match.index
    const urlEnd = urlStart + url.length
    URL_REGEX.lastIndex = urlEnd

    if (urlStart > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, urlStart) })
    }
    if (url.length > 0) {
      segments.push({ type: 'link', content: url })
    }
    lastIndex = urlEnd
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }
  return segments
}

export function truncateUrl(url: string, maxLen = 50): string {
  return url.length > maxLen ? url.slice(0, maxLen) + '…' : url
}
