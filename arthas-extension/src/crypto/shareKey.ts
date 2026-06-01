/**
 * Share code encoding/decoding — serializes room key info into a compact
 * colon-separated string suitable for copy-paste and QR code encoding.
 *
 * Format (segment count determines meaning):
 *   - 2 segments: `{roomId}:{keyEncoded}` → ephemeral=0, expiresAt=0
 *   - 3 segments: `{roomId}:{keyEncoded}:{ephemeral}` → expiresAt=0
 *   - 4 segments: `{roomId}:{keyEncoded}:{ephemeral}:{expiresAt}`
 *
 * Encoding rules:
 *   - expiresAt > 0: output 4 segments (ephemeral included explicitly, even if 0)
 *   - expiresAt == 0 && ephemeral > 0: output 3 segments
 *   - expiresAt == 0 && ephemeral == 0: output 2 segments (most compact)
 *
 * Validation rules (decodeShareKey returns null when):
 *   - Segment count not in [2, 4]
 *   - roomId length ≠ 21 (NanoID fixed length)
 *   - keyEncoded length ≠ 43 (base64url-encoded 32-byte AES-256 key)
 *   - ephemeral is not a valid non-negative integer
 *   - expiresAt is not a valid non-negative integer
 */

import { exportRoomKey } from './keys';

/** NanoID-generated roomId fixed length */
const ROOM_ID_LENGTH = 21;

/** base64url-encoded 32-byte AES-256 key length (no padding) */
const KEY_ENCODED_LENGTH = 43;

/**
 * Decoded share code components containing all info needed to join a room.
 */
export interface ShareCodeComponents {
  /** Room ID (NanoID, fixed 21 characters) */
  roomId: string;
  /** base64url-encoded room key (fixed 43 characters) */
  keyEncoded: string;
  /** Ephemeral mode seconds, 0 means non-ephemeral */
  ephemeral: number;
  /** Expiry timestamp (Unix seconds), 0 means no expiry. Advisory only — server is authoritative. */
  expiresAt: number;
}

/**
 * Encode a roomId and CryptoKey into a share code string.
 *
 * @param roomId - Room ID (NanoID, 21 characters)
 * @param key - AES-256-GCM CryptoKey to export as base64url
 * @param ephemeral - Ephemeral mode seconds, defaults to 0
 * @param expiresAt - Expiry timestamp (Unix seconds), defaults to 0
 * @returns Encoded share code string
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

  // When expiresAt > 0, must include ephemeral explicitly (even if 0)
  // because the decoder uses positional segments, not key-value pairs.
  if (exp > 0) {
    return `${base}:${eph}:${exp}`;
  }

  return eph > 0 ? `${base}:${eph}` : base;
}

/**
 * Validate a string as a non-negative integer.
 * Rejects decimals, negatives, non-numeric strings, and values exceeding safe integer range.
 *
 * @param value - String to validate
 * @returns Parsed non-negative integer, or null if invalid
 */
function parseNonNegativeInt(value: string): number | null {
  // Reject empty strings and strings too long to be safe integers
  if (value.length === 0 || value.length > 15) return null;

  // Must be purely digits (no leading minus, decimal point, scientific notation, spaces)
  if (!/^\d+$/.test(value)) return null;

  const num = Number(value);

  // Guard against Number.MAX_SAFE_INTEGER overflow
  if (num > Number.MAX_SAFE_INTEGER) return null;

  return num;
}

/**
 * Decode a share code string into its component parts.
 *
 * Supports 2/3/4 segment formats for backward compatibility:
 *   - 2 segments: `{roomId}:{keyEncoded}` → ephemeral=0, expiresAt=0
 *   - 3 segments: `{roomId}:{keyEncoded}:{ephemeral}` → expiresAt=0
 *   - 4 segments: `{roomId}:{keyEncoded}:{ephemeral}:{expiresAt}`
 *
 * @param code - Share code string
 * @returns Decoded components, or null if the code is malformed
 */
export function decodeShareKey(code: string): ShareCodeComponents | null {
  if (typeof code !== 'string') return null;

  const parts = code.split(':');

  // Segment count must be in [2, 4]
  if (parts.length < 2 || parts.length > 4) return null;

  const roomId = parts[0] as string;
  const keyEncoded = parts[1] as string;

  // Validate roomId length (NanoID fixed 21 characters)
  if (roomId.length !== ROOM_ID_LENGTH) return null;

  // Validate keyEncoded length (base64url-encoded 32 bytes = 43 characters)
  if (keyEncoded.length !== KEY_ENCODED_LENGTH) return null;

  // Parse ephemeral segment (3rd segment, optional)
  let ephemeral = 0;
  if (parts.length >= 3) {
    const parsed = parseNonNegativeInt(parts[2] as string);
    if (parsed === null) return null;
    ephemeral = parsed;
  }

  // Parse expiresAt segment (4th segment, optional)
  let expiresAt = 0;
  if (parts.length === 4) {
    const parsed = parseNonNegativeInt(parts[3] as string);
    if (parsed === null) return null;
    expiresAt = parsed;
  }

  return { roomId, keyEncoded, ephemeral, expiresAt };
}
