/**
 * Property-based test: Signed_Payload JSON serialization round-trip
 *
 * 📚 学习要点: 序列化往返（Round-trip）属性
 * 在分布式系统中，消息在发送方序列化、接收方反序列化。如果这个过程不是无损的
 * （即序列化→反序列化后丢失或损坏了字段），消息内容将不一致。
 *
 * 本属性测试验证：
 * 对于任意有效的 Signed_Payload 对象（包含任意组合的可选字段），
 * 通过 JSON.stringify 序列化后再用 parseSignedPayload 解析，
 * 必须产生一个字段值等价的对象——无数据丢失或损坏。
 *
 * 测试策略：
 * - 直接测试 parseSignedPayload 对 JSON 字符串的解析能力
 * - 生成包含所有可选字段组合的 payload 对象
 * - 验证 round-trip 后所有字段值保持一致
 *
 * **Validates: Requirements 6.5**
 *
 * @module utils/payload.property.test
 * @see payload.ts — Signed_Payload 构建与解析实现
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseSignedPayload } from './payload';

/**
 * 生成模拟 Signed_Payload 对象的 fast-check arbitrary。
 *
 * 📚 学习要点: 生成器覆盖所有可选字段组合
 * Signed_Payload 有多个可选字段（sig、reply、type、pubkey），
 * 属性测试需要覆盖这些字段的所有存在/缺失组合。
 * 使用 fc.record 的 requiredKeys 选项，只有 text 是必填的，
 * 其余字段由 fast-check 随机决定是否包含。
 */
function arbitrarySignedPayload() {
  const replyArb = fc.record({
    stableId: fc.string({ minLength: 1, maxLength: 50 }),
    senderName: fc.string({ minLength: 1, maxLength: 50 }),
    preview: fc.string({ minLength: 0, maxLength: 50 }),
  });

  return fc.record(
    {
      text: fc.string({ minLength: 0, maxLength: 200 }),
      reply: replyArb,
      type: fc.string({ minLength: 1, maxLength: 20 }),
      pubkey: fc.string({ minLength: 1, maxLength: 100 }),
    },
    { requiredKeys: ['text'] }
  );
}

describe('Property 6: Signed_Payload JSON serialization round-trip', () => {
  /**
   * 核心 round-trip 属性：对任意有效 payload，
   * JSON.stringify → parseSignedPayload 必须恢复所有字段值。
   *
   * 📚 学习要点: 为什么不测试 buildSignedPayload？
   * buildSignedPayload 是 async 且需要 CryptoKey（Ed25519 私钥）。
   * 为了隔离测试序列化逻辑本身（不依赖密码学操作），
   * 我们直接构造 JSON 字符串并验证 parseSignedPayload 的解析正确性。
   * 这更精确地测试了 Requirement 6.5 的核心属性：
   * "serializing to JSON then parsing back SHALL produce an equivalent object"
   *
   * **Validates: Requirements 6.5**
   */
  it('serialize→parse round-trip preserves all fields without data loss', () => {
    fc.assert(
      fc.property(arbitrarySignedPayload(), (payload) => {
        // Step 1: 序列化为 JSON 字符串（模拟 buildSignedPayload 的最终输出）
        const json = JSON.stringify(payload);

        // Step 2: 使用 parseSignedPayload 解析
        const parsed = parseSignedPayload(json);

        // Step 3: 验证 text 字段（必填）
        expect(parsed.text).toBe(payload.text);

        // Step 4: 验证 reply 字段（可选）
        if (payload.reply !== undefined) {
          expect(parsed.reply).toBeDefined();
          expect(parsed.reply!.stableId).toBe(payload.reply.stableId);
          expect(parsed.reply!.senderName).toBe(payload.reply.senderName);
          expect(parsed.reply!.preview).toBe(payload.reply.preview);
        } else {
          expect(parsed.reply).toBeUndefined();
        }

        // Step 5: 验证 type 字段（可选）
        if (payload.type !== undefined) {
          expect(parsed.type).toBe(payload.type);
        } else {
          expect(parsed.type).toBeUndefined();
        }

        // Step 6: 验证 pubkey 字段（可选）
        if (payload.pubkey !== undefined) {
          expect(parsed.pubkey).toBe(payload.pubkey);
        } else {
          expect(parsed.pubkey).toBeUndefined();
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * 带 sig 字段的 round-trip：验证 sig 字段在序列化/解析过程中保持不变。
   *
   * 📚 学习要点: sig 字段的特殊性
   * sig 字段在签名计算时被排除（computeSignableBytes 移除它），
   * 但在最终序列化的 JSON 中它必须被保留并正确传输。
   * parseSignedPayload 必须能正确提取 sig 字段供验证逻辑使用。
   *
   * **Validates: Requirements 6.5**
   */
  it('sig field is preserved through serialize→parse round-trip', () => {
    fc.assert(
      fc.property(
        arbitrarySignedPayload(),
        fc.string({ minLength: 10, maxLength: 100 }),
        (payload, sig) => {
          // 添加 sig 字段
          const payloadWithSig = { ...payload, sig };
          const json = JSON.stringify(payloadWithSig);

          const parsed = parseSignedPayload(json);

          // sig 字段必须被正确保留
          expect(parsed.sig).toBe(sig);
          // 其他字段也必须保持不变
          expect(parsed.text).toBe(payload.text);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 向后兼容属性：非 JSON 字符串（旧客户端纯文本消息）
   * 应被 parseSignedPayload 作为 text 字段返回。
   *
   * 📚 学习要点: 向后兼容的 fallback 策略
   * 旧版客户端发送的消息可能是纯文本（非 JSON 格式）。
   * parseSignedPayload 必须优雅处理这种情况：
   * 将整个字符串作为 text 字段返回，不抛出异常。
   * 这确保了新旧客户端可以在同一房间中共存。
   *
   * **Validates: Requirements 6.5**
   */
  it('non-JSON plaintext is treated as text field (backward compatibility)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }).filter(
          (s) => {
            // 过滤掉有效 JSON 对象字符串（确保测试纯文本路径）
            try {
              const parsed = JSON.parse(s);
              return !(typeof parsed === 'object' && parsed !== null && typeof parsed.text === 'string');
            } catch {
              return true;
            }
          }
        ),
        (plaintext) => {
          const parsed = parseSignedPayload(plaintext);

          // 整个字符串作为 text 返回
          expect(parsed.text).toBe(plaintext);
          // 无其他字段
          expect(parsed.sig).toBeUndefined();
          expect(parsed.reply).toBeUndefined();
          expect(parsed.type).toBeUndefined();
          expect(parsed.pubkey).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
