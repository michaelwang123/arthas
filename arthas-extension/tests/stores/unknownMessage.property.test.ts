/**
 * Property 15: Unknown Message Type Resilience
 *
 * For any message with a type field value not in the set of handled message types
 * (0x10–0x18), the message handler should not throw an exception and should not
 * modify the chat state.
 *
 * **Validates: Graceful degradation for future protocol extensions**
 *
 * @module tests/stores/unknownMessage.property.test
 * @see src/stores/chatStore.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ===== Mock websocket module before importing chatStore =====

let capturedMessageHandler: ((msg: { type: number; data: unknown }) => void) | null = null;

vi.mock('../../src/network/websocket', () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  send: vi.fn(),
  onMessage: vi.fn((handler: (msg: { type: number; data: unknown }) => void) => {
    capturedMessageHandler = handler;
  }),
  onStateChange: vi.fn(),
  getConnectionState: vi.fn(() => ({ status: 'disconnected', consecutiveFailures: 0 })),
}));

// Mock crypto modules to avoid async complexity in property tests
vi.mock('../../src/crypto/keys', () => ({
  importRoomKey: vi.fn(),
  exportRoomKey: vi.fn(),
  generateRoomKey: vi.fn(),
}));

vi.mock('../../src/crypto/encrypt', () => ({
  encryptMessage: vi.fn(),
}));

vi.mock('../../src/crypto/decrypt', () => ({
  decryptMessage: vi.fn(),
}));

vi.mock('../../src/crypto/typingEncrypt', () => ({
  encryptTypingStatus: vi.fn(),
  decryptTypingStatus: vi.fn(),
}));

import { useChatStore } from '../../src/stores/chatStore';
import type { ChatState } from '../../src/stores/chatStore';

// ===== Handled message type IDs (0x10–0x18) =====

const HANDLED_TYPES = new Set([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18]);

/**
 * Generates a random type ID in the range 0–255 that is NOT in the handled set (0x10–0x18).
 */
function unknownTypeArbitrary(): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: 255 }).filter((n) => !HANDLED_TYPES.has(n));
}

/**
 * Captures a snapshot of the relevant chat state fields for comparison.
 * Excludes function fields and non-serializable values.
 */
function captureState(): Omit<ChatState, 'initialize' | 'createRoom' | 'joinRoom' | 'sendMessage' | 'setTyping' | 'leaveRoom' | 'retryConnection'> {
  const state = useChatStore.getState();
  return {
    connectionStatus: state.connectionStatus,
    consecutiveFailures: state.consecutiveFailures,
    isConnecting: state.isConnecting,
    myId: state.myId,
    myName: state.myName,
    roomId: state.roomId,
    roomKey: state.roomKey,
    shareCode: state.shareCode,
    members: [...state.members],
    messages: [...state.messages],
    typingMembers: new Map(state.typingMembers),
    hasActiveSession: state.hasActiveSession,
    sessionError: state.sessionError,
  };
}

describe('Property 15: Unknown Message Type Resilience', () => {
  beforeEach(() => {
    capturedMessageHandler = null;

    // Reset store to initial state
    useChatStore.setState({
      connectionStatus: 'connected',
      consecutiveFailures: 0,
      myId: 'user-1',
      myName: 'TestUser',
      roomId: 'room-abc123456789012345',
      roomKey: null,
      shareCode: 'test:share:code',
      members: [{ id: 'user-1', name: 'TestUser', color: '#ff0000' }],
      messages: [
        {
          id: 'msg-1',
          stableId: 'user-1:1000',
          senderId: 'user-1',
          senderName: 'TestUser',
          text: 'Hello',
          timestamp: 1000,
          isMine: true,
          isSystem: false,
        },
      ],
      typingMembers: new Map(),
      hasActiveSession: true,
      sessionError: null,
    });

    // Initialize the store to register the message handler
    void useChatStore.getState().initialize();
  });

  it('messages with type IDs outside 0x10–0x18 do not throw', () => {
    // Ensure handler was captured
    expect(capturedMessageHandler).not.toBeNull();
    const handler = capturedMessageHandler!;

    fc.assert(
      fc.property(
        unknownTypeArbitrary(),
        fc.jsonValue(),
        (typeId, data) => {
          // Calling the handler with an unknown type must not throw
          expect(() => {
            handler({ type: typeId, data });
          }).not.toThrow();
        }
      ),
      { numRuns: 500 }
    );
  });

  it('messages with type IDs outside 0x10–0x18 do not modify chat state', () => {
    // Ensure handler was captured
    expect(capturedMessageHandler).not.toBeNull();
    const handler = capturedMessageHandler!;

    fc.assert(
      fc.property(
        unknownTypeArbitrary(),
        fc.jsonValue(),
        (typeId, data) => {
          // Capture state before handling the unknown message
          const stateBefore = captureState();

          // Handle the unknown message
          handler({ type: typeId, data });

          // Capture state after
          const stateAfter = captureState();

          // State must be unchanged
          expect(stateAfter.connectionStatus).toBe(stateBefore.connectionStatus);
          expect(stateAfter.consecutiveFailures).toBe(stateBefore.consecutiveFailures);
          expect(stateAfter.myId).toBe(stateBefore.myId);
          expect(stateAfter.myName).toBe(stateBefore.myName);
          expect(stateAfter.roomId).toBe(stateBefore.roomId);
          expect(stateAfter.roomKey).toBe(stateBefore.roomKey);
          expect(stateAfter.shareCode).toBe(stateBefore.shareCode);
          expect(stateAfter.members).toEqual(stateBefore.members);
          expect(stateAfter.messages).toEqual(stateBefore.messages);
          expect(stateAfter.hasActiveSession).toBe(stateBefore.hasActiveSession);
          expect(stateAfter.sessionError).toBe(stateBefore.sessionError);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('covers the full range of non-handled type IDs (0x00–0x0F, 0x19–0xFF)', () => {
    // Ensure handler was captured
    expect(capturedMessageHandler).not.toBeNull();
    const handler = capturedMessageHandler!;

    fc.assert(
      fc.property(
        fc.oneof(
          // Low range: 0x00–0x0F (below handled server→client types)
          fc.integer({ min: 0x00, max: 0x0F }),
          // High range: 0x19–0xFF (above handled server→client types)
          fc.integer({ min: 0x19, max: 0xFF })
        ),
        fc.record({
          id: fc.string({ minLength: 0, maxLength: 20 }),
          name: fc.string({ minLength: 0, maxLength: 20 }),
          payload: fc.jsonValue(),
        }),
        (typeId, data) => {
          const stateBefore = captureState();

          expect(() => {
            handler({ type: typeId, data });
          }).not.toThrow();

          const stateAfter = captureState();
          expect(stateAfter.messages).toEqual(stateBefore.messages);
          expect(stateAfter.members).toEqual(stateBefore.members);
          expect(stateAfter.connectionStatus).toBe(stateBefore.connectionStatus);
          expect(stateAfter.roomId).toBe(stateBefore.roomId);
        }
      ),
      { numRuns: 300 }
    );
  });
});
