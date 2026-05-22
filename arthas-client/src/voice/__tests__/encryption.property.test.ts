/**
 * Property-based test: Voice message encryption round-trip
 *
 * 📚 学习要点: 语音消息加密的完整性验证
 * 语音消息复用文件传输的分片加密机制（64KB chunk + per-chunk AES-256-GCM）。
 * 本测试验证：对于任意大小（500B~240KB）的音频数据，经过分片加密再解密后，
 * 重组的数据与原始数据字节完全相同。
 *
 * 与 `encryptChunk.property.test.ts` 的区别：
 * - encryptChunk 测试：验证单个 chunk（1~65536 bytes）的加密/解密正确性
 * - 本测试：验证完整语音消息的分片→加密→解密→重组流程
 *   - 数据可能跨越多个 chunk（240KB = 4 个 64KB chunk）
 *   - 验证分片边界处理正确（最后一个 chunk 可能不满 64KB）
 *   - 验证重组后数据顺序和完整性
 *
 * 📚 学习要点: 为什么测试 500B~240KB 范围？
 * - 500B：最短有效语音消息（约 0.5 秒 Opus 编码）
 * - 240KB：60 秒语音消息的最大预期大小（32kbps Opus）
 * - 这个范围覆盖了 1~4 个 chunk 的场景，验证了多 chunk 重组逻辑
 *
 * **Validates: Requirements 3.1, 4.1**
 *
 * @module voice/__tests__/encryption.property.test
 * @see file-transfer/encryptChunk.ts — 分片加密实现
 * @see file-transfer/decryptChunk.ts — 分片解密实现
 * @see file-transfer/types.ts — CHUNK_SIZE 常量定义
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encryptChunk } from '../../file-transfer/encryptChunk';
import { decryptChunk } from '../../file-transfer/decryptChunk';
import { CHUNK_SIZE } from '../../file-transfer/types';

/**
 * 生成 AES-256-GCM 测试密钥（模拟房间密钥 Room_Key）。
 *
 * 📚 学习要点: 测试中的密钥生成
 * 每个测试用例使用独立的密钥，确保：
 * 1. 测试之间互不干扰（一个测试的密钥不会影响另一个）
 * 2. 验证加密/解密对任意有效密钥都正确工作
 * 3. extractable=true 仅用于测试环境（生产环境应为 false）
 */
async function generateTestKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * 将数据按 CHUNK_SIZE (64KB) 分片。
 *
 * 📚 学习要点: 分片策略
 * 文件传输引擎将任意大小的数据切分为固定大小的 chunk：
 * - 前 N-1 个 chunk 大小恰好为 CHUNK_SIZE (65536 bytes)
 * - 最后一个 chunk 大小为 remainder（1 ~ CHUNK_SIZE bytes）
 * - 单个 chunk 的场景：数据 ≤ CHUNK_SIZE 时只有一个 chunk
 *
 * 语音消息通常只有 1~4 个 chunk（500B~240KB / 64KB = 0.008~3.66）
 */
function splitIntoChunks(data: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, data.length);
    chunks.push(data.slice(offset, end));
  }
  return chunks;
}

/**
 * 将解密后的 chunk 重组为完整数据。
 *
 * 📚 学习要点: 重组顺序的重要性
 * chunk 必须按原始顺序拼接，否则数据会错乱。
 * 在实际文件传输中，接收方通过 chunk index 确保顺序正确。
 * 本测试中我们按顺序加密和解密，模拟正确的传输流程。
 */
function reassembleChunks(chunks: ArrayBuffer[]): Uint8Array {
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return result;
}

describe('Feature: voice-push-to-talk, Property 1: Voice message encryption round-trip', () => {
  /**
   * **Property 1: Voice message encryption round-trip**
   *
   * 对于任意大小（500B~240KB）的音频数据，经过以下流程后数据不变：
   * 1. 按 64KB 分片
   * 2. 每个分片使用 AES-256-GCM 独立加密（独立随机 IV）
   * 3. 每个加密分片解密
   * 4. 按顺序重组所有解密后的分片
   *
   * 📚 学习要点: 为什么这个属性对语音消息至关重要？
   * 语音消息的加密/解密必须是无损的（lossless round-trip）：
   * - 音频编解码器（Opus）已经是有损压缩，不能在传输层再引入数据损失
   * - 即使 1 bit 的差异也会导致音频容器格式（WebM/MP4）解析失败
   * - 接收方无法重新请求原始数据（服务器不存储，零知识架构）
   *
   * 属性测试通过随机生成数百种不同大小的数据，验证分片边界处理、
   * 多 chunk 重组、以及各种对齐/非对齐场景的正确性。
   *
   * **Validates: Requirements 3.1, 4.1**
   */
  it('encrypting then decrypting voice-sized data via chunk mechanism produces identical output', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成 500 到 245760 bytes (240KB) 的随机 Uint8Array
        // 📚 学习要点: 为什么上限是 245760？
        // 240KB = 240 × 1024 = 245760 bytes
        // 这是 60 秒 Opus 语音在 32kbps 比特率下的最大预期大小
        fc.uint8Array({ minLength: 500, maxLength: 245760 }),
        async (audioData) => {
          // 1. 生成独立的测试密钥（模拟房间密钥）
          const key = await generateTestKey();

          // 2. 按 CHUNK_SIZE (64KB) 分片
          const chunks = splitIntoChunks(audioData);

          // 验证分片数量符合预期（1~4 个 chunk）
          const expectedChunks = Math.ceil(audioData.length / CHUNK_SIZE);
          expect(chunks.length).toBe(expectedChunks);

          // 3. 逐片加密（每个 chunk 使用独立的随机 IV）
          const encryptedChunks = await Promise.all(
            chunks.map(async (chunk) => {
              // 将 Uint8Array 转为 ArrayBuffer（encryptChunk 的输入类型）
              const chunkBuffer = chunk.buffer.slice(
                chunk.byteOffset,
                chunk.byteOffset + chunk.byteLength
              ) as ArrayBuffer;
              return encryptChunk(key, chunkBuffer);
            })
          );

          // 4. 逐片解密
          const decryptedChunks = await Promise.all(
            encryptedChunks.map(({ iv, ciphertext }) =>
              decryptChunk(key, iv, ciphertext)
            )
          );

          // 5. 重组所有解密后的分片
          const reassembled = reassembleChunks(decryptedChunks);

          // 6. 验证：重组后的数据与原始数据字节完全相同
          expect(reassembled).toEqual(audioData);
        }
      ),
      {
        // 📚 学习要点: numRuns 的选择
        // 加密操作涉及 Web Crypto API 异步调用，每次迭代耗时较长。
        // 50 次迭代在覆盖率和执行时间之间取得平衡：
        // - 覆盖了单 chunk (500B~64KB)、双 chunk (~128KB)、多 chunk (~240KB) 场景
        // - fast-check 的 shrinking 机制确保发现的反例被缩小到最小失败输入
        // - 50 次 × 4 chunks × 2 crypto ops ≈ 400 次 Web Crypto 调用，约 2-5 秒
        numRuns: 50,
      }
    );
  });
});
