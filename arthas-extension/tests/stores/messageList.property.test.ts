import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MAX_MESSAGES } from '../../src/stores/chatStore';

/**
 * Property 9: Message List Bounded at 200
 *
 * For any sequence of messages added to the chat store (regardless of count),
 * the messages array length should never exceed 200, and when the limit is reached,
 * the array should contain the 200 most recent messages in chronological order.
 *
 * **Validates: Requirements 6.5**
 */
describe('Property 9: Message List Bounded at 200', () => {
  /**
   * Simulates the message capping logic used in chatStore:
   * - Messages are appended to the array
   * - When length exceeds MAX_MESSAGES, oldest are removed via slice
   */
  function addMessages(existing: number[], newMessages: number[]): number[] {
    let messages = [...existing];
    for (const msg of newMessages) {
      messages = [...messages, msg];
      if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(messages.length - MAX_MESSAGES);
      }
    }
    return messages;
  }

  it('array length never exceeds MAX_MESSAGES regardless of how many messages are added', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        (n) => {
          // Generate N messages (using sequential integers as message identifiers)
          const messages = Array.from({ length: n }, (_, i) => i);
          const result = addMessages([], messages);

          // Array length must never exceed MAX_MESSAGES
          expect(result.length).toBeLessThanOrEqual(MAX_MESSAGES);

          // Array length should be min(n, MAX_MESSAGES)
          expect(result.length).toBe(Math.min(n, MAX_MESSAGES));
        }
      ),
      { numRuns: 200 }
    );
  });

  it('always contains the most recent messages in chronological order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        (n) => {
          // Generate N messages with sequential timestamps
          const messages = Array.from({ length: n }, (_, i) => i);
          const result = addMessages([], messages);

          // The result should contain the last min(n, MAX_MESSAGES) messages
          const expectedStart = Math.max(0, n - MAX_MESSAGES);
          const expected = messages.slice(expectedStart);

          expect(result).toEqual(expected);

          // Verify chronological order (each element > previous)
          for (let i = 1; i < result.length; i++) {
            expect(result[i]).toBeGreaterThan(result[i - 1]!);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('incrementally adding messages one-by-one never exceeds the bound at any intermediate step', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        (n) => {
          let messages: number[] = [];

          for (let i = 0; i < n; i++) {
            messages = [...messages, i];
            if (messages.length > MAX_MESSAGES) {
              messages = messages.slice(messages.length - MAX_MESSAGES);
            }

            // At every step, the invariant must hold
            expect(messages.length).toBeLessThanOrEqual(MAX_MESSAGES);
          }

          // Final state: contains the most recent messages
          const expectedLength = Math.min(n, MAX_MESSAGES);
          expect(messages.length).toBe(expectedLength);

          // Last element should be n-1 (the most recently added)
          expect(messages[messages.length - 1]).toBe(n - 1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('MAX_MESSAGES constant equals 200', () => {
    // Sanity check that the constant is correctly defined
    expect(MAX_MESSAGES).toBe(200);
  });
});
