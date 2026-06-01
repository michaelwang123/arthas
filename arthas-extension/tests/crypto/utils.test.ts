import { describe, it, expect } from 'vitest';
import { toBase64Url, fromBase64Url } from '../../src/crypto/utils';

describe('toBase64Url', () => {
  it('encodes an empty buffer to empty string', () => {
    const buffer = new ArrayBuffer(0);
    expect(toBase64Url(buffer)).toBe('');
  });

  it('encodes a known byte sequence correctly', () => {
    // [0x48, 0x65, 0x6c, 0x6c, 0x6f] = "Hello" in ASCII
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const result = toBase64Url(bytes.buffer);
    expect(result).toBe('SGVsbG8'); // base64url of "Hello" without padding
  });

  it('replaces + with - and / with _', () => {
    // Bytes that produce + and / in standard base64: [0xfb, 0xff, 0xfe]
    const bytes = new Uint8Array([0xfb, 0xff, 0xfe]);
    const result = toBase64Url(bytes.buffer);
    expect(result).not.toContain('+');
    expect(result).not.toContain('/');
    expect(result).not.toContain('=');
  });

  it('strips padding characters', () => {
    // Single byte produces 2 base64 chars + 2 padding
    const bytes = new Uint8Array([0x41]); // 'A'
    const result = toBase64Url(bytes.buffer);
    expect(result).not.toContain('=');
    expect(result).toBe('QQ');
  });
});

describe('fromBase64Url', () => {
  it('decodes an empty string to empty buffer', () => {
    const buffer = fromBase64Url('');
    expect(buffer.byteLength).toBe(0);
  });

  it('decodes a known base64url string correctly', () => {
    const buffer = fromBase64Url('SGVsbG8'); // "Hello"
    const bytes = new Uint8Array(buffer);
    expect(Array.from(bytes)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  });

  it('handles URL-safe characters (- and _)', () => {
    // Encode then decode should round-trip
    const original = new Uint8Array([0xfb, 0xff, 0xfe]);
    const encoded = toBase64Url(original.buffer);
    const decoded = new Uint8Array(fromBase64Url(encoded));
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});

describe('round-trip', () => {
  it('toBase64Url → fromBase64Url preserves data', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 255, 0, 128]);
    const encoded = toBase64Url(original.buffer);
    const decoded = new Uint8Array(fromBase64Url(encoded));
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('handles 32-byte key-sized buffers (AES-256)', () => {
    const key = new Uint8Array(32);
    for (let i = 0; i < 32; i++) key[i] = i * 8;
    const encoded = toBase64Url(key.buffer);
    const decoded = new Uint8Array(fromBase64Url(encoded));
    expect(Array.from(decoded)).toEqual(Array.from(key));
  });

  it('handles 12-byte IV-sized buffers (96-bit)', () => {
    const iv = new Uint8Array(12);
    for (let i = 0; i < 12; i++) iv[i] = i * 20;
    const encoded = toBase64Url(iv.buffer);
    const decoded = new Uint8Array(fromBase64Url(encoded));
    expect(Array.from(decoded)).toEqual(Array.from(iv));
  });
});
