/**
 * Share code round-trip property test.
 *
 * Validates that for any valid roomId (21 chars), any generated AES-256-GCM key,
 * any non-negative ephemeral, and any non-negative expiresAt, encoding a share code
 * with encodeShareKey and then decoding with decodeShareKey produces matching components.
 *
 * **Validates: Requirements 3.4, 4.1**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encodeShareKey, decodeShareKey } from '../../src/crypto/shareKey';

/**
 * NanoID alphabet used by the server for room IDs.
 */
const NANOID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Constrained generator for valid 21-character room IDs using NanoID charset.
 * Avoids colons and other characters that would break the colon-separated format.
 */
const arbRoomId = fc.array(
  fc.constantFrom(...NANOID_ALPHABET.split('')),
  { minLength: 21, maxLength: 21 }
).map(chars => chars.join(''));

/**
 * Generator for 32-byte raw key material (AES-256 = 256 bits = 32 bytes).
 */
const arbKeyBytes = fc.uint8Array({ minLength: 32, maxLength: 32 });

/**
 * Generator for ephemeral values (non-negative integers, practical range).
 */
const arbEphemeral = fc.nat();

/**
 * Generator for expiresAt values (non-negative integers, practical range).
 */
const arbExpiresAt = fc.nat();

/**
 * Helper: create a real CryptoKey from raw bytes for use in encode/decode tests.
 */
async function createCryptoKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawBytes as BufferSource,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

describe('Property 4: Share Code Round-Trip', () => {
  /**
   * For any valid roomId (21 chars), any generated key, any non-negative ephemeral
   * and expiresAt, encode → decode produces matching roomId, keyEncoded length 43,
   * matching ephemeral and expiresAt.
   *
   * **Validates: Requirements 3.4, 4.1**
   */
  it('encode→decode round-trip preserves roomId, keyEncoded length, ephemeral, and expiresAt', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRoomId,
        arbKeyBytes,
        arbEphemeral,
        arbExpiresAt,
        async (roomId, keyBytes, ephemeral, expiresAt) => {
          const cryptoKey = await createCryptoKey(keyBytes);

          // Encode
          const encoded = await encodeShareKey(roomId, cryptoKey, ephemeral, expiresAt);

          // Decode
          const decoded = decodeShareKey(encoded);

          // Decode must succeed
          expect(decoded).not.toBeNull();

          // roomId matches original
          expect(decoded!.roomId).toBe(roomId);

          // keyEncoded has length 43 (base64url of 32 bytes without padding)
          expect(decoded!.keyEncoded.length).toBe(43);

          // ephemeral matches original
          expect(decoded!.ephemeral).toBe(ephemeral);

          // expiresAt matches original
          expect(decoded!.expiresAt).toBe(expiresAt);
        }
      ),
      { numRuns: 100 }
    );
  });
});
