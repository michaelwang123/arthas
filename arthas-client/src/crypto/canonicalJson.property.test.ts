/**
 * Property-based test: Canonical JSON determinism with recursive sorted keys
 *
 * 📚 学习要点: Canonical JSON 的确定性属性
 * 在 Ed25519 消息签名流程中，签名的输入（Signable_Bytes）必须在所有客户端上
 * 产生完全相同的字节序列。如果 canonical JSON 序列化不是确定性的（即相同输入
 * 可能产生不同输出），签名验证将随机失败。
 *
 * 本属性测试验证：
 * 1. 确定性：对相同输入调用两次 canonicalJsonStringify 产生完全相同的字符串
 * 2. Key 排序：输出中所有层级的 key 都按 Unicode 字母序排列
 * 3. 嵌套对象：包含 reply 等嵌套对象时，递归排序仍然正确
 * 4. computeSignableBytes 移除 sig：添加 sig 字段不影响 signable bytes
 *
 * **Validates: Requirements 4.2, 7.4**
 *
 * @module crypto/canonicalJson.property.test
 * @see canonicalJson.ts — Canonical JSON 递归序列化实现
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canonicalJsonStringify, computeSignableBytes } from './canonicalJson';

/**
 * 生成模拟 Signed_Payload 对象的 fast-check arbitrary。
 *
 * 📚 学习要点: 智能生成器设计
 * 属性测试的关键是生成器的质量——它应该覆盖真实使用场景中的输入空间。
 * 这里我们模拟 Arthas 消息 payload 的结构：
 * - text: 必填字符串（消息内容）
 * - reply: 可选嵌套对象（引用回复，包含 preview、senderName、stableId）
 * - type: 可选字符串（如 "pubkey"）
 * - pubkey: 可选字符串（base64url 编码的公钥）
 */
function arbitraryPayload() {
  const replyArb = fc.record({
    preview: fc.string({ minLength: 0, maxLength: 100 }),
    senderName: fc.string({ minLength: 1, maxLength: 50 }),
    stableId: fc.string({ minLength: 1, maxLength: 50 }),
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

/**
 * 递归检查 JSON 字符串中所有对象层级的 key 是否按字母序排列。
 *
 * 📚 学习要点: 验证策略
 * 我们不能简单地检查顶层 key 排序——必须递归验证每一层嵌套对象。
 * 这个辅助函数解析 canonical JSON 输出，遍历所有对象节点，
 * 验证每个对象的 key 数组等于其排序后的版本。
 */
function verifyKeysAreSorted(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(verifyKeysAreSorted);
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const sortedKeys = [...keys].sort();
  if (keys.join(',') !== sortedKeys.join(',')) {
    return false;
  }
  // 递归检查每个 value
  return Object.values(value as Record<string, unknown>).every(
    verifyKeysAreSorted
  );
}

describe('Property 4: Canonical JSON determinism with recursive sorted keys', () => {
  /**
   * 确定性属性：对相同输入调用 canonicalJsonStringify 两次，
   * 必须产生完全相同的字符串输出。
   *
   * 📚 学习要点: 为什么确定性如此重要？
   * 发送方签名时调用 computeSignableBytes 一次，接收方验证时再调用一次。
   * 如果两次调用对相同 payload 产生不同的字节，签名验证将失败。
   * 这个属性确保序列化是纯函数（无副作用、无随机性）。
   *
   * **Validates: Requirements 4.2, 7.4**
   */
  it('canonicalJsonStringify is deterministic — same input always produces same output', () => {
    fc.assert(
      fc.property(arbitraryPayload(), (payload) => {
        const result1 = canonicalJsonStringify(payload);
        const result2 = canonicalJsonStringify(payload);
        expect(result1).toBe(result2);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Key 排序属性：canonical JSON 输出中，所有层级的 object key
   * 都按 Unicode 字母序排列。
   *
   * 📚 学习要点: 递归排序的必要性
   * 如果只排序顶层 key 而忽略嵌套对象（如 reply 内部的 key），
   * 不同客户端可能因为嵌套 key 顺序不同而产生不同的 Signable_Bytes。
   * 这个属性验证排序是递归的——每一层都独立排序。
   *
   * **Validates: Requirements 4.2, 7.4**
   */
  it('all keys at every nesting level are in Unicode alphabetical order', () => {
    fc.assert(
      fc.property(arbitraryPayload(), (payload) => {
        const canonical = canonicalJsonStringify(payload);
        // 解析输出并验证 key 排序（JSON.parse 保留 key 插入顺序）
        const parsed = JSON.parse(canonical);
        expect(verifyKeysAreSorted(parsed)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * 嵌套对象递归排序属性：包含 reply 嵌套对象的 payload，
   * reply 内部的 key 也必须按字母序排列。
   *
   * 📚 学习要点: 这正是 JSON.stringify array replacer 会失败的场景
   * JSON.stringify(obj, ["reply", "text"]) 会在序列化 reply 对象时
   * 只保留 replacer 数组中的 key，导致 reply 内部的 preview、senderName、
   * stableId 全部丢失。递归实现避免了这个陷阱。
   *
   * **Validates: Requirements 4.2, 7.4**
   */
  it('nested reply objects have recursively sorted keys', () => {
    // 使用始终包含 reply 的生成器
    const payloadWithReply = fc.record({
      text: fc.string({ minLength: 0, maxLength: 200 }),
      reply: fc.record({
        preview: fc.string({ minLength: 0, maxLength: 100 }),
        senderName: fc.string({ minLength: 1, maxLength: 50 }),
        stableId: fc.string({ minLength: 1, maxLength: 50 }),
      }),
    });

    fc.assert(
      fc.property(payloadWithReply, (payload) => {
        const canonical = canonicalJsonStringify(payload);
        const parsed = JSON.parse(canonical);

        // 验证顶层 key 排序
        const topKeys = Object.keys(parsed);
        expect(topKeys).toEqual([...topKeys].sort());

        // 验证 reply 内部 key 排序
        const replyKeys = Object.keys(parsed.reply);
        expect(replyKeys).toEqual([...replyKeys].sort());
      }),
      { numRuns: 100 }
    );
  });

  /**
   * computeSignableBytes 移除 sig 属性：添加 sig 字段到 payload
   * 不应改变 computeSignableBytes 的输出。
   *
   * 📚 学习要点: sig 字段排除的安全意义
   * 签名本身不能包含在被签名的数据中（循环依赖）。
   * computeSignableBytes 必须在计算前移除 sig 字段，
   * 这样发送方（签名前无 sig）和接收方（验证时有 sig）
   * 对相同 payload 计算出相同的 Signable_Bytes。
   *
   * **Validates: Requirements 4.2, 7.4**
   */
  it('computeSignableBytes produces identical output regardless of sig field presence', () => {
    fc.assert(
      fc.property(
        arbitraryPayload(),
        fc.string({ minLength: 10, maxLength: 100 }),
        (payload, fakeSig) => {
          // 不带 sig 的 payload
          const bytesWithoutSig = computeSignableBytes(
            payload as Record<string, unknown>
          );

          // 带 sig 的 payload
          const payloadWithSig = { ...payload, sig: fakeSig };
          const bytesWithSig = computeSignableBytes(
            payloadWithSig as Record<string, unknown>
          );

          // 两者必须完全相同
          expect(bytesWithSig).toEqual(bytesWithoutSig);
        }
      ),
      { numRuns: 100 }
    );
  });
});
