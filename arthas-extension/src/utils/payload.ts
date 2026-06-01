/**
 * Payload build/parse utilities — JSON wrapping for message content.
 *
 * All message text is wrapped in JSON format before encryption to ensure
 * interoperability with the web client. The web client wraps messages as
 * `{text, reply?, sig?, type?, pubkey?}` JSON before encryption.
 *
 * This module provides:
 * - `buildPayload` — wraps text (and optional reply) in JSON format for sending
 * - `parsePayload` — extracts text from JSON payload for display (backward compatible)
 *
 * Backward compatibility: if the decrypted plaintext is not valid JSON or lacks
 * a `text` field, the entire string is returned as text (handles old/CLI clients).
 */

export interface ReplyData {
  stableId: string
  senderName: string
  preview: string
}

interface MessagePayload {
  text: string
  reply?: ReplyData
}

/**
 * Wrap text in JSON payload format before encryption (for sending).
 * Optionally includes reply metadata if replying to another message.
 */
export function buildPayload(text: string, reply?: ReplyData | null): string {
  const payload: MessagePayload = { text }
  if (reply) payload.reply = reply
  return JSON.stringify(payload)
}

/**
 * Extract text from decrypted JSON payload (for receiving).
 * Backward compatible: if plaintext is not valid JSON or lacks 'text' field,
 * the entire plaintext string is returned as text.
 */
export function parsePayload(plaintext: string): { text: string; reply?: ReplyData } {
  try {
    const parsed: unknown = JSON.parse(plaintext)
    if (typeof parsed === 'object' && parsed !== null && 'text' in parsed) {
      const obj = parsed as Record<string, unknown>
      if (typeof obj.text === 'string') {
        const result: { text: string; reply?: ReplyData } = { text: obj.text }
        if (obj.reply && typeof obj.reply === 'object') {
          result.reply = obj.reply as ReplyData
        }
        return result
      }
    }
  } catch {
    // Not valid JSON — legacy plaintext format
  }
  return { text: plaintext }
}
