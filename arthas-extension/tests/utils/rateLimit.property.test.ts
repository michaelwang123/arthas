import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { canSend, recordSend, reset, MAX_MESSAGES, WINDOW_MS } from '../../src/utils/rateLimit';

/**
 * Property 6: Rate Limiter Invariant
 *
 * For any sequence of N message send attempts within a 10-second sliding window,
 * the rate limiter should allow exactly the first 10 and reject all subsequent
 * attempts until timestamps older than 10 seconds are evicted from the window.
 *
 * **Validates: Requirements 5.5**
 */
describe('Property 6: Rate Limiter Invariant', () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exactly the first MAX_MESSAGES attempts within a window are allowed, subsequent rejected', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        (totalAttempts) => {
          reset();
          vi.setSystemTime(0);

          let allowed = 0;
          let rejected = 0;

          for (let i = 0; i < totalAttempts; i++) {
            if (canSend()) {
              recordSend();
              allowed++;
            } else {
              rejected++;
            }
          }

          const expectedAllowed = Math.min(totalAttempts, MAX_MESSAGES);
          const expectedRejected = Math.max(0, totalAttempts - MAX_MESSAGES);

          expect(allowed).toBe(expectedAllowed);
          expect(rejected).toBe(expectedRejected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('after window expires, capacity is fully restored', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        (firstBatch, secondBatch) => {
          reset();
          vi.setSystemTime(0);

          // Send first batch within the window
          let firstAllowed = 0;
          for (let i = 0; i < firstBatch; i++) {
            if (canSend()) {
              recordSend();
              firstAllowed++;
            }
          }

          expect(firstAllowed).toBe(Math.min(firstBatch, MAX_MESSAGES));

          // Advance time past the window so all timestamps are evicted
          vi.advanceTimersByTime(WINDOW_MS + 1);

          // Send second batch — should have full capacity again
          let secondAllowed = 0;
          for (let i = 0; i < secondBatch; i++) {
            if (canSend()) {
              recordSend();
              secondAllowed++;
            }
          }

          expect(secondAllowed).toBe(Math.min(secondBatch, MAX_MESSAGES));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sliding window evicts only timestamps older than WINDOW_MS', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_MESSAGES }),
        fc.integer({ min: 1, max: MAX_MESSAGES }),
        fc.integer({ min: 1, max: WINDOW_MS - 1 }),
        (earlyCount, lateCount, timeBetween) => {
          reset();
          vi.setSystemTime(0);

          // Send earlyCount messages at t=0
          for (let i = 0; i < earlyCount; i++) {
            if (canSend()) {
              recordSend();
            }
          }

          // Advance by timeBetween (still within window)
          vi.advanceTimersByTime(timeBetween);

          // Send lateCount messages at t=timeBetween
          let lateAllowed = 0;
          for (let i = 0; i < lateCount; i++) {
            if (canSend()) {
              recordSend();
              lateAllowed++;
            }
          }

          // Total allowed across both batches should not exceed MAX_MESSAGES
          // since all timestamps are still within the window
          const totalInWindow = earlyCount + lateAllowed;
          expect(totalInWindow).toBeLessThanOrEqual(MAX_MESSAGES);

          // The late batch should allow exactly the remaining capacity
          const remainingCapacity = Math.max(0, MAX_MESSAGES - earlyCount);
          expect(lateAllowed).toBe(Math.min(lateCount, remainingCapacity));

          // Advance exactly WINDOW_MS - timeBetween from current time.
          // Current time is timeBetween, so after advance it's WINDOW_MS.
          // Cutoff = WINDOW_MS - WINDOW_MS = 0.
          // Early messages at t=0: 0 > 0 is false → evicted.
          // Late messages at t=timeBetween (≥1): timeBetween > 0 is true → kept.
          vi.advanceTimersByTime(WINDOW_MS - timeBetween);

          // Early messages are now evicted, only late messages remain
          // Capacity should be MAX_MESSAGES - lateAllowed
          let afterEvictionAllowed = 0;
          const attemptsAfterEviction = MAX_MESSAGES;
          for (let i = 0; i < attemptsAfterEviction; i++) {
            if (canSend()) {
              recordSend();
              afterEvictionAllowed++;
            }
          }

          expect(afterEvictionAllowed).toBe(MAX_MESSAGES - lateAllowed);
        }
      ),
      { numRuns: 100 }
    );
  });
});
