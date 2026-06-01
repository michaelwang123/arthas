/**
 * Property-based test: Encryption Round-Trip
 *
 * Validates that encrypting then decrypting any UTF-8 string (1–500 chars)
 * with the same AES-256-GCM key produces the original plaintext.
 *
 * **Validates: Requirements 5.2, 6.2**
 *
 * @module tests/crypto/encrypt.property.test
 * @see src/crypto/encrypt.ts
 * @see src/crypto/decrypt.ts
 * @see src/crypto/keys.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fc from 'fast-check';
import { encryptMessage } from '../../src/crypto/encrypt';
import { decryptMessage } from '../../src/crypto/decrypt';
import { generateRoomKey } from '../../src/crypto/keys';

describe('Property 2: Encryption Round-Trip', () => {
  let key: CryptoKey;

  beforeAll(async () => {
    key = await generateRoomKey();
  });

  /**
   * Core round-trip property: for any valid UTF-8 plaintext (1–500 chars),
   * encrypt(key, plaintext) → decrypt(key, iv, ciphertext) === plaintext.
   *
   * **Validates: Requirements 5.2, 6.2**
   */
  it('encrypting then decrypting any UTF-8 string (1–500 chars) with the same key produces the original', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 500 }),
        async (plaintext) => {
          const { iv, ciphertext } = await encryptMessage(key, plaintext);
          const decrypted = await decryptMessage(key, iv, ciphertext);
          expect(decrypted).toBe(plaintext);
        }
      ),
      { numRuns: 200 }
    );
  });
});
