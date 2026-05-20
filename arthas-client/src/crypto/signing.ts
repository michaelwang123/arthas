/**
 * Ed25519 签名模块 — 密钥生成、签名、验证。
 *
 * 职责：
 * - 生成 Ed25519 签名密钥对（每次加入/创建房间时调用）
 * - 对消息 payload 进行数字签名（发送端）
 * - 验证消息签名（接收端）
 * - 公钥的 base64url 编解码（用于广播和存储）
 *
 * 与其他模块的关系：
 * - 使用 `./utils.ts` 的 toBase64Url/fromBase64Url 进行编码
 * - 被 `../stores/chatStore.ts` 调用（密钥生命周期管理）
 * - 被 `../utils/payload.ts` 调用（签名计算和验证）
 *
 * 安全属性：
 * - 密钥对仅存在于内存中，不持久化到 localStorage/sessionStorage
 * - 私钥标记为 non-extractable（Web Crypto API 保护）
 * - 浏览器不支持 Ed25519 时 graceful degrade（返回 null）
 */

import { toBase64Url, fromBase64Url } from './utils';

/**
 * 📚 学习要点: Ed25519 vs ECDSA 的选择
 *
 * 为什么选择 Ed25519 而不是 ECDSA (P-256)？
 *
 * 1. **确定性签名**: Ed25519 签名是确定性的（不需要随机数 k），
 *    消除了因 PRNG 质量差导致私钥泄露的风险（Sony PS3 ECDSA 事件）。
 *
 * 2. **性能**: Ed25519 签名和验证速度比 ECDSA P-256 快约 2-3 倍，
 *    适合聊天场景中频繁的签名/验证操作。
 *
 * 3. **密钥尺寸**: 32 字节公钥 + 64 字节签名，比 ECDSA P-256 更紧凑
 *    （P-256 公钥 65 字节未压缩 / 33 字节压缩，签名 64 字节）。
 *
 * 4. **安全性**: 128-bit 安全级别，抗侧信道攻击设计（constant-time 实现）。
 *
 * 浏览器兼容性：
 * - Chrome 113+ (2023-05)
 * - Firefox 130+ (2024-09)
 * - Safari 17+ (2023-09)
 * - Edge 113+ (2023-05)
 *
 * Fallback 策略：不支持的浏览器中 generateSigningKeyPair 返回 null，
 * 客户端以 no-sig 模式运行（消息正常加密发送，只是没有签名）。
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Ed25519 密钥对（内存中，不持久化） */
export interface SigningKeyPair {
  /** Ed25519 私钥（用于签名，non-extractable） */
  privateKey: CryptoKey;
  /** Ed25519 公钥（用于验证） */
  publicKey: CryptoKey;
  /** 32 字节原始公钥（用于广播给其他成员） */
  publicKeyBytes: Uint8Array;
}

// ─── Feature Detection ───────────────────────────────────────────────────────

/**
 * 检测当前浏览器是否支持 Ed25519 算法。
 *
 * 通过尝试生成一个临时密钥对来检测支持情况。
 * 不支持的浏览器会抛出 NotSupportedError。
 *
 * @returns true 如果浏览器支持 Ed25519
 */
async function isEd25519Supported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

// ─── Key Generation ──────────────────────────────────────────────────────────

/**
 * 生成 Ed25519 签名密钥对。
 *
 * 每次加入/创建房间时调用。密钥对仅存在于内存中，
 * 会话结束时由调用方丢弃引用（GC 回收）。
 *
 * 内部流程：
 * 1. 检测 Ed25519 支持（feature detection）
 * 2. 生成密钥对（私钥 non-extractable，公钥 extractable）
 * 3. 导出公钥原始字节（32 字节，用于广播）
 *
 * @returns SigningKeyPair 或 null（浏览器不支持 Ed25519 时）
 */
export async function generateSigningKeyPair(): Promise<SigningKeyPair | null> {
  // Feature detection: 不支持时 graceful degrade
  const supported = await isEd25519Supported();
  if (!supported) {
    return null;
  }

  // 生成 Ed25519 密钥对
  // - extractable: true 用于公钥导出（广播给其他成员）
  // - usages: ['sign', 'verify'] 分别分配给私钥和公钥
  const keyPair = await crypto.subtle.generateKey(
    'Ed25519',
    true, // extractable — 需要导出公钥原始字节
    ['sign', 'verify']
  );

  // 导出公钥为 32 字节原始格式（用于 base64url 编码后广播）
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyBytes = new Uint8Array(publicKeyRaw);

  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyBytes,
  };
}

// ─── Signing ─────────────────────────────────────────────────────────────────

/**
 * 使用 Ed25519 私钥对 Signable_Bytes 进行签名。
 *
 * Signable_Bytes 是去除 `sig` 字段后的 payload 经 canonical JSON 序列化
 * 再 UTF-8 编码得到的字节序列（由 canonicalJson.ts 的 computeSignableBytes 生成）。
 *
 * @param privateKey - Ed25519 私钥（从 SigningKeyPair.privateKey 获取）
 * @param signableBytes - 待签名的字节序列（Signable_Bytes）
 * @returns 64 字节签名的 base64url 编码字符串
 */
export async function signPayload(
  privateKey: CryptoKey,
  signableBytes: Uint8Array
): Promise<string> {
  // Ed25519 签名产生固定 64 字节输出
  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    signableBytes as Uint8Array<ArrayBuffer>
  );

  return toBase64Url(signature);
}

// ─── Verification ────────────────────────────────────────────────────────────

/**
 * 使用 Ed25519 公钥验证签名。
 *
 * 调用方应传入已缓存的 CryptoKey（通过 importVerifyKey 导入并缓存），
 * 避免每次验证都重复 import 操作。
 *
 * @param publicKey - 已 import 的 Ed25519 公钥 CryptoKey（从 publicKeyMap 缓存获取）
 * @param signableBytes - 待验证的字节序列（与签名时相同的 Signable_Bytes）
 * @param signatureBase64url - base64url 编码的 64 字节签名
 * @returns true 如果签名验证通过
 */
export async function verifySignature(
  publicKey: CryptoKey,
  signableBytes: Uint8Array,
  signatureBase64url: string
): Promise<boolean> {
  // 将 base64url 签名解码为原始字节
  const signatureBuffer = fromBase64Url(signatureBase64url);

  // Ed25519 验证：返回 boolean，不抛异常
  return crypto.subtle.verify(
    'Ed25519',
    publicKey,
    signatureBuffer,
    signableBytes as Uint8Array<ArrayBuffer>
  );
}

// ─── Key Import ──────────────────────────────────────────────────────────────

/**
 * 将 32 字节原始公钥导入为 CryptoKey（用于签名验证）。
 *
 * 调用方应缓存返回的 CryptoKey，避免对同一公钥重复调用 importKey。
 * 典型用法：收到公钥广播时调用一次，结果存入 publicKeyMap。
 *
 * @param publicKeyBytes - 32 字节 Ed25519 原始公钥
 * @returns 可用于 verifySignature 的 CryptoKey
 */
export async function importVerifyKey(publicKeyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    publicKeyBytes as Uint8Array<ArrayBuffer>,
    'Ed25519',
    true, // extractable — 允许后续导出（如需要重新编码）
    ['verify']
  );
}

// ─── Public Key Encoding ─────────────────────────────────────────────────────

/**
 * 将原始公钥字节编码为 base64url 字符串（用于广播和传输）。
 *
 * @param publicKeyBytes - 32 字节 Ed25519 原始公钥
 * @returns base64url 编码字符串（43 字符，无 padding）
 */
export function encodePublicKey(publicKeyBytes: Uint8Array): string {
  return toBase64Url(publicKeyBytes.buffer as ArrayBuffer);
}

/**
 * 从 base64url 编码的公钥字符串解码为原始字节。
 *
 * @param base64url - base64url 编码的公钥字符串
 * @returns 32 字节 Uint8Array（Ed25519 原始公钥）
 */
export function decodePublicKey(base64url: string): Uint8Array {
  return new Uint8Array(fromBase64Url(base64url));
}
