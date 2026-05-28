/**
 * @file crypto.ts — AES-256-GCM 加密引擎
 *
 * 本文件实现与 Arthas Web 客户端和 CLI 客户端完全兼容的加密/解密逻辑。
 * 职责：
 * 1. deriveKey(shareCode) — 从分享码提取 Base64URL 密钥并解码为 Buffer
 * 2. encrypt(plaintext, key) — AES-256-GCM 加密（随机 12 字节 IV）
 * 3. decrypt(ciphertext, iv, key) — AES-256-GCM 解密 + GCM tag 验证
 *
 * 📚 学习要点: 跨平台加密兼容性
 * Arthas 有三个客户端实现：
 * - Web 客户端（arthas-client）：使用 Web Crypto API（SubtleCrypto）
 * - CLI 客户端（arthas-cli）：使用 Go crypto/aes + crypto/cipher
 * - 本插件（openclaw-channel）：使用 Node.js crypto 模块
 *
 * 三者必须产生兼容的密文格式：
 * - 密钥：256-bit AES 密钥（从 Base64URL 编码的分享码第 2 段提取）
 * - IV：12 字节随机值（每条消息唯一）
 * - 算法：AES-256-GCM（128-bit authentication tag）
 * - 密文格式：ciphertext || authTag（auth tag 附加在密文末尾，共 16 字节）
 * - 传输编码：Base64URL（无 padding）
 *
 * 📚 学习要点: 为什么使用 Node.js crypto 而非 Web Crypto API？
 * 虽然 Node.js 也支持 Web Crypto API（globalThis.crypto.subtle），
 * 但 Node.js 原生 crypto 模块更适合服务端场景：
 * - 同步 API 可用（createCipheriv 支持流式处理）
 * - 更好的性能（直接调用 OpenSSL，无 Promise 开销）
 * - 更丰富的算法支持（如 Ed25519 签名）
 * - 对 Buffer 的原生支持（无需 ArrayBuffer ↔ Buffer 转换）
 *
 * @module openclaw-channel/crypto
 * @see design.md — D2: 复用 Web Crypto API 加密实现
 * @see requirements.md — Requirement 2: 加密与安全
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

// ============================================================================
// 常量定义
// ============================================================================

/**
 * AES-256 密钥长度（字节）。
 * AES 支持 16（AES-128）、24（AES-192）、32（AES-256）三种密钥长度。
 * Arthas 使用最高安全级别 AES-256。
 */
const KEY_SIZE = 32;

/**
 * GCM 初始化向量（IV/Nonce）长度（字节）。
 *
 * 📚 学习要点: 为什么 GCM 使用 12 字节 IV？
 * NIST SP 800-38D 推荐 96 位（12 字节）作为 GCM 的标准 nonce 长度。
 * 使用其他长度需要额外的 GHASH 计算，降低性能且不增加安全性。
 * 12 字节随机 IV 在 2^32 条消息内碰撞概率约 2^(-48)，实际使用中可忽略。
 */
const IV_SIZE = 12;

/**
 * GCM 认证标签（Authentication Tag）长度（字节）。
 *
 * 📚 学习要点: 认证标签的作用
 * GCM 模式在加密的同时生成 16 字节（128 位）认证标签。
 * 解密时验证此标签，确保密文未被篡改。
 * 如果密钥错误或密文被修改，验证会失败并抛出错误，
 * 而不是返回错误的明文（这是 AEAD 的核心安全属性）。
 */
const AUTH_TAG_SIZE = 16;

/**
 * 分享码中 roomId 段的固定长度（NanoID 格式）。
 */
const ROOM_ID_LENGTH = 21;

/**
 * 分享码中 base64url 编码密钥段的固定长度。
 * 32 字节密钥经 base64url 编码（无 padding）后为 ⌈32×4/3⌉ = 43 字符。
 */
const KEY_ENCODED_LENGTH = 43;

// ============================================================================
// 密钥派生
// ============================================================================

/**
 * 从 Arthas 分享码中提取并解码 AES-256 密钥。
 *
 * 分享码格式：`{roomId}:{base64urlKey}[:{ephemeral}[:{expiresAt}]]`
 * - 第 1 段：21 字符 NanoID（房间标识）
 * - 第 2 段：43 字符 base64url 编码的 32 字节 AES-256 密钥
 * - 第 3 段（可选）：临时模式秒数
 * - 第 4 段（可选）：过期时间戳（Unix 秒）
 *
 * 本函数提取第 2 段并解码为原始 32 字节密钥 Buffer。
 *
 * 📚 学习要点: Base64URL 编码
 * Base64URL（RFC 4648 §5）使用 URL 安全字符集：
 * - 标准 Base64 的 '+' 替换为 '-'
 * - 标准 Base64 的 '/' 替换为 '_'
 * - 无尾部 '=' padding（RawURLEncoding）
 * 这使得密钥可以安全地嵌入 URL、终端命令和环境变量中。
 *
 * @param shareCode - Arthas 房间分享码字符串
 * @returns 32 字节 AES-256 密钥 Buffer
 * @throws 如果分享码格式无效或密钥长度不正确
 *
 * @example
 * ```typescript
 * const key = deriveKey('abcdefghijklmnopqrstu:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
 * // key 是 32 字节的 Buffer
 * ```
 */
export function deriveKey(shareCode: string): Buffer {
  // 1. 按冒号分割分享码
  const parts = shareCode.split(':');
  if (parts.length < 2 || parts.length > 4) {
    throw new Error(
      'Invalid share code: expected format {roomId}:{key}[:{ephemeral}[:{expiresAt}]]'
    );
  }

  // 2. 验证 roomId 长度（21 字符 NanoID）
  const roomId = parts[0];
  if (roomId === undefined || roomId.length !== ROOM_ID_LENGTH) {
    throw new Error(
      `Invalid share code: room ID must be ${ROOM_ID_LENGTH} characters, got ${roomId?.length ?? 0}`
    );
  }

  // 3. 验证 key 段长度（43 字符 base64url）
  const keyEncoded = parts[1];
  if (keyEncoded === undefined || keyEncoded.length !== KEY_ENCODED_LENGTH) {
    throw new Error(
      `Invalid share code: key segment must be ${KEY_ENCODED_LENGTH} characters, got ${keyEncoded?.length ?? 0}`
    );
  }

  // 4. Base64URL 解码密钥
  // 📚 学习要点: Node.js Buffer 的 base64url 支持
  // Node.js Buffer.from() 原生支持 'base64url' 编码（自 v15.7.0），
  // 无需手动替换字符或添加 padding，比 Web 客户端的实现更简洁。
  const keyBuffer = Buffer.from(keyEncoded, 'base64url');

  // 5. 验证解码后的密钥长度
  if (keyBuffer.length !== KEY_SIZE) {
    throw new Error(
      `Invalid share code: key must be ${KEY_SIZE} bytes after decoding, got ${keyBuffer.length}`
    );
  }

  return keyBuffer;
}

// ============================================================================
// 加密
// ============================================================================

/**
 * 加密结果接口。
 *
 * 📚 学习要点: 为什么返回 Buffer 而非 Base64 字符串？
 * 本模块返回原始 Buffer，将编码决策留给调用方（protocol.ts）。
 * 这样做的好处：
 * - 职责分离：crypto 模块只负责加密/解密，不关心传输编码
 * - 灵活性：调用方可以选择 base64url、hex 或直接二进制传输
 * - 可测试性：测试可以直接比较字节，无需额外的编解码步骤
 */
export interface EncryptResult {
  /** 密文（包含 16 字节 GCM 认证标签附加在末尾） */
  ciphertext: Buffer;
  /** 12 字节随机初始化向量 */
  iv: Buffer;
}

/**
 * 使用 AES-256-GCM 加密明文字符串。
 *
 * 加密流程：
 * 1. 生成 12 字节密码学安全随机 IV（使用 crypto.randomBytes/CSPRNG）
 * 2. 使用 AES-256-GCM 算法加密 UTF-8 编码的明文
 * 3. 将 16 字节认证标签附加到密文末尾
 *
 * 输出格式与 Web 客户端和 Go CLI 完全兼容：
 * - Web Crypto API 的 encrypt() 自动将 auth tag 附加到密文末尾
 * - Go 的 gcm.Seal() 也将 auth tag 附加到密文末尾
 * - 本实现手动拼接以保持一致
 *
 * 📚 学习要点: IV 唯一性是 AES-GCM 安全性的关键前提
 * 同一密钥下，如果两条消息使用相同的 IV，攻击者可以：
 * - 计算两条明文的 XOR（泄露明文信息）
 * - 伪造认证标签（破坏完整性保证）
 * 使用 crypto.randomBytes()（操作系统 CSPRNG）生成随机 IV，
 * 碰撞概率约为 2^(-48)（对于 2^32 条消息），在实际使用中可忽略。
 *
 * @param plaintext - 待加密的 UTF-8 明文字符串
 * @param key - 32 字节 AES-256 密钥（从 deriveKey() 获取）
 * @returns 加密结果，包含密文（含 auth tag）和 IV
 * @throws 如果密钥长度不正确或加密过程出错
 *
 * @example
 * ```typescript
 * const key = deriveKey(shareCode);
 * const { ciphertext, iv } = encrypt('Hello, World!', key);
 * // ciphertext: Buffer (明文长度 + 16 字节 auth tag)
 * // iv: Buffer (12 字节)
 * ```
 */
export function encrypt(plaintext: string, key: Buffer): EncryptResult {
  // 0. 验证密钥长度（ISSUE-4 修复）
  if (key.length !== KEY_SIZE) {
    throw new Error(
      `密钥长度错误: 期望 ${KEY_SIZE} 字节, 实际 ${key.length} 字节`
    );
  }

  // 1. 生成 12 字节随机 IV
  const iv = randomBytes(IV_SIZE);

  // 2. 创建 AES-256-GCM cipher
  // 📚 学习要点: createCipheriv 的参数
  // - 'aes-256-gcm': 算法标识（OpenSSL 命名）
  // - key: 32 字节密钥
  // - iv: 12 字节初始化向量
  // Node.js 的 GCM 实现默认使用 128 位（16 字节）认证标签。
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  // 3. 加密明文（UTF-8 编码）
  // update() 处理输入数据，final() 完成加密并返回剩余数据
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  // 4. 获取 16 字节认证标签
  const authTag = cipher.getAuthTag();

  // 5. 将认证标签附加到密文末尾
  // 📚 学习要点: 为什么将 auth tag 附加到密文末尾？
  // 这是 Arthas 协议的约定，与 Web Crypto API 和 Go gcm.Seal() 的行为一致：
  // - Web Crypto API: crypto.subtle.encrypt('AES-GCM', ...) 返回 ciphertext || tag
  // - Go: gcm.Seal(nil, nonce, plaintext, nil) 返回 ciphertext || tag
  // - Node.js: 需要手动拼接 cipher.update() + cipher.final() + cipher.getAuthTag()
  const ciphertext = Buffer.concat([encrypted, authTag]);

  return { ciphertext, iv };
}

// ============================================================================
// 解密
// ============================================================================

/**
 * 使用 AES-256-GCM 解密密文并验证认证标签。
 *
 * 解密流程：
 * 1. 从密文末尾分离 16 字节认证标签
 * 2. 使用 AES-256-GCM 解密（同时验证认证标签）
 * 3. 将解密后的字节解码为 UTF-8 字符串
 *
 * 📚 学习要点: GCM 认证标签验证的安全属性
 * AES-GCM 的解密操作在验证认证标签的同时解密数据。
 * 如果密钥错误、IV 被修改、或密文被篡改，解密会抛出错误：
 * - 不会返回部分解密的明文（全有或全无）
 * - 攻击者无法在不被检测的情况下修改密文内容
 * - 这是 AEAD（Authenticated Encryption with Associated Data）的核心安全属性
 *
 * @param ciphertext - 密文 Buffer（末尾包含 16 字节 GCM 认证标签）
 * @param iv - 12 字节初始化向量 Buffer
 * @param key - 32 字节 AES-256 密钥 Buffer
 * @returns 解密后的 UTF-8 明文字符串
 * @throws 如果认证标签验证失败（密钥错误或数据被篡改）
 *
 * @example
 * ```typescript
 * const key = deriveKey(shareCode);
 * const plaintext = decrypt(ciphertext, iv, key);
 * // plaintext: 'Hello, World!'
 * ```
 */
export function decrypt(ciphertext: Buffer, iv: Buffer, key: Buffer): string {
  // 0. 验证密钥长度（ISSUE-4 修复）
  if (key.length !== KEY_SIZE) {
    throw new Error(
      `密钥长度错误: 期望 ${KEY_SIZE} 字节, 实际 ${key.length} 字节`
    );
  }

  // 0.1 验证 IV 长度
  if (iv.length !== IV_SIZE) {
    throw new Error(
      `IV 长度错误: 期望 ${IV_SIZE} 字节, 实际 ${iv.length} 字节`
    );
  }

  // 1. 验证密文长度（至少需要包含 16 字节认证标签）
  if (ciphertext.length < AUTH_TAG_SIZE) {
    throw new Error(
      `Invalid ciphertext: too short (${ciphertext.length} bytes), must be at least ${AUTH_TAG_SIZE} bytes for auth tag`
    );
  }

  // 2. 分离密文和认证标签
  // 📚 学习要点: 密文格式 = encrypted_data || auth_tag
  // 最后 16 字节是 GCM 认证标签，前面的部分是实际加密数据。
  // 这与 Web Crypto API 和 Go gcm.Open() 的输入格式一致：
  // - Web Crypto API: crypto.subtle.decrypt() 期望 ciphertext || tag
  // - Go: gcm.Open() 期望 ciphertext || tag
  // - Node.js: 需要手动分离，分别传给 decipher 和 setAuthTag()
  const encryptedData = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_SIZE);
  const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_SIZE);

  // 3. 创建 AES-256-GCM decipher
  const decipher = createDecipheriv('aes-256-gcm', key, iv);

  // 4. 设置认证标签（必须在 update/final 之前调用）
  decipher.setAuthTag(authTag);

  // 5. 解密并验证
  // 📚 学习要点: final() 是认证标签验证发生的时刻
  // update() 只是解密数据，final() 在完成解密后验证认证标签。
  // 如果标签不匹配，final() 会抛出 "Unsupported state or unable to authenticate data" 错误。
  // 这意味着即使 update() 成功返回了数据，如果 final() 失败，
  // 整个解密结果都应该被丢弃（数据可能已被篡改）。
  const decrypted = Buffer.concat([
    decipher.update(encryptedData),
    decipher.final(),
  ]);

  // 6. 将解密后的字节解码为 UTF-8 字符串
  return decrypted.toString('utf8');
}

// ============================================================================
// Base64URL 编解码工具函数
// ============================================================================

/**
 * 将 Buffer 编码为 Base64URL 字符串（无 padding）。
 *
 * 与 Web 客户端 utils.ts 的 toBase64Url() 和 Go 的 base64.RawURLEncoding 兼容。
 *
 * 📚 学习要点: Node.js Buffer 原生 base64url 支持
 * Node.js v15.7.0+ 的 Buffer.toString('base64url') 直接输出无 padding 的 base64url，
 * 无需像 Web 客户端那样手动替换 +/- 和 /_ 字符。
 *
 * @param buffer - 要编码的 Buffer
 * @returns Base64URL 编码字符串（无 padding）
 */
export function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/**
 * 将 Base64URL 字符串解码为 Buffer。
 *
 * 与 Web 客户端 utils.ts 的 fromBase64Url() 和 Go 的 base64.RawURLEncoding 兼容。
 *
 * @param encoded - Base64URL 编码字符串（无 padding）
 * @returns 解码后的 Buffer
 */
export function fromBase64Url(encoded: string): Buffer {
  return Buffer.from(encoded, 'base64url');
}

// ============================================================================
// Buffer 加密/解密（用于文件传输，ISSUE-1 修复）
// ============================================================================

/**
 * 使用 AES-256-GCM 加密原始二进制数据（Buffer）。
 *
 * 📚 学习要点: 为什么需要独立的 Buffer 加密函数？
 * encrypt() 接受 string 并使用 UTF-8 编码，适合文本消息。
 * 但文件传输的 chunk 是原始二进制数据，不能经过 UTF-8 编码
 * （会改变字节长度，导致与 Web 客户端的 ArrayBuffer 加密不兼容）。
 * encryptBuffer() 直接对 Buffer 加密，与 Web Crypto API 的行为完全一致。
 *
 * @param data - 待加密的原始二进制数据
 * @param key - 32 字节 AES-256 密钥
 * @returns 加密结果（ciphertext 含 auth tag + iv）
 */
export function encryptBuffer(data: Buffer, key: Buffer): EncryptResult {
  if (key.length !== KEY_SIZE) {
    throw new Error(`密钥长度错误: 期望 ${KEY_SIZE} 字节, 实际 ${key.length} 字节`);
  }

  const iv = randomBytes(IV_SIZE);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  // 直接加密 Buffer（不经过字符串编码）
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, authTag]);

  return { ciphertext, iv };
}

/**
 * 使用 AES-256-GCM 解密原始二进制数据（Buffer）。
 *
 * 与 encryptBuffer() 配对使用，返回原始 Buffer 而非 UTF-8 字符串。
 * 用于文件传输 chunk 的解密，与 Web 客户端的 ArrayBuffer 解密兼容。
 *
 * @param ciphertext - 密文 Buffer（末尾含 16 字节 auth tag）
 * @param iv - 12 字节 IV
 * @param key - 32 字节 AES-256 密钥
 * @returns 解密后的原始二进制 Buffer
 */
export function decryptBuffer(ciphertext: Buffer, iv: Buffer, key: Buffer): Buffer {
  if (key.length !== KEY_SIZE) {
    throw new Error(`密钥长度错误: 期望 ${KEY_SIZE} 字节, 实际 ${key.length} 字节`);
  }

  if (iv.length !== IV_SIZE) {
    throw new Error(`IV 长度错误: 期望 ${IV_SIZE} 字节, 实际 ${iv.length} 字节`);
  }

  if (ciphertext.length < AUTH_TAG_SIZE) {
    throw new Error(
      `Invalid ciphertext: too short (${ciphertext.length} bytes), must be at least ${AUTH_TAG_SIZE} bytes for auth tag`
    );
  }

  const encryptedData = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_SIZE);
  const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_SIZE);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}
