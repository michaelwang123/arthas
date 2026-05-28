/**
 * @file signing.test.ts — Ed25519 数字签名模块单元测试
 *
 * 测试覆盖：
 * 1. 密钥对生成（有效 Ed25519 密钥尺寸）
 * 2. 签名 + 验证往返测试（roundtrip）
 * 3. 使用错误密钥验证签名应失败
 * 4. 篡改消息后验证签名应失败
 * 5. 公钥广播消息格式化与解析
 * 6. 内存清零功能
 *
 * @module openclaw-channel/tests/signing
 * @see requirements.md — Requirement 2.5, 2.6
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  generateSigningKeyPair,
  signMessage,
  verifySignature,
  formatPublicKeyMessage,
  parsePublicKeyMessage,
  zeroKeyPair,
} from '../src/signing';

// ============================================================================
// 密钥对生成测试
// ============================================================================

describe('generateSigningKeyPair', () => {
  it('应生成 32 字节公钥', () => {
    const keyPair = generateSigningKeyPair();
    expect(keyPair.publicKey.length).toBe(32);
  });

  it('应生成 32 字节私钥 seed', () => {
    const keyPair = generateSigningKeyPair();
    expect(keyPair.privateKey.length).toBe(32);
  });

  it('每次调用应生成不同的密钥对', () => {
    const keyPair1 = generateSigningKeyPair();
    const keyPair2 = generateSigningKeyPair();

    expect(keyPair1.publicKey).not.toEqual(keyPair2.publicKey);
    expect(keyPair1.privateKey).not.toEqual(keyPair2.privateKey);
  });

  it('公钥和私钥应为 Buffer 类型', () => {
    const keyPair = generateSigningKeyPair();
    expect(Buffer.isBuffer(keyPair.publicKey)).toBe(true);
    expect(Buffer.isBuffer(keyPair.privateKey)).toBe(true);
  });
});

// ============================================================================
// 签名 + 验证往返测试
// ============================================================================

describe('signMessage + verifySignature roundtrip', () => {
  it('应正确签名并验证普通文本', () => {
    const keyPair = generateSigningKeyPair();
    const message = 'Hello, Arthas!';

    const signature = signMessage(message, keyPair.privateKey);
    const isValid = verifySignature(message, signature, keyPair.publicKey);

    expect(isValid).toBe(true);
  });

  it('签名应为 64 字节', () => {
    const keyPair = generateSigningKeyPair();
    const signature = signMessage('test message', keyPair.privateKey);

    expect(signature.length).toBe(64);
  });

  it('应正确签名并验证空字符串', () => {
    const keyPair = generateSigningKeyPair();
    const message = '';

    const signature = signMessage(message, keyPair.privateKey);
    const isValid = verifySignature(message, signature, keyPair.publicKey);

    expect(isValid).toBe(true);
  });

  it('应正确签名并验证 Unicode 内容（中文、emoji）', () => {
    const keyPair = generateSigningKeyPair();
    const message = '你好世界 🌍🔐 — "端到端加密" 的 AI 对话';

    const signature = signMessage(message, keyPair.privateKey);
    const isValid = verifySignature(message, signature, keyPair.publicKey);

    expect(isValid).toBe(true);
  });

  it('应正确签名并验证长文本', () => {
    const keyPair = generateSigningKeyPair();
    const message = '这是一段很长的文本。'.repeat(500);

    const signature = signMessage(message, keyPair.privateKey);
    const isValid = verifySignature(message, signature, keyPair.publicKey);

    expect(isValid).toBe(true);
  });

  it('Ed25519 签名应是确定性的（相同输入产生相同签名）', () => {
    const keyPair = generateSigningKeyPair();
    const message = 'deterministic signing test';

    const signature1 = signMessage(message, keyPair.privateKey);
    const signature2 = signMessage(message, keyPair.privateKey);

    expect(signature1).toEqual(signature2);
  });
});

// ============================================================================
// 签名验证失败测试（使用错误密钥）
// ============================================================================

describe('signature verification with wrong key', () => {
  it('使用不同密钥对的公钥验证应失败', () => {
    const keyPair1 = generateSigningKeyPair();
    const keyPair2 = generateSigningKeyPair();
    const message = 'signed by keyPair1';

    const signature = signMessage(message, keyPair1.privateKey);
    const isValid = verifySignature(message, signature, keyPair2.publicKey);

    expect(isValid).toBe(false);
  });

  it('使用随机字节作为公钥验证应失败（不崩溃）', () => {
    const keyPair = generateSigningKeyPair();
    const message = 'test message';
    const fakePublicKey = randomBytes(32);

    const signature = signMessage(message, keyPair.privateKey);
    const isValid = verifySignature(message, signature, fakePublicKey);

    expect(isValid).toBe(false);
  });

  it('公钥长度不正确应返回 false', () => {
    const keyPair = generateSigningKeyPair();
    const message = 'test';
    const signature = signMessage(message, keyPair.privateKey);

    // 公钥太短
    const shortKey = randomBytes(16);
    expect(verifySignature(message, signature, shortKey)).toBe(false);

    // 公钥太长
    const longKey = randomBytes(64);
    expect(verifySignature(message, signature, longKey)).toBe(false);
  });
});

// ============================================================================
// 签名验证失败测试（篡改消息）
// ============================================================================

describe('signature verification with tampered message', () => {
  it('修改消息内容后签名验证应失败', () => {
    const keyPair = generateSigningKeyPair();
    const originalMessage = 'original message';
    const tamperedMessage = 'tampered message';

    const signature = signMessage(originalMessage, keyPair.privateKey);
    const isValid = verifySignature(tamperedMessage, signature, keyPair.publicKey);

    expect(isValid).toBe(false);
  });

  it('在消息末尾添加字符后签名验证应失败', () => {
    const keyPair = generateSigningKeyPair();
    const message = 'hello';

    const signature = signMessage(message, keyPair.privateKey);
    const isValid = verifySignature(message + ' ', signature, keyPair.publicKey);

    expect(isValid).toBe(false);
  });

  it('篡改签名字节后验证应失败', () => {
    const keyPair = generateSigningKeyPair();
    const message = 'test message';

    const signature = signMessage(message, keyPair.privateKey);
    const tampered = Buffer.from(signature);
    tampered[0] = tampered[0]! ^ 0xff;

    const isValid = verifySignature(message, tampered, keyPair.publicKey);
    expect(isValid).toBe(false);
  });

  it('签名长度不正确应返回 false', () => {
    const keyPair = generateSigningKeyPair();
    const message = 'test';

    // 签名太短
    const shortSig = randomBytes(32);
    expect(verifySignature(message, shortSig, keyPair.publicKey)).toBe(false);

    // 签名太长
    const longSig = randomBytes(128);
    expect(verifySignature(message, longSig, keyPair.publicKey)).toBe(false);
  });
});

// ============================================================================
// 公钥广播消息测试
// ============================================================================

describe('formatPublicKeyMessage / parsePublicKeyMessage', () => {
  it('应正确格式化公钥广播消息', () => {
    const keyPair = generateSigningKeyPair();
    const message = formatPublicKeyMessage(keyPair.publicKey);

    expect(message.startsWith('[PUBLIC_KEY]')).toBe(true);
    // 32 字节 base64url 编码 = 43 字符
    expect(message.length).toBe('[PUBLIC_KEY]'.length + 43);
  });

  it('应正确解析公钥广播消息（往返测试）', () => {
    const keyPair = generateSigningKeyPair();
    const message = formatPublicKeyMessage(keyPair.publicKey);

    const parsed = parsePublicKeyMessage(message);

    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(keyPair.publicKey);
  });

  it('非公钥消息应返回 null', () => {
    expect(parsePublicKeyMessage('Hello, World!')).toBeNull();
    expect(parsePublicKeyMessage('')).toBeNull();
    expect(parsePublicKeyMessage('[PUBLIC_KEY')).toBeNull();
  });

  it('公钥长度不正确的广播消息应返回 null', () => {
    // 构造一个前缀正确但公钥长度错误的消息
    const shortKey = randomBytes(16).toString('base64url');
    const message = `[PUBLIC_KEY]${shortKey}`;

    expect(parsePublicKeyMessage(message)).toBeNull();
  });

  it('解析出的公钥应可用于签名验证', () => {
    const keyPair = generateSigningKeyPair();
    const broadcastMsg = formatPublicKeyMessage(keyPair.publicKey);

    // 模拟接收方解析公钥
    const receivedPublicKey = parsePublicKeyMessage(broadcastMsg);
    expect(receivedPublicKey).not.toBeNull();

    // 使用解析出的公钥验证签名
    const testMessage = 'verify with parsed key';
    const signature = signMessage(testMessage, keyPair.privateKey);
    const isValid = verifySignature(testMessage, signature, receivedPublicKey!);

    expect(isValid).toBe(true);
  });
});

// ============================================================================
// 内存清零测试
// ============================================================================

describe('zeroKeyPair', () => {
  it('应将私钥和公钥内存清零', () => {
    const keyPair = generateSigningKeyPair();

    // 确认密钥非零
    expect(keyPair.privateKey.some((b) => b !== 0)).toBe(true);
    expect(keyPair.publicKey.some((b) => b !== 0)).toBe(true);

    // 清零
    zeroKeyPair(keyPair);

    // 验证全部为零
    const allZeroPrivate = keyPair.privateKey.every((b) => b === 0);
    const allZeroPublic = keyPair.publicKey.every((b) => b === 0);
    expect(allZeroPrivate).toBe(true);
    expect(allZeroPublic).toBe(true);
  });
});
