/**
 * Chunk-level decryption for file transfer using AES-256-GCM.
 *
 * 本文件负责将接收到的加密分片（Chunk）解密为原始明文数据，供接收引擎重组文件。
 * 与 `src/crypto/decrypt.ts`（消息解密）的区别：
 * - 消息解密：输入 base64url 编码的 iv + ciphertext → 输出 string
 * - 分片解密：输入原始二进制 iv (Uint8Array) + ciphertext (Uint8Array) → 输出 ArrayBuffer
 *
 * 选择原始二进制输入的原因：
 * - 发送方通过 msgpack bin 格式传输 IV 和密文，接收方直接获得 Uint8Array
 * - 无需 base64url 解码步骤，减少每个 chunk 的处理延迟
 * - 解密后的 ArrayBuffer 直接存入 chunk buffer，等待文件重组
 *
 * @module file-transfer/decryptChunk
 * @see src/crypto/decrypt.ts — 消息级解密（base64url 输入，string 输出）
 * @see encryptChunk.ts — 对应的加密实现
 */

/**
 * 使用 AES-256-GCM 解密单个文件分片。
 *
 * 📚 学习要点: GCM 解密与认证验证
 * AES-GCM 解密过程同时执行两个操作：
 * 1. 解密：使用 (key, IV, ciphertext) 恢复明文
 * 2. 验证：检查 GCM auth tag 是否匹配
 *
 * 如果密文被篡改（哪怕只改了 1 bit），或者使用了错误的密钥/IV，
 * Web Crypto API 会抛出 `DOMException: The operation failed for an
 * operation-specific reason`（不会返回部分解密的数据）。
 *
 * 这是 AEAD 的核心安全属性：要么得到完整正确的明文，要么得到错误。
 * 不存在「部分正确」的中间状态，防止了 padding oracle 等攻击。
 *
 * 📚 学习要点: 为什么 IV 是 Uint8Array 而非 base64url string？
 * 接收方从 msgpack 反序列化得到的 IV 已经是 Uint8Array（bin 格式），
 * 直接传给 Web Crypto API 即可，无需任何格式转换。
 * 这与消息解密不同——消息的 IV 是 base64url string，需要先调用 fromBase64Url() 解码。
 * 对于高频操作（每个文件 80 次解密），省去字符串解析是有意义的性能优化。
 *
 * @param key - AES-256-GCM CryptoKey（房间密钥 Room_Key，与加密时使用的相同密钥）
 * @param iv - 12 bytes (96-bit) 初始化向量（从加密方的 EncryptedChunk.iv 获得）
 * @param ciphertext - 加密后的分片数据（包含 16 bytes GCM auth tag）
 * @returns 解密后的原始分片数据（ArrayBuffer）
 * @throws {DOMException} 如果密钥错误、IV 不匹配、或密文被篡改，Web Crypto API 抛出异常
 *
 * @example
 * ```typescript
 * const roomKey = await importRoomKey(rawKeyBytes);
 * // 从 WebSocket 收到的 relay chunk 数据
 * const { iv, data: ciphertext } = relayChunkData;
 * try {
 *   const plaintext = await decryptChunk(roomKey, iv, ciphertext);
 *   // plaintext.byteLength === ciphertext.length - 16
 *   chunkBuffer[index] = new Uint8Array(plaintext);
 * } catch (e) {
 *   // 解密失败：密钥错误或数据损坏
 *   markTransferFailed(transferId, '文件解密失败');
 * }
 * ```
 */
export async function decryptChunk(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array
): Promise<ArrayBuffer> {
  // 使用 AES-GCM 解密
  // Web Crypto API 内部流程：
  // 1. 从 ciphertext 末尾提取 16 bytes 作为 GCM auth tag
  // 2. 使用 (key, IV) 解密剩余的密文部分
  // 3. 计算解密后明文的 GHASH，与 auth tag 比较
  // 4. 如果匹配 → 返回明文 ArrayBuffer
  //    如果不匹配 → 抛出 DOMException（密文被篡改或密钥/IV 错误）
  //
  // 类型断言说明：TypeScript 5.x 将 Uint8Array 泛型化为 Uint8Array<ArrayBufferLike>，
  // 而 Web Crypto API 要求 BufferSource（基于 ArrayBuffer，不含 SharedArrayBuffer）。
  // 在浏览器环境中，Uint8Array.buffer 始终是 ArrayBuffer（SharedArrayBuffer 需要
  // Cross-Origin-Isolation headers 才能使用），因此 `as ArrayBuffer` 断言是安全的。
  // 📚 学习要点: 为什么使用 slice() 而非直接传 .buffer？
  // @msgpack/msgpack 解码时使用共享内部缓冲区，返回的 Uint8Array 的 .buffer
  // 可能指向一个更大的 ArrayBuffer（byteOffset != 0, byteLength != array.length）。
  // 如果直接传 .buffer 给 Web Crypto API，它会使用整个 ArrayBuffer 的内容，
  // 而非 Uint8Array 指定的子范围，导致解密失败。
  // 使用 .slice() 创建一个独立的 ArrayBuffer 副本，确保字节范围正确。
  const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer;
  const ciphertextBuffer = ciphertext.buffer.slice(
    ciphertext.byteOffset,
    ciphertext.byteOffset + ciphertext.byteLength
  ) as ArrayBuffer;

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    ciphertextBuffer
  );

  return plaintextBuffer;
}
