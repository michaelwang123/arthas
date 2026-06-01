/**
 * Property-based test: Payload Format Round-Trip
 *
 * Validates that buildPayload and parsePayload form a correct round-trip:
 * for any valid UTF-8 string (1–500 chars), parsePayload(buildPayload(text)).text === text.
 *
 * Also validates that reply metadata is preserved through the round-trip.
 *
 * **Validates: Requirements 5.3, 6.2**
 *
 * @module tests/utils/payload.property.test
 * @see src/utils/payload.ts
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildPayload, parsePayload, type ReplyData } from '../../src/utils/payload';

describe('Property 14: Payload Format Round-Trip', () => {
  /**
   * Core round-trip property: for any valid text string (1–500 chars),
   * parsePayload(buildPayload(text)).text === text.
   *
   * **Validates: Requirements 5.3, 6.2**
   */
  it('parsePayload(buildPayload(text)).text === text for any valid UTF-8 string (1–500 chars)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        (text) => {
          const payload = buildPayload(text);
          const parsed = parsePayload(payload);
          expect(parsed.text).toBe(text);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Round-trip with reply data: for any text and valid ReplyData,
   * parsePayload(buildPayload(text, reply)).reply should match the original reply.
   *
   * **Validates: Requirements 5.3, 6.2**
   */
  it('parsePayload(buildPayload(text, reply)).reply matches original reply data', () => {
    const replyArb: fc.Arbitrary<ReplyData> = fc.record({
      stableId: fc.string({ minLength: 1, maxLength: 50 }),
      senderName: fc.string({ minLength: 1, maxLength: 20 }),
      preview: fc.string({ minLength: 0, maxLength: 100 }),
    });

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        replyArb,
        (text, reply) => {
          const payload = buildPayload(text, reply);
          const parsed = parsePayload(payload);

          expect(parsed.text).toBe(text);
          expect(parsed.reply).toBeDefined();
          expect(parsed.reply!.stableId).toBe(reply.stableId);
          expect(parsed.reply!.senderName).toBe(reply.senderName);
          expect(parsed.reply!.preview).toBe(reply.preview);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * No reply case: when buildPayload is called without reply,
   * parsePayload should return undefined for reply.
   *
   * **Validates: Requirements 5.3, 6.2**
   */
  it('parsePayload(buildPayload(text)).reply is undefined when no reply provided', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        (text) => {
          const payload = buildPayload(text);
          const parsed = parsePayload(payload);
          expect(parsed.reply).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
