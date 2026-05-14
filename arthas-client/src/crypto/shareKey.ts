/**
 * Share code encoding/decoding for room key distribution.
 * Format: {roomId}:{base64url(roomKey)}[:{ephemeral}]
 *   - roomId: NanoID 21 characters
 *   - separator: ':'
 *   - keyEncoded: base64url of 32 bytes = 43 characters
 *   - ephemeral (optional): seconds for ephemeral mode, omitted when 0
 */

import { exportRoomKey } from './keys';

/** Expected lengths for share code validation */
const ROOM_ID_LENGTH = 21;
const KEY_ENCODED_LENGTH = 43; // base64url of 32 bytes (no padding)

/**
 * Encode a roomId and CryptoKey into a share code string.
 * Format: `{roomId}:{base64url(roomKey)}` or `{roomId}:{base64url(roomKey)}:{ephemeral}`
 * The ephemeral segment is omitted when ephemeral is 0 or not provided (backward compatible).
 */
export async function encodeShareKey(roomId: string, key: CryptoKey, ephemeral?: number): Promise<string> {
  const keyEncoded = await exportRoomKey(key);
  const base = `${roomId}:${keyEncoded}`;
  return ephemeral && ephemeral > 0 ? `${base}:${ephemeral}` : base;
}

/**
 * Decode a share code string into its components.
 * Returns null if the format is invalid.
 *
 * Backward compatible: old format (no third segment) parses as ephemeral=0.
 *
 * Note: Returns the raw encoded key string, not a CryptoKey.
 * Use `importRoomKey(keyEncoded)` separately to get the CryptoKey.
 */
export function decodeShareKey(code: string): { roomId: string; keyEncoded: string; ephemeral: number } | null {
  if (typeof code !== 'string') return null;

  const parts = code.split(':');
  if (parts.length < 2) return null;

  const roomId = parts[0];
  const keyEncoded = parts[1];

  // Validate lengths
  if (roomId.length !== ROOM_ID_LENGTH) return null;
  if (keyEncoded.length !== KEY_ENCODED_LENGTH) return null;

  return {
    roomId,
    keyEncoded,
    ephemeral: parts.length >= 3 ? parseInt(parts[2], 10) || 0 : 0,
  };
}
