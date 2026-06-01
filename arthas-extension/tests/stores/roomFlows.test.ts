/**
 * Unit tests for createRoom and joinRoom flows.
 *
 * Tests the store actions with mocked WebSocket module to verify:
 * - Nickname validation
 * - Server URL requirement
 * - Share code validation
 * - Key generation/import
 * - Correct protocol messages sent
 * - Error state management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ===== Mock WebSocket module =====

const mockSend = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockGetConnectionState = vi.fn(() => ({ status: 'disconnected', consecutiveFailures: 0 }));

let stateChangeListeners: Array<(state: { status: string; consecutiveFailures: number }) => void> = [];

vi.mock('../../src/network/websocket', () => ({
  connect: (...args: unknown[]) => mockConnect(...args),
  disconnect: (...args: unknown[]) => mockDisconnect(...args),
  send: (...args: unknown[]) => mockSend(...args),
  onMessage: vi.fn(),
  onStateChange: vi.fn((handler: (state: { status: string; consecutiveFailures: number }) => void) => {
    stateChangeListeners.push(handler);
    return () => {
      stateChangeListeners = stateChangeListeners.filter((h) => h !== handler);
    };
  }),
  getConnectionState: () => mockGetConnectionState(),
}));

vi.mock('../../src/crypto/keys', () => ({
  generateRoomKey: vi.fn(async () => ({ type: 'secret', algorithm: { name: 'AES-GCM' } })),
  exportRoomKey: vi.fn(async () => 'dGVzdC1rZXktZW5jb2RlZC1iYXNlNjR1cmwtNDNj'),
  importRoomKey: vi.fn(async (encoded: string) => {
    if (encoded === 'invalid') throw new Error('Invalid key');
    return { type: 'secret', algorithm: { name: 'AES-GCM' } };
  }),
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

vi.mock('../../src/crypto/shareKey', () => ({
  encodeShareKey: vi.fn(async () => 'roomId12345678901234:keyEncoded1234567890123456789012345678901'),
  decodeShareKey: vi.fn((code: string) => {
    if (code === 'invalid') return null;
    if (code.includes(':')) {
      const parts = code.split(':');
      if (parts[0]!.length === 21 && parts[1]!.length === 43) {
        return { roomId: parts[0], keyEncoded: parts[1], ephemeral: 0, expiresAt: 0 };
      }
    }
    return null;
  }),
}));

import { useChatStore } from '../../src/stores/chatStore';
import { MSG_CREATE_ROOM, MSG_JOIN_ROOM } from '../../src/network/protocol';
import { saveSettings } from '../../src/utils/storage';

// ===== Tests =====

describe('createRoom', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    stateChangeListeners = [];
    mockGetConnectionState.mockReturnValue({ status: 'disconnected', consecutiveFailures: 0 });

    useChatStore.setState({
      connectionStatus: 'disconnected',
      consecutiveFailures: 0,
      isConnecting: false,
      myId: null,
      myName: '',
      roomId: null,
      roomKey: null,
      shareCode: null,
      members: [],
      messages: [],
      typingMembers: new Map(),
      hasActiveSession: false,
      sessionError: null,
    });

    await saveSettings({ serverUrl: 'wss://test.com/ws' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects empty nickname', async () => {
    await useChatStore.getState().createRoom('');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('rejects nickname with only whitespace', async () => {
    await useChatStore.getState().createRoom('   ');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('rejects nickname longer than 20 chars', async () => {
    await useChatStore.getState().createRoom('a'.repeat(21));
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('sets error when server URL is not configured', async () => {
    await saveSettings({ serverUrl: '' });
    await useChatStore.getState().createRoom('Alice');

    const state = useChatStore.getState();
    expect(state.sessionError).toBe('error.serverNotConfigured');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('connects to server and sends CreateRoom on success', async () => {
    // Make getConnectionState return 'connected' immediately so waitForConnection resolves
    mockGetConnectionState.mockReturnValue({ status: 'connected', consecutiveFailures: 0 });

    await useChatStore.getState().createRoom('Alice');

    // Verify connect was called
    expect(mockConnect).toHaveBeenCalledWith('wss://test.com/ws');

    // Verify CreateRoom message was sent
    const createCalls = mockSend.mock.calls.filter(
      (call: unknown[]) => call[0] === MSG_CREATE_ROOM
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]![1]).toEqual({
      name: 'Alice',
      password: '',
      ephemeral: 0,
      expiry: 0,
    });

    // Verify state
    expect(useChatStore.getState().myName).toBe('Alice');
    expect(useChatStore.getState().roomKey).not.toBeNull();
  });

  it('sets error when connection fails', async () => {
    // Make getConnectionState return 'failed' immediately
    mockGetConnectionState.mockReturnValue({ status: 'failed', consecutiveFailures: 5 });

    await useChatStore.getState().createRoom('Alice');

    const state = useChatStore.getState();
    expect(state.sessionError).toBe('error.connectionFailed');
    expect(state.isConnecting).toBe(false);
  });

  it('trims nickname before sending', async () => {
    mockGetConnectionState.mockReturnValue({ status: 'connected', consecutiveFailures: 0 });

    await useChatStore.getState().createRoom('  Alice  ');

    const createCalls = mockSend.mock.calls.filter(
      (call: unknown[]) => call[0] === MSG_CREATE_ROOM
    );
    expect(createCalls[0]![1]).toMatchObject({ name: 'Alice' });
    expect(useChatStore.getState().myName).toBe('Alice');
  });
});

describe('joinRoom', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    stateChangeListeners = [];
    mockGetConnectionState.mockReturnValue({ status: 'disconnected', consecutiveFailures: 0 });

    useChatStore.setState({
      connectionStatus: 'disconnected',
      consecutiveFailures: 0,
      isConnecting: false,
      myId: null,
      myName: '',
      roomId: null,
      roomKey: null,
      shareCode: null,
      members: [],
      messages: [],
      typingMembers: new Map(),
      hasActiveSession: false,
      sessionError: null,
    });

    await saveSettings({ serverUrl: 'wss://test.com/ws' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects empty nickname', async () => {
    await useChatStore.getState().joinRoom('code:key', '');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('sets error for invalid share code', async () => {
    await useChatStore.getState().joinRoom('invalid', 'Alice');

    const state = useChatStore.getState();
    expect(state.sessionError).toBe('error.invalidShareCode');
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('sets error when server URL is not configured', async () => {
    await saveSettings({ serverUrl: '' });
    const validCode = 'abcdefghijklmnopqrstu:' + 'a'.repeat(43);
    await useChatStore.getState().joinRoom(validCode, 'Alice');

    expect(useChatStore.getState().sessionError).toBe('error.serverNotConfigured');
  });

  it('connects and sends JoinRoom on success', async () => {
    mockGetConnectionState.mockReturnValue({ status: 'connected', consecutiveFailures: 0 });

    const validCode = 'abcdefghijklmnopqrstu:' + 'a'.repeat(43);
    await useChatStore.getState().joinRoom(validCode, 'Bob');

    expect(mockConnect).toHaveBeenCalledWith('wss://test.com/ws');

    const joinCalls = mockSend.mock.calls.filter(
      (call: unknown[]) => call[0] === MSG_JOIN_ROOM
    );
    expect(joinCalls).toHaveLength(1);
    expect(joinCalls[0]![1]).toEqual({
      roomId: 'abcdefghijklmnopqrstu',
      name: 'Bob',
      password: '',
    });
  });

  it('sets error when connection fails', async () => {
    mockGetConnectionState.mockReturnValue({ status: 'failed', consecutiveFailures: 5 });

    const validCode = 'abcdefghijklmnopqrstu:' + 'a'.repeat(43);
    await useChatStore.getState().joinRoom(validCode, 'Bob');

    expect(useChatStore.getState().sessionError).toBe('error.connectionFailed');
    expect(useChatStore.getState().isConnecting).toBe(false);
  });
});
