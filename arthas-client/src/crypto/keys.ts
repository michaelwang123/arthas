/**
 * Room key management using Web Crypto API (AES-256-GCM).
 * No third-party crypto libraries — browser-native only.
 */

import { toBase64Url, fromBase64Url } from './utils';

/**
 * Generate a new AES-256-GCM CryptoKey for a chat room.
 * The key is extractable so it can be exported and shared.
 */
export async function generateRoomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable — needed for export/sharing
    ['encrypt', 'decrypt']
  );
}

/**
 * Export a CryptoKey to a base64url-encoded string (43 chars for 32 bytes).
 */
export async function exportRoomKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return toBase64Url(raw);
}

/**
 * Import a base64url-encoded string back into an AES-256-GCM CryptoKey.
 */
export async function importRoomKey(encoded: string): Promise<CryptoKey> {
  const raw = fromBase64Url(encoded);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    true, // extractable — allows re-export if needed
    ['encrypt', 'decrypt']
  );
}
