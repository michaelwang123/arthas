/**
 * Unit tests for chunk-level encryption and decryption.
 * 验证 encryptChunk 和 decryptChunk 的基本功能正确性。
 */

import { encryptChunk } from './encryptChunk';
import { decryptChunk } from './decryptChunk';

/**
 * 辅助函数：生成 AES-256-GCM 测试密钥
 */
async function generateTestKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

describe('encryptChunk', () => {
  it('should return iv of 12 bytes and ciphertext of plaintext.length + 16 bytes', async () => {
    const key = await generateTestKey();
    const plaintext = new Uint8Array(1024); // 1KB chunk
    crypto.getRandomValues(plaintext);

    const { iv, ciphertext } = await encryptChunk(key, plaintext.buffer as ArrayBuffer);

    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.length).toBe(12);
    expect(ciphertext).toBeInstanceOf(Uint8Array);
    expect(ciphertext.length).toBe(1024 + 16); // plaintext + GCM auth tag
  });

  it('should produce different IVs for each call (random IV)', async () => {
    const key = await generateTestKey();
    const plaintext = new Uint8Array(64).buffer as ArrayBuffer;

    const result1 = await encryptChunk(key, plaintext);
    const result2 = await encryptChunk(key, plaintext);

    // IVs should be different (random)
    const ivsEqual = result1.iv.every((byte, i) => byte === result2.iv[i]);
    expect(ivsEqual).toBe(false);
  });

  it('should produce different ciphertexts for same plaintext (due to random IV)', async () => {
    const key = await generateTestKey();
    const plaintext = new Uint8Array(64).buffer as ArrayBuffer;

    const result1 = await encryptChunk(key, plaintext);
    const result2 = await encryptChunk(key, plaintext);

    // Ciphertexts should differ due to different IVs
    const ciphertextsEqual = result1.ciphertext.every(
      (byte, i) => byte === result2.ciphertext[i]
    );
    expect(ciphertextsEqual).toBe(false);
  });

  it('should handle empty chunk (0 bytes)', async () => {
    const key = await generateTestKey();
    const emptyChunk = new ArrayBuffer(0);

    const { iv, ciphertext } = await encryptChunk(key, emptyChunk);

    expect(iv.length).toBe(12);
    expect(ciphertext.length).toBe(16); // only GCM auth tag, no plaintext
  });

  it('should handle max chunk size (65536 bytes)', async () => {
    const key = await generateTestKey();
    const maxChunk = new Uint8Array(65536);
    crypto.getRandomValues(maxChunk);

    const { iv, ciphertext } = await encryptChunk(key, maxChunk.buffer as ArrayBuffer);

    expect(iv.length).toBe(12);
    expect(ciphertext.length).toBe(65536 + 16);
  });
});

describe('decryptChunk', () => {
  it('should decrypt ciphertext back to original plaintext (round-trip)', async () => {
    const key = await generateTestKey();
    const original = new Uint8Array(1024);
    crypto.getRandomValues(original);

    const { iv, ciphertext } = await encryptChunk(key, original.buffer as ArrayBuffer);
    const decrypted = await decryptChunk(key, iv, ciphertext);

    const decryptedBytes = new Uint8Array(decrypted);
    expect(decryptedBytes).toEqual(original);
  });

  it('should throw on wrong key', async () => {
    const encryptKey = await generateTestKey();
    const wrongKey = await generateTestKey();
    const plaintext = new Uint8Array(64);
    crypto.getRandomValues(plaintext);

    const { iv, ciphertext } = await encryptChunk(encryptKey, plaintext.buffer as ArrayBuffer);

    await expect(decryptChunk(wrongKey, iv, ciphertext)).rejects.toThrow();
  });

  it('should throw on tampered ciphertext', async () => {
    const key = await generateTestKey();
    const plaintext = new Uint8Array(64);
    crypto.getRandomValues(plaintext);

    const { iv, ciphertext } = await encryptChunk(key, plaintext.buffer as ArrayBuffer);

    // Tamper with ciphertext (flip a bit)
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xff;

    await expect(decryptChunk(key, iv, tampered)).rejects.toThrow();
  });

  it('should throw on wrong IV', async () => {
    const key = await generateTestKey();
    const plaintext = new Uint8Array(64);
    crypto.getRandomValues(plaintext);

    const { ciphertext } = await encryptChunk(key, plaintext.buffer as ArrayBuffer);

    // Use a different random IV
    const wrongIv = crypto.getRandomValues(new Uint8Array(12));

    await expect(decryptChunk(key, wrongIv, ciphertext)).rejects.toThrow();
  });

  it('should handle empty chunk round-trip', async () => {
    const key = await generateTestKey();
    const emptyChunk = new ArrayBuffer(0);

    const { iv, ciphertext } = await encryptChunk(key, emptyChunk);
    const decrypted = await decryptChunk(key, iv, ciphertext);

    expect(decrypted.byteLength).toBe(0);
  });

  it('should handle max chunk size round-trip (65536 bytes)', async () => {
    const key = await generateTestKey();
    const maxChunk = new Uint8Array(65536);
    crypto.getRandomValues(maxChunk);

    const { iv, ciphertext } = await encryptChunk(key, maxChunk.buffer as ArrayBuffer);
    const decrypted = await decryptChunk(key, iv, ciphertext);

    const decryptedBytes = new Uint8Array(decrypted);
    expect(decryptedBytes).toEqual(maxChunk);
  });
});
