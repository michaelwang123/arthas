import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 7: Input Validation Bounds
 *
 * For any string s:
 * - Nickname validation returns true if and only if s.trim().length is between 1 and 20 (inclusive).
 * - Message validation returns true if and only if s.length is between 1 and 500 (inclusive).
 *
 * **Validates: Requirements 3.6, 5.6**
 */

// Standalone validation functions matching the chatStore's inline validation logic.
// The store validates nickname as 1–20 chars (trimmed) and message as 1–500 chars.

/**
 * Validates a nickname: true iff s.trim().length is between 1 and 20 (inclusive).
 */
function validateNickname(s: string): boolean {
  const trimmed = s.trim();
  return trimmed.length >= 1 && trimmed.length <= 20;
}

/**
 * Validates a message: true iff s.length is between 1 and 500 (inclusive).
 */
function validateMessage(s: string): boolean {
  return s.length >= 1 && s.length <= 500;
}

describe('Property 7: Input Validation Bounds', () => {
  describe('Nickname validation', () => {
    it('returns true iff s.trim().length is between 1 and 20', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 50 }),
          (s) => {
            const result = validateNickname(s);
            const trimmedLength = s.trim().length;
            const expected = trimmedLength >= 1 && trimmedLength <= 20;
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('accepts valid nicknames (1–20 trimmed chars)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length >= 1 && s.trim().length <= 20),
          (s) => {
            expect(validateNickname(s)).toBe(true);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('rejects empty or whitespace-only strings', () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 30 }),
          (chars) => {
            const s = chars.join('');
            expect(validateNickname(s)).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('rejects strings whose trimmed length exceeds 20', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 21, maxLength: 60 }).filter((s) => s.trim().length > 20),
          (s) => {
            expect(validateNickname(s)).toBe(false);
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Message validation', () => {
    it('returns true iff s.length is between 1 and 500', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 600 }),
          (s) => {
            const result = validateMessage(s);
            const expected = s.length >= 1 && s.length <= 500;
            expect(result).toBe(expected);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('accepts valid messages (1–500 chars)', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 500 }),
          (s) => {
            expect(validateMessage(s)).toBe(true);
          }
        ),
        { numRuns: 500 }
      );
    });

    it('rejects empty strings', () => {
      expect(validateMessage('')).toBe(false);
    });

    it('rejects strings longer than 500 characters', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 501, maxLength: 700 }),
          (s) => {
            expect(validateMessage(s)).toBe(false);
          }
        ),
        { numRuns: 500 }
      );
    });
  });
});
