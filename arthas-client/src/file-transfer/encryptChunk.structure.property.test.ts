/**
 * Property-based test: Encrypted chunk structure invariant.
 *
 * 📚 学习要点: 结构不变量（Structure Invariant）
 * AES-256-GCM 加密的输出具有确定性的结构：
 * - IV（初始化向量）：固定 12 bytes（96-bit），由 NIST SP 800-38D 规定
 * - Ciphertext：明文长度 + 16 bytes GCM 认证标签（auth tag）
 *
 * 这个属性测试验证：对于任意长度的明文输入，加密输出始终满足上述结构约束。
 * 这是一个「代数性质」测试——不依赖具体值，只验证输出的结构关系。
 *
 * **Validates: Requirements 2.6, 2.3**
 *
 * @module file-transfer/encryptChunk.structure.property.test
 * @see encryptChunk.ts — 被测模块
 * @see design.md — 分片加密策略说明
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import { encryptChunk } from './encryptChunk';

/**
 * 📚 学习要点: 测试用 CryptoKey 生成
 * Property-based testing 需要在多次迭代中复用同一个密钥。
 * 在 beforeAll 中生成一次，避免每次迭代都调用 crypto.subtle.generateKey()
 * 带来的性能开销（密钥生成涉及随机数和密码学运算）。
 */
let testKey: CryptoKey;

beforeAll(async () => {
  testKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
});

describe('Property 3: Encrypted chunk structure invariant', () => {
  /**
   * **Validates: Requirements 2.6, 2.3**
   *
   * 📚 学习要点: 为什么测试 IV 长度和 ciphertext 长度？
   * - IV 必须恰好 12 bytes：GCM 模式对 96-bit IV 有最优性能路径，
   *   更长或更短的 IV 需要额外 GHASH 计算。如果 IV 长度错误，
   *   解密方无法正确还原明文。
   * - Ciphertext 必须恰好 N + 16 bytes：GCM 模式将 128-bit (16 bytes)
   *   认证标签附加到密文末尾。如果长度不符，说明加密实现有误，
   *   可能导致认证失败或数据截断。
   */
  it('for any plaintext of N bytes, IV is exactly 12 bytes and ciphertext is exactly N + 16 bytes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 65536 }),
        async (size) => {
          // 生成指定大小的随机明文
          const plaintext = new Uint8Array(size);
          if (size > 0) {
            crypto.getRandomValues(plaintext);
          }

          const result = await encryptChunk(testKey, plaintext.buffer as ArrayBuffer);

          // 结构不变量 1: IV 恰好 12 bytes (96-bit)
          expect(result.iv).toBeInstanceOf(Uint8Array);
          expect(result.iv.length).toBe(12);

          // 结构不变量 2: Ciphertext 恰好 N + 16 bytes (明文 + GCM auth tag)
          expect(result.ciphertext).toBeInstanceOf(Uint8Array);
          expect(result.ciphertext.length).toBe(size + 16);
        }
      ),
      { numRuns: 100 }
    );
  });
});
