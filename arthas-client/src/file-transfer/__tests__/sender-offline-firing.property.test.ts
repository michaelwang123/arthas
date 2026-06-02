/**
 * @file sender-offline-firing.property.test.ts — Offline timeout firing behavior property tests
 *
 * Validates two correctness properties from the design document:
 * - Property 3: Offline timeout with active send fails the transfer
 * - Property 4: Offline timeout without active send is a no-op
 *
 * Uses Vitest with fake timers and fast-check for property-based testing.
 *
 * **Validates: Requirements 1.1, 1.3, 1.5**
 *
 * @module file-transfer/__tests__/sender-offline-firing.property.test
 * @see sender.ts — setupOfflineDetection, failTransfer
 * @see design.md — Properties 3 and 4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import type { TransferState } from '../types';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock WebSocket module
vi.mock('../../network/websocket', () => ({
  send: vi.fn(),
  isConnected: vi.fn(() => true),
  getWs: vi.fn(() => ({ bufferedAmount: 0 })),
}));

// Mock fileTransferStore — we use a real Map for transfers to validate state changes
const mockTransfers = new Map<string, TransferState>();
let mockActiveSendId: string | null = null;
const mockSetState = vi.fn((updater: unknown) => {
  if (typeof updater === 'function') {
    const currentState = {
      transfers: mockTransfers,
      activeSendId: mockActiveSendId,
      sendQueue: [],
    };
    const result = updater(currentState);
    if (result.transfers) {
      mockTransfers.clear();
      for (const [k, v] of result.transfers) {
        mockTransfers.set(k, v);
      }
    }
    if ('activeSendId' in result) {
      mockActiveSendId = result.activeSendId;
    }
  } else if (typeof updater === 'object' && updater !== null) {
    const obj = updater as Record<string, unknown>;
    if ('activeSendId' in obj) {
      mockActiveSendId = obj.activeSendId as string | null;
    }
  }
});

vi.mock('../fileTransferStore', () => ({
  useFileTransferStore: {
    getState: () => ({
      transfers: mockTransfers,
      activeSendId: mockActiveSendId,
      sendQueue: [],
    }),
    setState: mockSetState,
  },
  triggerProcessQueue: vi.fn(),
  consumeExtraMetadata: vi.fn(() => undefined),
}));

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a minimal TransferState for testing.
 */
function createMockTransfer(overrides: Partial<TransferState> = {}): TransferState {
  return {
    transferId: 'test-transfer-001',
    direction: 'send',
    status: 'sending',
    fileName: 'test-file.txt',
    fileSize: 1024,
    mimeType: 'text/plain',
    totalChunks: 1,
    receivedChunks: 0,
    lastReceivedIndex: -1,
    chunks: [],
    startTime: Date.now(),
    lastChunkTime: Date.now(),
    senderId: 'user-1',
    senderName: 'TestUser',
    ackCount: 0,
    totalReceivers: 1,
    chatMessageId: 'msg-001',
    ...overrides,
  };
}

/**
 * Arbitrary for generating valid transfer IDs (NanoID-like strings).
 */
const transferIdArb = fc.string({ minLength: 10, maxLength: 21 }).filter(s => s.length > 0);

/**
 * Arbitrary for generating valid file names.
 */
const fileNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0);

/**
 * Arbitrary for generating valid file sizes (1 byte to 5MB).
 */
const fileSizeArb = fc.integer({ min: 1, max: 5_242_880 });

// ============================================================================
// Property 3: Offline timeout with active send fails the transfer
// ============================================================================

describe('Property 3: Offline timeout with active send fails the transfer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTransfers.clear();
    mockActiveSendId = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Reset offline detection state before restoring timers
    const { resetOfflineDetectionState } = await import('../sender');
    resetOfflineDetectionState();
    vi.useRealTimers();
  });

  /**
   * Property 3: For any active send transfer, if the offline timeout fires
   * (60 seconds elapsed while offline), the transfer SHALL be marked as `failed`
   * with a timeout error message, `activeSendId` SHALL be cleared, and the queue
   * SHALL advance.
   *
   * **Validates: Requirements 1.1, 1.3**
   */
  it('for any active send transfer, offline timeout marks it as failed with timeout error', async () => {
    const {
      setupOfflineDetection,
      resetOfflineDetectionState,
      OFFLINE_TIMEOUT_MS,
    } = await import('../sender');
    const { triggerProcessQueue } = await import('../fileTransferStore');

    await fc.assert(
      fc.asyncProperty(
        transferIdArb,
        fileNameArb,
        fileSizeArb,
        async (transferId, fileName, fileSize) => {
          // Reset state for each property iteration
          resetOfflineDetectionState();
          mockTransfers.clear();
          mockActiveSendId = transferId;
          vi.clearAllMocks();

          // Set up a transfer in 'sending' status
          const transfer = createMockTransfer({
            transferId,
            fileName,
            fileSize,
            status: 'sending',
            totalChunks: Math.ceil(fileSize / 65536),
          });
          mockTransfers.set(transferId, transfer);

          // Initialize offline detection
          setupOfflineDetection();

          // Fire the offline event
          window.dispatchEvent(new Event('offline'));

          // Advance timers by exactly OFFLINE_TIMEOUT_MS (60s)
          vi.advanceTimersByTime(OFFLINE_TIMEOUT_MS);

          // Assert: transfer is marked as failed
          const updatedTransfer = mockTransfers.get(transferId);
          expect(updatedTransfer).toBeDefined();
          expect(updatedTransfer!.status).toBe('failed');

          // Assert: error message contains timeout information
          expect(updatedTransfer!.error).toBeDefined();
          expect(updatedTransfer!.error!.length).toBeGreaterThan(0);

          // Assert: activeSendId is cleared
          expect(mockActiveSendId).toBeNull();

          // Assert: queue advances (triggerProcessQueue called)
          expect(triggerProcessQueue).toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Validates that the error message is descriptive (mentions timeout/offline).
   *
   * **Validates: Requirements 1.3**
   */
  it('failed transfer has descriptive timeout error message for any transfer', async () => {
    const {
      setupOfflineDetection,
      resetOfflineDetectionState,
      OFFLINE_TIMEOUT_MS,
    } = await import('../sender');

    await fc.assert(
      fc.asyncProperty(
        transferIdArb,
        async (transferId) => {
          // Reset state
          resetOfflineDetectionState();
          mockTransfers.clear();
          mockActiveSendId = transferId;
          vi.clearAllMocks();

          // Set up transfer
          const transfer = createMockTransfer({
            transferId,
            status: 'sending',
          });
          mockTransfers.set(transferId, transfer);

          // Initialize, go offline, wait timeout
          setupOfflineDetection();
          window.dispatchEvent(new Event('offline'));
          vi.advanceTimersByTime(OFFLINE_TIMEOUT_MS);

          // Assert: error message mentions offline/timeout (Chinese or English)
          const updatedTransfer = mockTransfers.get(transferId);
          expect(updatedTransfer!.error).toBeDefined();
          const errorMsg = updatedTransfer!.error!;
          expect(
            errorMsg.includes('离线') || errorMsg.includes('超时') ||
            errorMsg.toLowerCase().includes('offline') || errorMsg.toLowerCase().includes('timeout')
          ).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ============================================================================
// Property 4: Offline timeout without active send is a no-op
// ============================================================================

describe('Property 4: Offline timeout without active send is a no-op', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTransfers.clear();
    mockActiveSendId = null;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    const { resetOfflineDetectionState } = await import('../sender');
    resetOfflineDetectionState();
    vi.useRealTimers();
  });

  /**
   * Property 4: For any state where no active send exists (activeSendId is null)
   * when the offline timeout fires, the transfers map SHALL remain unchanged and
   * no transfer state shall be modified.
   *
   * **Validates: Requirements 1.5**
   */
  it('when no active send exists, offline timeout does not modify any transfer state', async () => {
    const {
      setupOfflineDetection,
      resetOfflineDetectionState,
      OFFLINE_TIMEOUT_MS,
    } = await import('../sender');

    await fc.assert(
      fc.asyncProperty(
        // Generate 0-5 transfers with various statuses (but none active)
        fc.array(
          fc.record({
            transferId: transferIdArb,
            status: fc.constantFrom('pending', 'complete', 'failed', 'cancelled') as fc.Arbitrary<'pending' | 'complete' | 'failed' | 'cancelled'>,
            fileName: fileNameArb,
            fileSize: fileSizeArb,
          }),
          { minLength: 0, maxLength: 5 }
        ),
        async (transferConfigs) => {
          // Reset state
          resetOfflineDetectionState();
          mockTransfers.clear();
          mockActiveSendId = null; // No active send
          vi.clearAllMocks();

          // Set up transfers with various non-active statuses
          for (const config of transferConfigs) {
            const transfer = createMockTransfer({
              transferId: config.transferId,
              status: config.status,
              fileName: config.fileName,
              fileSize: config.fileSize,
            });
            mockTransfers.set(config.transferId, transfer);
          }

          // Snapshot the transfers state before timeout
          const snapshotBefore = new Map<string, TransferState>();
          for (const [id, t] of mockTransfers) {
            snapshotBefore.set(id, { ...t });
          }

          // Initialize offline detection
          setupOfflineDetection();

          // Fire offline event and advance past timeout
          window.dispatchEvent(new Event('offline'));
          vi.advanceTimersByTime(OFFLINE_TIMEOUT_MS);

          // Assert: No transfer state was modified
          expect(mockTransfers.size).toBe(snapshotBefore.size);
          for (const [id, originalTransfer] of snapshotBefore) {
            const currentTransfer = mockTransfers.get(id);
            expect(currentTransfer).toBeDefined();
            expect(currentTransfer!.status).toBe(originalTransfer.status);
            expect(currentTransfer!.error).toBe(originalTransfer.error);
            expect(currentTransfer!.fileName).toBe(originalTransfer.fileName);
            expect(currentTransfer!.fileSize).toBe(originalTransfer.fileSize);
          }

          // Assert: activeSendId remains null
          expect(mockActiveSendId).toBeNull();
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 4b: Even with existing transfers in the store, no setState call
   * modifies transfers when activeSendId is null during timeout fire.
   *
   * **Validates: Requirements 1.5**
   */
  it('setState is not called to modify transfers when activeSendId is null at timeout fire', async () => {
    const {
      setupOfflineDetection,
      resetOfflineDetectionState,
      OFFLINE_TIMEOUT_MS,
    } = await import('../sender');

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        async (numTransfers) => {
          // Reset state
          resetOfflineDetectionState();
          mockTransfers.clear();
          mockActiveSendId = null; // Explicitly no active send
          vi.clearAllMocks();

          // Optionally add some transfers (none active)
          for (let i = 0; i < numTransfers; i++) {
            const transfer = createMockTransfer({
              transferId: `transfer-${i}`,
              status: 'complete',
            });
            mockTransfers.set(`transfer-${i}`, transfer);
          }

          // Initialize offline detection
          setupOfflineDetection();

          // Clear mock call history after setup (setup may trigger setState)
          mockSetState.mockClear();

          // Fire offline event and advance past timeout
          window.dispatchEvent(new Event('offline'));
          vi.advanceTimersByTime(OFFLINE_TIMEOUT_MS);

          // Assert: mockSetState was NOT called after the timeout fired
          // The timeout callback only calls failTransfer when activeSendId exists
          // When activeSendId is null, the callback is a no-op
          expect(mockSetState).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 50 }
    );
  });
});
