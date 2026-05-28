/**
 * @file crypto-compat.test.ts — AES-256-GCM 跨客户端加密兼容性测试
 *
 * 本文件验证 openclaw-channel 插件的加密实现与 Arthas 其他客户端完全兼容：
 * - arthas-client（Web 客户端）：使用 Web Crypto API（SubtleCrypto）
 * - arthas-cli（Go CLI 客户端）：使用 Go crypto/aes + crypto/cipher
 *
 * 📚 学习要点: 跨客户端互操作性验证策略
 * 在多客户端系统中，仅验证单端正确性不够——必须确保所有客户端对相同输入产生相同输出。
 * 策略：使用预计算的固定 Test Vector（固定 key + 固定 IV + 已知明文 → 已知密文），
 * 如果所有客户端都能正确加密/解密这些向量，则证明互操作性成立。
 *
 * 测试向量生成方式：
 * 由于 AES-256-GCM 是确定性算法（给定相同 key + IV + plaintext，输出相同 ciphertext），
 * 我们使用 Node.js crypto 模块生成固定向量。这些向量与 Web Crypto API 和 Go crypto
 * 产生的结果完全一致（因为底层都是 AES-256-GCM 标准实现）。
 *
 * 对应的 Go 端兼容性测试：arthas-cli/internal/crypto/crossclient_test.go
 * 对应的 Web 端加密实现：arthas-client/src/crypto/encrypt.ts
 *
 * Validates: Requirements 2.1, 2.4
 * @module openclaw-channel/tests/crypto-compat
 * @see design.md — D2: 复用 Web Crypto API 加密实现
 */

import { describe, it, expect } from 'vitest';
import { createCipheriv } from 'node:crypto';
import { deriveKey, encrypt, decrypt, toBase64Url, fromBase64Url } from '../src/crypto';

// ============================================================================
// Appendix A: 固定测试向量（Pre-computed Test Vectors）
// ============================================================================

/**
 * 📚 学习要点: 为什么使用固定测试向量？
 * 跨客户端兼容性测试的核心是"传递性证明"：
 * - 如果 Node.js 插件能正确解密固定向量 → 证明与生成该向量的实现兼容
 * - 如果 Node.js 插件加密的结果与固定向量一致 → 证明其他客户端能解密
 * - AES-256-GCM 是确定性的：相同 (key, iv, plaintext) → 相同 (ciphertext, tag)
 *
 * 这些向量可以被复制到 Go 和 Web 客户端的测试中，形成三方互操作性证明。
 */
const TEST_VECTORS = {
  /**
   * 固定 AES-256 密钥（32 字节）。
   * ASCII: "arthas-test-vector-key-32bytes!\0"（末尾补零到 32 字节）
   * Hex: 6172746861732d746573742d766563746f722d6b65792d333262797465732100
   */
  keyHex: '6172746861732d746573742d766563746f722d6b65792d333262797465732100',
  keyBase64url: 'YXJ0aGFzLXRlc3QtdmVjdG9yLWtleS0zMmJ5dGVzIQA',

  /**
   * 固定 IV（12 字节）：0x00 0x01 0x02 ... 0x0B
   * 注意：实际使用中 IV 必须随机生成，这里仅用于测试向量的确定性验证。
   */
  ivHex: '000102030405060708090a0b',
  ivBase64url: 'AAECAwQFBgcICQoL',

  /**
   * 对应的分享码格式（21 字符 roomId + base64url 密钥）。
   * 用于测试 deriveKey() 与加密/解密的端到端流程。
   */
  shareCode: 'abcdefghijklmnopqrstu:YXJ0aGFzLXRlc3QtdmVjdG9yLWtleS0zMmJ5dGVzIQA',

  /**
   * Test Vector 1: 普通 ASCII 文本
   * plaintext: "Hello, Arthas!"
   * ciphertext (含 16 字节 auth tag): base64url 编码
   */
  vector1: {
    plaintext: 'Hello, Arthas!',
    ciphertextBase64url: 'yqYeefSDcrBAPgt_hYBLlePU7zu_PctHZaGobZui',
    ciphertextHex: 'caa61e79f48372b0403e0b7f85804b95e3d4ef3bbf3dcb4765a1a86d9ba2',
  },

  /**
   * Test Vector 2: 空字符串
   * plaintext: ""
   * 📚 学习要点: 空明文加密
   * AES-GCM 可以加密空明文，此时密文长度 = 0 + 16（仅 auth tag）。
   * 这验证了边界情况：即使没有实际数据，认证标签仍然保护消息完整性。
   */
  vector2: {
    plaintext: '',
    ciphertextBase64url: 'E5NibSsnG4S9aopJrpMlMQ',
    ciphertextHex: '1393626d2b271b84bd6a8a49ae932531',
  },

  /**
   * Test Vector 3: Unicode 内容（中文 + emoji）
   * plaintext: "你好世界 🌍"
   * UTF-8 编码后为 17 字节，密文 = 17 + 16 = 33 字节
   */
  vector3: {
    plaintext: '你好世界 🌍',
    ciphertextBase64url: 'Zn7S8D4StkmkrfaS1lFQpS1OrvWzxHKwcktbeyDN289w',
    ciphertextHex: '667ed2f03e12b649a4adf692d65150a52d4eaef5b3c472b0724b5b7b20cddbcf70',
  },
} as const;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 使用固定 IV 加密明文（仅用于测试向量验证）。
 *
 * 📚 学习要点: 为什么需要固定 IV 的加密函数？
 * 正常的 encrypt() 函数使用随机 IV（这是安全要求），
 * 但为了验证跨客户端兼容性，我们需要确定性输出。
 * 此函数仅在测试中使用，生产代码永远不应使用固定 IV。
 *
 * @param plaintext - 待加密明文
 * @param key - 32 字节 AES-256 密钥
 * @param iv - 12 字节固定 IV（仅测试用）
 * @returns 密文 Buffer（含 16 字节 auth tag）
 */
function encryptWithFixedIv(plaintext: string, key: Buffer, iv: Buffer): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([encrypted, authTag]);
}

// ============================================================================
// 跨客户端加密兼容性测试
// ============================================================================

describe('cross-client encryption compatibility (跨客户端加密兼容性)', () => {
  /**
   * 📚 学习要点: 确定性加密验证
   * AES-256-GCM 在给定相同 (key, iv, plaintext) 时，总是产生相同的 (ciphertext, tag)。
   * 这意味着无论使用哪个实现（Node.js crypto、Web Crypto API、Go crypto），
   * 只要参数相同，输出必须字节级一致。
   */
  describe('Test Vector 1: ASCII 文本加密验证', () => {
    const key = Buffer.from(TEST_VECTORS.keyHex, 'hex');
    const iv = Buffer.from(TEST_VECTORS.ivHex, 'hex');

    it('固定 key + 固定 IV + 已知明文 → 密文应与预期完全一致', () => {
      const ciphertext = encryptWithFixedIv(
        TEST_VECTORS.vector1.plaintext,
        key,
        iv
      );

      // 验证密文的 hex 表示与预计算值一致
      expect(ciphertext.toString('hex')).toBe(TEST_VECTORS.vector1.ciphertextHex);

      // 验证 base64url 编码与预计算值一致
      expect(toBase64Url(ciphertext)).toBe(TEST_VECTORS.vector1.ciphertextBase64url);
    });

    it('已知密文 → 解密应产生预期明文（模拟接收 arthas-client 消息）', () => {
      // 模拟从 arthas-client（Web）或 arthas-cli（Go）接收到的加密消息
      const ciphertext = fromBase64Url(TEST_VECTORS.vector1.ciphertextBase64url);
      const ivBuffer = fromBase64Url(TEST_VECTORS.ivBase64url);

      const plaintext = decrypt(ciphertext, ivBuffer, key);
      expect(plaintext).toBe(TEST_VECTORS.vector1.plaintext);
    });
  });

  describe('Test Vector 2: 空字符串加密验证', () => {
    const key = Buffer.from(TEST_VECTORS.keyHex, 'hex');
    const iv = Buffer.from(TEST_VECTORS.ivHex, 'hex');

    it('空明文加密 → 密文应仅包含 16 字节 auth tag', () => {
      const ciphertext = encryptWithFixedIv(
        TEST_VECTORS.vector2.plaintext,
        key,
        iv
      );

      // 空明文 → 密文长度 = 0 + 16（仅 auth tag）
      expect(ciphertext.length).toBe(16);
      expect(ciphertext.toString('hex')).toBe(TEST_VECTORS.vector2.ciphertextHex);
      expect(toBase64Url(ciphertext)).toBe(TEST_VECTORS.vector2.ciphertextBase64url);
    });

    it('空密文解密 → 应返回空字符串', () => {
      const ciphertext = fromBase64Url(TEST_VECTORS.vector2.ciphertextBase64url);
      const ivBuffer = fromBase64Url(TEST_VECTORS.ivBase64url);

      const plaintext = decrypt(ciphertext, ivBuffer, key);
      expect(plaintext).toBe('');
    });
  });

  describe('Test Vector 3: Unicode 内容加密验证', () => {
    const key = Buffer.from(TEST_VECTORS.keyHex, 'hex');
    const iv = Buffer.from(TEST_VECTORS.ivHex, 'hex');

    it('Unicode 明文加密 → 密文应与预期一致', () => {
      const ciphertext = encryptWithFixedIv(
        TEST_VECTORS.vector3.plaintext,
        key,
        iv
      );

      expect(ciphertext.toString('hex')).toBe(TEST_VECTORS.vector3.ciphertextHex);
      expect(toBase64Url(ciphertext)).toBe(TEST_VECTORS.vector3.ciphertextBase64url);
    });

    it('Unicode 密文解密 → 应正确还原中文和 emoji', () => {
      const ciphertext = fromBase64Url(TEST_VECTORS.vector3.ciphertextBase64url);
      const ivBuffer = fromBase64Url(TEST_VECTORS.ivBase64url);

      const plaintext = decrypt(ciphertext, ivBuffer, key);
      expect(plaintext).toBe(TEST_VECTORS.vector3.plaintext);
    });
  });
});

// ============================================================================
// 密文结构验证（Ciphertext Structure Verification）
// ============================================================================

describe('ciphertext structure verification (密文结构验证)', () => {
  /**
   * 📚 学习要点: 密文格式一致性
   * Arthas 所有客户端约定的密文格式：
   * - Web Crypto API: crypto.subtle.encrypt('AES-GCM', ...) 返回 ciphertext || tag
   * - Go: gcm.Seal(nil, nonce, plaintext, nil) 返回 ciphertext || tag
   * - Node.js: cipher.update() + cipher.final() + cipher.getAuthTag() 手动拼接
   *
   * 三者的输出格式必须一致：encrypted_data(N bytes) || auth_tag(16 bytes)
   */
  it('密文长度应为 plaintext UTF-8 字节数 + 16（auth tag）', () => {
    const key = Buffer.from(TEST_VECTORS.keyHex, 'hex');
    const testCases = [
      { plaintext: '', expectedExtra: 16 },
      { plaintext: 'A', expectedExtra: 16 },
      { plaintext: 'Hello, Arthas!', expectedExtra: 16 },
      { plaintext: '你好', expectedExtra: 16 },  // 6 UTF-8 bytes + 16
      { plaintext: '🌍', expectedExtra: 16 },     // 4 UTF-8 bytes + 16
    ];

    for (const { plaintext, expectedExtra } of testCases) {
      const { ciphertext } = encrypt(plaintext, key);
      const plaintextBytes = Buffer.from(plaintext, 'utf8').length;
      expect(ciphertext.length).toBe(plaintextBytes + expectedExtra);
    }
  });

  it('IV 应始终为 12 字节', () => {
    const key = Buffer.from(TEST_VECTORS.keyHex, 'hex');

    // 多次加密，验证 IV 长度一致
    for (let i = 0; i < 10; i++) {
      const { iv } = encrypt(`message ${i}`, key);
      expect(iv.length).toBe(12);
    }
  });

  it('auth tag 应为密文最后 16 字节（可通过解密验证）', () => {
    const key = Buffer.from(TEST_VECTORS.keyHex, 'hex');
    const plaintext = 'verify auth tag position';

    const { ciphertext, iv } = encrypt(plaintext, key);

    // 如果 auth tag 不在最后 16 字节，解密会失败
    const decrypted = decrypt(ciphertext, iv, key);
    expect(decrypted).toBe(plaintext);

    // 验证修改最后 16 字节（auth tag 区域）会导致解密失败
    const tampered = Buffer.from(ciphertext);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => decrypt(tampered, iv, key)).toThrow();
  });
});

// ============================================================================
// Base64URL 编码兼容性测试
// ============================================================================

describe('base64url encoding compatibility (Base64URL 编码兼容性)', () => {
  /**
   * 📚 学习要点: Base64URL 跨平台一致性
   * Arthas 三个客户端使用不同的 Base64URL 实现：
   * - Web: 手动替换 +→- /→_ 并去除 = padding（utils.ts toBase64Url）
   * - Go: base64.RawURLEncoding（标准库，无 padding）
   * - Node.js: Buffer.toString('base64url')（原生支持，无 padding）
   *
   * 三者必须对相同输入产生相同输出，否则消息无法跨客户端解密。
   */
  it('12 字节 IV 的 base64url 编码应与 Go/Web 一致', () => {
    // 固定 IV: 0x00 0x01 ... 0x0B
    const iv = Buffer.from(TEST_VECTORS.ivHex, 'hex');
    const encoded = toBase64Url(iv);

    // 验证与预计算值一致（此值可在 Go 和 Web 端独立验证）
    expect(encoded).toBe(TEST_VECTORS.ivBase64url);

    // 验证不包含标准 Base64 的特殊字符
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('32 字节密钥的 base64url 编码应为 43 字符（无 padding）', () => {
    const key = Buffer.from(TEST_VECTORS.keyHex, 'hex');
    const encoded = toBase64Url(key);

    expect(encoded).toBe(TEST_VECTORS.keyBase64url);
    expect(encoded.length).toBe(43);
    expect(encoded).not.toContain('=');
  });

  it('base64url 编码/解码往返应保持字节一致', () => {
    // 测试各种长度的数据
    const testData = [
      Buffer.from(TEST_VECTORS.ivHex, 'hex'),       // 12 bytes
      Buffer.from(TEST_VECTORS.keyHex, 'hex'),      // 32 bytes
      Buffer.from(TEST_VECTORS.vector1.ciphertextHex, 'hex'), // 30 bytes
    ];

    for (const original of testData) {
      const encoded = toBase64Url(original);
      const decoded = fromBase64Url(encoded);
      expect(decoded).toEqual(original);
    }
  });

  it('fromBase64Url 应正确解码 Go RawURLEncoding 的输出', () => {
    // 模拟 Go 端 base64.RawURLEncoding.EncodeToString() 的输出
    // Go 的 RawURLEncoding 与 Node.js 的 base64url 编码完全一致
    const goEncodedIv = 'AAECAwQFBgcICQoL';
    const goEncodedKey = 'YXJ0aGFzLXRlc3QtdmVjdG9yLWtleS0zMmJ5dGVzIQA';

    const decodedIv = fromBase64Url(goEncodedIv);
    const decodedKey = fromBase64Url(goEncodedKey);

    expect(decodedIv.toString('hex')).toBe(TEST_VECTORS.ivHex);
    expect(decodedKey.toString('hex')).toBe(TEST_VECTORS.keyHex);
  });
});

// ============================================================================
// 端到端分享码兼容性测试
// ============================================================================

describe('share code end-to-end compatibility (分享码端到端兼容性)', () => {
  /**
   * 📚 学习要点: 分享码是跨客户端互操作的入口
   * 用户通过分享码将房间密钥传递给各客户端。
   * 所有客户端必须从相同分享码提取出相同的 AES-256 密钥，
   * 否则加密/解密将不兼容。
   */
  it('deriveKey 从分享码提取的密钥应能解密固定向量', () => {
    // 从分享码提取密钥
    const key = deriveKey(TEST_VECTORS.shareCode);

    // 验证提取的密钥与固定向量中的密钥一致
    expect(key.toString('hex')).toBe(TEST_VECTORS.keyHex);

    // 使用提取的密钥解密 Test Vector 1
    const ciphertext = fromBase64Url(TEST_VECTORS.vector1.ciphertextBase64url);
    const iv = fromBase64Url(TEST_VECTORS.ivBase64url);
    const plaintext = decrypt(ciphertext, iv, key);
    expect(plaintext).toBe(TEST_VECTORS.vector1.plaintext);
  });

  it('本插件加密的消息应能被其他客户端解密（格式验证）', () => {
    // 从分享码提取密钥
    const key = deriveKey(TEST_VECTORS.shareCode);

    // 使用本插件加密一条消息
    const originalText = 'Message from OpenClaw plugin';
    const { ciphertext, iv } = encrypt(originalText, key);

    // 验证密文格式符合 Arthas 协议约定
    // 1. IV 为 12 字节
    expect(iv.length).toBe(12);
    // 2. 密文 = 明文字节数 + 16（auth tag）
    expect(ciphertext.length).toBe(Buffer.from(originalText, 'utf8').length + 16);

    // 3. 可以用 base64url 编码传输（模拟 msgpack 协议中的字符串字段）
    const ivB64 = toBase64Url(iv);
    const ctB64 = toBase64Url(ciphertext);

    // 4. 模拟其他客户端接收：从 base64url 解码后解密
    const receivedIv = fromBase64Url(ivB64);
    const receivedCt = fromBase64Url(ctB64);
    const decrypted = decrypt(receivedCt, receivedIv, key);
    expect(decrypted).toBe(originalText);
  });

  it('分享码含 ephemeral 和 expiresAt 段时密钥提取应一致', () => {
    // 4 段分享码（含 ephemeral=60, expiresAt=1700000000）
    const fullShareCode = `${TEST_VECTORS.shareCode}:60:1700000000`;
    const key = deriveKey(fullShareCode);

    // 密钥应与 2 段分享码提取的一致（额外段不影响密钥）
    expect(key.toString('hex')).toBe(TEST_VECTORS.keyHex);

    // 验证可以解密固定向量
    const ciphertext = fromBase64Url(TEST_VECTORS.vector1.ciphertextBase64url);
    const iv = fromBase64Url(TEST_VECTORS.ivBase64url);
    const plaintext = decrypt(ciphertext, iv, key);
    expect(plaintext).toBe(TEST_VECTORS.vector1.plaintext);
  });
});

// ============================================================================
// 边界测试（Edge Cases）
// ============================================================================

describe('edge cases (边界测试)', () => {
  const key = Buffer.from(TEST_VECTORS.keyHex, 'hex');

  it('单字符消息应正确加密/解密', () => {
    const testChars = ['A', '中', '🌍', '\n', '\0', ' '];

    for (const char of testChars) {
      const { ciphertext, iv } = encrypt(char, key);
      const decrypted = decrypt(ciphertext, iv, key);
      expect(decrypted).toBe(char);
    }
  });

  it('超长消息（10KB）应正确加密/解密', () => {
    // 模拟 AI Agent 的长回复（约 10KB）
    // 每次重复 25 字符，500 次 = 12500 字符（UTF-8 编码后约 30KB+）
    const longMessage = '这是一段很长的 AI 回复内容，包含代码和解释。\n'.repeat(500);
    expect(longMessage.length).toBeGreaterThan(10000);

    const { ciphertext, iv } = encrypt(longMessage, key);
    const decrypted = decrypt(ciphertext, iv, key);
    expect(decrypted).toBe(longMessage);
  });

  it('最大消息长度（接近 4000 字符分割阈值）应正确处理', () => {
    // Arthas 协议中 4000 字符是消息分割阈值
    const nearLimitMessage = 'A'.repeat(3999);
    const { ciphertext, iv } = encrypt(nearLimitMessage, key);
    const decrypted = decrypt(ciphertext, iv, key);
    expect(decrypted).toBe(nearLimitMessage);

    const atLimitMessage = 'B'.repeat(4000);
    const { ciphertext: ct2, iv: iv2 } = encrypt(atLimitMessage, key);
    const decrypted2 = decrypt(ct2, iv2, key);
    expect(decrypted2).toBe(atLimitMessage);
  });

  it('各种 Unicode 内容应正确加密/解密', () => {
    const unicodeTests = [
      // 基本中文
      '你好世界',
      // Emoji（4 字节 UTF-8）
      '🔐🌍💬🤖',
      // 混合内容（模拟真实 AI 对话）
      'User: 请解释 AES-GCM 的工作原理\nAI: AES-GCM（Galois/Counter Mode）是一种 AEAD 算法...',
      // 特殊 Unicode 字符
      'Ñoño café résumé naïve',
      // 零宽字符和组合字符
      'a\u0301 e\u0301',  // á é (combining acute accent)
      // 日文假名
      'こんにちは世界',
      // 韩文
      '안녕하세요',
      // 阿拉伯文（RTL）
      'مرحبا بالعالم',
      // 数学符号
      '∑∏∫∂√∞≈≠≤≥',
      // 包含 null 字节的字符串
      'before\x00after',
    ];

    for (const text of unicodeTests) {
      const { ciphertext, iv } = encrypt(text, key);
      const decrypted = decrypt(ciphertext, iv, key);
      expect(decrypted).toBe(text);
    }
  });

  it('包含 JSON 特殊字符的消息应正确处理', () => {
    // Arthas 协议中消息内容通常是 JSON 字符串
    const jsonContent = JSON.stringify({
      text: 'Hello "world"',
      code: 'const x = 1;\nconst y = 2;',
      special: '<script>alert("xss")</script>',
    });

    const { ciphertext, iv } = encrypt(jsonContent, key);
    const decrypted = decrypt(ciphertext, iv, key);
    expect(decrypted).toBe(jsonContent);
    expect(JSON.parse(decrypted)).toEqual(JSON.parse(jsonContent));
  });

  it('连续加密多条消息应使用不同 IV（语义安全性）', () => {
    const message = 'same message repeated';
    const ivSet = new Set<string>();

    // 加密 100 次相同消息
    for (let i = 0; i < 100; i++) {
      const { iv } = encrypt(message, key);
      ivSet.add(iv.toString('hex'));
    }

    // 所有 IV 应该唯一（随机生成，碰撞概率极低）
    expect(ivSet.size).toBe(100);
  });
});
