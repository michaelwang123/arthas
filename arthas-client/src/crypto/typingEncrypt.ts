/**
 * Typing 状态加密/解密 — 使用 Room_Key (AES-256-GCM) 加密输入状态。
 *
 * 本模块负责将 typing 布尔值加密后传输，使服务器无法观察"谁在输入"的元数据。
 * 复用 encrypt.ts / decrypt.ts 相同的 AES-256-GCM 模式，但专门处理 typing payload。
 *
 * 📚 学习要点: 为什么 typing 元数据泄露是隐私问题？
 * 即使消息内容已加密，typing 状态（谁在输入、何时输入）仍是有价值的元数据：
 * - 服务器可以推断用户活跃时间模式（行为分析）
 * - 结合消息时间戳，可以关联"输入中"与"发送消息"事件（流量分析）
 * - 在敏感场景中（如举报人、记者），typing 模式可暴露通信关系
 * - 加密 typing 状态确保服务器只看到不透明的密文，无法区分"开始输入"和"停止输入"
 * 这是端到端加密系统中"元数据保护"的一部分——不仅保护内容，也保护行为模式。
 */

import { toBase64Url, fromBase64Url } from './utils';

/**
 * 加密 typing 状态。
 *
 * 将 `{"typing": true}` 或 `{"typing": false}` 序列化为 UTF-8 JSON，
 * 使用 AES-256-GCM 和 Room_Key 加密，每次生成唯一的 96-bit 随机 IV。
 *
 * @param roomKey - AES-256-GCM CryptoKey（房间共享密钥）
 * @param typing - 当前输入状态（true = 正在输入，false = 停止输入）
 * @returns 包含 base64url 编码的 iv 和 ciphertext 的对象
 */
export async function encryptTypingStatus(
  roomKey: CryptoKey,
  typing: boolean
): Promise<{ iv: string; ciphertext: string }> {
  // 1. 构建 Typing_Payload JSON 并编码为 UTF-8 字节
  const payload = JSON.stringify({ typing });
  const plaintextBytes = new TextEncoder().encode(payload);

  // 2. 生成唯一的 96-bit (12 bytes) 随机 IV
  //    AES-GCM 要求同一密钥下 IV 绝不重复，否则会泄露明文 XOR
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 3. 使用 AES-256-GCM 加密
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    roomKey,
    plaintextBytes
  );

  // 4. 返回 base64url 编码的 IV 和密文（无 padding）
  return {
    iv: toBase64Url(iv.buffer),
    ciphertext: toBase64Url(ciphertextBuffer),
  };
}

/**
 * 解密 typing 状态。
 *
 * 将 base64url 编码的 iv 和 ciphertext 解码，使用 AES-256-GCM 解密，
 * 解析 JSON 提取 typing 布尔值。
 *
 * @param roomKey - AES-256-GCM CryptoKey（房间共享密钥）
 * @param iv - base64url 编码的 96-bit IV
 * @param ciphertext - base64url 编码的密文（含 GCM 认证标签）
 * @returns typing 布尔值
 * @throws 如果解密失败（密钥错误、数据损坏、密文被篡改）或 JSON 解析失败
 */
export async function decryptTypingStatus(
  roomKey: CryptoKey,
  iv: string,
  ciphertext: string
): Promise<boolean> {
  // 1. 将 base64url 编码的 IV 解码为字节
  const ivBytes = new Uint8Array(fromBase64Url(iv));

  // 2. 将 base64url 编码的密文解码为字节
  const ciphertextBytes = new Uint8Array(fromBase64Url(ciphertext));

  // 3. 使用 AES-256-GCM 解密（密钥错误或数据被篡改时会抛出异常）
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    roomKey,
    ciphertextBytes
  );

  // 4. 将解密后的字节解码为 UTF-8 字符串，解析 JSON 提取 typing 值
  const plaintext = new TextDecoder().decode(plaintextBuffer);
  const parsed: { typing: boolean } = JSON.parse(plaintext);

  return parsed.typing;
}
