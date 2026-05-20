/**
 * chatStore Ed25519 unsupported fallback 单元测试。
 *
 * 📚 学习要点: 为什么需要测试 Ed25519 不支持的场景？
 * Ed25519 在 Web Crypto API 中的支持并非所有浏览器都有（Chrome 113+, Firefox 130+）。
 * 当浏览器不支持时，客户端应 graceful degrade：
 * - createRoom/joinRoom 仍然成功
 * - signingKeyPair 为 null
 * - 不广播公钥
 * - sendMessage 正常工作（无签名）
 *
 * Validates: Requirements 2.1, 2.3, 2.6, 5.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useChatStore } from './chatStore';
import * as ws from '../network/websocket';
import { MSG_SEND_MESSAGE, MSG_ROOM_JOINED } from '../network/protocol';

// ─────────────────────────────────────────────────────────────────────────────
// Mock setup
// ─────────────────────────────────────────────────────────────────────────────

// Mock the websocket module
vi.mock('../network/websocket', () => ({
  send: vi.fn(),
  onMessage: vi.fn(),
  connect: vi.fn(),
  isConnected: vi.fn(() => true),
}));

// Mock notification utilities (they access DOM APIs)
vi.mock('../utils/notification', () => ({
  playNotificationSound: vi.fn(),
  showDesktopNotification: vi.fn(),
  playJoinSound: vi.fn(),
  playLeaveSound: vi.fn(),
}));

// Mock i18n
vi.mock('../i18n/store', () => ({
  useI18nStore: {
    getState: () => ({ locale: 'en' }),
  },
}));

vi.mock('../i18n/translate', () => ({
  translate: (_locale: string, key: string) => key,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Ed25519 unsupported fallback test
// ─────────────────────────────────────────────────────────────────────────────

describe('chatStore — Ed25519 unsupported fallback', () => {
  let originalGenerateKey: typeof crypto.subtle.generateKey;

  beforeEach(() => {
    // Save original
    originalGenerateKey = crypto.subtle.generateKey.bind(crypto.subtle);

    // Reset store state
    useChatStore.setState({
      connected: true,
      myId: null,
      myName: '',
      roomId: null,
      roomKey: null,
      shareCode: null,
      members: [],
      hasPassword: false,
      ephemeral: 0,
      messages: [],
      typingMembers: new Map(),
      muted: false,
      replyTo: null,
      reactions: new Map(),
      signingKeyPair: null,
      publicKeyMap: new Map(),
    });

    // Clear mock call history
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original crypto.subtle.generateKey
    Object.defineProperty(crypto.subtle, 'generateKey', {
      value: originalGenerateKey,
      writable: true,
      configurable: true,
    });
  });

  /**
   * 📚 学习要点: 模拟 Ed25519 不支持
   * 通过 mock crypto.subtle.generateKey 使其在检测到 Ed25519 算法时抛出 NotSupportedError，
   * 但对 AES-GCM 等其他算法正常工作。这模拟了旧浏览器的行为。
   */
  function mockEd25519Unsupported(): void {
    const mockGenerateKey = vi.fn(async (algorithm: AlgorithmIdentifier, extractable: boolean, keyUsages: KeyUsage[]) => {
      // Ed25519 detection: algorithm is the string 'Ed25519' or an object with name 'Ed25519'
      const algoName = typeof algorithm === 'string' ? algorithm : (algorithm as { name?: string })?.name;
      if (algoName === 'Ed25519') {
        const error = new DOMException(
          "The algorithm is not supported",
          'NotSupportedError'
        );
        throw error;
      }
      // For other algorithms (AES-GCM, etc.), use the original implementation
      return originalGenerateKey.call(crypto.subtle, algorithm as any, extractable, keyUsages as any);
    });

    Object.defineProperty(crypto.subtle, 'generateKey', {
      value: mockGenerateKey,
      writable: true,
      configurable: true,
    });
  }

  it('createRoom succeeds when Ed25519 is unsupported, signingKeyPair is null', async () => {
    mockEd25519Unsupported();

    await useChatStore.getState().createRoom('TestUser', '', 0);

    const state = useChatStore.getState();
    // createRoom should succeed
    expect(state.myName).toBe('TestUser');
    expect(state.roomKey).not.toBeNull();
    // signingKeyPair should be null (Ed25519 not supported)
    expect(state.signingKeyPair).toBeNull();
  });

  it('joinRoom succeeds when Ed25519 is unsupported, signingKeyPair is null', async () => {
    mockEd25519Unsupported();

    // We need a valid share code. Generate a room key first using the real crypto
    // then encode it as a share code.
    const { generateRoomKey } = await import('../crypto/keys');
    const { encodeShareKey } = await import('../crypto/shareKey');
    const roomKey = await generateRoomKey();
    // roomId must be exactly 21 characters (NanoID format)
    const shareCode = await encodeShareKey('abcdefghijklmnopqrstu', roomKey, 0);

    await useChatStore.getState().joinRoom(shareCode, 'TestUser', '');

    const state = useChatStore.getState();
    // joinRoom should succeed (sends MSG_JOIN_ROOM)
    expect(state.myName).toBe('TestUser');
    expect(state.roomKey).not.toBeNull();
    // signingKeyPair should be null
    expect(state.signingKeyPair).toBeNull();
  });

  it('no pubkey announcement is sent when signingKeyPair is null', async () => {
    mockEd25519Unsupported();

    await useChatStore.getState().createRoom('TestUser', '', 0);

    // Clear the ws.send calls from createRoom (MSG_CREATE_ROOM)
    vi.clearAllMocks();

    // Simulate receiving MSG_ROOM_JOINED from server
    useChatStore.getState().handleServerMessage({
      type: MSG_ROOM_JOINED,
      data: {
        roomId: 'room-123',
        members: [{ id: 'user-1', name: 'TestUser', color: '#ff0000' }],
        hasPassword: false,
        ephemeral: 0,
      },
    });

    // Wait for any async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // ws.send should NOT have been called with MSG_SEND_MESSAGE (pubkey announcement)
    const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
    const pubkeySends = sendCalls.filter(
      (call: unknown[]) => call[0] === MSG_SEND_MESSAGE
    );
    expect(pubkeySends).toHaveLength(0);
  });

  it('sendMessage works without signing when signingKeyPair is null', async () => {
    mockEd25519Unsupported();

    await useChatStore.getState().createRoom('TestUser', '', 0);

    // Simulate room joined to set myId
    useChatStore.getState().handleServerMessage({
      type: MSG_ROOM_JOINED,
      data: {
        roomId: 'room-123',
        members: [{ id: 'user-1', name: 'TestUser', color: '#ff0000' }],
        hasPassword: false,
        ephemeral: 0,
      },
    });

    // Wait for any async operations
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Clear mocks before sendMessage
    vi.clearAllMocks();

    // Send a message — should work without signing
    await useChatStore.getState().sendMessage('Hello, world!');

    // Message should be sent via ws.send with MSG_SEND_MESSAGE
    const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
    const messageSends = sendCalls.filter(
      (call: unknown[]) => call[0] === MSG_SEND_MESSAGE
    );
    expect(messageSends).toHaveLength(1);

    // The sent data should have iv and ciphertext (encrypted)
    const [, data] = messageSends[0] as [number, { iv: string; ciphertext: string }];
    expect(data).toHaveProperty('iv');
    expect(data).toHaveProperty('ciphertext');

    // Message should appear in local messages
    const state = useChatStore.getState();
    const userMessages = state.messages.filter((m) => !m.isSystem);
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].text).toBe('Hello, world!');
  });
});
