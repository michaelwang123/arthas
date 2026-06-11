/**
 * Unit tests for matchCleanup.ts — verifies:
 * 1. Voice store methods are called (cancelRecording, cleanup)
 * 2. File transfer store method is called (abortAllTransfers)
 * 3. chatStore fields are properly reset
 * 4. Function is synchronous and idempotent
 *
 * @module match/__tests__/matchCleanup.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChatStore } from '../../stores/chatStore';
import { resetChatStoreForMatch } from '../matchCleanup';

// Track mock calls
const mockCancelRecording = vi.fn();
const mockCleanup = vi.fn();
const mockAbortAllTransfers = vi.fn();

vi.mock('../../voice/voiceStore', () => ({
  useVoiceStore: {
    getState: () => ({
      cancelRecording: mockCancelRecording,
      cleanup: mockCleanup,
    }),
  },
}));

vi.mock('../../file-transfer/fileTransferStore', () => ({
  useFileTransferStore: {
    getState: () => ({
      abortAllTransfers: mockAbortAllTransfers,
    }),
  },
}));

vi.mock('../../network/websocket', () => ({
  connect: vi.fn(),
  send: vi.fn(),
  onMessage: vi.fn(),
  isConnected: vi.fn(() => false),
}));

describe('resetChatStoreForMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      roomId: 'test-room',
      roomKey: {} as CryptoKey,
      shareCode: 'abc123',
      members: [{ id: '1', name: 'Alice', color: '#f00' }],
      hasPassword: true,
      ephemeral: 60,
      expiresAt: 1700000000,
      messages: [{ id: 'm1', stableId: 's1', senderId: '1', senderName: 'Alice', text: 'hi', timestamp: 1000, isMine: false, isSystem: false }],
      typingMembers: new Map([['1', 42]]),
      replyTo: { stableId: 's1', senderName: 'Alice', preview: 'hi' },
      reactions: new Map([['s1', [{ emoji: '👍', userIds: ['1'] }]]]),
      signingKeyPair: { privateKey: {} as CryptoKey, publicKeyBytes: new Uint8Array(32) } as never,
      publicKeyMap: new Map([['1', { raw: new Uint8Array(32), cryptoKey: {} as CryptoKey, firstSeen: 1000 }]]),
    });
  });

  it('calls voice cancelRecording before cleanup', () => {
    const callOrder: string[] = [];
    mockCancelRecording.mockImplementation(() => callOrder.push('cancelRecording'));
    mockCleanup.mockImplementation(() => callOrder.push('cleanup'));

    resetChatStoreForMatch();

    expect(mockCancelRecording).toHaveBeenCalledTimes(1);
    expect(mockCleanup).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['cancelRecording', 'cleanup']);
  });

  it('calls abortAllTransfers', () => {
    resetChatStoreForMatch();
    expect(mockAbortAllTransfers).toHaveBeenCalledTimes(1);
  });

  it('resets roomId to null', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().roomId).toBeNull();
  });

  it('resets roomKey to null', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().roomKey).toBeNull();
  });

  it('resets shareCode to null', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().shareCode).toBeNull();
  });

  it('resets members to empty array', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().members).toEqual([]);
  });

  it('resets hasPassword to false', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().hasPassword).toBe(false);
  });

  it('resets ephemeral to 0', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().ephemeral).toBe(0);
  });

  it('resets expiresAt to 0', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().expiresAt).toBe(0);
  });

  it('resets messages to empty array', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it('resets typingMembers to empty Map', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().typingMembers).toEqual(new Map());
  });

  it('resets replyTo to null', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().replyTo).toBeNull();
  });

  it('resets reactions to empty Map', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().reactions).toEqual(new Map());
  });

  it('resets signingKeyPair to null', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().signingKeyPair).toBeNull();
  });

  it('resets publicKeyMap to empty Map', () => {
    resetChatStoreForMatch();
    expect(useChatStore.getState().publicKeyMap).toEqual(new Map());
  });

  it('does not affect non-room fields (connected, myId, myName, muted)', () => {
    useChatStore.setState({
      connected: true,
      myId: 'my-id-123',
      myName: 'TestUser',
      muted: true,
    });

    resetChatStoreForMatch();

    const state = useChatStore.getState();
    expect(state.connected).toBe(true);
    expect(state.myId).toBe('my-id-123');
    expect(state.myName).toBe('TestUser');
    expect(state.muted).toBe(true);
  });

  it('is safe to call multiple times', () => {
    resetChatStoreForMatch();
    resetChatStoreForMatch();
    resetChatStoreForMatch();

    expect(mockCancelRecording).toHaveBeenCalledTimes(3);
    expect(mockCleanup).toHaveBeenCalledTimes(3);
    expect(mockAbortAllTransfers).toHaveBeenCalledTimes(3);

    const state = useChatStore.getState();
    expect(state.roomId).toBeNull();
    expect(state.members).toEqual([]);
  });

  it('is safe to call when chatStore is already in initial state', () => {
    // First reset to initial
    resetChatStoreForMatch();

    // Clear mock call counts
    vi.clearAllMocks();

    // Call again on already-clean state — should not throw
    expect(() => resetChatStoreForMatch()).not.toThrow();
    expect(mockCancelRecording).toHaveBeenCalledTimes(1);
  });
});
