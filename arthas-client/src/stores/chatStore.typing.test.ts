/**
 * chatStore 加密 Typing 集成单元测试。
 *
 * 📚 学习要点: 为什么需要测试加密 typing 集成？
 * Typing 状态加密涉及多个层的协作：
 * 1. setTyping → encryptTypingStatus → ws.send（发送路径）
 * 2. handleServerMessage(MSG_MEMBER_TYPING) → decryptTypingStatus → 更新 typingMembers（接收路径）
 * 3. 向后兼容：旧客户端发送明文 typing 消息仍能正确处理
 * 4. 解密失败时静默忽略，不影响聊天功能
 * 5. debounce 竞态：快速连续 typing 事件只发送最终状态（last-write-wins）
 *
 * Validates: Requirements 1.1, 1.5, 1.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';
import * as ws from '../network/websocket';
import { MSG_TYPING, MSG_MEMBER_TYPING } from '../network/protocol';
import { generateRoomKey } from '../crypto/keys';
import { encryptTypingStatus } from '../crypto/typingEncrypt';

// ─────────────────────────────────────────────────────────────────────────────
// Mock setup (same pattern as chatStore.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../network/websocket', () => ({
  send: vi.fn(),
  onMessage: vi.fn(),
  connect: vi.fn(),
  isConnected: vi.fn(() => true),
}));

vi.mock('../utils/notification', () => ({
  playNotificationSound: vi.fn(),
  showDesktopNotification: vi.fn(),
  playJoinSound: vi.fn(),
  playLeaveSound: vi.fn(),
}));

vi.mock('../i18n/store', () => ({
  useI18nStore: {
    getState: () => ({ locale: 'en' }),
  },
}));

vi.mock('../i18n/translate', () => ({
  translate: (_locale: string, key: string) => key,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 创建一个已加入房间的 store 状态（含 roomKey），用于测试 typing 功能。
 */
async function setupRoomState() {
  const roomKey = await generateRoomKey();
  useChatStore.setState({
    connected: true,
    myId: 'user-1',
    myName: 'TestUser',
    roomId: 'room-123',
    roomKey,
    shareCode: 'test-share-code',
    members: [
      { id: 'user-1', name: 'TestUser', color: '#ff0000' },
      { id: 'user-2', name: 'OtherUser', color: '#00ff00' },
    ],
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
  return roomKey;
}

/**
 * 📚 学习要点: 为什么需要 flushPromises？
 * handleServerMessage 内部的解密操作是异步的（crypto.subtle.decrypt 返回 Promise）。
 * 调用 handleServerMessage 后，解密 Promise 在微任务队列中等待执行。
 * 需要多次 flush 微任务队列来确保所有 Promise 链完成（包括 .then 回调）。
 */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('chatStore — Encrypted Typing Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store to initial state (this also resets module-level typing state
    // by calling leaveRoom which clears isCurrentlyTyping and typingTimer)
    useChatStore.getState().leaveRoom();

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

    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Encrypt → Send → Receive → Decrypt flow
  // ─────────────────────────────────────────────────────────────────────────

  describe('encrypt→send→receive→decrypt flow', () => {
    it('setTyping(true) sends MSG_TYPING with encrypted {iv, ciphertext}', async () => {
      await setupRoomState();

      await useChatStore.getState().setTyping(true);

      // ws.send should have been called with MSG_TYPING and encrypted data
      expect(ws.send).toHaveBeenCalledWith(
        MSG_TYPING,
        expect.objectContaining({
          iv: expect.any(String),
          ciphertext: expect.any(String),
        })
      );

      // Verify the sent data has proper base64url format (no padding, no +/)
      const [, sentData] = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0] as [
        number,
        { iv: string; ciphertext: string },
      ];
      expect(sentData.iv).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(sentData.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('receiving encrypted typing message updates typingMembers', async () => {
      const roomKey = await setupRoomState();

      // Encrypt a typing:true message using the same room key
      const encrypted = await encryptTypingStatus(roomKey, true);

      // Simulate receiving the encrypted typing message from server
      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: {
          id: 'user-2',
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
        },
      });

      // Wait for async decryption to complete (multiple microtask flushes)
      await flushPromises();
      await flushPromises();

      const state = useChatStore.getState();
      expect(state.typingMembers.has('user-2')).toBe(true);
    });

    it('full round-trip: encrypt typing:true, send, receive, decrypt → indicator on', async () => {
      await setupRoomState();

      // Step 1: Call setTyping(true) — this encrypts and sends
      await useChatStore.getState().setTyping(true);

      // Step 2: Capture what was sent
      const sendCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(sendCalls.length).toBeGreaterThan(0);
      const [, sentData] = sendCalls[0] as [
        number,
        { iv: string; ciphertext: string },
      ];

      // Step 3: Simulate receiving the same encrypted data from another user
      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: {
          id: 'user-2',
          iv: sentData.iv,
          ciphertext: sentData.ciphertext,
        },
      });

      // Wait for async decryption
      await flushPromises();
      await flushPromises();

      // Step 4: Verify typing indicator is updated
      const state = useChatStore.getState();
      expect(state.typingMembers.has('user-2')).toBe(true);
    });

    it('receiving encrypted typing:false removes typing indicator', async () => {
      const roomKey = await setupRoomState();

      // First, set user-2 as typing
      const encryptedTrue = await encryptTypingStatus(roomKey, true);
      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: { id: 'user-2', iv: encryptedTrue.iv, ciphertext: encryptedTrue.ciphertext },
      });
      await flushPromises();
      await flushPromises();
      expect(useChatStore.getState().typingMembers.has('user-2')).toBe(true);

      // Then, send typing:false
      const encryptedFalse = await encryptTypingStatus(roomKey, false);
      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: { id: 'user-2', iv: encryptedFalse.iv, ciphertext: encryptedFalse.ciphertext },
      });
      await flushPromises();
      await flushPromises();

      expect(useChatStore.getState().typingMembers.has('user-2')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Backward compatibility with plaintext typing messages
  // ─────────────────────────────────────────────────────────────────────────

  describe('backward compatibility with plaintext typing messages', () => {
    it('plaintext typing:true from old client updates typing indicator', async () => {
      await setupRoomState();

      // Simulate receiving a plaintext typing message (old format: {id, typing})
      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: { id: 'user-2', typing: true },
      });

      const state = useChatStore.getState();
      expect(state.typingMembers.has('user-2')).toBe(true);
    });

    it('plaintext typing:false from old client removes typing indicator', async () => {
      await setupRoomState();

      // First set typing:true
      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: { id: 'user-2', typing: true },
      });
      expect(useChatStore.getState().typingMembers.has('user-2')).toBe(true);

      // Then set typing:false
      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: { id: 'user-2', typing: false },
      });

      expect(useChatStore.getState().typingMembers.has('user-2')).toBe(false);
    });

    it('plaintext typing auto-expires after timeout', async () => {
      vi.useFakeTimers();
      await setupRoomState();

      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: { id: 'user-2', typing: true },
      });
      expect(useChatStore.getState().typingMembers.has('user-2')).toBe(true);

      // Advance past the TYPING_TIMEOUT_MS (2000ms)
      vi.advanceTimersByTime(2100);

      expect(useChatStore.getState().typingMembers.has('user-2')).toBe(false);
      vi.useRealTimers();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Decryption failure handling (silent ignore)
  // ─────────────────────────────────────────────────────────────────────────

  describe('decryption failure handling (silent ignore)', () => {
    it('invalid ciphertext does not throw and does not update typing indicator', async () => {
      await setupRoomState();

      // Simulate receiving an encrypted typing message with invalid ciphertext
      // (garbage base64url data that will fail AES-GCM decryption)
      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: {
          id: 'user-2',
          iv: 'AAAAAAAAAAAAAAAA', // valid base64url but wrong data
          ciphertext: 'invalidciphertextdata_that_will_fail_decryption',
        },
      });

      // Wait for async decryption attempt to complete
      await flushPromises();
      await flushPromises();
      await flushPromises();

      // Typing indicator should NOT be updated (decryption failed silently)
      const state = useChatStore.getState();
      expect(state.typingMembers.has('user-2')).toBe(false);
    });

    it('encrypted typing with wrong key does not throw and does not update indicator', async () => {
      await setupRoomState();

      // Encrypt with a DIFFERENT room key (simulates key mismatch)
      const wrongKey = await generateRoomKey();
      const encrypted = await encryptTypingStatus(wrongKey, true);

      // Receive the message encrypted with the wrong key
      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: {
          id: 'user-2',
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
        },
      });

      // Wait for async decryption attempt
      await flushPromises();
      await flushPromises();
      await flushPromises();

      // Should silently ignore — no typing indicator update
      const state = useChatStore.getState();
      expect(state.typingMembers.has('user-2')).toBe(false);
    });

    it('message with neither encrypted nor plaintext format is silently ignored', async () => {
      await setupRoomState();

      // Simulate receiving a malformed typing message (neither format)
      useChatStore.getState().handleServerMessage({
        type: MSG_MEMBER_TYPING,
        data: { id: 'user-2', someUnknownField: 'garbage' },
      });

      await flushPromises();

      // Should be silently ignored
      const state = useChatStore.getState();
      expect(state.typingMembers.has('user-2')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Debounce race condition: rapid typing events only send latest state
  // ─────────────────────────────────────────────────────────────────────────

  describe('debounce race condition: rapid typing events only send latest state', () => {
    it('calling setTyping(true) when already typing does not send duplicate', async () => {
      await setupRoomState();

      // First call — should send
      await useChatStore.getState().setTyping(true);
      expect(ws.send).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Second call with same value — should NOT send (already typing)
      await useChatStore.getState().setTyping(true);
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('rapid true→false sequence sends both states (last-write-wins per transition)', async () => {
      await setupRoomState();

      // Start typing
      await useChatStore.getState().setTyping(true);
      expect(ws.send).toHaveBeenCalledTimes(1);

      // Immediately stop typing
      await useChatStore.getState().setTyping(false);
      expect(ws.send).toHaveBeenCalledTimes(2);

      // Both calls should be MSG_TYPING with encrypted data
      const calls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][0]).toBe(MSG_TYPING);
      expect(calls[1][0]).toBe(MSG_TYPING);
      expect(calls[0][1]).toHaveProperty('iv');
      expect(calls[0][1]).toHaveProperty('ciphertext');
      expect(calls[1][1]).toHaveProperty('iv');
      expect(calls[1][1]).toHaveProperty('ciphertext');
    });

    it('typing auto-cancels after timeout and sends typing:false', async () => {
      vi.useFakeTimers();
      await setupRoomState();

      // Start typing
      await useChatStore.getState().setTyping(true);
      expect(ws.send).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Advance past the TYPING_TIMEOUT_MS (2000ms) — auto-cancel fires
      await vi.advanceTimersByTimeAsync(2100);

      // Should have sent typing:false automatically
      expect(ws.send).toHaveBeenCalledWith(
        MSG_TYPING,
        expect.objectContaining({
          iv: expect.any(String),
          ciphertext: expect.any(String),
        })
      );
      vi.useRealTimers();
    });

    it('setTyping(false) after auto-cancel timeout does not send duplicate', async () => {
      vi.useFakeTimers();
      await setupRoomState();

      // Start typing
      await useChatStore.getState().setTyping(true);

      // Wait for auto-cancel timeout
      await vi.advanceTimersByTimeAsync(2100);

      vi.clearAllMocks();

      // Manually call setTyping(false) — should be no-op since already cancelled
      await useChatStore.getState().setTyping(false);

      // Should NOT send again (already in not-typing state)
      expect(ws.send).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('no send occurs when roomKey is null', async () => {
      // Set up state without roomKey
      useChatStore.setState({
        connected: true,
        myId: 'user-1',
        myName: 'TestUser',
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

      await useChatStore.getState().setTyping(true);

      // Should not send anything without a room key
      expect(ws.send).not.toHaveBeenCalled();
    });
  });
});
