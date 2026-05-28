/**
 * @file crypto.test.ts — AES-256-GCM 加密引擎单元测试
 *
 * 测试覆盖：
 * 1. encrypt → decrypt 往返测试（roundtrip）
 * 2. 不同 IV 产生不同密文（语义安全性）
 * 3. 篡改密文导致解密失败（完整性验证）
 * 4. deriveKey 从分享码正确提取密钥
 * 5. 空字符串加密/解密
 * 6. Unicode 内容加密/解密
 *
 * @module openclaw-channel/tests/crypto
 * @see requirements.md — Requirement 2.1, 2.2, 2.3
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { deriveKey, encrypt, decrypt, toBase64Url, fromBase64Url } from '../src/crypto';

// ============================================================================
// 测试辅助工具
// ============================================================================

/**
 * 生成一个有效的测试用分享码。
 *
 * 格式：{21 字符 roomId}:{43 字符 base64url 密钥}
 * roomId 使用 NanoID 字符集（A-Za-z0-9_-）的前 21 字符模拟。
 */
function makeShareCode(key?: Buffer): string {
  const roomId = 'abcdefghijklmnopqrstu'; // 21 字符
  const keyBuffer = key ?? randomBytes(32);
  const keyEncoded = keyBuffer.toString('base64url');
  return `${roomId}:${keyEncoded}`;
}

/**
 * 生成一个有效的 32 字节测试密钥。
 */
function makeKey(): Buffer {
  return randomBytes(32);
}

// ============================================================================
// deriveKey 测试
// ============================================================================

describe('deriveKey', () => {
  it('应从 2 段分享码中正确提取 32 字节密钥', () => {
    // 准备一个已知密钥
    const originalKey = randomBytes(32);
    const shareCode = makeShareCode(originalKey);

    // 提取密钥
    const derivedKey = deriveKey(shareCode);

    // 验证密钥一致
    expect(derivedKey).toEqual(originalKey);
    expect(derivedKey.length).toBe(32);
  });

  it('应从 3 段分享码中正确提取密钥（含 ephemeral）', () => {
    const originalKey = randomBytes(32);
    const roomId = 'abcdefghijklmnopqrstu';
    const keyEncoded = originalKey.toString('base64url');
    const shareCode = `${roomId}:${keyEncoded}:30`;

    const derivedKey = deriveKey(shareCode);
    expect(derivedKey).toEqual(originalKey);
  });

  it('应从 4 段分享码中正确提取密钥（含 ephemeral + expiresAt）', () => {
    const originalKey = randomBytes(32);
    const roomId = 'abcdefghijklmnopqrstu';
    const keyEncoded = originalKey.toString('base64url');
    const shareCode = `${roomId}:${keyEncoded}:60:1700000000`;

    const derivedKey = deriveKey(shareCode);
    expect(derivedKey).toEqual(originalKey);
  });

  it('应拒绝段数不足的分享码', () => {
    expect(() => deriveKey('onlyone')).toThrow('Invalid share code');
  });

  it('应拒绝段数过多的分享码', () => {
    expect(() => deriveKey('a:b:c:d:e')).toThrow('Invalid share code');
  });

  it('应拒绝 roomId 长度不正确的分享码', () => {
    const keyEncoded = randomBytes(32).toString('base64url');
    expect(() => deriveKey(`short:${keyEncoded}`)).toThrow('room ID must be 21 characters');
  });

  it('应拒绝密钥段长度不正确的分享码', () => {
    expect(() => deriveKey('abcdefghijklmnopqrstu:shortkey')).toThrow(
      'key segment must be 43 characters'
    );
  });
});

// ============================================================================
// encrypt + decrypt 往返测试
// ============================================================================

describe('encrypt / decrypt roundtrip', () => {
  it('应正确加密并解密普通文本', () => {
    const key = makeKey();
    const plaintext = 'Hello, Arthas!';

    const { ciphertext, iv } = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, iv, key);

    expect(decrypted).toBe(plaintext);
  });

  it('应正确加密并解密空字符串', () => {
    const key = makeKey();
    const plaintext = '';

    const { ciphertext, iv } = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, iv, key);

    expect(decrypted).toBe(plaintext);
  });

  it('应正确加密并解密 Unicode 内容（中文、emoji、特殊字符）', () => {
    const key = makeKey();
    const plaintext = '你好世界 🌍🔐 — "端到端加密" 的 AI 对话 ñ ü ö';

    const { ciphertext, iv } = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, iv, key);

    expect(decrypted).toBe(plaintext);
  });

  it('应正确加密并解密多行文本', () => {
    const key = makeKey();
    const plaintext = '第一行\n第二行\n第三行\n\n空行之后';

    const { ciphertext, iv } = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, iv, key);

    expect(decrypted).toBe(plaintext);
  });

  it('应正确加密并解密长文本（超过 4000 字符）', () => {
    const key = makeKey();
    const plaintext = '这是一段很长的文本。'.repeat(500); // ~5000 字符

    const { ciphertext, iv } = encrypt(plaintext, key);
    const decrypted = decrypt(ciphertext, iv, key);

    expect(decrypted).toBe(plaintext);
  });
});

// ============================================================================
// 语义安全性测试
// ============================================================================

describe('semantic security', () => {
  it('相同明文使用不同 IV 应产生不同密文', () => {
    const key = makeKey();
    const plaintext = 'same message';

    const result1 = encrypt(plaintext, key);
    const result2 = encrypt(plaintext, key);

    // IV 应该不同（随机生成）
    expect(result1.iv).not.toEqual(result2.iv);

    // 密文也应该不同（因为 IV 不同）
    expect(result1.ciphertext).not.toEqual(result2.ciphertext);
  });

  it('IV 应为 12 字节', () => {
    const key = makeKey();
    const { iv } = encrypt('test', key);
    expect(iv.length).toBe(12);
  });

  it('密文长度应为明文 UTF-8 字节长度 + 16（auth tag）', () => {
    const key = makeKey();
    const plaintext = 'Hello!';
    const plaintextBytes = Buffer.from(plaintext, 'utf8').length;

    const { ciphertext } = encrypt(plaintext, key);

    // AES-GCM 密文长度 = 明文长度 + 16 字节 auth tag
    expect(ciphertext.length).toBe(plaintextBytes + 16);
  });
});

// ============================================================================
// 完整性验证测试（篡改检测）
// ============================================================================

describe('integrity verification', () => {
  it('篡改密文应导致解密失败', () => {
    const key = makeKey();
    const { ciphertext, iv } = encrypt('secret message', key);

    // 篡改密文中间的一个字节
    const tampered = Buffer.from(ciphertext);
    tampered[0] = tampered[0]! ^ 0xff;

    expect(() => decrypt(tampered, iv, key)).toThrow();
  });

  it('篡改 auth tag 应导致解密失败', () => {
    const key = makeKey();
    const { ciphertext, iv } = encrypt('secret message', key);

    // 篡改最后一个字节（auth tag 区域）
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;

    expect(() => decrypt(tampered, iv, key)).toThrow();
  });

  it('使用错误密钥应导致解密失败', () => {
    const key1 = makeKey();
    const key2 = makeKey();
    const { ciphertext, iv } = encrypt('secret message', key1);

    expect(() => decrypt(ciphertext, iv, key2)).toThrow();
  });

  it('使用错误 IV 应导致解密失败', () => {
    const key = makeKey();
    const { ciphertext } = encrypt('secret message', key);
    const wrongIv = randomBytes(12);

    expect(() => decrypt(ciphertext, wrongIv, key)).toThrow();
  });

  it('密文过短（小于 16 字节）应抛出明确错误', () => {
    const key = makeKey();
    const iv = randomBytes(12);
    const shortCiphertext = Buffer.alloc(10);

    expect(() => decrypt(shortCiphertext, iv, key)).toThrow('too short');
  });
});

// ============================================================================
// Base64URL 工具函数测试
// ============================================================================

describe('toBase64Url / fromBase64Url', () => {
  it('应正确编码和解码往返', () => {
    const original = randomBytes(32);
    const encoded = toBase64Url(original);
    const decoded = fromBase64Url(encoded);

    expect(decoded).toEqual(original);
  });

  it('编码结果不应包含 +、/ 或 = 字符', () => {
    // 使用包含会产生 +/= 的字节序列进行多次测试
    for (let i = 0; i < 20; i++) {
      const data = randomBytes(32);
      const encoded = toBase64Url(data);

      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');
    }
  });

  it('32 字节密钥编码后应为 43 字符', () => {
    const key = randomBytes(32);
    const encoded = toBase64Url(key);
    expect(encoded.length).toBe(43);
  });
});

// ============================================================================
// 跨客户端兼容性测试
// ============================================================================

describe('cross-client compatibility', () => {
  it('密文格式应与 Web 客户端兼容（ciphertext || authTag）', () => {
    const key = makeKey();
    const plaintext = 'cross-client test';

    const { ciphertext, iv } = encrypt(plaintext, key);

    // 验证密文结构：encrypted_data(N bytes) || auth_tag(16 bytes)
    // 总长度 = UTF-8 明文字节数 + 16
    const plaintextBytes = Buffer.from(plaintext, 'utf8').length;
    expect(ciphertext.length).toBe(plaintextBytes + 16);

    // 验证可以用 base64url 编码传输（模拟 Arthas 协议）
    const ivB64 = toBase64Url(iv);
    const ciphertextB64 = toBase64Url(ciphertext);

    // 验证可以从 base64url 解码回来并解密
    const ivDecoded = fromBase64Url(ivB64);
    const ciphertextDecoded = fromBase64Url(ciphertextB64);

    const decrypted = decrypt(ciphertextDecoded, ivDecoded, key);
    expect(decrypted).toBe(plaintext);
  });

  it('deriveKey 提取的密钥应与 base64url 编码/解码一致', () => {
    // 模拟 Web 客户端生成的分享码
    const originalKey = randomBytes(32);
    const roomId = 'ABCDEFGHIJKLMNOPQRSTU'; // 21 字符
    const keyB64 = originalKey.toString('base64url');
    const shareCode = `${roomId}:${keyB64}`;

    // 验证 deriveKey 提取的密钥与原始密钥一致
    const derived = deriveKey(shareCode);
    expect(derived).toEqual(originalKey);

    // 验证可以用此密钥加密/解密
    const { ciphertext, iv } = encrypt('test', derived);
    const decrypted = decrypt(ciphertext, iv, derived);
    expect(decrypted).toBe('test');
  });
});
