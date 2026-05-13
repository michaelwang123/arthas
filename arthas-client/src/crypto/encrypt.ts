/**
 * Message encryption using AES-256-GCM via Web Crypto API.
 * Each message gets a unique random 96-bit IV for semantic security.
 */

import { toBase64Url } from './utils';

/**
 * Encrypt a plaintext message using AES-256-GCM.
 *
 * @param key - AES-256-GCM CryptoKey (the room key)
 * @param plaintext - UTF-8 string to encrypt
 * @returns Object with base64url-encoded IV and ciphertext
 */
export async function encryptMessage(
  key: CryptoKey,
  plaintext: string
): Promise<{ iv: string; ciphertext: string }> {
  // 1. Generate a random 96-bit (12 bytes) IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 2. Encode plaintext to UTF-8 bytes
  const plaintextBytes = new TextEncoder().encode(plaintext);

  // 3. Encrypt using AES-GCM
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintextBytes
  );

  // 4. Return base64url-encoded IV and ciphertext
  return {
    iv: toBase64Url(iv.buffer),
    ciphertext: toBase64Url(ciphertextBuffer),
  };
}
