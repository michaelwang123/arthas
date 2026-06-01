/**
 * Property-based test: Typing Encryption Round-Trip
 *
 * Property 13: For any boolean value and any valid AES-256-GCM CryptoKey,
 * encrypting the typing status and then decrypting the result with the same
 * key produces the original boolean.
 *
 * **Validates: Requirements 10.1, 10.3**
 *
 * @module tests/crypto/typingEncrypt.property.test
 * @see src/crypto/typingEncrypt.ts
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encryptTypingStatus, decryptTypingStatus } from '../../src/crypto/typingEncrypt';
import { generateRoomKey } from '../../src/crypto/keys';

describe('Property 13: Typing Encryption Round-Trip', () => {
  /**
   * For any boolean b and any AES-256-GCM key, encrypting then decrypting
   * must recover the original boolean value.
   *
   * **Validates: Requirements 10.1, 10.3**
   */
  it('encrypt then decrypt always recovers the original typing boolean', async () => {
    const key = await generateRoomKey();

    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (typing) => {
        const { iv, ciphertext } = await encryptTypingStatus(key, typing);
        const decrypted = await decryptTypingStatus(key, iv, ciphertext);
        expect(decrypted).toBe(typing);
      }),
      { numRuns: 100 }
    );
  });
});
