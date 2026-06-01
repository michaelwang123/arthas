import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateBackoff } from '../../src/network/websocket';

/**
 * Property 8: Exponential Backoff Calculation
 *
 * For any number of consecutive connection failures n (where n ≥ 1),
 * the reconnection delay should equal min(2^(n-1) × 1000, 30000) milliseconds.
 *
 * **Validates: Requirements 2.5**
 */
describe('Property 8: Exponential Backoff Calculation', () => {
  it('for any failure count n ≥ 1, delay equals min(2^(n-1) × 1000, 30000) ms', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (n) => {
          const expected = Math.min(Math.pow(2, n - 1) * 1000, 30000);
          const actual = calculateBackoff(n);
          expect(actual).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('calculateBackoff(0) returns 1000 (base case)', () => {
    expect(calculateBackoff(0)).toBe(1000);
  });

  it('result is always between 1000 and 30000 inclusive for any n ≥ 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        (n) => {
          const delay = calculateBackoff(n);
          expect(delay).toBeGreaterThanOrEqual(1000);
          expect(delay).toBeLessThanOrEqual(30000);
        }
      ),
      { numRuns: 200 }
    );
  });
});
