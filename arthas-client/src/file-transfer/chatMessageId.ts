/**
 * 聊天消息 ID 生成工具模块。
 *
 * 本模块为文件传输和语音消息提供统一的 ChatMessageId 生成函数。
 * ChatMessageId 用于在聊天界面中唯一标识每条消息，关联传输状态与聊天气泡。
 *
 * 📚 学习要点: 为什么统一 ID 格式？
 * 之前各模块各自生成 ID，格式不一致：
 * - voiceSender 使用 `${Date.now()}-voice-${Math.random().toString(36).slice(2, 10)}`
 * - sender.ts 使用 `${timestamp}-file-${transferId.slice(0, 8)}`
 * - receiver.ts 使用 `${timestamp}-${type}-${data.transferId.slice(0, 8)}`
 *
 * 统一格式的好处：
 * 1. 从 ID 即可判断消息类型（file/voice）和创建时间（timestamp）
 * 2. 随机部分固定 8 字符，便于正则匹配和日志解析
 * 3. 避免依赖 transferId（接收端可能尚未生成 transferId 时就需要 chatMessageId）
 * 4. 单一数据源原则 — 所有 ID 生成逻辑集中在一处，修改时不会遗漏
 *
 * @module file-transfer/chatMessageId
 * @see Requirements 3.5, 3.7
 */

/**
 * 生成标准化的 ChatMessageId。
 *
 * 格式: `${timestamp}-${type}-${random8chars}`
 * - timestamp: 13 位毫秒级 Unix 时间戳（Date.now()）
 * - type: 消息类型标识符，'file' 或 'voice'
 * - random8chars: 8 字符的 base-36 随机字符串（a-z0-9）
 *
 * 📚 学习要点: padEnd(8, '0') 的防御性
 * `Math.random().toString(36).slice(2, 10)` 在极端情况下可能产生少于 8 字符：
 * - Math.random() 返回 0 → toString(36) 为 "0" → slice(2, 10) 为 ""
 * - Math.random() 返回 0.5 → toString(36) 为 "0.i" → slice(2, 10) 为 "i"
 * padEnd(8, '0') 确保输出始终为固定 8 字符，使 ID 格式可预测。
 *
 * 📚 学习要点: 为什么不用 crypto.getRandomValues？
 * ChatMessageId 仅用于 UI 去重和调试追踪，不涉及安全性。
 * Math.random() 在同一毫秒内碰撞概率极低（timestamp 已提供唯一性），
 * 且代码更简洁、无需 fallback 处理。KISS 原则优先。
 *
 * @param type - 消息类型：'file' 表示文件消息，'voice' 表示语音消息
 * @returns 格式为 `${timestamp}-${type}-${random8chars}` 的唯一标识符字符串
 *
 * @example
 * generateChatMessageId('file')   // "1717012345678-file-a3f8k2m1"
 * generateChatMessageId('voice')  // "1717012345678-voice-b7x9p4q2"
 */
export function generateChatMessageId(type: 'file' | 'voice'): string {
  const timestamp = Date.now();
  const random8 = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `${timestamp}-${type}-${random8}`;
}
