/**
 * Property-based test: MessagePack Codec Round-Trip
 *
 * Validates that encoding a valid `{type: uint8, data: object}` message envelope
 * with MessagePack and then decoding the resulting binary produces a deeply equal object.
 *
 * **Validates: Requirements 2.2, 2.3, 15.1, 15.2, 15.3**
 *
 * @module tests/network/codec.property.test
 * @see src/network/websocket.ts
 * @see src/network/protocol.ts
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { encode, decode } from '@msgpack/msgpack';

/**
 * Custom arbitrary that generates MessagePack-compatible values.
 * Excludes -0 (MessagePack normalizes -0 to +0), undefined (not representable),
 * and objects with `__proto__` keys (rejected by @msgpack/msgpack for prototype
 * pollution protection).
 * Uses JSON-safe primitives: strings, positive numbers, booleans, null,
 * arrays, and plain objects — all of which round-trip cleanly through MessagePack.
 */
function msgpackSafeValue(): fc.Arbitrary<unknown> {
  return fc.jsonValue().filter((v) => !containsNegativeZero(v) && !containsProtoKey(v));
}

/**
 * Recursively checks if a value contains -0 anywhere in its structure.
 */
function containsNegativeZero(value: unknown): boolean {
  if (typeof value === 'number') {
    return Object.is(value, -0);
  }
  if (Array.isArray(value)) {
    return value.some(containsNegativeZero);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(containsNegativeZero);
  }
  return false;
}

/**
 * Recursively checks if a value contains `__proto__` as an object key.
 * @msgpack/msgpack rejects __proto__ keys for prototype pollution protection.
 */
function containsProtoKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsProtoKey);
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.includes('__proto__')) return true;
    return Object.values(value as Record<string, unknown>).some(containsProtoKey);
  }
  return false;
}

describe('Property 1: MessagePack Codec Round-Trip', () => {
  /**
   * Core round-trip property: for any valid message envelope {type: uint8, data: object},
   * encode(msg) → decode(encoded) deeply equals the original message.
   *
   * Note: MessagePack does not preserve `undefined` or `-0` values — the generator
   * produces only MessagePack-compatible values (JSON-safe, no -0).
   *
   * **Validates: Requirements 2.2, 2.3, 15.1, 15.2, 15.3**
   */
  it('encoding then decoding any valid {type: uint8, data: object} produces a deeply equal object', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        msgpackSafeValue(),
        (type, data) => {
          const msg = { type, data };
          const encoded = encode(msg);
          const decoded = decode(encoded);
          expect(decoded).toEqual(msg);
        }
      ),
      { numRuns: 500 }
    );
  });
});
