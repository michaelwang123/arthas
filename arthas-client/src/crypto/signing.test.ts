/**
 * Ed25519 签名模块单元测试 — 使用 Appendix A Test Vector 验证。
 *
 * 📚 学习要点: 为什么使用固定 Test Vector？
 * Ed25519 是确定性签名算法（相同 seed + 相同消息 → 相同签名），
 * 因此可以使用固定输入/输出向量验证实现的正确性。
 * 这些向量在 Web 和 CLI 两端共享，确保跨客户端互操作性。
 *
 * 测试覆盖：
 * 1. 固定 seed → 固定 public key 派生
 * 2. 固定 signable bytes → 固定 signature
 * 3. 正确公钥验证 → true
 * 4. 修改 signable bytes 后验证 → false
 *
 * Validates: Requirements 2.1, 2.4, 2.5
 */

import { describe, it, expect } from 'vitest';
import { signPayload, verifySignature, importVerifyKey } from './signing';

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * 将 hex 字符串转换为 Uint8Array。
 * @param hex - 偶数长度的十六进制字符串
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ─── Appendix A Test Vector ──────────────────────────────────────────────────

/**
 * 📚 学习要点: PKCS8 DER 格式导入 Ed25519 seed
 *
 * Web Crypto API 不支持直接导入 Ed25519 raw seed，
 * 需要包装为 PKCS8 DER 格式：16 字节固定前缀 + 32 字节 seed。
 * 前缀编码了 ASN.1 结构：SEQUENCE { version, algorithm OID (Ed25519), OCTET STRING { seed } }
 */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
  0x04, 0x22, 0x04, 0x20,
]);

const TEST_VECTOR = {
  seed: '746573742d736565642d666f722d6172746861732d766563746f727321212121',
  publicKeyHex:
    '3f23c13782fe6b1341fcd51844ecbc4de9e3af1cdf3a1f5599e8f1ad38340618',
  publicKeyBase64url: 'PyPBN4L-axNB_NUYROy8TenjrxzfOh9VmejxrTg0Bhg',
  signableBytesHex: '7b2274657874223a2248656c6c6f227d',
  signatureHex:
    '072335f25bc666c64dc8ae69e005ab8beac57cbe082a51077d43fdf1f4eb969bfbbc32c05f017fae68a0c9d84404b49c276ba35b872f88ade0e4a64a16c4b308',
  signatureBase64url:
    'ByM18lvGZsZNyK5p4AWri-rFfL4IKlEHfUP98fTrlpv7vDLAXwF_rmigydhEBLScJ2ujW4cviK3g5KZKFsSzCA',
};

// ─── Helper: Import private key from seed ────────────────────────────────────

/**
 * 从 32 字节 seed 导入 Ed25519 私钥（用于测试）。
 * 生产代码使用 generateKey 生成随机密钥对，不需要此函数。
 */
async function importPrivateKeyFromSeed(
  seedHex: string
): Promise<CryptoKey> {
  const seedBytes = hexToBytes(seedHex);
  const pkcs8 = new Uint8Array([...PKCS8_ED25519_PREFIX, ...seedBytes]);
  return crypto.subtle.importKey('pkcs8', pkcs8, 'Ed25519', false, ['sign']);
}

/**
 * 从 seed 派生公钥：导入私钥 → 签名一个空消息来获取公钥不可行，
 * 所以我们导入私钥为 extractable，然后通过 PKCS8 导出获取公钥。
 * 实际上更简单的方式是：导入 seed 为 keypair 然后导出公钥。
 *
 * Web Crypto 不直接支持从 seed 导出公钥，
 * 但我们可以用 importKey('pkcs8') 导入后，
 * 无法直接 exportKey('raw') 获取公钥（raw export 只对公钥有效）。
 *
 * 替代方案：使用 extractable=true 导入，然后通过 PKCS8 导出解析公钥。
 * 但更简单的方式是：直接用已知的 public key hex 来 import 公钥进行验证。
 */

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Ed25519 Signing — Appendix A Test Vector', () => {
  it('should derive the correct public key from the fixed seed', async () => {
    // Import seed as PKCS8 private key
    const seedBytes = hexToBytes(TEST_VECTOR.seed);
    const pkcs8 = new Uint8Array([...PKCS8_ED25519_PREFIX, ...seedBytes]);

    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      'Ed25519',
      false,
      ['sign']
    );

    // Sign a known message and verify with the expected public key.
    // If verification passes, the seed → public key derivation is correct.
    const signableBytes = hexToBytes(TEST_VECTOR.signableBytesHex);
    const signatureBase64url = await signPayload(privateKey, signableBytes);

    // Import the expected public key and verify
    const expectedPubKeyBytes = hexToBytes(TEST_VECTOR.publicKeyHex);
    const publicKey = await importVerifyKey(expectedPubKeyBytes);
    const isValid = await verifySignature(
      publicKey,
      signableBytes,
      signatureBase64url
    );

    // If the signature produced by our seed verifies against the expected public key,
    // then the seed correctly derives to that public key.
    expect(isValid).toBe(true);

    // Additionally verify the signature matches the expected value (deterministic)
    expect(signatureBase64url).toBe(TEST_VECTOR.signatureBase64url);
  });

  it('should produce the expected signature for fixed signable bytes', async () => {
    const privateKey = await importPrivateKeyFromSeed(TEST_VECTOR.seed);
    const signableBytes = hexToBytes(TEST_VECTOR.signableBytesHex);

    const signatureBase64url = await signPayload(privateKey, signableBytes);

    expect(signatureBase64url).toBe(TEST_VECTOR.signatureBase64url);
  });

  it('should verify the signature with the correct public key', async () => {
    const publicKeyBytes = hexToBytes(TEST_VECTOR.publicKeyHex);
    const publicKey = await importVerifyKey(publicKeyBytes);
    const signableBytes = hexToBytes(TEST_VECTOR.signableBytesHex);

    const isValid = await verifySignature(
      publicKey,
      signableBytes,
      TEST_VECTOR.signatureBase64url
    );

    expect(isValid).toBe(true);
  });

  it('should fail verification when signable bytes are modified', async () => {
    const publicKeyBytes = hexToBytes(TEST_VECTOR.publicKeyHex);
    const publicKey = await importVerifyKey(publicKeyBytes);
    const signableBytes = hexToBytes(TEST_VECTOR.signableBytesHex);

    // Flip one byte (first byte) to simulate tampering
    const modifiedBytes = new Uint8Array(signableBytes);
    modifiedBytes[0] ^= 0xff;

    const isValid = await verifySignature(
      publicKey,
      modifiedBytes,
      TEST_VECTOR.signatureBase64url
    );

    expect(isValid).toBe(false);
  });
});
