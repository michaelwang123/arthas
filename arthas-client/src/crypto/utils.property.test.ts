/**
 * Property-based test: Base64url encoding round-trip and RFC 4648 compliance
 *
 * 📚 学习要点: Base64url 编码的安全属性
 * 在 Arthas 的 Ed25519 签名系统中，公钥（32 字节）和签名（64 字节）
 * 需要嵌入 JSON payload 中传输。标准 base64 使用 `+` 和 `/` 字符，
 * 这些在 URL 和某些 JSON 解析器中可能引起问题。
 *
 * RFC 4648 §5 定义了 base64url 变体：
 * - 使用 `-` 替代 `+`
 * - 使用 `_` 替代 `/`
 * - 不使用 `=` 填充（padding）
 *
 * 本属性测试验证：
 * 1. 往返一致性：对 32 字节数组（公钥大小），encode → decode 还原原始字节
 * 2. 往返一致性：对 64 字节数组（签名大小），encode → decode 还原原始字节
 * 3. RFC 4648 合规：编码输出仅包含 [A-Za-z0-9_-] 字符集（无 +、/、= ）
 *
 * **Validates: Requirements 3.7, 6.7, 7.5**
 *
 * @module crypto/utils.property.test
 * @see utils.ts — Base64url 编码/解码实现
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { toBase64Url, fromBase64Url } from './utils';

/**
 * RFC 4648 §5 合规字符集正则表达式。
 * Base64url 编码的输出只能包含：大小写字母、数字、`-`、`_`。
 * 不允许标准 base64 的 `+`、`/`，也不允许填充字符 `=`。
 */
const BASE64URL_REGEX = /^[A-Za-z0-9_-]*$/;

describe('Property 7: Base64url encoding round-trip and RFC 4648 compliance', () => {
  /**
   * 32 字节数组往返属性：对任意 32 字节 Uint8Array（公钥大小），
   * toBase64Url 编码后再 fromBase64Url 解码，必须还原为完全相同的字节序列。
   *
   * 📚 学习要点: 为什么测试 32 字节？
   * Ed25519 公钥固定为 32 字节。如果 base64url 编码/解码在 32 字节输入上
   * 存在任何数据丢失或损坏，公钥交换将失败，导致签名验证永远无法通过。
   *
   * **Validates: Requirements 3.7, 6.7, 7.5**
   */
  it('round-trip for 32-byte arrays (public keys): encode then decode produces original bytes', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        (bytes) => {
          const encoded = toBase64Url(bytes.buffer);
          const decoded = fromBase64Url(encoded);
          const decodedBytes = new Uint8Array(decoded);

          expect(decodedBytes.length).toBe(32);
          expect(decodedBytes).toEqual(bytes);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 64 字节数组往返属性：对任意 64 字节 Uint8Array（签名大小），
   * toBase64Url 编码后再 fromBase64Url 解码，必须还原为完全相同的字节序列。
   *
   * 📚 学习要点: 为什么测试 64 字节？
   * Ed25519 签名固定为 64 字节。签名在 JSON payload 中以 base64url 字符串
   * 形式传输，接收方解码后用于验证。任何编码/解码错误都会导致验证失败。
   *
   * **Validates: Requirements 3.7, 6.7, 7.5**
   */
  it('round-trip for 64-byte arrays (signatures): encode then decode produces original bytes', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 64, maxLength: 64 }),
        (bytes) => {
          const encoded = toBase64Url(bytes.buffer);
          const decoded = fromBase64Url(encoded);
          const decodedBytes = new Uint8Array(decoded);

          expect(decodedBytes.length).toBe(64);
          expect(decodedBytes).toEqual(bytes);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * RFC 4648 合规属性：对任意 32 字节或 64 字节数组，
   * toBase64Url 的输出仅包含 [A-Za-z0-9_-] 字符。
   * 不允许出现标准 base64 的 `+`、`/` 或填充字符 `=`。
   *
   * 📚 学习要点: 为什么字符集合规如此重要？
   * - `+` 在 URL 中被解释为空格
   * - `/` 在 URL 路径中是分隔符
   * - `=` 在 URL query string 中是键值分隔符
   * 如果编码输出包含这些字符，在 JSON 嵌入和网络传输中可能引起解析错误。
   * 跨客户端互操作要求 Web 和 CLI 使用完全相同的 base64url 编码（无填充）。
   *
   * **Validates: Requirements 3.7, 6.7, 7.5**
   */
  it('RFC 4648 compliance: encoded string contains only [A-Za-z0-9_-] characters (no +, /, or = padding)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.uint8Array({ minLength: 64, maxLength: 64 })
        ),
        (bytes) => {
          const encoded = toBase64Url(bytes.buffer);

          // 编码结果不能为空（32 或 64 字节输入必然产生非空输出）
          expect(encoded.length).toBeGreaterThan(0);

          // 仅包含 RFC 4648 §5 允许的字符
          expect(encoded).toMatch(BASE64URL_REGEX);

          // 显式验证不包含标准 base64 特殊字符
          expect(encoded).not.toContain('+');
          expect(encoded).not.toContain('/');
          expect(encoded).not.toContain('=');
        }
      ),
      { numRuns: 100 }
    );
  });
});
