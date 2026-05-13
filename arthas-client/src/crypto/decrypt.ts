/**
 * Message decryption using AES-256-GCM via Web Crypto API.
 * Reverses the encryption performed by encrypt.ts.
 */

import { fromBase64Url } from './utils';

/**
 * Decrypt a ciphertext message using AES-256-GCM.
 *
 * @param key - AES-256-GCM CryptoKey (the room key)
 * @param iv - base64url-encoded 96-bit IV
 * @param ciphertext - base64url-encoded ciphertext (includes GCM auth tag)
 * @returns The decrypted UTF-8 plaintext string
 * @throws If decryption fails (wrong key, corrupted data, tampered ciphertext)
 */
export async function decryptMessage(
  key: CryptoKey,
  iv: string,
  ciphertext: string
): Promise<string> {
  // 1. Decode base64url IV back to bytes
  const ivBytes = new Uint8Array(fromBase64Url(iv));

  // 2. Decode base64url ciphertext back to bytes
  const ciphertextBytes = new Uint8Array(fromBase64Url(ciphertext));

  // 3. Decrypt using AES-GCM (throws on wrong key or tampered data)
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    ciphertextBytes
  );

  // 4. Decode plaintext bytes to UTF-8 string
  return new TextDecoder().decode(plaintextBuffer);
}
