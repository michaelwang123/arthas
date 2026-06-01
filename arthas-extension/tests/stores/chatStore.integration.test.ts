/**
 * Integration test for the full chat flow.
 *
 * Tests the chatStore actions end-to-end:
 * - Create room → generate share code → join room → send message → receive and decrypt
 * - Session persistence: simulate popup close → reopen → auto-rejoin
 * - Error paths: invalid share code, room not found, decryption failure
 *
 * _Requirements: 3.1–3.5, 4.1–4.5, 5.1–5.4, 6.1–6.4, 13.2–13.4_
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ===== Mock WebSocket module =====

let capturedMessageHandler: ((msg: { type: number; data: unknown }) => void) | null = null;
let capturedStateChangeHandler: ((state: { status: string; consecutiveFailures: number }) => void) | null = null;
const mockSend = vi.fn();
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();

vi.mock('../../src/network/websocket', () => ({
  connect: (...args: unknown[]) => mockConnect(...args),
  disconnect: (...args: unknown[]) => mockDisconnect(...args),
  send: (...args: unknown[]) => mockSend(...args),
  onMessage: vi.fn((handler: (msg: { type: number; data: unknown }) => void) => {
    capturedMessageHandler = handler;
  }),
  onStateChange: vi.fn((handler: (state: { status: string; consecutiveFailures: number }) => void) => {
    capturedStateChangeHandler = handler;
  }),
  getConnectionState: vi.fn(() => ({ status: 'disconnected', consecutiveFailures: 0 })),
}));

import { useChatStore } from '../../src/stores/chatStore';
import {
  MSG_JOIN_ROOM,
  MSG_SEND_MESSAGE,
  MSG_LEAVE_ROOM,
  MSG_ROOM_JOINED,
  MSG_MEMBER_JOINED,
  MSG_MEMBER_LEFT,
  MSG_RELAY_MESSAGE,
  MSG_ROOM_CLOSED,
  MSG_ERROR,
} from '../../src/network/protocol';
import { generateRoomKey, exportRoomKey } from '../../src/crypto/keys';
import { encryptMessage } from '../../src/crypto/encrypt';
import { encodeShareKey, decodeShareKey } from '../../src/crypto/shareKey';
import { buildPayload } from '../../src/utils/payload';
import { saveSession, loadSession, saveSettings } from '../../src/utils/storage';

// ===== Helpers =====

/** Simulate the server responding with "connected" state. */
function simulateConnected(): void {
  if (capturedStateChangeHandler) {
    capturedStateChangeHandler({ status: 'connected', consecutiveFailures: 0 });
  }
}

/** Wait for async operations to settle. */
async function tick(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** A valid 21-character NanoID-style room ID. */
const ROOM_ID = 'abcdefghijklmnopqrstu';

// ===== Test Suite =====

describe('chatStore integration — full chat flow', () => {
  beforeEach(async () => {
    capturedMessageHandler = null;
    capturedStateChangeHandler = null;
    vi.clearAllMocks();

    // Reset store to initial state
    useChatStore.setState({
      connectionStatus: 'disconnected',
      consecutiveFailures: 0,
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

    // Set up a server URL in local storage
    await saveSettings({ serverUrl: 'wss://test-server.com/ws' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Full Chat Flow: Create Room → Share Code → Send Message → Receive
  // ─────────────────────────────────────────────────────────────────────────

  describe('complete chat flow', () => {
    it('creates a room, generates share code, sends and receives encrypted messages', async () => {
      // 1. Initialize the store (registers message handler)
      await useChatStore.getState().initialize();
      expect(capturedMessageHandler).not.toBeNull();

      // 2. Generate a room key (simulating what createRoom does internally)
      const roomKey = await generateRoomKey();
      const keyEncoded = await exportRoomKey(roomKey);

      // Set up store state as if createRoom was called and server responded
      useChatStore.setState({
        myName: 'Alice',
        roomKey,
        connectionStatus: 'connected',
      });

      // 3. Simulate server responding with RoomCreated + RoomJoined
      capturedMessageHandler!({
        type: MSG_ROOM_JOINED,
        data: {
          roomId: ROOM_ID,
          members: [{ id: 'user-alice', name: 'Alice', color: '#ff0000' }],
          hasPassword: false,
          ephemeral: 0,
          expiresAt: 0,
        },
      });

      await tick();

      // Verify room state is set
      const stateAfterJoin = useChatStore.getState();
      expect(stateAfterJoin.roomId).toBe(ROOM_ID);
      expect(stateAfterJoin.myId).toBe('user-alice');
      expect(stateAfterJoin.members).toHaveLength(1);
      expect(stateAfterJoin.hasActiveSession).toBe(true);

      // 4. Generate share code from the room key
      const shareCode = await encodeShareKey(ROOM_ID, roomKey);
      expect(shareCode).toBeTruthy();

      // Verify share code can be decoded
      const decoded = decodeShareKey(shareCode);
      expect(decoded).not.toBeNull();
      expect(decoded!.roomId).toBe(ROOM_ID);
      expect(decoded!.keyEncoded).toBe(keyEncoded);

      // 5. Simulate a second user joining
      capturedMessageHandler!({
        type: MSG_MEMBER_JOINED,
        data: { id: 'user-bob', name: 'Bob', color: '#00ff00' },
      });

      await tick();

      const stateAfterBobJoins = useChatStore.getState();
      expect(stateAfterBobJoins.members).toHaveLength(2);
      expect(stateAfterBobJoins.members[1]!.name).toBe('Bob');

      // Verify system message for Bob joining
      const joinMessages = stateAfterBobJoins.messages.filter(
        (m) => m.isSystem && m.text.includes('Bob joined')
      );
      expect(joinMessages).toHaveLength(1);

      // 6. Send a message from Alice
      await useChatStore.getState().sendMessage('Hello Bob!');

      // Verify ws.send was called with MSG_SEND_MESSAGE
      const sendCalls = mockSend.mock.calls.filter(
        (call: unknown[]) => call[0] === MSG_SEND_MESSAGE
      );
      expect(sendCalls).toHaveLength(1);

      // Verify the sent data has iv and ciphertext
      const sentData = sendCalls[0]![1] as { iv: string; ciphertext: string };
      expect(sentData).toHaveProperty('iv');
      expect(sentData).toHaveProperty('ciphertext');

      // Verify message appears in local messages
      const stateAfterSend = useChatStore.getState();
      const aliceMessages = stateAfterSend.messages.filter(
        (m) => !m.isSystem && m.isMine
      );
      expect(aliceMessages).toHaveLength(1);
      expect(aliceMessages[0]!.text).toBe('Hello Bob!');

      // 7. Simulate receiving an encrypted message from Bob
      const bobMessage = 'Hi Alice!';
      const payload = buildPayload(bobMessage);
      const encrypted = await encryptMessage(roomKey, payload);

      capturedMessageHandler!({
        type: MSG_RELAY_MESSAGE,
        data: {
          senderId: 'user-bob',
          senderName: 'Bob',
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
          t: Date.now(),
        },
      });

      await tick();

      // Verify Bob's message was decrypted and displayed
      const stateAfterReceive = useChatStore.getState();
      const bobMessages = stateAfterReceive.messages.filter(
        (m) => !m.isSystem && m.senderId === 'user-bob'
      );
      expect(bobMessages).toHaveLength(1);
      expect(bobMessages[0]!.text).toBe('Hi Alice!');
      expect(bobMessages[0]!.senderName).toBe('Bob');
      expect(bobMessages[0]!.isMine).toBe(false);
    });

    it('handles member leaving the room', async () => {
      await useChatStore.getState().initialize();

      const roomKey = await generateRoomKey();
      useChatStore.setState({
        myName: 'Alice',
        roomKey,
        connectionStatus: 'connected',
        members: [
          { id: 'user-alice', name: 'Alice', color: '#ff0000' },
          { id: 'user-bob', name: 'Bob', color: '#00ff00' },
        ],
        myId: 'user-alice',
        roomId: ROOM_ID,
        hasActiveSession: true,
      });

      // Simulate Bob leaving
      capturedMessageHandler!({
        type: MSG_MEMBER_LEFT,
        data: { id: 'user-bob' },
      });

      await tick();

      const state = useChatStore.getState();
      expect(state.members).toHaveLength(1);
      expect(state.members[0]!.name).toBe('Alice');

      // Verify system message
      const leaveMessages = state.messages.filter(
        (m) => m.isSystem && m.text.includes('Bob left')
      );
      expect(leaveMessages).toHaveLength(1);
    });

    it('handles room closed event', async () => {
      await useChatStore.getState().initialize();

      const roomKey = await generateRoomKey();
      useChatStore.setState({
        myName: 'Alice',
        roomKey,
        connectionStatus: 'connected',
        members: [{ id: 'user-alice', name: 'Alice', color: '#ff0000' }],
        myId: 'user-alice',
        roomId: ROOM_ID,
        hasActiveSession: true,
      });

      // Simulate room closed
      capturedMessageHandler!({
        type: MSG_ROOM_CLOSED,
        data: {},
      });

      await tick();

      const state = useChatStore.getState();
      expect(state.roomId).toBeNull();
      expect(state.roomKey).toBeNull();
      expect(state.members).toHaveLength(0);
      expect(state.hasActiveSession).toBe(false);
      expect(state.connectionStatus).toBe('disconnected');

      // Verify disconnect was called
      expect(mockDisconnect).toHaveBeenCalled();

      // Verify system message about room closure
      const closedMessages = state.messages.filter(
        (m) => m.isSystem && m.text.includes('closed')
      );
      expect(closedMessages).toHaveLength(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Session Persistence: Close → Reopen → Auto-Rejoin
  // ─────────────────────────────────────────────────────────────────────────

  describe('session persistence and auto-rejoin', () => {
    it('saves session on room join and auto-rejoins on initialize', async () => {
      // 1. Initialize and set up a room session
      await useChatStore.getState().initialize();

      const roomKey = await generateRoomKey();
      const keyEncoded = await exportRoomKey(roomKey);

      useChatStore.setState({
        myName: 'Alice',
        roomKey,
        connectionStatus: 'connected',
      });

      // Simulate RoomJoined to trigger session save
      capturedMessageHandler!({
        type: MSG_ROOM_JOINED,
        data: {
          roomId: ROOM_ID,
          members: [{ id: 'user-alice', name: 'Alice', color: '#ff0000' }],
          hasPassword: false,
          ephemeral: 0,
          expiresAt: 0,
        },
      });

      await tick(100);

      // Verify session was saved
      const savedSession = await loadSession();
      expect(savedSession).not.toBeNull();
      expect(savedSession!.roomId).toBe(ROOM_ID);
      expect(savedSession!.nickname).toBe('Alice');
      expect(savedSession!.keyEncoded).toBe(keyEncoded);

      // 2. Simulate popup close → reopen by resetting store and re-initializing
      vi.clearAllMocks();
      capturedMessageHandler = null;
      capturedStateChangeHandler = null;

      useChatStore.setState({
        connectionStatus: 'disconnected',
        consecutiveFailures: 0,
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

      // 3. Re-initialize (simulates popup reopen)
      await useChatStore.getState().initialize();

      // Verify store loaded session state
      const stateAfterInit = useChatStore.getState();
      expect(stateAfterInit.myName).toBe('Alice');
      expect(stateAfterInit.roomId).toBe(ROOM_ID);
      expect(stateAfterInit.roomKey).not.toBeNull();
      expect(stateAfterInit.hasActiveSession).toBe(true);

      // Verify WebSocket connect was called with the server URL
      expect(mockConnect).toHaveBeenCalledWith('wss://test-server.com/ws');

      // 4. Simulate connection established — should trigger auto-rejoin JoinRoom
      simulateConnected();

      await tick();

      // Verify JoinRoom was sent for auto-rejoin
      const joinCalls = mockSend.mock.calls.filter(
        (call: unknown[]) => call[0] === MSG_JOIN_ROOM
      );
      expect(joinCalls).toHaveLength(1);
      expect(joinCalls[0]![1]).toEqual({
        roomId: ROOM_ID,
        name: 'Alice',
        password: '',
      });

      // 5. Simulate server responding with RoomJoined (rejoin success)
      capturedMessageHandler!({
        type: MSG_ROOM_JOINED,
        data: {
          roomId: ROOM_ID,
          members: [
            { id: 'user-alice-new', name: 'Alice', color: '#ff0000' },
            { id: 'user-bob', name: 'Bob', color: '#00ff00' },
          ],
          hasPassword: false,
          ephemeral: 0,
          expiresAt: 0,
        },
      });

      await tick();

      // Verify "Reconnected" system message
      const stateAfterRejoin = useChatStore.getState();
      const reconnectMessages = stateAfterRejoin.messages.filter(
        (m) => m.isSystem && m.text === 'Reconnected'
      );
      expect(reconnectMessages).toHaveLength(1);

      // Verify members are updated
      expect(stateAfterRejoin.members).toHaveLength(2);
    });

    it('clears session and shows error when auto-rejoin fails (E001)', async () => {
      // Set up a saved session
      const roomKey = await generateRoomKey();
      const keyEncoded = await exportRoomKey(roomKey);

      await saveSession({
        roomId: ROOM_ID,
        nickname: 'Alice',
        keyEncoded,
        serverUrl: 'wss://test-server.com/ws',
        members: [{ id: 'user-alice', name: 'Alice', color: '#ff0000' }],
      });

      // Initialize (loads session, attempts auto-rejoin)
      await useChatStore.getState().initialize();

      // Simulate connection established
      simulateConnected();
      await tick();

      // Simulate server responding with E001 (room not found)
      capturedMessageHandler!({
        type: MSG_ERROR,
        data: { code: 'E001', msg: 'Room not found' },
      });

      await tick();

      // Verify session was cleared and error is shown
      const state = useChatStore.getState();
      expect(state.roomId).toBeNull();
      expect(state.roomKey).toBeNull();
      expect(state.hasActiveSession).toBe(false);
      expect(state.sessionError).toBe('error.sessionExpired');
      expect(state.myName).toBe('');

      // Verify session storage was cleared
      const session = await loadSession();
      expect(session).toBeNull();

      // Verify disconnect was called
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Error Paths
  // ─────────────────────────────────────────────────────────────────────────

  describe('error paths', () => {
    it('rejects invalid share code (wrong format)', () => {
      // Share code with wrong segment count
      expect(decodeShareKey('')).toBeNull();
      expect(decodeShareKey('single-segment')).toBeNull();
      expect(decodeShareKey('a:b:c:d:e')).toBeNull(); // 5 segments

      // Share code with wrong roomId length (not 21)
      expect(decodeShareKey('short:' + 'a'.repeat(43))).toBeNull();
      expect(decodeShareKey('a'.repeat(22) + ':' + 'b'.repeat(43))).toBeNull();

      // Share code with wrong key length (not 43)
      expect(decodeShareKey(ROOM_ID + ':' + 'a'.repeat(42))).toBeNull();
      expect(decodeShareKey(ROOM_ID + ':' + 'a'.repeat(44))).toBeNull();

      // Share code with invalid ephemeral (not a non-negative integer)
      expect(decodeShareKey(ROOM_ID + ':' + 'a'.repeat(43) + ':-1')).toBeNull();
      expect(decodeShareKey(ROOM_ID + ':' + 'a'.repeat(43) + ':abc')).toBeNull();
    });

    it('displays placeholder for decryption failure', async () => {
      await useChatStore.getState().initialize();

      const roomKey = await generateRoomKey();
      useChatStore.setState({
        myName: 'Alice',
        roomKey,
        connectionStatus: 'connected',
        myId: 'user-alice',
        roomId: ROOM_ID,
        hasActiveSession: true,
      });

      // Simulate receiving a message encrypted with a DIFFERENT key
      const wrongKey = await generateRoomKey();
      const payload = buildPayload('Secret message');
      const encrypted = await encryptMessage(wrongKey, payload);

      capturedMessageHandler!({
        type: MSG_RELAY_MESSAGE,
        data: {
          senderId: 'user-bob',
          senderName: 'Bob',
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
          t: Date.now(),
        },
      });

      await tick(100);

      // Verify placeholder is shown instead of decrypted text
      const state = useChatStore.getState();
      const bobMessages = state.messages.filter(
        (m) => !m.isSystem && m.senderId === 'user-bob'
      );
      expect(bobMessages).toHaveLength(1);
      expect(bobMessages[0]!.text).toBe('[Cannot decrypt this message]');
    });

    it('handles corrupted ciphertext gracefully', async () => {
      await useChatStore.getState().initialize();

      const roomKey = await generateRoomKey();
      useChatStore.setState({
        myName: 'Alice',
        roomKey,
        connectionStatus: 'connected',
        myId: 'user-alice',
        roomId: ROOM_ID,
        hasActiveSession: true,
      });

      // Simulate receiving a message with invalid base64url ciphertext
      capturedMessageHandler!({
        type: MSG_RELAY_MESSAGE,
        data: {
          senderId: 'user-bob',
          senderName: 'Bob',
          iv: 'AAAAAAAAAAAAAAAA', // valid base64url (12 bytes)
          ciphertext: 'corrupted-data-not-valid-base64url!!!',
          t: Date.now(),
        },
      });

      await tick(100);

      // Verify placeholder is shown
      const state = useChatStore.getState();
      const bobMessages = state.messages.filter(
        (m) => !m.isSystem && m.senderId === 'user-bob'
      );
      expect(bobMessages).toHaveLength(1);
      expect(bobMessages[0]!.text).toBe('[Cannot decrypt this message]');
    });

    it('skips pubkey broadcast messages after decryption', async () => {
      await useChatStore.getState().initialize();

      const roomKey = await generateRoomKey();
      useChatStore.setState({
        myName: 'Alice',
        roomKey,
        connectionStatus: 'connected',
        myId: 'user-alice',
        roomId: ROOM_ID,
        hasActiveSession: true,
      });

      // Simulate receiving a pubkey broadcast (encrypted JSON with type: "pubkey")
      const pubkeyPayload = JSON.stringify({ type: 'pubkey', pubkey: 'fake-ed25519-key' });
      const encrypted = await encryptMessage(roomKey, pubkeyPayload);

      capturedMessageHandler!({
        type: MSG_RELAY_MESSAGE,
        data: {
          senderId: 'user-bob',
          senderName: 'Bob',
          iv: encrypted.iv,
          ciphertext: encrypted.ciphertext,
          t: Date.now(),
        },
      });

      await tick(100);

      // Verify pubkey message was NOT added to the message list
      const state = useChatStore.getState();
      const bobMessages = state.messages.filter(
        (m) => !m.isSystem && m.senderId === 'user-bob'
      );
      expect(bobMessages).toHaveLength(0);
    });

    it('leave room clears all state and sends LeaveRoom message', async () => {
      await useChatStore.getState().initialize();

      const roomKey = await generateRoomKey();
      const keyEncoded = await exportRoomKey(roomKey);

      // Set up active room state
      useChatStore.setState({
        myName: 'Alice',
        roomKey,
        connectionStatus: 'connected',
        myId: 'user-alice',
        roomId: ROOM_ID,
        members: [{ id: 'user-alice', name: 'Alice', color: '#ff0000' }],
        hasActiveSession: true,
      });

      // Save session to verify it gets cleared
      await saveSession({
        roomId: ROOM_ID,
        nickname: 'Alice',
        keyEncoded,
        serverUrl: 'wss://test-server.com/ws',
        members: [{ id: 'user-alice', name: 'Alice', color: '#ff0000' }],
      });

      // Leave the room
      await useChatStore.getState().leaveRoom();

      // Verify LeaveRoom was sent
      const leaveCalls = mockSend.mock.calls.filter(
        (call: unknown[]) => call[0] === MSG_LEAVE_ROOM
      );
      expect(leaveCalls).toHaveLength(1);

      // Verify disconnect was called
      expect(mockDisconnect).toHaveBeenCalled();

      // Verify state is cleared
      const state = useChatStore.getState();
      expect(state.roomId).toBeNull();
      expect(state.roomKey).toBeNull();
      expect(state.myId).toBeNull();
      expect(state.myName).toBe('');
      expect(state.members).toHaveLength(0);
      expect(state.messages).toHaveLength(0);
      expect(state.hasActiveSession).toBe(false);

      // Verify session storage was cleared
      const session = await loadSession();
      expect(session).toBeNull();
    });
  });
});
