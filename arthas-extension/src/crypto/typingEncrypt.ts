/**
 * Typing status encryption/decryption using AES-256-GCM.
 *
 * Encrypts the typing boolean as JSON before transmission so the relay server
 * cannot observe "who is typing" metadata. Uses the same Room_Key and
 * AES-256-GCM mode as message encryption for web client interoperability.
 *
 * Reference: arthas-client/src/crypto/typingEncrypt.ts
 */

import { encryptMessage } from './encrypt';
import { decryptMessage } from './decrypt';

/**
 * Encrypt typing status.
 *
 * Serializes the typing boolean as JSON and encrypts it with AES-256-GCM
 * using the room key. Each call generates a unique 96-bit random IV.
 *
 * @param key - AES-256-GCM CryptoKey (room shared key)
 * @param typing - Current typing state (true = typing, false = stopped)
 * @returns Object with base64url-encoded iv and ciphertext
 */
export async function encryptTypingStatus(
  key: CryptoKey,
  typing: boolean
): Promise<{ iv: string; ciphertext: string }> {
  const payload = JSON.stringify(typing);
  return encryptMessage(key, payload);
}

/**
 * Decrypt typing status.
 *
 * Decrypts the base64url-encoded iv and ciphertext using AES-256-GCM,
 * then parses the JSON to extract the typing boolean.
 *
 * @param key - AES-256-GCM CryptoKey (room shared key)
 * @param iv - base64url-encoded 96-bit IV
 * @param ciphertext - base64url-encoded ciphertext (includes GCM auth tag)
 * @returns The typing boolean value
 * @throws If decryption fails (wrong key, corrupted data, tampered ciphertext)
 */
export async function decryptTypingStatus(
  key: CryptoKey,
  iv: string,
  ciphertext: string
): Promise<boolean> {
  const plaintext = await decryptMessage(key, iv, ciphertext);
  return JSON.parse(plaintext) as boolean;
}
