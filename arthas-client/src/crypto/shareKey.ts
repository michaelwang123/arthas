/**
 * 分享码编解码模块 — 负责房间密钥的分享码序列化与反序列化。
 *
 * 📚 学习要点: 分享码格式设计
 * 分享码将加入房间所需的全部信息编码为一个紧凑字符串，便于复制粘贴和 QR 码编码。
 * 使用 ':' 作为分隔符（不会出现在 base64url 编码中），支持可变段数以保持向后兼容。
 *
 * 格式定义（段数决定含义）：
 *   - 2 段: `{roomId}:{keyEncoded}` → ephemeral=0, expiresAt=0
 *   - 3 段: `{roomId}:{keyEncoded}:{ephemeral}` → expiresAt=0
 *   - 4 段: `{roomId}:{keyEncoded}:{ephemeral}:{expiresAt}`
 *
 * 编码规则：
 *   - expiresAt > 0 时：必须输出 4 段（ephemeral 段显式包含，即使为 0）
 *   - expiresAt == 0 且 ephemeral > 0 时：输出 3 段
 *   - expiresAt == 0 且 ephemeral == 0 时：输出 2 段（最紧凑）
 *
 * 验证规则（decodeShareKey 返回 null 的条件）：
 *   - 段数不在 [2, 4] 范围内
 *   - roomId 长度 ≠ 21（NanoID 固定长度）
 *   - keyEncoded 长度 ≠ 43（base64url 编码的 32 字节 AES-256 密钥）
 *   - ephemeral 段不是有效非负整数（含小数、负数、非数字字符串）
 *   - expiresAt 段不是有效非负整数（含小数、负数、非数字字符串）
 *
 * 安全说明：
 *   分享码中的 expiresAt 是信息性的（advisory），服务器是过期时间的唯一权威来源。
 *   客户端不应将分享码中的 expiresAt 作为安全边界。
 */

import { exportRoomKey } from './keys';

/** roomId 固定长度（NanoID 生成） */
const ROOM_ID_LENGTH = 21;

/** base64url 编码的 32 字节 AES-256 密钥长度（无 padding） */
const KEY_ENCODED_LENGTH = 43;

/**
 * 分享码解码后的组件接口。
 * 包含加入房间所需的全部信息。
 */
export interface ShareCodeComponents {
  /** 房间 ID（NanoID，固定 21 字符） */
  roomId: string;
  /** base64url 编码的房间密钥（固定 43 字符） */
  keyEncoded: string;
  /** 临时模式秒数，0 表示非临时模式 */
  ephemeral: number;
  /** 过期时间戳（Unix 秒），0 表示无过期。此值为信息性，服务器是唯一权威。 */
  expiresAt: number;
}

/**
 * 将 roomId 和 CryptoKey 编码为分享码字符串。
 *
 * 编码策略：
 * - expiresAt > 0: 输出 4 段 `{roomId}:{key}:{ephemeral}:{expiresAt}`（ephemeral 显式包含）
 * - expiresAt == 0 且 ephemeral > 0: 输出 3 段 `{roomId}:{key}:{ephemeral}`
 * - expiresAt == 0 且 ephemeral == 0: 输出 2 段 `{roomId}:{key}`（向后兼容）
 *
 * @param roomId - 房间 ID（NanoID，21 字符）
 * @param key - AES-256-GCM CryptoKey，将被导出为 base64url 字符串
 * @param ephemeral - 临时模式秒数，默认 0（非临时）
 * @param expiresAt - 过期时间戳（Unix 秒），默认 0（无过期）
 * @returns 编码后的分享码字符串
 */
export async function encodeShareKey(
  roomId: string,
  key: CryptoKey,
  ephemeral?: number,
  expiresAt?: number
): Promise<string> {
  const keyEncoded = await exportRoomKey(key);
  const base = `${roomId}:${keyEncoded}`;

  const eph = ephemeral ?? 0;
  const exp = expiresAt ?? 0;

  // 📚 学习要点: 4 段格式的必要性
  // 当 expiresAt > 0 时，必须显式包含 ephemeral 段（即使为 0），
  // 因为解码器通过段数来确定各段含义（位置编码，非键值对）。
  // 如果省略 ephemeral=0，则 3 段格式会将 expiresAt 误解为 ephemeral。
  if (exp > 0) {
    return `${base}:${eph}:${exp}`;
  }

  return eph > 0 ? `${base}:${eph}` : base;
}

/**
 * 验证字符串是否为有效的非负整数。
 *
 * 📚 学习要点: 严格整数验证 vs parseInt 宽松解析
 * parseInt("3.14") 返回 3，parseInt("12abc") 返回 12 — 这些都不是有效的整数段。
 * 我们需要严格验证：字符串必须完全由数字组成，且解析后为非负整数。
 * 使用正则 /^\d+$/ 确保只包含数字字符，再用 Number() 转换验证范围。
 *
 * 📚 学习要点: 字符串长度前置检查
 * JavaScript 的 Number 类型安全整数范围为 2^53 - 1（约 9×10^15，16 位数字）。
 * 超过 15 位的纯数字字符串经 Number() 转换后可能丢失精度（如末尾数字变为 0）。
 * 通过 length > 15 前置检查，在正则匹配前就拒绝不可能是安全整数的输入，
 * 避免精度丢失导致的静默错误。
 * 实际场景中 Unix 时间戳（10 位）和 ephemeral 秒数（最多 6 位）都远小于此限制。
 *
 * @param value - 待验证的字符串
 * @returns 解析后的非负整数，验证失败返回 null
 */
function parseNonNegativeInt(value: string): number | null {
  // 前置检查：超过 15 位的数字字符串可能超出 Number.MAX_SAFE_INTEGER
  if (value.length === 0 || value.length > 15) return null;

  // 必须是纯数字字符串（不允许前导负号、小数点、科学记号、空格等）
  if (!/^\d+$/.test(value)) return null;

  const num = Number(value);

  // 防御 Number.MAX_SAFE_INTEGER 溢出
  if (num > Number.MAX_SAFE_INTEGER) return null;

  return num;
}

/**
 * 将分享码字符串解码为组件对象。
 *
 * 支持 2/3/4 段格式（向后兼容旧客户端生成的分享码）：
 * - 2 段: `{roomId}:{keyEncoded}` → ephemeral=0, expiresAt=0
 * - 3 段: `{roomId}:{keyEncoded}:{ephemeral}` → expiresAt=0
 * - 4 段: `{roomId}:{keyEncoded}:{ephemeral}:{expiresAt}`
 *
 * 验证规则：
 * - roomId 长度必须为 21（NanoID 固定长度）
 * - keyEncoded 长度必须为 43（base64url 编码的 32 字节）
 * - ephemeral 必须为有效非负整数（纯数字字符串）
 * - expiresAt 必须为有效非负整数（纯数字字符串）
 *
 * ⚠️ Breaking change（行为变更）:
 * 旧实现对无效 ephemeral 段使用 `parseInt(x) || 0` 静默接受（如 "3.14" → 3, "abc" → 0）。
 * 新实现采用严格验证：ephemeral/expiresAt 段必须是纯数字字符串，否则返回 null。
 * 这意味着包含非法 ephemeral 值的畸形分享码将被拒绝，而非静默降级。
 * 此变更提高了数据完整性，防止因格式错误导致的静默行为异常。
 *
 * @param code - 分享码字符串
 * @returns 解码后的组件对象，格式无效时返回 null
 */
export function decodeShareKey(code: string): ShareCodeComponents | null {
  if (typeof code !== 'string') return null;

  const parts = code.split(':');

  // 段数必须在 [2, 4] 范围内
  if (parts.length < 2 || parts.length > 4) return null;

  const roomId = parts[0];
  const keyEncoded = parts[1];

  // 验证 roomId 长度（NanoID 固定 21 字符）
  if (roomId.length !== ROOM_ID_LENGTH) return null;

  // 验证 keyEncoded 长度（base64url 编码的 32 字节 = 43 字符）
  if (keyEncoded.length !== KEY_ENCODED_LENGTH) return null;

  // 解析 ephemeral 段（第 3 段，可选）
  let ephemeral = 0;
  if (parts.length >= 3) {
    const parsed = parseNonNegativeInt(parts[2]);
    // ⚠️ Breaking change: 旧实现使用 parseInt(x) || 0 静默接受无效值，
    // 新实现严格验证，无效值直接返回 null
    if (parsed === null) return null;
    ephemeral = parsed;
  }

  // 解析 expiresAt 段（第 4 段，可选）
  let expiresAt = 0;
  if (parts.length === 4) {
    const parsed = parseNonNegativeInt(parts[3]);
    if (parsed === null) return null;
    expiresAt = parsed;
  }

  return { roomId, keyEncoded, ephemeral, expiresAt };
}
