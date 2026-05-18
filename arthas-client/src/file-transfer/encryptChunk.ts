/**
 * Chunk-level encryption for file transfer using AES-256-GCM.
 *
 * 本文件负责将单个文件分片（Chunk）加密为密文，供发送引擎通过 WebSocket 传输。
 * 与 `src/crypto/encrypt.ts`（消息加密）的区别：
 * - 消息加密：输入 string → 输出 base64url 编码的 { iv, ciphertext }
 * - 分片加密：输入 ArrayBuffer → 输出原始二进制 { iv: Uint8Array, ciphertext: Uint8Array }
 *
 * 选择原始二进制输出的原因：
 * - 文件分片高频发送（一个 5MB 文件 = 80 个 chunk），避免 base64 编码/解码开销
 * - msgpack 对 Uint8Array 使用 bin 格式直接传输，比 base64 string 更紧凑
 * - 省去每次 12 bytes → 16 chars 的 base64 转换和反向解析
 *
 * @module file-transfer/encryptChunk
 * @see src/crypto/encrypt.ts — 消息级加密（string 输入，base64url 输出）
 * @see design.md — 分片加密策略和 IV 格式差异说明
 */

/**
 * 加密后的分片数据结构。
 *
 * 📚 学习要点: 为什么 IV 是 Uint8Array 而非 base64url string？
 * - Metadata 的 IV 使用 base64url string（只发送一次，方便调试和日志记录）
 * - Chunk 的 IV 使用 Uint8Array（高频发送，避免编码开销）
 * - msgpack 对 Uint8Array 使用 bin 格式，比 string 更紧凑（12 bytes vs 16 chars）
 * - 接收方直接将 bin 格式的 IV 传给 Web Crypto API，零额外处理
 */
export interface EncryptedChunk {
  /** 96-bit (12 bytes) 随机初始化向量，每个 chunk 唯一 */
  iv: Uint8Array;
  /** AES-256-GCM 加密后的密文（包含 16 bytes GCM auth tag） */
  ciphertext: Uint8Array;
}

/**
 * 使用 AES-256-GCM 加密单个文件分片。
 *
 * 📚 学习要点: 分片加密策略（Per-Chunk IV）
 * 为什么每个 Chunk 使用独立的随机 IV（初始化向量）？
 * 1. AES-GCM 安全要求：同一密钥下 IV 绝不能重复。
 *    如果两个 chunk 使用相同的 (key, IV) 对，攻击者可以通过 XOR 两个密文
 *    得到两个明文的 XOR，从而泄露信息（这是 GCM 模式的致命弱点）。
 * 2. 流式处理：每个 chunk 独立加密，不依赖前一个 chunk 的状态，
 *    允许并行加密（WebWorker）和乱序解密（虽然当前设计是顺序的）。
 * 3. 错误隔离：单个 chunk 损坏（网络错误、内存翻转）不影响其他 chunk 的解密。
 *    损坏的 chunk 会因 GCM auth tag 验证失败而被检测到。
 *
 * 📚 学习要点: GCM Auth Tag（认证标签）
 * AES-GCM 是一种 AEAD（Authenticated Encryption with Associated Data）模式：
 * - 加密：提供机密性（confidentiality）— 攻击者无法读取明文
 * - 认证：提供完整性（integrity）— 攻击者无法篡改密文而不被检测
 * Web Crypto API 的 AES-GCM 实现会自动将 16 bytes (128-bit) 的 auth tag
 * 附加到密文末尾。解密时 API 会自动验证 tag，如果验证失败则抛出异常。
 * 因此：ciphertext.length = plaintext.length + 16
 *
 * @param key - AES-256-GCM CryptoKey（房间密钥 Room_Key）
 * @param chunk - 待加密的文件分片数据（最大 65536 bytes = 64KB）
 * @returns 加密结果：{ iv: 12 bytes 随机 IV, ciphertext: 加密数据 + 16 bytes auth tag }
 *
 * @example
 * ```typescript
 * const roomKey = await importRoomKey(rawKeyBytes);
 * const chunkData = await file.slice(0, 65536).arrayBuffer();
 * const { iv, ciphertext } = await encryptChunk(roomKey, chunkData);
 * // iv.length === 12
 * // ciphertext.length === chunkData.byteLength + 16
 * ws.send(MSG_SEND_FILE_CHUNK, { transferId, index: 0, iv, data: ciphertext });
 * ```
 */
export async function encryptChunk(
  key: CryptoKey,
  chunk: ArrayBuffer
): Promise<EncryptedChunk> {
  // 1. 生成随机 96-bit (12 bytes) IV
  //    📚 学习要点: 为什么是 96-bit？
  //    NIST SP 800-38D 推荐 AES-GCM 使用 96-bit IV（12 bytes）。
  //    这是 GCM 模式的最优长度：
  //    - 96-bit IV 直接用作计数器初始值，无需额外的 GHASH 计算
  //    - 更长或更短的 IV 需要先通过 GHASH 压缩到 128-bit，增加计算开销
  //    - crypto.getRandomValues() 提供密码学安全的随机数
  //    碰撞概率：对于 2^32 个 chunk（~40亿），碰撞概率约 2^-32 ≈ 极低
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 2. 使用 AES-GCM 加密 chunk 数据
  //    Web Crypto API 自动附加 128-bit (16 bytes) GCM auth tag 到密文末尾
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    chunk
  );

  // 3. 返回原始二进制格式（不做 base64 编码）
  //    iv: Uint8Array(12) — 直接通过 msgpack bin 格式传输
  //    ciphertext: Uint8Array(chunk.byteLength + 16) — 包含 GCM auth tag
  return {
    iv,
    ciphertext: new Uint8Array(ciphertextBuffer),
  };
}
