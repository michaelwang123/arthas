/**
 * Canonical JSON 序列化 — 确保跨客户端（Web + CLI）产生完全相同的 Signable_Bytes。
 *
 * 在 Ed25519 消息签名流程中，签名的输入（Signable_Bytes）必须在所有客户端上
 * 产生完全相同的字节序列。标准 JSON.stringify 不保证 key 顺序，因此需要
 * 自定义的 canonical JSON 实现：每层 key 按 Unicode 字母序排列，递归处理嵌套对象。
 *
 * 本模块与 CLI 端的 `internal/crypto/canonical.go` 产生 byte-identical 输出，
 * 通过共享 Test Vectors 验证互操作性。
 */

/**
 * 📚 学习要点: 为什么不能使用 JSON.stringify 的 array replacer？
 *
 * 直觉上，`JSON.stringify(obj, Object.keys(obj).sort())` 似乎能实现 key 排序。
 * 但 JSON.stringify 的 array replacer 有一个致命缺陷：
 * replacer 数组会应用到 **所有嵌套层级**，而不仅仅是顶层。
 *
 * 例如对于 `{reply: {preview: "Hi", senderName: "A"}, text: "World"}`：
 * - replacer = ["reply", "text"]（顶层 keys）
 * - 序列化 reply 对象时，只保留 replacer 中的 key → "preview" 和 "senderName" 被丢弃！
 * - 结果：`{"reply":{},"text":"World"}` — 嵌套字段全部丢失
 *
 * 因此必须使用递归实现：在每一层独立排序该层的 keys，不影响其他层级。
 */

/**
 * 将任意值序列化为 canonical JSON 字符串（递归实现）。
 *
 * 规则：
 * - 每层 object 的 key 按 Unicode 字母序（String.prototype.sort 默认行为）排列
 * - 嵌套对象递归排序
 * - 数组元素保持原始顺序（不排序元素，但递归处理每个元素）
 * - 原始值（string, number, boolean, null）使用标准 JSON.stringify
 * - 无缩进、无尾部换行、无 BOM
 *
 * @param value - 要序列化的值（支持任意嵌套结构）
 * @returns canonical JSON 字符串
 */
export function canonicalJsonStringify(value: unknown): string {
  // 原始值和 null：直接使用 JSON.stringify（保证正确的转义和格式）
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  // 数组：保持元素顺序，但递归处理每个元素（元素可能是对象）
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }

  // 对象：排序当前层的 keys，递归处理每个 value
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(
    (k) =>
      JSON.stringify(k) +
      ':' +
      canonicalJsonStringify((value as Record<string, unknown>)[k])
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * 计算 Signable_Bytes：从 payload 中移除 `sig` 字段，进行 canonical JSON 序列化，
 * 然后编码为 UTF-8 字节。
 *
 * 这是 Ed25519 签名和验证的共同输入——发送方签名前和接收方验证时
 * 都调用此函数，确保双方计算相同的字节序列。
 *
 * @param payload - 解密后的消息载荷对象（可能包含 sig 字段）
 * @returns UTF-8 编码的 canonical JSON 字节
 */
export function computeSignableBytes(
  payload: Record<string, unknown>
): Uint8Array {
  // 解构移除 sig 字段，保留其余所有字段用于签名计算
  const { sig, ...rest } = payload;
  const canonical = canonicalJsonStringify(rest);
  return new TextEncoder().encode(canonical);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Vectors（跨客户端验证基准）
// 以下向量硬编码在两端测试中，作为互操作性的黄金标准。
// CLI 端 internal/crypto/canonical_test.go 使用完全相同的向量。
// ─────────────────────────────────────────────────────────────────────────────

/** Test Vector 1: 纯文本消息 */
export const TEST_VECTOR_1 = {
  input: { text: 'Hello' },
  expectedJson: '{"text":"Hello"}',
  expectedHex: '7b2274657874223a2248656c6c6f227d',
};

/** Test Vector 2: 带 reply — 验证嵌套对象递归排序 */
export const TEST_VECTOR_2 = {
  input: {
    reply: { preview: 'Hi', senderName: 'A', stableId: 'x:1' },
    text: 'World',
  },
  expectedJson:
    '{"reply":{"preview":"Hi","senderName":"A","stableId":"x:1"},"text":"World"}',
  expectedHex:
    '7b227265706c79223a7b2270726576696577223a224869222c2273656e6465724e616d65223a2241222c22737461626c654964223a22783a31227d2c2274657874223a22576f726c64227d',
};

/** Test Vector 3: pubkey announcement — 验证多字段排序 */
export const TEST_VECTOR_3 = {
  input: {
    pubkey: 'dGVzdC1wdWJsaWMta2V5LWJhc2U2NHVybA',
    text: '',
    type: 'pubkey',
  },
  expectedJson:
    '{"pubkey":"dGVzdC1wdWJsaWMta2V5LWJhc2U2NHVybA","text":"","type":"pubkey"}',
  expectedHex:
    '7b227075626b6579223a226447567a6443317764574a7361574d74613256354c574a68633255324e4856796241222c2274657874223a22222c2274797065223a227075626b6579227d',
};
