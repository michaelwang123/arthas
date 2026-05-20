/**
 * Property-based tests: Typing encryption round-trip and IV uniqueness
 *
 * 📚 学习要点: AES-GCM 的两个关键安全属性
 * 1. 加密/解密往返正确性：加密后解密必须还原原始数据（功能正确性）
 * 2. IV 唯一性：同一密钥下每次加密必须使用不同的 IV（安全性）
 *    - AES-GCM 的安全性依赖于 (key, IV) 对的唯一性
 *    - 如果两条消息使用相同的 (key, IV)，攻击者可以计算两条明文的 XOR
 *    - 96-bit 随机 IV 的碰撞概率极低（生日悖论：约 2^48 次加密后才有 50% 碰撞概率）
 *
 * **Validates: Requirements 1.1, 1.3, 1.5**
 *
 * @module crypto/typingEncrypt.property.test
 * @see typingEncrypt.ts — Typing 状态 AES-GCM 加密/解密实现
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encryptTypingStatus, decryptTypingStatus } from './typingEncrypt';
import { fromBase64Url } from './utils';

/**
 * 生成一个新的 AES-256-GCM CryptoKey 用于测试。
 *
 * 📚 学习要点: 为什么每次测试生成新密钥？
 * 属性测试应覆盖所有可能的密钥空间。虽然 AES-256 密钥空间太大无法穷举，
 * 但每次迭代使用不同密钥可以增加测试覆盖的多样性，
 * 确保实现不依赖于特定密钥值的巧合行为。
 */
async function generateTestKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

describe('Property 1: Typing encryption round-trip', () => {
  /**
   * 对任意布尔值和任意 AES-256 密钥，加密后解密必须还原原始 typing 状态。
   *
   * 📚 学习要点: 为什么这个属性重要？
   * 如果加密/解密往返失败，typing 指示器将显示错误状态——
   * 用户可能看到对方"正在输入"但实际已停止，或反之。
   * 这个属性确保加密层是透明的（不改变语义）。
   *
   * **Validates: Requirements 1.1, 1.5**
   */
  it('encrypt then decrypt always recovers the original typing boolean', async () => {
    const key = await generateTestKey();

    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (typing) => {
        const { iv, ciphertext } = await encryptTypingStatus(key, typing);
        const decrypted = await decryptTypingStatus(key, iv, ciphertext);
        expect(decrypted).toBe(typing);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 2: IV uniqueness and correct length', () => {
  /**
   * 每次加密调用生成的 IV 必须恰好为 12 字节（96 bits）。
   *
   * 📚 学习要点: 为什么 AES-GCM 使用 96-bit IV？
   * AES-GCM 规范（NIST SP 800-38D）推荐 96-bit IV：
   * - 96-bit 是 GCM 的"原生"IV 长度，无需额外哈希处理
   * - 其他长度的 IV 会被 GHASH 压缩到 96-bit，增加碰撞风险
   * - 96-bit 随机 IV 在合理使用量下碰撞概率可忽略
   *
   * **Validates: Requirements 1.3**
   */
  it('each generated IV is exactly 12 bytes', async () => {
    const key = await generateTestKey();

    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (typing) => {
        const { iv } = await encryptTypingStatus(key, typing);
        const ivBytes = new Uint8Array(fromBase64Url(iv));
        expect(ivBytes.length).toBe(12);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * 对同一密钥和同一 typing 值进行 N 次加密，所有生成的 IV 必须互不相同。
   *
   * 📚 学习要点: IV 唯一性的安全意义
   * AES-GCM 的安全性完全依赖于 (key, nonce) 对的唯一性。
   * 如果两次加密使用相同的 key 和 IV：
   * - 攻击者可以计算两条密文的 XOR，得到两条明文的 XOR
   * - GCM 的认证标签也会泄露信息，可能被伪造
   * - 这是 AES-GCM 最严重的误用场景（nonce reuse attack）
   *
   * 本测试生成 50 次加密，验证所有 IV 互不相同。
   * 对于 96-bit 随机值，50 次碰撞的概率约为 50^2 / 2^97 ≈ 0，
   * 如果测试失败，说明 IV 生成逻辑有严重缺陷。
   *
   * **Validates: Requirements 1.3**
   */
  it('all IVs in a batch of 50 encryptions are distinct', async () => {
    const key = await generateTestKey();
    const batchSize = 50;

    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (typing) => {
        // 对同一密钥和同一 typing 值加密 N 次
        const ivHexSet = new Set<string>();

        for (let i = 0; i < batchSize; i++) {
          const { iv } = await encryptTypingStatus(key, typing);
          const ivBytes = new Uint8Array(fromBase64Url(iv));

          // 将 IV 转为 hex 字符串用于集合比较
          const ivHex = Array.from(ivBytes)
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');

          ivHexSet.add(ivHex);
        }

        // 所有 IV 必须互不相同（Set 大小等于批次大小）
        expect(ivHexSet.size).toBe(batchSize);
      }),
      { numRuns: 10 }
    );
  });
});
