/**
 * 密码哈希工具 — 使用 Web Crypto API (SHA-256)
 * 客户端发送密码 hash 而非明文，防止中间人窃取
 */

export async function hashPassword(password: string): Promise<string> {
  if (!password) return ''
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
