/**
 * Shared base64url encoding/decoding utilities for the crypto layer.
 * Used by keys.ts, encrypt.ts, and decrypt.ts.
 */

/**
 * Encode raw bytes to base64url string (no padding).
 * Standard base64 with `+` → `-`, `/` → `_`, trailing `=` stripped.
 */
export function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode base64url string back to raw bytes.
 * Reverses `-` → `+`, `_` → `/`, restores padding.
 */
export function fromBase64Url(encoded: string): ArrayBuffer {
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  // Restore padding
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
