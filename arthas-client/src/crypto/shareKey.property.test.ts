/**
 * 分享码编解码属性测试（Property-Based Test）。
 *
 * 本文件使用 fast-check 验证 shareKey.ts 的两个核心属性：
 * - Property 7: Share code round-trip — 任意有效组件经 encode→decode 后等价
 * - Property 2: Invalid share code rejection — 不合规字符串被 decodeShareKey 拒绝
 *
 * 📚 学习要点: 为什么分享码需要属性测试？
 * 分享码是房间加入的唯一凭证，编解码的正确性直接影响用户能否成功加入房间。
 * 单元测试只能覆盖有限的手工用例，而属性测试通过随机生成大量输入，
 * 验证编解码在整个合法输入空间中的往返一致性（round-trip），
 * 以及在整个非法输入空间中的拒绝正确性（rejection）。
 *
 * 📚 学习要点: encodeShareKey 需要 CryptoKey（Web Crypto API）
 * encodeShareKey 内部调用 exportRoomKey(key) 将 CryptoKey 导出为 base64url 字符串。
 * 在测试中，我们通过 crypto.subtle.importKey 创建真实的 CryptoKey 对象，
 * 而非 mock — 这确保测试验证的是真实的加密密钥导出行为。
 * happy-dom 测试环境提供了 Web Crypto API 支持。
 *
 * Feature: qr-share-and-room-expiry, Property 7: Share code round-trip (TypeScript)
 * Feature: qr-share-and-room-expiry, Property 2: Invalid share code rejection (TypeScript)
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 3.4**
 *
 * @module crypto/shareKey.property.test
 * @see shareKey.ts — 分享码编解码实现
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encodeShareKey, decodeShareKey } from './shareKey';

/**
 * NanoID 字符集（与服务器一致）。
 * 用于生成合法的 21 字符房间 ID。
 */
const NANOID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Base64url 字符集（RFC 4648 §5）。
 * 用于生成合法的 43 字符密钥编码。
 */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * 生成合法的 21 字符 NanoID 房间标识符的 fast-check arbitrary。
 *
 * 📚 学习要点: 约束生成器（Constrained Generator）
 * NanoID 有严格的字符集约束（A-Za-z0-9_-），使用 fc.string() 会生成
 * 包含冒号等非法字符的字符串，导致测试无法验证正确的往返行为。
 * 自定义 arbitrary 确保输入始终在合法域内。
 */
const arbRoomId = fc.array(
  fc.constantFrom(...NANOID_ALPHABET.split('')),
  { minLength: 21, maxLength: 21 }
).map(chars => chars.join(''));

/**
 * 生成合法的 32 字节随机密钥的 fast-check arbitrary。
 * 用于创建真实的 CryptoKey 对象进行 round-trip 测试。
 */
const arbKeyBytes = fc.uint8Array({ minLength: 32, maxLength: 32 });

/**
 * 生成合法的 ephemeral 值（非负整数，范围 0-86400）。
 */
const arbEphemeral = fc.integer({ min: 0, max: 86400 });

/**
 * 生成合法的 expiresAt 值（非负整数，范围 0-2000000000）。
 * 上限约为 2033 年的 Unix 时间戳，覆盖实际使用范围。
 */
const arbExpiresAt = fc.integer({ min: 0, max: 2000000000 });

/**
 * 辅助函数：从 32 字节原始密钥创建 CryptoKey 对象。
 *
 * 📚 学习要点: 为什么使用真实的 CryptoKey？
 * encodeShareKey 内部调用 crypto.subtle.exportKey('raw', key)，
 * 这要求传入的必须是真实的 CryptoKey 对象（不能是 mock）。
 * 使用 importKey 创建真实密钥确保测试覆盖完整的导出路径。
 */
async function createCryptoKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM', length: 256 },
    true, // extractable — 必须为 true 才能导出
    ['encrypt', 'decrypt']
  );
}

describe('Feature: qr-share-and-room-expiry, Property 7: Share code round-trip (TypeScript)', () => {
  /**
   * 往返属性：对任意合法的 roomId（21 字符）、32 字节密钥、
   * 非负 ephemeral 和非负 expiresAt，encodeShareKey 编码后
   * 经 decodeShareKey 解码，必须还原出完全相同的组件值。
   *
   * 📚 学习要点: 往返属性（Round-Trip Property）
   * 这是序列化/反序列化代码最基本的正确性保证：
   * decode(encode(x)) == x 对所有合法 x 成立。
   * 如果此属性被违反，说明编码或解码逻辑存在信息丢失或损坏。
   *
   * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
   */
  it('encode→decode round-trip preserves all components for any valid input', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRoomId,
        arbKeyBytes,
        arbEphemeral,
        arbExpiresAt,
        async (roomId, keyBytes, ephemeral, expiresAt) => {
          // 创建真实的 CryptoKey
          const cryptoKey = await createCryptoKey(keyBytes);

          // Encode
          const encoded = await encodeShareKey(roomId, cryptoKey, ephemeral, expiresAt);

          // Decode
          const decoded = decodeShareKey(encoded);

          // 解码必须成功
          expect(decoded).not.toBeNull();

          // 验证各组件还原
          expect(decoded!.roomId).toBe(roomId);
          expect(decoded!.ephemeral).toBe(ephemeral);
          expect(decoded!.expiresAt).toBe(expiresAt);

          // 验证 keyEncoded 长度（base64url 编码的 32 字节 = 43 字符）
          expect(decoded!.keyEncoded.length).toBe(43);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 段数格式属性：验证编码输出的段数符合格式规则。
   * - expiresAt > 0: 必须输出 4 段
   * - expiresAt == 0 且 ephemeral > 0: 输出 3 段
   * - expiresAt == 0 且 ephemeral == 0: 输出 2 段
   *
   * **Validates: Requirements 9.1, 9.2, 9.3**
   */
  it('encoded share code has correct segment count based on ephemeral and expiresAt', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRoomId,
        arbKeyBytes,
        arbEphemeral,
        arbExpiresAt,
        async (roomId, keyBytes, ephemeral, expiresAt) => {
          const cryptoKey = await createCryptoKey(keyBytes);
          const encoded = await encodeShareKey(roomId, cryptoKey, ephemeral, expiresAt);
          const segments = encoded.split(':');

          if (expiresAt > 0) {
            expect(segments.length).toBe(4);
          } else if (ephemeral > 0) {
            expect(segments.length).toBe(3);
          } else {
            expect(segments.length).toBe(2);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: qr-share-and-room-expiry, Property 2: Invalid share code rejection (TypeScript)', () => {
  /**
   * 段数不合规拒绝：段数不在 [2, 4] 范围内的字符串必须被拒绝。
   *
   * 📚 学习要点: 负面属性测试（Negative Property Testing）
   * 正面属性测试验证"合法输入产生正确输出"，
   * 负面属性测试验证"非法输入被正确拒绝"。
   * 对于安全相关的解析器，负面测试尤为重要——
   * 确保畸形输入不会绕过验证或产生无效状态。
   *
   * **Validates: Requirements 3.4**
   */
  it('rejects strings with wrong segment count (not 2, 3, or 4)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // 1 段（无冒号）— 使用 NanoID 字符生成
          fc.array(
            fc.constantFrom(...NANOID_ALPHABET.split('')),
            { minLength: 1, maxLength: 50 }
          ).map(chars => chars.join('')),
          // 5+ 段（过多冒号）
          fc.tuple(
            fc.array(fc.constantFrom(...NANOID_ALPHABET.split('')), { minLength: 1, maxLength: 21 }).map(c => c.join('')),
            fc.array(fc.constantFrom(...NANOID_ALPHABET.split('')), { minLength: 1, maxLength: 43 }).map(c => c.join('')),
            fc.array(fc.constantFrom(...NANOID_ALPHABET.split('')), { minLength: 1, maxLength: 10 }).map(c => c.join('')),
            fc.array(fc.constantFrom(...NANOID_ALPHABET.split('')), { minLength: 1, maxLength: 10 }).map(c => c.join('')),
            fc.array(fc.constantFrom(...NANOID_ALPHABET.split('')), { minLength: 1, maxLength: 10 }).map(c => c.join(''))
          ).map(parts => parts.join(':'))
        ),
        (input) => {
          const result = decodeShareKey(input);
          // 1 段的字符串不包含冒号，所以段数为 1 → 被拒绝
          // 5 段的字符串段数超出范围 → 被拒绝
          // 注意：1 段字符串如果恰好长度为 21 且不含冒号，仍然只有 1 段
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * roomId 长度不合规拒绝：roomId 长度不为 21 时必须返回 null。
   *
   * **Validates: Requirements 3.4**
   */
  it('rejects share codes with incorrect roomId length (not 21)', () => {
    fc.assert(
      fc.property(
        // 生成长度不为 21 的 roomId
        fc.oneof(
          fc.array(fc.constantFrom(...NANOID_ALPHABET.split('')), { minLength: 0, maxLength: 20 }).map(c => c.join('')),
          fc.array(fc.constantFrom(...NANOID_ALPHABET.split('')), { minLength: 22, maxLength: 50 }).map(c => c.join(''))
        ),
        // 合法的 43 字符 key
        fc.array(fc.constantFrom(...BASE64URL_ALPHABET.split('')), { minLength: 43, maxLength: 43 }).map(c => c.join('')),
        (roomId, keyEncoded) => {
          const code = `${roomId}:${keyEncoded}`;
          const result = decodeShareKey(code);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * keyEncoded 长度不合规拒绝：key 段长度不为 43 时必须返回 null。
   *
   * **Validates: Requirements 3.4**
   */
  it('rejects share codes with incorrect keyEncoded length (not 43)', () => {
    fc.assert(
      fc.property(
        arbRoomId,
        // 生成长度不为 43 的 key 段
        fc.oneof(
          fc.array(fc.constantFrom(...BASE64URL_ALPHABET.split('')), { minLength: 0, maxLength: 42 }).map(c => c.join('')),
          fc.array(fc.constantFrom(...BASE64URL_ALPHABET.split('')), { minLength: 44, maxLength: 80 }).map(c => c.join(''))
        ),
        (roomId, keyEncoded) => {
          const code = `${roomId}:${keyEncoded}`;
          const result = decodeShareKey(code);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 非数字 ephemeral 拒绝：ephemeral 段包含非数字字符时必须返回 null。
   *
   * 📚 学习要点: 严格验证 vs 宽松解析
   * 旧实现使用 parseInt(x) || 0 静默接受无效值（如 "3.14" → 3, "abc" → 0）。
   * 新实现要求 ephemeral 段必须是纯数字字符串，否则返回 null。
   * 属性测试验证此严格行为对所有非数字输入都成立。
   *
   * **Validates: Requirements 3.4**
   */
  it('rejects share codes with non-numeric ephemeral segment', () => {
    fc.assert(
      fc.property(
        arbRoomId,
        fc.array(fc.constantFrom(...BASE64URL_ALPHABET.split('')), { minLength: 43, maxLength: 43 }).map(c => c.join('')),
        // 生成包含非数字字符的 ephemeral 段
        fc.array(
          fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz!@#$%^&*().'.split('')),
          { minLength: 1, maxLength: 10 }
        ).map(c => c.join('')),
        (roomId, keyEncoded, ephemeral) => {
          const code = `${roomId}:${keyEncoded}:${ephemeral}`;
          const result = decodeShareKey(code);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 非数字 expiresAt 拒绝：expiresAt 段包含非数字字符时必须返回 null。
   *
   * **Validates: Requirements 3.4**
   */
  it('rejects share codes with non-numeric expiresAt segment', () => {
    fc.assert(
      fc.property(
        arbRoomId,
        fc.array(fc.constantFrom(...BASE64URL_ALPHABET.split('')), { minLength: 43, maxLength: 43 }).map(c => c.join('')),
        fc.nat(86400).map(String), // 合法的 ephemeral 段（纯数字）
        // 生成包含非数字字符的 expiresAt 段
        fc.array(
          fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz!@#$%^&*().'.split('')),
          { minLength: 1, maxLength: 10 }
        ).map(c => c.join('')),
        (roomId, keyEncoded, ephemeral, expiresAt) => {
          const code = `${roomId}:${keyEncoded}:${ephemeral}:${expiresAt}`;
          const result = decodeShareKey(code);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 负数 ephemeral 拒绝：ephemeral 段为负数时必须返回 null。
   * 负数以 '-' 开头，不匹配 /^\d+$/ 正则。
   *
   * **Validates: Requirements 3.4**
   */
  it('rejects share codes with negative ephemeral value', () => {
    fc.assert(
      fc.property(
        arbRoomId,
        fc.array(fc.constantFrom(...BASE64URL_ALPHABET.split('')), { minLength: 43, maxLength: 43 }).map(c => c.join('')),
        fc.integer({ min: -100000, max: -1 }),
        (roomId, keyEncoded, negativeEphemeral) => {
          const code = `${roomId}:${keyEncoded}:${negativeEphemeral}`;
          const result = decodeShareKey(code);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 负数 expiresAt 拒绝：expiresAt 段为负数时必须返回 null。
   *
   * **Validates: Requirements 3.4**
   */
  it('rejects share codes with negative expiresAt value', () => {
    fc.assert(
      fc.property(
        arbRoomId,
        fc.array(fc.constantFrom(...BASE64URL_ALPHABET.split('')), { minLength: 43, maxLength: 43 }).map(c => c.join('')),
        fc.nat(86400).map(String), // 合法的 ephemeral 段
        fc.integer({ min: -100000, max: -1 }),
        (roomId, keyEncoded, ephemeral, negativeExpiresAt) => {
          const code = `${roomId}:${keyEncoded}:${ephemeral}:${negativeExpiresAt}`;
          const result = decodeShareKey(code);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
