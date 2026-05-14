/**
 * 加密载荷构建/解析工具 — JSON 包装 + 向后兼容。
 *
 * 新格式: JSON.stringify({ text, reply? })
 * 旧格式: 纯文本字符串
 *
 * parsePayload 自动检测格式，确保旧客户端发送的消息仍能正常显示。
 */

export interface ReplyData {
  stableId: string    // 被引用消息的稳定 ID (senderId:timestamp)
  senderName: string  // 被引用消息的发送者名称
  preview: string     // 被引用消息的文本摘要（最多 50 字符）
}

interface MessagePayload {
  text: string
  reply?: ReplyData
}

/**
 * 构建加密载荷字符串。
 * 如果有 reply，包装为 JSON；否则也包装为 JSON（统一格式）。
 */
export function buildPayload(text: string, reply?: ReplyData | null): string {
  const payload: MessagePayload = { text }
  if (reply) payload.reply = reply
  return JSON.stringify(payload)
}

/**
 * 解析解密后的载荷。
 * 向后兼容：如果不是有效 JSON 或缺少 text 字段，则整个字符串作为消息文本。
 */
export function parsePayload(plaintext: string): { text: string; reply?: ReplyData } {
  try {
    const parsed = JSON.parse(plaintext)
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.text === 'string') {
      return { text: parsed.text, reply: parsed.reply }
    }
  } catch {
    // 不是 JSON — 旧格式纯文本
  }
  return { text: plaintext }
}

/**
 * 截断文本为引用摘要。
 */
export function truncatePreview(text: string, maxLen = 50): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

/**
 * 生成跨客户端稳定的消息 ID。
 * 使用 senderId + timestamp 组合，在同一房间内实际上不可能冲突。
 */
export function makeStableId(senderId: string, timestamp: number): string {
  return `${senderId}:${timestamp}`
}
