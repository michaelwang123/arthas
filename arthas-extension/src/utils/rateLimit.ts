/**
 * Sliding window rate limiter.
 * Allows a maximum of MAX_MESSAGES within a WINDOW_MS sliding window.
 */

/** Duration of the sliding window in milliseconds. */
export const WINDOW_MS = 10_000;

/** Maximum number of messages allowed within the window. */
export const MAX_MESSAGES = 10;

/** Timestamps of recent sends within the current window. */
let timestamps: number[] = [];

/**
 * Evicts timestamps older than WINDOW_MS from the current time.
 */
function evictOld(): void {
  const cutoff = Date.now() - WINDOW_MS;
  timestamps = timestamps.filter((t) => t > cutoff);
}

/**
 * Returns true if a message can be sent (window has capacity).
 * Evicts stale timestamps before checking.
 */
export function canSend(): boolean {
  evictOld();
  return timestamps.length < MAX_MESSAGES;
}

/**
 * Records the current timestamp as a sent message.
 */
export function recordSend(): void {
  timestamps.push(Date.now());
}

/**
 * Resets the rate limiter state. Intended for testing.
 */
export function reset(): void {
  timestamps = [];
}
