/**
 * Share code validation property test (Property 5).
 *
 * Verifies that `decodeShareKey` correctly rejects all malformed inputs:
 * - Strings with fewer than 2 or more than 4 colon-separated segments
 * - First segment (roomId) length ≠ 21
 * - Second segment (keyEncoded) length ≠ 43
 * - Third segment (if present) not a valid non-negative integer
 * - Fourth segment (if present) not a valid non-negative integer
 *
 * **Validates: Requirements 4.2**
 *
 * @module crypto/shareKey.validation.property.test
 * @see shareKey.ts — Share code encoding/decoding implementation
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { decodeShareKey } from '../../src/crypto/shareKey';

/** NanoID character set for generating valid room IDs */
const NANOID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Base64url character set for generating valid key encodings */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Generator for valid 21-character NanoID room IDs */
const arbRoomId = fc.array(
  fc.constantFrom(...NANOID_ALPHABET.split('')),
  { minLength: 21, maxLength: 21 }
).map(chars => chars.join(''));

/** Generator for valid 43-character base64url key encodings */
const arbKeyEncoded = fc.array(
  fc.constantFrom(...BASE64URL_ALPHABET.split('')),
  { minLength: 43, maxLength: 43 }
).map(chars => chars.join(''));

describe('Property 5: Share Code Validation Rejects Malformed Input', () => {
  /**
   * Strings with fewer than 2 colon-separated segments (0 or 1 segments) must return null.
   */
  it('rejects strings with fewer than 2 colon-separated segments', () => {
    fc.assert(
      fc.property(
        // Generate strings without colons (1 segment)
        fc.array(
          fc.constantFrom(...NANOID_ALPHABET.split('')),
          { minLength: 1, maxLength: 60 }
        ).map(chars => chars.join('')),
        (input) => {
          const result = decodeShareKey(input);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Strings with more than 4 colon-separated segments must return null.
   */
  it('rejects strings with more than 4 colon-separated segments', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 10 }),
        arbRoomId,
        arbKeyEncoded,
        (segmentCount, roomId, keyEncoded) => {
          // Build a string with the specified number of segments
          const segments = [roomId, keyEncoded];
          for (let i = 2; i < segmentCount; i++) {
            segments.push(String(i));
          }
          const input = segments.join(':');
          const result = decodeShareKey(input);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * First segment (roomId) with length ≠ 21 must return null.
   */
  it('rejects share codes where roomId length ≠ 21', () => {
    fc.assert(
      fc.property(
        // Generate roomId with length != 21 (either shorter or longer)
        fc.oneof(
          fc.array(
            fc.constantFrom(...NANOID_ALPHABET.split('')),
            { minLength: 0, maxLength: 20 }
          ).map(chars => chars.join('')),
          fc.array(
            fc.constantFrom(...NANOID_ALPHABET.split('')),
            { minLength: 22, maxLength: 50 }
          ).map(chars => chars.join(''))
        ),
        arbKeyEncoded,
        (badRoomId, keyEncoded) => {
          const code = `${badRoomId}:${keyEncoded}`;
          const result = decodeShareKey(code);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Second segment (keyEncoded) with length ≠ 43 must return null.
   */
  it('rejects share codes where keyEncoded length ≠ 43', () => {
    fc.assert(
      fc.property(
        arbRoomId,
        // Generate keyEncoded with length != 43 (either shorter or longer)
        fc.oneof(
          fc.array(
            fc.constantFrom(...BASE64URL_ALPHABET.split('')),
            { minLength: 0, maxLength: 42 }
          ).map(chars => chars.join('')),
          fc.array(
            fc.constantFrom(...BASE64URL_ALPHABET.split('')),
            { minLength: 44, maxLength: 80 }
          ).map(chars => chars.join(''))
        ),
        (roomId, badKeyEncoded) => {
          const code = `${roomId}:${badKeyEncoded}`;
          const result = decodeShareKey(code);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Third segment (ephemeral), if present, must be a valid non-negative integer.
   * Non-numeric strings, negative numbers, and decimals must cause null return.
   */
  it('rejects share codes where third segment is not a valid non-negative integer', () => {
    fc.assert(
      fc.property(
        arbRoomId,
        arbKeyEncoded,
        fc.oneof(
          // Non-numeric strings (letters, symbols)
          fc.array(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz!@#$%^&*().+-/'.split('')),
            { minLength: 1, maxLength: 10 }
          ).map(chars => chars.join('')),
          // Negative integers
          fc.integer({ min: -100000, max: -1 }).map(String),
          // Decimal numbers
          fc.tuple(fc.nat(1000), fc.integer({ min: 1, max: 99 }))
            .map(([whole, frac]) => `${whole}.${frac}`),
          // Empty string
          fc.constant('')
        ),
        (roomId, keyEncoded, badEphemeral) => {
          const code = `${roomId}:${keyEncoded}:${badEphemeral}`;
          const result = decodeShareKey(code);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Fourth segment (expiresAt), if present, must be a valid non-negative integer.
   * Non-numeric strings, negative numbers, and decimals must cause null return.
   */
  it('rejects share codes where fourth segment is not a valid non-negative integer', () => {
    fc.assert(
      fc.property(
        arbRoomId,
        arbKeyEncoded,
        // Valid ephemeral (third segment must be valid for fourth to be checked)
        fc.nat(86400).map(String),
        fc.oneof(
          // Non-numeric strings (letters, symbols)
          fc.array(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz!@#$%^&*().+-/'.split('')),
            { minLength: 1, maxLength: 10 }
          ).map(chars => chars.join('')),
          // Negative integers
          fc.integer({ min: -100000, max: -1 }).map(String),
          // Decimal numbers
          fc.tuple(fc.nat(1000), fc.integer({ min: 1, max: 99 }))
            .map(([whole, frac]) => `${whole}.${frac}`),
          // Empty string
          fc.constant('')
        ),
        (roomId, keyEncoded, validEphemeral, badExpiresAt) => {
          const code = `${roomId}:${keyEncoded}:${validEphemeral}:${badExpiresAt}`;
          const result = decodeShareKey(code);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
