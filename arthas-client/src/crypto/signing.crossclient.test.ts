/**
 * 跨客户端签名互操作性集成测试 — Web Crypto Ed25519
 *
 * 本文件验证 Web 客户端的 Ed25519 签名实现与 Go CLI 客户端产生完全相同的密码学输出。
 * 使用 Appendix A 固定 Test Vector：相同 seed → 相同公钥 → 相同签名。
 *
 * 📚 学习要点: 跨客户端互操作性验证策略
 * 在多客户端系统中，仅验证单端正确性不够——必须确保两端对相同输入产生相同输出。
 * 策略：在两端测试中硬编码相同的 Test Vector（seed、公钥、签名），
 * 如果两端都通过，则证明互操作性成立（传递性证明）。
 *
 * 架构角色：
 * - 本文件是 Web 端的互操作性证明
 * - 对应的 CLI 端测试：internal/crypto/crossclient_test.go
 * - 两个文件使用完全相同的 Test Vector，独立验证各自实现
 *
 * Validates: Requirement 7.6 (cross-client integration test)
 * Requirements: 7.1, 7.2, 7.6
 */

import { describe, it, expect } from 'vitest';
import { signPayload, verifySignature, importVerifyKey } from './signing';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * 将 hex 字符串转换为 Uint8Array。
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * 将 Uint8Array 转换为 hex 字符串。
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Appendix A Test Vector (shared with CLI) ────────────────────────────────

/**
 * 📚 学习要点: PKCS8 DER 格式导入 Ed25519 seed
 *
 * Web Crypto API 不支持直接导入 Ed25519 raw seed，
 * 需要包装为 PKCS8 DER 格式：16 字节固定前缀 + 32 字节 seed。
 * 前缀编码了 ASN.1 结构：
 *   SEQUENCE { INTEGER(0), SEQUENCE { OID(1.3.101.112) }, OCTET STRING { OCTET STRING { seed } } }
 *
 * Go 端直接使用 ed25519.NewKeyFromSeed(seed) 即可——
 * 两种方式在数学上等价，产生相同的密钥对。
 */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
  0x04, 0x22, 0x04, 0x20,
]);

/**
 * Appendix A 固定 Test Vector — 与 CLI 端 crossclient_test.go 完全相同的值。
 * 如果两端测试都通过，则证明跨客户端互操作性成立。
 */
const CROSS_CLIENT_VECTOR = {
  // 32 字节 seed（ASCII: "test-seed-for-arthas-vectors!!!!"）
  seedHex:
    '746573742d736565642d666f722d6172746861732d766563746f727321212121',

  // 从 seed 派生的 32 字节 Ed25519 公钥
  publicKeyHex:
    '3f23c13782fe6b1341fcd51844ecbc4de9e3af1cdf3a1f5599e8f1ad38340618',

  // Test Vector 1: signable bytes = UTF-8 of '{"text":"Hello"}'
  signableBytesHex: '7b2274657874223a2248656c6c6f227d',

  // 对 signable bytes 的 Ed25519 签名（64 字节）
  signatureHex:
    '072335f25bc666c64dc8ae69e005ab8beac57cbe082a51077d43fdf1f4eb969bfbbc32c05f017fae68a0c9d84404b49c276ba35b872f88ade0e4a64a16c4b308',

  // 签名的 base64url 编码（无 padding）
  signatureBase64url:
    'ByM18lvGZsZNyK5p4AWri-rFfL4IKlEHfUP98fTrlpv7vDLAXwF_rmigydhEBLScJ2ujW4cviK3g5KZKFsSzCA',
};

// ─── Helper: Import private key from seed ────────────────────────────────────

/**
 * 从 32 字节 seed 导入 Ed25519 私钥（PKCS8 格式）。
 * 这与 Go 端的 ed25519.NewKeyFromSeed(seed) 在数学上等价。
 */
async function importPrivateKeyFromSeed(seedHex: string): Promise<CryptoKey> {
  const seedBytes = hexToBytes(seedHex);
  const pkcs8 = new Uint8Array([...PKCS8_ED25519_PREFIX, ...seedBytes]);
  return crypto.subtle.importKey('pkcs8', pkcs8, 'Ed25519', false, ['sign']);
}

// ─── Cross-Client Integration Tests ─────────────────────────────────────────

describe('Cross-Client Ed25519 Signing Integration — Appendix A Vector', () => {
  it('should derive the same public key from the shared seed as the CLI client', async () => {
    // Import seed as private key, then sign and verify against expected public key
    // to confirm the seed → public key derivation matches CLI
    const privateKey = await importPrivateKeyFromSeed(
      CROSS_CLIENT_VECTOR.seedHex
    );
    const signableBytes = hexToBytes(CROSS_CLIENT_VECTOR.signableBytesHex);

    // Sign with the derived private key
    const sigBase64url = await signPayload(privateKey, signableBytes);

    // Import the expected public key (same as CLI derives from the same seed)
    const expectedPubKeyBytes = hexToBytes(CROSS_CLIENT_VECTOR.publicKeyHex);
    const publicKey = await importVerifyKey(expectedPubKeyBytes);

    // If verification passes, the Web-derived private key corresponds to
    // the same public key that CLI derives from the same seed
    const isValid = await verifySignature(publicKey, signableBytes, sigBase64url);
    expect(isValid).toBe(true);
  });

  it('should produce the identical signature as the CLI client for Test Vector 1', async () => {
    // This is the core cross-client interop proof:
    // Web signPayload(seed, "Hello") === CLI kp.Sign(signableBytes)
    const privateKey = await importPrivateKeyFromSeed(
      CROSS_CLIENT_VECTOR.seedHex
    );
    const signableBytes = hexToBytes(CROSS_CLIENT_VECTOR.signableBytesHex);

    const sigBase64url = await signPayload(privateKey, signableBytes);

    // The signature MUST match the shared Appendix A value exactly.
    // CLI's crossclient_test.go verifies the same value — if both pass,
    // cross-client interop is proven.
    expect(sigBase64url).toBe(CROSS_CLIENT_VECTOR.signatureBase64url);
  });

  it('should verify the shared signature using the project verifySignature function', async () => {
    // Simulate receiving a message signed by the CLI client:
    // use the shared public key and signature to verify
    const publicKeyBytes = hexToBytes(CROSS_CLIENT_VECTOR.publicKeyHex);
    const publicKey = await importVerifyKey(publicKeyBytes);
    const signableBytes = hexToBytes(CROSS_CLIENT_VECTOR.signableBytesHex);

    // Verify using the project's verifySignature function
    const isValid = await verifySignature(
      publicKey,
      signableBytes,
      CROSS_CLIENT_VECTOR.signatureBase64url
    );

    expect(isValid).toBe(true);
  });

  it('should fail verification when the payload is tampered with', async () => {
    // Cross-client security guarantee: tampering detected regardless of which
    // client signed the message
    const publicKeyBytes = hexToBytes(CROSS_CLIENT_VECTOR.publicKeyHex);
    const publicKey = await importVerifyKey(publicKeyBytes);
    const signableBytes = hexToBytes(CROSS_CLIENT_VECTOR.signableBytesHex);

    // Tamper with the last byte of signable bytes
    const tampered = new Uint8Array(signableBytes);
    tampered[tampered.length - 1] ^= 0x42;

    const isValid = await verifySignature(
      publicKey,
      tampered,
      CROSS_CLIENT_VECTOR.signatureBase64url
    );

    expect(isValid).toBe(false);
  });

  it('should produce a signature whose hex matches the shared vector exactly', async () => {
    // Additional hex-level verification for maximum confidence
    const privateKey = await importPrivateKeyFromSeed(
      CROSS_CLIENT_VECTOR.seedHex
    );
    const signableBytes = hexToBytes(CROSS_CLIENT_VECTOR.signableBytesHex);

    // Sign and get raw signature bytes via the Web Crypto API directly
    const rawSignature = await crypto.subtle.sign(
      'Ed25519',
      privateKey,
      signableBytes.buffer as ArrayBuffer
    );

    const sigHex = bytesToHex(new Uint8Array(rawSignature));
    expect(sigHex).toBe(CROSS_CLIENT_VECTOR.signatureHex);
  });
});
