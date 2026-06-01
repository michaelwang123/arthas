/**
 * Property 12: Server URL Validation (Strengthened)
 *
 * For any string `url`, the server URL validator should return `true`
 * if and only if `url` starts with `ws://` or `wss://`, has a valid host,
 * and ends with `/ws`.
 *
 * **Validates: Requirements 11.4**
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateServerUrl } from '../../src/utils/storage';

/** Generate a valid hostname (alphanumeric characters). */
const validHostArb = fc.tuple(
  fc.array(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    { minLength: 1, maxLength: 20 }
  ).map((chars) => chars.join('')),
  fc.constantFrom('', '.com', '.io', '.org', ':8080', ':3000')
).map(([host, suffix]) => `${host}${suffix}`);

describe('Property 12: Server URL Validation', () => {
  it('returns true for valid WebSocket URLs with proper host and /ws suffix', () => {
    const validUrlArb = fc.tuple(
      fc.constantFrom('ws://', 'wss://'),
      validHostArb,
      fc.constantFrom('', '/path')
    ).map(([protocol, host, path]) => `${protocol}${host}${path}/ws`);

    fc.assert(
      fc.property(validUrlArb, (url) => {
        expect(validateServerUrl(url)).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('returns false for any string that does NOT start with ws:// or wss://', () => {
    const invalidProtocolArb = fc.string({ minLength: 0, maxLength: 100 }).filter(
      (s) => !s.startsWith('ws://') && !s.startsWith('wss://')
    );

    fc.assert(
      fc.property(invalidProtocolArb, (url) => {
        expect(validateServerUrl(url)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('returns false for any string that does NOT end with /ws', () => {
    const noWsSuffixArb = fc.tuple(
      fc.constantFrom('ws://', 'wss://'),
      validHostArb
    )
      .map(([protocol, host]) => `${protocol}${host}`)
      .filter((url) => !url.endsWith('/ws'));

    fc.assert(
      fc.property(noWsSuffixArb, (url) => {
        expect(validateServerUrl(url)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('returns false for URLs with empty or invalid host', () => {
    // ws:///ws — no host
    expect(validateServerUrl('ws:///ws')).toBe(false);
    // ws:// /ws — space as host
    expect(validateServerUrl('ws:// /ws')).toBe(false);
    // wss:///ws — no host
    expect(validateServerUrl('wss:///ws')).toBe(false);
  });

  it('returns true for well-known valid server URLs', () => {
    expect(validateServerUrl('wss://chat.example.com/ws')).toBe(true);
    expect(validateServerUrl('ws://localhost:8080/ws')).toBe(true);
    expect(validateServerUrl('wss://192.168.1.1:3000/ws')).toBe(true);
    expect(validateServerUrl('ws://my-server.io/path/ws')).toBe(true);
  });
});
