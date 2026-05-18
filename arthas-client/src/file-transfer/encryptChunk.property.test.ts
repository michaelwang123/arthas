/**
 * Property-based test: Chunk encryption round-trip
 *
 * 📚 学习要点: 属性测试 vs 单元测试
 * 单元测试验证特定输入的正确性（如 1KB、64KB 的固定数据）。
 * 属性测试（Property-Based Testing）验证对**所有可能输入**都成立的不变量：
 * - 任意大小（1~65536 bytes）的 ArrayBuffer
 * - 任意有效的 AES-256-GCM 密钥
 * - 加密后再解密，必须得到与原始数据完全相同的字节序列
 *
 * fast-check 会自动生成数百个随机测试用例，包括边界值（1 byte、最大 chunk），
 * 如果发现反例会自动缩小（shrink）到最小失败输入，便于调试。
 *
 * **Validates: Requirements 2.5, 2.3, 2.4, 5.2**
 *
 * @module file-transfer/encryptChunk.property.test
 * @see encryptChunk.ts — 分片加密实现
 * @see decryptChunk.ts — 分片解密实现
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encryptChunk } from './encryptChunk';
import { decryptChunk } from './decryptChunk';

/**
 * 生成 AES-256-GCM 测试密钥。
 *
 * 📚 学习要点: CryptoKey 的生命周期
 * Web Crypto API 的 generateKey 返回一个不可导出的密钥对象（extractable=true 仅用于测试）。
 * 在属性测试中，我们为每个测试用例生成独立的密钥，确保测试之间互不干扰。
 */
async function generateTestKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

describe('Property: Chunk encryption round-trip', () => {
  /**
   * **Property 2: Chunk encryption round-trip**
   *
   * 对于任意 ArrayBuffer（1 到 65,536 bytes）和有效的 AES-256-GCM 密钥，
   * `encryptChunk` 然后 `decryptChunk` 必须产生与原始数据字节完全相同的副本。
   *
   * 📚 学习要点: 为什么这个属性很重要？
   * 加密的核心安全属性之一是「正确性」：加密不应丢失或改变任何信息。
   * 如果 encrypt→decrypt 不是恒等变换，说明实现有 bug（如 IV 处理错误、
   * buffer 偏移计算错误、类型转换丢失数据等）。
   * 属性测试能发现手写测试遗漏的边界情况（如奇数长度、单字节等）。
   *
   * **Validates: Requirements 2.5, 2.3, 2.4, 5.2**
   */
  it('encrypting then decrypting any chunk produces byte-identical output', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成 1 到 65536 bytes 的随机 Uint8Array
        fc.uint8Array({ minLength: 1, maxLength: 65536 }),
        async (plainBytes) => {
          // 为每个测试用例生成独立密钥
          const key = await generateTestKey();

          // 将 Uint8Array 转为 ArrayBuffer（encryptChunk 的输入类型）
          const plainBuffer = plainBytes.buffer.slice(
            plainBytes.byteOffset,
            plainBytes.byteOffset + plainBytes.byteLength
          ) as ArrayBuffer;

          // 加密
          const { iv, ciphertext } = await encryptChunk(key, plainBuffer);

          // 解密
          const decryptedBuffer = await decryptChunk(key, iv, ciphertext);

          // 验证：解密后的数据与原始数据字节完全相同
          const decryptedBytes = new Uint8Array(decryptedBuffer);
          expect(decryptedBytes).toEqual(plainBytes);
        }
      ),
      {
        // 属性测试运行次数：平衡覆盖率和执行时间
        // 加密操作相对耗时，100 次足以覆盖各种大小的输入
        numRuns: 100,
      }
    );
  });
});
