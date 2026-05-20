/**
 * Canonical JSON 单元测试 — 使用 Test Vectors 验证跨客户端字节等价性。
 *
 * 📚 学习要点: 为什么需要 Test Vectors？
 * Ed25519 签名要求发送方和接收方对相同 payload 计算出完全相同的字节序列。
 * 如果 Web 客户端和 CLI 客户端的 canonical JSON 输出有任何差异（哪怕一个空格），
 * 签名验证就会失败。Test Vectors 是硬编码的"黄金标准"——两端测试都使用相同的
 * 输入/输出对，确保互操作性。
 *
 * Property 9: Cross-client canonical JSON byte equivalence (via shared vectors)
 * Validates: Requirements 7.4, 7.5
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalJsonStringify,
  computeSignableBytes,
  TEST_VECTOR_1,
  TEST_VECTOR_2,
  TEST_VECTOR_3,
} from './canonicalJson';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Uint8Array → hex string（用于与 Test Vectors 的 expectedHex 比较）
// ─────────────────────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Vector 验证 — 跨客户端字节等价性（Property 9）
// CLI 端 internal/crypto/canonical_test.go 使用完全相同的向量。
// ─────────────────────────────────────────────────────────────────────────────

describe('canonicalJsonStringify — Test Vectors', () => {
  it('Test Vector 1: 纯文本消息 → canonical JSON matches expected', () => {
    const result = canonicalJsonStringify(TEST_VECTOR_1.input);
    expect(result).toBe(TEST_VECTOR_1.expectedJson);
  });

  it('Test Vector 2: 带 reply 嵌套对象 → 递归排序 keys', () => {
    const result = canonicalJsonStringify(TEST_VECTOR_2.input);
    expect(result).toBe(TEST_VECTOR_2.expectedJson);
  });

  it('Test Vector 3: pubkey announcement → 多字段按字母序排列', () => {
    const result = canonicalJsonStringify(TEST_VECTOR_3.input);
    expect(result).toBe(TEST_VECTOR_3.expectedJson);
  });
});

describe('computeSignableBytes — Test Vectors (hex comparison)', () => {
  it('Test Vector 1: signable bytes hex matches expected', () => {
    const bytes = computeSignableBytes(TEST_VECTOR_1.input);
    expect(toHex(bytes)).toBe(TEST_VECTOR_1.expectedHex);
  });

  it('Test Vector 2: signable bytes hex matches expected (nested reply)', () => {
    const bytes = computeSignableBytes(TEST_VECTOR_2.input);
    expect(toHex(bytes)).toBe(TEST_VECTOR_2.expectedHex);
  });

  it('Test Vector 3: signable bytes hex matches expected (pubkey announcement)', () => {
    const bytes = computeSignableBytes(TEST_VECTOR_3.input);
    expect(toHex(bytes)).toBe(TEST_VECTOR_3.expectedHex);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('canonicalJsonStringify — edge cases', () => {
  it('empty object → {}', () => {
    expect(canonicalJsonStringify({})).toBe('{}');
  });

  it('nested arrays — array order preserved, nested objects sorted', () => {
    const input = { arr: [1, 'two', { nested: true, alpha: 'first' }] };
    const result = canonicalJsonStringify(input);
    // "arr" is the only key; array elements keep order; nested object keys sorted
    expect(result).toBe('{"arr":[1,"two",{"alpha":"first","nested":true}]}');
  });

  it('unicode strings — UTF-8 encoding preserved', () => {
    const input = { text: '你好世界' };
    const result = canonicalJsonStringify(input);
    expect(result).toBe('{"text":"你好世界"}');
  });

  it('unicode strings — computeSignableBytes produces valid UTF-8 bytes', () => {
    const input = { text: '你好世界' };
    const bytes = computeSignableBytes(input);
    // Decode back to string and verify round-trip
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe('{"text":"你好世界"}');
  });
});

describe('computeSignableBytes — sig field removal', () => {
  it('removes sig field from output', () => {
    const input = { text: 'Hello', sig: 'some-signature-value' };
    const bytes = computeSignableBytes(input);
    const decoded = new TextDecoder().decode(bytes);
    // sig should be removed, only text remains
    expect(decoded).toBe('{"text":"Hello"}');
  });

  it('sig removal with multiple fields — remaining fields sorted', () => {
    const input = {
      sig: 'signature-to-remove',
      text: 'World',
      reply: { preview: 'Hi', senderName: 'A', stableId: 'x:1' },
    };
    const bytes = computeSignableBytes(input);
    const hex = toHex(bytes);
    // Should match Test Vector 2 (same payload without sig)
    expect(hex).toBe(TEST_VECTOR_2.expectedHex);
  });
});
