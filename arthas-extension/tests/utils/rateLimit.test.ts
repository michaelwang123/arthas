import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { canSend, recordSend, reset, WINDOW_MS, MAX_MESSAGES } from '../../src/utils/rateLimit';

describe('rateLimit', () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows sending when no messages have been sent', () => {
    expect(canSend()).toBe(true);
  });

  it('allows up to MAX_MESSAGES within the window', () => {
    for (let i = 0; i < MAX_MESSAGES; i++) {
      expect(canSend()).toBe(true);
      recordSend();
    }
    expect(canSend()).toBe(false);
  });

  it('rejects after MAX_MESSAGES within the window', () => {
    for (let i = 0; i < MAX_MESSAGES; i++) {
      recordSend();
    }
    expect(canSend()).toBe(false);
  });

  it('allows sending again after window expires', () => {
    for (let i = 0; i < MAX_MESSAGES; i++) {
      recordSend();
    }
    expect(canSend()).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(WINDOW_MS + 1);
    expect(canSend()).toBe(true);
  });

  it('evicts only old timestamps (sliding window)', () => {
    // Send 5 messages at t=0
    for (let i = 0; i < 5; i++) {
      recordSend();
    }

    // Advance 6 seconds
    vi.advanceTimersByTime(6000);

    // Send 5 more messages at t=6s
    for (let i = 0; i < 5; i++) {
      recordSend();
    }

    // At t=6s, all 10 are within the window (first 5 at t=0, next 5 at t=6s)
    expect(canSend()).toBe(false);

    // Advance to t=10.001s — first 5 (sent at t=0) are now older than 10s
    vi.advanceTimersByTime(4001);
    expect(canSend()).toBe(true);
  });

  it('reset clears all state', () => {
    for (let i = 0; i < MAX_MESSAGES; i++) {
      recordSend();
    }
    expect(canSend()).toBe(false);
    reset();
    expect(canSend()).toBe(true);
  });

  it('exports correct constants', () => {
    expect(WINDOW_MS).toBe(10_000);
    expect(MAX_MESSAGES).toBe(10);
  });
});
