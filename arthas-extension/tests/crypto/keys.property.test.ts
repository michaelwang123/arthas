import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { generateRoomKey, exportRoomKey, importRoomKey } from '../../src/crypto/keys';
import { encryptMessage } from '../../src/crypto/encrypt';
import { decryptMessage } from '../../src/crypto/decrypt';

/**
 * Property 3: Key Export/Import Round-Trip
 *
 * For any freshly generated AES-256-GCM CryptoKey, exporting it to base64url
 * and then importing the base64url string back should produce a CryptoKey that
 * encrypts/decrypts identically to the original.
 *
 * **Validates: Requirements 4.3**
 */
describe('Property 3: Key Export/Import Round-Trip', () => {
  it('exported then imported key can decrypt what the original key encrypted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 500 }),
        async (plaintext) => {
          // Generate a fresh key
          const originalKey = await generateRoomKey();

          // Export and re-import the key
          const exported = await exportRoomKey(originalKey);
          const importedKey = await importRoomKey(exported);

          // Encrypt with the original key
          const { iv, ciphertext } = await encryptMessage(originalKey, plaintext);

          // Decrypt with the imported key — should produce the original plaintext
          const decrypted = await decryptMessage(importedKey, iv, ciphertext);
          expect(decrypted).toBe(plaintext);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('imported then re-exported key produces the same base64url string', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null), // no input needed, key is generated fresh each run
        async () => {
          const key = await generateRoomKey();

          // Export → import → re-export should yield the same encoded string
          const exported1 = await exportRoomKey(key);
          const reimported = await importRoomKey(exported1);
          const exported2 = await exportRoomKey(reimported);

          expect(exported2).toBe(exported1);
        }
      ),
      { numRuns: 50 }
    );
  });

  it('exported key is always 43 characters (base64url of 32 bytes)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(null),
        async () => {
          const key = await generateRoomKey();
          const exported = await exportRoomKey(key);

          // 32 bytes → ceil(32 * 4/3) = 43 base64url chars (no padding)
          expect(exported).toHaveLength(43);
        }
      ),
      { numRuns: 50 }
    );
  });
});
