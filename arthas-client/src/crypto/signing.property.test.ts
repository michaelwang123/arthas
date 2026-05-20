/**
 * Property-based tests: Ed25519 签名模块
 *
 * 📚 学习要点: 密码学属性测试的价值
 * 密码学实现的正确性至关重要——一个微小的 bug 可能导致签名被伪造或篡改不被检测。
 * 属性测试通过生成大量随机输入，验证以下不变量在所有情况下都成立：
 * - Property 3: 签名后验证始终成功（正确性）
 * - Property 5: 任何修改都导致验证失败（完整性/篡改检测）
 *
 * 这两个属性共同保证了 Ed25519 签名的核心安全承诺：
 * 只有持有私钥的人能产生有效签名，且签名覆盖的内容不可被篡改。
 *
 * @module crypto/signing.property.test
 * @see signing.ts — Ed25519 签名实现
 * @see canonicalJson.ts — Signable_Bytes 计算
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  generateSigningKeyPair,
  signPayload,
  verifySignature,
  importVerifyKey,
  encodePublicKey,
  decodePublicKey,
} from './signing';
import { computeSignableBytes } from './canonicalJson';

describe('Property 3: Ed25519 keypair validity and sign/verify round-trip', () => {
  /**
   * **Property 3: Ed25519 keypair validity and sign/verify round-trip**
   *
   * 对于任意生成的 Ed25519 密钥对和任意字节序列（Signable_Bytes），
   * 使用私钥签名后，用对应公钥验证必须始终返回 true。
   * 同时验证密钥尺寸：公钥 32 字节。
   *
   * 📚 学习要点: 为什么测试任意字节序列？
   * Ed25519 签名的输入是任意长度的字节序列（内部会 SHA-512 哈希）。
   * 属性测试确保无论输入内容如何（空字节、超长数据、特殊字符），
   * sign→verify 的正确性都不受影响。
   *
   * **Validates: Requirements 2.1, 2.2, 2.4, 2.5, 4.1, 5.1**
   */
  it('signing any byte sequence then verifying with the correct public key always succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成 0 到 1024 bytes 的随机字节序列作为 Signable_Bytes
        fc.uint8Array({ minLength: 0, maxLength: 1024 }),
        async (signableBytes) => {
          // 生成 Ed25519 密钥对
          const keyPair = await generateSigningKeyPair();
          // 如果浏览器不支持 Ed25519，跳过测试（不应在 CI 中发生）
          if (keyPair === null) return;

          // 验证公钥尺寸：Ed25519 公钥固定 32 字节
          expect(keyPair.publicKeyBytes.length).toBe(32);

          // 签名
          const signature = await signPayload(keyPair.privateKey, signableBytes);

          // 验证：使用对应公钥验证签名必须成功
          const isValid = await verifySignature(
            keyPair.publicKey,
            signableBytes,
            signature
          );
          expect(isValid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 5: Tamper detection — modifying any field invalidates signature', () => {
  /**
   * **Property 5: Tamper detection — modifying any field invalidates signature**
   *
   * 对于任意有效的 Signed_Payload（签名后），修改 payload 中的任何非 `sig` 字段
   * （text、reply、type、pubkey），重新计算 Signable_Bytes 后验证签名必须失败。
   *
   * 📚 学习要点: 篡改检测是消息签名的核心安全属性
   * 在 Arthas 的威胁模型中，服务器可能尝试修改中转的消息内容（如篡改 text、
   * 伪造 reply 引用、修改 type 字段）。Ed25519 签名覆盖完整 payload（去除 sig），
   * 确保任何修改都会被接收方检测到。
   *
   * 测试策略：
   * 1. 生成随机 payload 对象（含 text、可选 reply/type/pubkey）
   * 2. 计算 Signable_Bytes 并签名
   * 3. 修改 payload 中的某个字段（随机选择修改方式）
   * 4. 重新计算 Signable_Bytes（从修改后的 payload）
   * 5. 用原始签名验证修改后的 bytes → 必须返回 false
   *
   * **Validates: Requirements 4.6**
   */
  it('modifying payload text after signing causes verification to fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成原始 text 和修改后的 text（确保不同）
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        async (originalText, modifiedText) => {
          // 确保修改后的 text 与原始不同（否则 signable bytes 相同，验证会通过）
          fc.pre(originalText !== modifiedText);

          const keyPair = await generateSigningKeyPair();
          if (keyPair === null) return;

          // 构建原始 payload 并签名
          const originalPayload: Record<string, unknown> = { text: originalText };
          const originalBytes = computeSignableBytes(originalPayload);
          const signature = await signPayload(keyPair.privateKey, originalBytes);

          // 修改 text 字段
          const tamperedPayload: Record<string, unknown> = { text: modifiedText };
          const tamperedBytes = computeSignableBytes(tamperedPayload);

          // 验证：修改后的 payload 使用原始签名验证必须失败
          const isValid = await verifySignature(
            keyPair.publicKey,
            tamperedBytes,
            signature
          );
          expect(isValid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('modifying nested reply fields after signing causes verification to fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成带 reply 的 payload
        fc.record({
          text: fc.string({ minLength: 1, maxLength: 100 }),
          reply: fc.record({
            preview: fc.string({ minLength: 1, maxLength: 50 }),
            senderName: fc.string({ minLength: 1, maxLength: 20 }),
            stableId: fc.string({ minLength: 1, maxLength: 30 }),
          }),
        }),
        // 生成用于篡改的新 preview 值
        fc.string({ minLength: 1, maxLength: 50 }),
        async (payload, tamperedPreview) => {
          // 确保篡改值与原始不同
          fc.pre(tamperedPreview !== payload.reply.preview);

          const keyPair = await generateSigningKeyPair();
          if (keyPair === null) return;

          // 签名原始 payload
          const originalBytes = computeSignableBytes(payload as unknown as Record<string, unknown>);
          const signature = await signPayload(keyPair.privateKey, originalBytes);

          // 篡改 reply.preview 字段
          const tamperedPayload = {
            ...payload,
            reply: { ...payload.reply, preview: tamperedPreview },
          };
          const tamperedBytes = computeSignableBytes(tamperedPayload as unknown as Record<string, unknown>);

          // 验证必须失败
          const isValid = await verifySignature(
            keyPair.publicKey,
            tamperedBytes,
            signature
          );
          expect(isValid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('adding or removing fields after signing causes verification to fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (text, extraValue) => {
          const keyPair = await generateSigningKeyPair();
          if (keyPair === null) return;

          // 签名只有 text 字段的 payload
          const originalPayload: Record<string, unknown> = { text };
          const originalBytes = computeSignableBytes(originalPayload);
          const signature = await signPayload(keyPair.privateKey, originalBytes);

          // 篡改：添加一个新字段（模拟服务器注入 type 字段）
          const tamperedPayload: Record<string, unknown> = { text, type: extraValue };
          const tamperedBytes = computeSignableBytes(tamperedPayload);

          // 验证必须失败
          const isValid = await verifySignature(
            keyPair.publicKey,
            tamperedBytes,
            signature
          );
          expect(isValid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('flipping a random byte in signable bytes causes verification to fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 生成 payload text
        fc.string({ minLength: 1, maxLength: 200 }),
        // 生成用于 XOR 翻转的随机字节值（1-255，确保实际修改了字节）
        fc.integer({ min: 1, max: 255 }),
        async (text, flipByte) => {
          const keyPair = await generateSigningKeyPair();
          if (keyPair === null) return;

          // 签名原始 payload
          const payload: Record<string, unknown> = { text };
          const originalBytes = computeSignableBytes(payload);
          const signature = await signPayload(keyPair.privateKey, originalBytes);

          // 翻转 signable bytes 中的一个随机字节
          const tamperedBytes = new Uint8Array(originalBytes);
          const flipIndex = Math.floor(Math.random() * tamperedBytes.length);
          tamperedBytes[flipIndex] ^= flipByte;

          // 确保确实修改了（XOR 非零值保证修改）
          // 验证必须失败
          const isValid = await verifySignature(
            keyPair.publicKey,
            tamperedBytes,
            signature
          );
          expect(isValid).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('Property 8: Public key announcement round-trip with self-verification', () => {
  /**
   * **Property 8: Public key announcement round-trip with self-verification**
   *
   * 对于任意生成的 Ed25519 密钥对，构建 Public_Key_Announcement payload
   * （type="pubkey", text="", pubkey=base64url(publicKey)），签名后：
   * (a) 使用嵌入的 pubkey 自验证签名必须成功
   * (b) 解码存储的公钥必须与原始 32 字节公钥完全一致（字节相同）
   *
   * 📚 学习要点: 公钥广播的自验证机制
   * 接收方收到公钥广播时，发送方的公钥尚未存储（这正是广播的目的）。
   * 因此验证逻辑为"自验证"：用广播中携带的 pubkey 验证广播本身的 sig。
   * 这证明发送方确实持有对应的私钥（防止格式错误的公钥被存储）。
   * 如果自验证失败，丢弃该广播，不存储公钥。
   *
   * **Validates: Requirements 3.2, 3.3**
   */
  it('announcement signed with keypair self-verifies using embedded pubkey, and stored key is byte-identical', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 使用 fc.constant(undefined) 因为密钥生成本身是异步随机的
        fc.constant(undefined),
        async () => {
          // 1. 生成 Ed25519 密钥对
          const keyPair = await generateSigningKeyPair();
          if (keyPair === null) return; // 浏览器不支持 Ed25519 时跳过

          // 2. 构建公钥广播 payload（模拟 Public_Key_Announcement 格式）
          const announcementPayload: Record<string, unknown> = {
            type: 'pubkey',
            text: '',
            pubkey: encodePublicKey(keyPair.publicKeyBytes),
          };

          // 3. 计算 Signable_Bytes（去除 sig 字段后的 canonical JSON UTF-8 编码）
          const signableBytes = computeSignableBytes(announcementPayload);

          // 4. 使用私钥签名
          const sig = await signPayload(keyPair.privateKey, signableBytes);

          // 5. 自验证：模拟接收端行为
          //    接收端从 payload 中提取 pubkey，import 为 CryptoKey，验证 sig
          const embeddedPubkeyBase64url = announcementPayload.pubkey as string;
          const embeddedPubkeyBytes = decodePublicKey(embeddedPubkeyBase64url);
          const importedKey = await importVerifyKey(embeddedPubkeyBytes);

          // 重新计算 signable bytes（接收端也会去除 sig 后重新计算）
          const verifyBytes = computeSignableBytes(announcementPayload);
          const isValid = await verifySignature(importedKey, verifyBytes, sig);

          // 自验证必须成功
          expect(isValid).toBe(true);

          // 6. 验证存储的公钥与原始公钥字节相同
          //    模拟接收端存储流程：decode(encode(originalBytes)) === originalBytes
          const storedKeyBytes = decodePublicKey(encodePublicKey(keyPair.publicKeyBytes));

          // 长度必须相同（32 字节）
          expect(storedKeyBytes.length).toBe(keyPair.publicKeyBytes.length);
          expect(storedKeyBytes.length).toBe(32);

          // 逐字节比较：存储的公钥必须与原始公钥完全一致
          for (let i = 0; i < storedKeyBytes.length; i++) {
            expect(storedKeyBytes[i]).toBe(keyPair.publicKeyBytes[i]);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
