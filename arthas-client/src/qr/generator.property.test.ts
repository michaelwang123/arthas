/**
 * buildJoinURL 属性测试（Property-Based Test）。
 *
 * 本文件使用 fast-check 验证 buildJoinURL 和 parseJoinRoute 之间的往返一致性：
 * - Property 1: Join URL round-trip — 任意有效 shareCode 经 buildJoinURL 生成 URL，
 *   再经 parseJoinRoute 解析 hash 部分后，还原为原始 shareCode。
 *
 * 📚 学习要点: 为什么需要 round-trip 属性测试？
 * buildJoinURL 和 parseJoinRoute 是 QR 码分享流程的两端：
 * - buildJoinURL: 房间创建者生成 Join URL → 编码为 QR 码
 * - parseJoinRoute: 扫码者打开 URL → 解析 hash 提取 shareCode → 加入房间
 * 如果这两个函数不是精确的逆操作，用户扫码后将无法正确加入房间。
 * 属性测试通过随机生成大量 shareCode（包含 `:` 分隔符的多段格式），
 * 验证在整个合法输入空间中 round-trip 始终成立。
 *
 * 📚 学习要点: 测试中的 URL 结构分解
 * buildJoinURL 生成完整 URL（如 `https://example.com/#/join/roomId:key:0:1700000000`），
 * 而 parseJoinRoute 只处理 hash 部分（如 `#/join/roomId:key:0:1700000000`）。
 * 因此测试需要从完整 URL 中提取 hash 部分（`#` 及其后的所有内容），
 * 再传递给 parseJoinRoute 进行解析。
 *
 * Feature: qr-share-and-room-expiry, Property 1: Join URL round-trip
 *
 * **Validates: Requirements 1.2, 3.1**
 *
 * @module qr/generator.property.test
 * @see generator.ts — buildJoinURL 实现
 * @see ../pages/Home.tsx — parseJoinRoute 实现
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { buildJoinURL } from './generator';
import { parseJoinRoute } from '../pages/Home';

/**
 * NanoID 字符集（与服务器一致）。
 * 用于生成合法的 21 字符房间 ID。
 */
const NANOID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Base64url 字符集（RFC 4648 §5）。
 * 用于生成合法的 43 字符密钥编码。
 */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * 生成合法的 21 字符 NanoID 房间标识符。
 *
 * 📚 学习要点: 约束生成器
 * NanoID 使用 [A-Za-z0-9_-] 字符集，固定 21 字符长度。
 * 自定义 arbitrary 确保生成的 roomId 始终符合实际格式。
 */
const arbRoomId = fc.array(
  fc.constantFrom(...NANOID_ALPHABET.split('')),
  { minLength: 21, maxLength: 21 }
).map(chars => chars.join(''));

/**
 * 生成合法的 43 字符 base64url 密钥编码。
 *
 * 📚 学习要点: 为什么是 43 字符？
 * AES-256 密钥为 32 字节，base64url 编码后为 ceil(32*4/3) = 43 字符（无填充）。
 */
const arbKeyEncoded = fc.array(
  fc.constantFrom(...BASE64URL_ALPHABET.split('')),
  { minLength: 43, maxLength: 43 }
).map(chars => chars.join(''));

/**
 * 生成合法的 ephemeral 值（非负整数，常见值：0, 10, 30, 60, 300）。
 */
const arbEphemeral = fc.nat({ max: 3600 });

/**
 * 生成合法的 expiresAt 值（非负整数，Unix 秒时间戳或 0）。
 * 范围覆盖 0（无过期）到合理的未来时间戳。
 */
const arbExpiresAt = fc.nat({ max: 2000000000 });

/**
 * 生成真实的 4 段分享码字符串（roomId:key:ephemeral:expiresAt）。
 *
 * 📚 学习要点: 分享码格式
 * Arthas 分享码使用 `:` 作为分隔符，包含 2-4 段：
 * - 2 段: {roomId}:{key}
 * - 3 段: {roomId}:{key}:{ephemeral}
 * - 4 段: {roomId}:{key}:{ephemeral}:{expiresAt}
 * 本测试生成所有格式变体，验证 round-trip 在各种段数下都成立。
 */
const arbShareCode = fc.oneof(
  // 2 段格式: roomId:key
  fc.tuple(arbRoomId, arbKeyEncoded).map(
    ([roomId, key]) => `${roomId}:${key}`
  ),
  // 3 段格式: roomId:key:ephemeral
  fc.tuple(arbRoomId, arbKeyEncoded, arbEphemeral).map(
    ([roomId, key, eph]) => `${roomId}:${key}:${eph}`
  ),
  // 4 段格式: roomId:key:ephemeral:expiresAt
  fc.tuple(arbRoomId, arbKeyEncoded, arbEphemeral, arbExpiresAt).map(
    ([roomId, key, eph, exp]) => `${roomId}:${key}:${eph}:${exp}`
  )
);

describe('Feature: qr-share-and-room-expiry, Property 1: Join URL round-trip', () => {
  /**
   * 设置测试环境：mock VITE_APP_URL 环境变量。
   *
   * 📚 学习要点: 为什么需要 mock import.meta.env？
   * buildJoinURL 使用 import.meta.env.VITE_APP_URL 作为 base URL。
   * 在测试环境中，该变量可能未定义，导致 fallback 到 window.location.origin。
   * 通过 vi.stubEnv 设置固定值，确保测试结果可预测。
   */
  beforeEach(() => {
    vi.stubEnv('VITE_APP_URL', 'https://chat.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * Property 1: Join URL round-trip
   *
   * 对任意有效 shareCode 字符串：
   * 1. buildJoinURL(shareCode) 生成完整 URL
   * 2. 从 URL 中提取 hash 部分（`#` 及其后内容）
   * 3. parseJoinRoute(hash) 解析出 shareCode
   * 4. 解析结果必须等于原始 shareCode
   *
   * 📚 学习要点: 提取 hash 的方式
   * 使用 URL 对象解析完整 URL，通过 url.hash 获取 hash 部分。
   * 这比字符串分割更可靠，因为 URL 对象正确处理各种边界情况
   * （如 base URL 中包含 `#` 的异常情况）。
   *
   * **Validates: Requirements 1.2, 3.1**
   */
  it('buildJoinURL(shareCode) → extract hash → parseJoinRoute(hash) === shareCode', () => {
    fc.assert(
      fc.property(
        arbShareCode,
        (shareCode) => {
          // Step 1: 构建完整 Join URL
          const joinUrl = buildJoinURL(shareCode);

          // Step 2: 从 URL 中提取 hash 部分
          // 使用 URL 对象解析，确保正确提取 hash（含 # 前缀）
          const url = new URL(joinUrl);
          const hash = url.hash;

          // Step 3: 使用 parseJoinRoute 解析 hash
          const parsed = parseJoinRoute(hash);

          // Step 4: 验证 round-trip 一致性
          expect(parsed).toBe(shareCode);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 补充验证：buildJoinURL 生成的 URL 格式正确。
   *
   * 验证 URL 结构为 `{base}/#/join/{shareCode}`，
   * 确保 hash 部分以 `#/join/` 开头且不包含双斜杠。
   *
   * **Validates: Requirements 1.2, 3.1**
   */
  it('buildJoinURL produces URL with correct structure: {base}/#/join/{shareCode}', () => {
    fc.assert(
      fc.property(
        arbShareCode,
        (shareCode) => {
          const joinUrl = buildJoinURL(shareCode);

          // URL 应以配置的 base 开头
          expect(joinUrl).toContain('https://chat.example.com');

          // URL 不应包含双斜杠（除了 https:// 中的）
          const afterProtocol = joinUrl.replace('https://', '');
          expect(afterProtocol).not.toContain('//');

          // Hash 部分格式正确
          const url = new URL(joinUrl);
          expect(url.hash).toBe(`#/join/${shareCode}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});
