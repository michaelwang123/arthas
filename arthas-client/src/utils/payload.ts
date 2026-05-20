/**
 * 加密载荷构建/解析工具 — JSON 包装 + 向后兼容 + Ed25519 签名支持。
 *
 * 本模块提供两套 API：
 * - `buildPayload` / `parsePayload` — 原始无签名版本（向后兼容）
 * - `buildSignedPayload` / `parseSignedPayload` — 带 Ed25519 签名的扩展版本
 *
 * 新格式: JSON.stringify({ text, sig?, reply?, type?, pubkey? })
 * 旧格式: 纯文本字符串
 *
 * parseSignedPayload 自动检测格式，确保旧客户端发送的消息仍能正常显示。
 *
 * 与其他模块的关系：
 * - 使用 `../crypto/canonicalJson.ts` 的 computeSignableBytes 计算签名输入
 * - 使用 `../crypto/signing.ts` 的 signPayload 进行 Ed25519 签名
 * - 被 `../stores/chatStore.ts` 调用（消息发送/接收）
 */

import { computeSignableBytes } from '../crypto/canonicalJson'
import { signPayload } from '../crypto/signing'

export interface ReplyData {
  stableId: string    // 被引用消息的稳定 ID (senderId:timestamp)
  senderName: string  // 被引用消息的发送者名称
  preview: string     // 被引用消息的文本摘要（最多 50 字符）
}

/**
 * 扩展后的消息载荷接口 — 支持 Ed25519 签名和公钥广播。
 *
 * 📚 学习要点: 为什么 sig 是 optional？
 * - 浏览器不支持 Ed25519 时，privateKey 为 null，不生成签名
 * - 旧客户端发送的消息没有 sig 字段
 * - 签名失败时（异常情况），消息仍可正常发送（graceful degradation）
 */
export interface SignedMessagePayload {
  /** 消息文本内容（始终存在，公钥广播时为空字符串） */
  text: string
  /** base64url 编码的 64 字节 Ed25519 签名（可选） */
  sig?: string
  /** 引用回复元数据（可选，与现有 reply 功能兼容） */
  reply?: ReplyData
  /** 特殊消息类型标识（如 "pubkey" 表示公钥广播） */
  type?: string
  /** base64url 编码的 32 字节公钥（仅 type="pubkey" 时存在） */
  pubkey?: string
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

// ─── Signed Payload API ──────────────────────────────────────────────────────

/**
 * 构建带 Ed25519 签名的加密载荷。
 *
 * 📚 学习要点: 签名流程与 JSON 序列化的区别
 * - Signable_Bytes 使用 canonical JSON（递归排序 keys）确保跨客户端一致性
 * - 最终输出使用普通 JSON.stringify（不需要 canonical，因为接收方会重新计算 Signable_Bytes）
 * - 签名覆盖所有非 sig 字段（text, reply, type, pubkey），防止任何字段被篡改
 *
 * 流程：
 * 1. 构建 payload 对象（不含 sig）
 * 2. 计算 Signable_Bytes（canonical JSON → UTF-8 bytes）
 * 3. Ed25519 签名（如果 privateKey 非 null）
 * 4. 将 sig 插入 payload
 * 5. 返回 JSON.stringify 的完整 payload（普通序列化）
 *
 * @param text - 消息文本内容（公钥广播时为空字符串）
 * @param privateKey - Ed25519 私钥（null 表示不支持或跳过签名）
 * @param reply - 引用回复元数据（可选）
 * @param type - 特殊消息类型（如 "pubkey"）
 * @param pubkey - base64url 编码的公钥（仅公钥广播时使用）
 * @returns JSON 字符串形式的完整 payload（含签名）
 */
export async function buildSignedPayload(
  text: string,
  privateKey: CryptoKey | null,
  reply?: ReplyData | null,
  type?: string,
  pubkey?: string
): Promise<string> {
  // Step 1: 构建 payload 对象（不含 sig）
  const payload: Record<string, unknown> = { text }
  if (reply) payload.reply = reply
  if (type) payload.type = type
  if (pubkey) payload.pubkey = pubkey

  // Step 2-3: 如果有私钥，计算签名
  if (privateKey) {
    // Step 2: 计算 Signable_Bytes（canonical JSON 序列化 → UTF-8 编码）
    const signableBytes = computeSignableBytes(payload)

    // Step 3: Ed25519 签名（返回 base64url 编码的 64 字节签名）
    const sig = await signPayload(privateKey, signableBytes)

    // Step 4: 将 sig 插入 payload
    payload.sig = sig
  }

  // Step 5: 普通 JSON.stringify（非 canonical — 接收方会重新计算 Signable_Bytes）
  return JSON.stringify(payload)
}

/**
 * 解析解密后的载荷，提取签名和所有扩展字段。
 *
 * 向后兼容策略：
 * - 有效 JSON 且包含 text 字段 → 提取所有已知字段
 * - 无效 JSON 或缺少 text 字段 → 整个明文作为 text（兼容旧客户端）
 *
 * @param plaintext - AES-256-GCM 解密后的明文字符串
 * @returns SignedMessagePayload 对象
 */
export function parseSignedPayload(plaintext: string): SignedMessagePayload {
  try {
    const parsed = JSON.parse(plaintext)
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.text === 'string') {
      const result: SignedMessagePayload = { text: parsed.text }
      if (typeof parsed.sig === 'string') result.sig = parsed.sig
      if (parsed.reply && typeof parsed.reply === 'object') result.reply = parsed.reply
      if (typeof parsed.type === 'string') result.type = parsed.type
      if (typeof parsed.pubkey === 'string') result.pubkey = parsed.pubkey
      return result
    }
  } catch {
    // 不是有效 JSON — 旧格式纯文本，fallback 处理
  }
  return { text: plaintext }
}
