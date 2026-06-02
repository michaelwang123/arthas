/**
 * Property-based tests: Offline timeout behavior
 *
 * Tests the offline detection timeout mechanism in sender.ts:
 * - Property 1: Offline event always starts a timeout timer
 * - Property 2: Online event cancels the offline timeout (round-trip)
 * - Property 5: Offline timer idempotence (no duplicate timers)
 *
 * **Validates: Requirements 1.1, 1.2, 1.4, 1.6**
 *
 * @module file-transfer/__tests__/sender-offline-timeout.property.test
 * @see sender.ts — setupOfflineDetection() implementation
 * @see design.md — Correctness Properties 1, 2, 5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// ============================================================================
// Mocks — isolate offline detection from store/network dependencies
// ============================================================================

// vi.hoisted ensures the mock function is available when vi.mock factories run
const { mockGetState } = vi.hoisted(() => ({
  mockGetState: vi.fn(() => ({
    transfers: new Map(),
    activeSendId: null as string | null,
    sendQueue: [] as string[],
  })),
}));

vi.mock('../../network/websocket', () => ({
  send: vi.fn(),
  isConnected: vi.fn(() => true),
  getWs: vi.fn(() => ({ bufferedAmount: 0 })),
}));

vi.mock('../encryptChunk', () => ({
  encryptChunk: vi.fn(async () => ({
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(64),
  })),
}));

vi.mock('../chunker', () => ({
  streamChunks: vi.fn(async function* () {
    yield { index: 0, data: new ArrayBuffer(64) };
  }),
}));

vi.mock('../thumbnail', () => ({
  generateThumbnail: vi.fn(async () => null),
}));

vi.mock('../../crypto/utils', () => ({
  toBase64Url: vi.fn(() => 'mock-iv'),
}));

vi.mock('../../stores/chatStore', () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      myId: 'test-user',
      myName: 'TestUser',
      members: [],
      roomKey: null,
    })),
    setState: vi.fn(),
  },
}));

vi.mock('../fileTransferStore', () => ({
  useFileTransferStore: {
    getState: mockGetState,
    setState: vi.fn(),
  },
  triggerProcessQueue: vi.fn(),
  consumeExtraMetadata: vi.fn(() => undefined),
}));

// Import sender AFTER mocks are set up (vi.mock is hoisted)
import {
  setupOfflineDetection,
  resetOfflineDetectionState,
  getOfflineTimeoutId,
  getOfflineStartTime,
  OFFLINE_TIMEOUT_MS,
} from '../sender';

// ============================================================================
// Test helpers
// ============================================================================

/**
 * Dispatch a browser offline event on the window object.
 */
function fireOfflineEvent(): void {
  window.dispatchEvent(new Event('offline'));
}

/**
 * Dispatch a browser online event on the window object.
 */
function fireOnlineEvent(): void {
  window.dispatchEvent(new Event('online'));
}

// ============================================================================
// Property Tests
// ============================================================================

describe('Property: Offline timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetOfflineDetectionState();
    setupOfflineDetection();
  });

  afterEach(() => {
    resetOfflineDetectionState();
    vi.useRealTimers();
  });

  /**
   * **Property 1: Offline event always starts a timeout timer**
   *
   * For any application state (with or without an active send), when the
   * browser fires the `offline` event and no timer is currently running,
   * the offline timeout timer SHALL be started (timer handle becomes non-null
   * and offline start time is recorded).
   *
   * **Validates: Requirements 1.1, 1.4**
   */
  it('offline event always starts a timeout timer regardless of active send state', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary "has active send" boolean and arbitrary transfer IDs
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 50 }),
        (hasActiveSend, transferId) => {
          // Reset state for each generated case
          resetOfflineDetectionState();
          setupOfflineDetection();

          // Configure the store mock to simulate active/inactive send
          mockGetState.mockReturnValue({
            transfers: new Map(),
            activeSendId: hasActiveSend ? transferId : null,
            sendQueue: [],
          });

          // Pre-condition: no timer running
          expect(getOfflineTimeoutId()).toBeNull();
          expect(getOfflineStartTime()).toBe(0);

          // Act: fire offline event
          fireOfflineEvent();

          // Assert: timer is started and offline start time is recorded
          expect(getOfflineTimeoutId()).not.toBeNull();
          expect(getOfflineStartTime()).toBeGreaterThan(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Property 2: Online event cancels the offline timeout (round-trip)**
   *
   * For any state where an offline timeout is running, when the browser fires
   * the `online` event, the timer SHALL be cleared (timer handle becomes null)
   * and the offline start time SHALL be reset to zero.
   *
   * **Validates: Requirements 1.2**
   */
  it('online event always cancels the offline timeout and resets state', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary delay amounts to advance time before going online
        fc.integer({ min: 1, max: OFFLINE_TIMEOUT_MS - 1 }),
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 50 }),
        (elapsedMs, hasActiveSend, transferId) => {
          // Reset state for each generated case
          resetOfflineDetectionState();
          setupOfflineDetection();

          // Configure the store mock
          mockGetState.mockReturnValue({
            transfers: new Map(),
            activeSendId: hasActiveSend ? transferId : null,
            sendQueue: [],
          });

          // Go offline first to start the timer
          fireOfflineEvent();

          // Pre-condition: timer is running
          expect(getOfflineTimeoutId()).not.toBeNull();
          expect(getOfflineStartTime()).toBeGreaterThan(0);

          // Advance time by some amount less than the full timeout
          vi.advanceTimersByTime(elapsedMs);

          // Act: go back online
          fireOnlineEvent();

          // Assert: timer is cleared and offline start time is reset
          expect(getOfflineTimeoutId()).toBeNull();
          expect(getOfflineStartTime()).toBe(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Property 5: Offline timer idempotence (no duplicate timers)**
   *
   * For any state where an offline timeout is already running, firing a second
   * `offline` event SHALL NOT create an additional timer. The timer handle
   * remains the same (only one timer is active at any time).
   *
   * **Validates: Requirements 1.6**
   */
  it('multiple offline events do not create duplicate timers', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary number of additional offline events (2-10)
        fc.integer({ min: 2, max: 10 }),
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 50 }),
        (extraOfflineEvents, hasActiveSend, transferId) => {
          // Reset state for each generated case
          resetOfflineDetectionState();
          setupOfflineDetection();

          // Configure the store mock
          mockGetState.mockReturnValue({
            transfers: new Map(),
            activeSendId: hasActiveSend ? transferId : null,
            sendQueue: [],
          });

          // Fire the first offline event
          fireOfflineEvent();

          // Capture the timer handle from the first event
          const firstTimerHandle = getOfflineTimeoutId();
          const firstOfflineStartTime = getOfflineStartTime();

          expect(firstTimerHandle).not.toBeNull();

          // Fire additional offline events
          for (let i = 0; i < extraOfflineEvents; i++) {
            fireOfflineEvent();
          }

          // Assert: timer handle has not changed (same timer, no duplicates)
          expect(getOfflineTimeoutId()).toBe(firstTimerHandle);
          // Assert: offline start time has not changed
          expect(getOfflineStartTime()).toBe(firstOfflineStartTime);
        }
      ),
      { numRuns: 50 }
    );
  });
});
