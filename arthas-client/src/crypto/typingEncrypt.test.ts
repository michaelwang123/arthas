/**
 * Typing 状态加密/解密 单元测试。
 *
 * 📚 学习要点: 为什么需要测试 IV 随机性？
 * AES-GCM 的安全性依赖于每次加密使用唯一的 IV（初始化向量）。
 * 如果两次加密使用相同的 IV 和密钥，攻击者可以通过 XOR 两个密文来推导明文关系。
 * 因此我们必须验证：即使加密相同的明文，每次产生的密文也不同（因为 IV 不同）。
 *
 * Validates: Requirements 1.1, 1.2, 1.5
 */

import { describe, it, expect } from 'vitest';
import { encryptTypingStatus, decryptTypingStatus } from './typingEncrypt';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: 生成 AES-256-GCM 测试密钥
// ─────────────────────────────────────────────────────────────────────────────

async function generateTestKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 加密/解密 round-trip 测试
// ─────────────────────────────────────────────────────────────────────────────

describe('encryptTypingStatus / decryptTypingStatus — round-trip', () => {
  it('encrypt true → decrypt → returns true', async () => {
    const key = await generateTestKey();
    const { iv, ciphertext } = await encryptTypingStatus(key, true);
    const result = await decryptTypingStatus(key, iv, ciphertext);
    expect(result).toBe(true);
  });

  it('encrypt false → decrypt → returns false', async () => {
    const key = await generateTestKey();
    const { iv, ciphertext } = await encryptTypingStatus(key, false);
    const result = await decryptTypingStatus(key, iv, ciphertext);
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IV 随机性测试 — 相同明文产生不同密文
// ─────────────────────────────────────────────────────────────────────────────

describe('encryptTypingStatus — IV randomness', () => {
  it('two encryptions of same value produce different ciphertexts', async () => {
    const key = await generateTestKey();

    const result1 = await encryptTypingStatus(key, true);
    const result2 = await encryptTypingStatus(key, true);

    // IV 应该不同（96-bit 随机值碰撞概率极低）
    expect(result1.iv).not.toBe(result2.iv);
    // 由于 IV 不同，密文也应该不同
    expect(result1.ciphertext).not.toBe(result2.ciphertext);
  });

  it('two encryptions of false also produce different ciphertexts', async () => {
    const key = await generateTestKey();

    const result1 = await encryptTypingStatus(key, false);
    const result2 = await encryptTypingStatus(key, false);

    expect(result1.iv).not.toBe(result2.iv);
    expect(result1.ciphertext).not.toBe(result2.ciphertext);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 错误处理 — 错误密钥解密失败
// ─────────────────────────────────────────────────────────────────────────────

describe('decryptTypingStatus — wrong key', () => {
  it('decryption with wrong key throws error', async () => {
    const correctKey = await generateTestKey();
    const wrongKey = await generateTestKey();

    const { iv, ciphertext } = await encryptTypingStatus(correctKey, true);

    await expect(
      decryptTypingStatus(wrongKey, iv, ciphertext)
    ).rejects.toThrow();
  });
});
