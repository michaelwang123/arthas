/**
 * Share code encoding/decoding for room key distribution.
 * Format: {roomId}:{base64url(roomKey)}
 *   - roomId: NanoID 21 characters
 *   - separator: ':'
 *   - keyEncoded: base64url of 32 bytes = 43 characters
 *   - Total: 65 characters
 */

import { exportRoomKey } from './keys';

/** Expected lengths for share code validation */
const ROOM_ID_LENGTH = 21;
const KEY_ENCODED_LENGTH = 43; // base64url of 32 bytes (no padding)

/**
 * Encode a roomId and CryptoKey into a share code string.
 * Format: `{roomId}:{base64url(roomKey)}`
 */
export async function encodeShareKey(roomId: string, key: CryptoKey): Promise<string> {
  const keyEncoded = await exportRoomKey(key);
  return `${roomId}:${keyEncoded}`;
}

/**
 * Decode a share code string into its components.
 * Returns null if the format is invalid.
 *
 * Note: Returns the raw encoded key string, not a CryptoKey.
 * Use `importRoomKey(keyEncoded)` separately to get the CryptoKey.
 */
export function decodeShareKey(code: string): { roomId: string; keyEncoded: string } | null {
  if (typeof code !== 'string') return null;

  const separatorIndex = code.indexOf(':');
  if (separatorIndex === -1) return null;

  const roomId = code.slice(0, separatorIndex);
  const keyEncoded = code.slice(separatorIndex + 1);

  // Validate lengths
  if (roomId.length !== ROOM_ID_LENGTH) return null;
  if (keyEncoded.length !== KEY_ENCODED_LENGTH) return null;

  return { roomId, keyEncoded };
}
