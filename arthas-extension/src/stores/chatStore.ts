/**
 * Chat state management using Zustand.
 * Integrates crypto layer (encrypt/decrypt) and network layer (WebSocket).
 *
 * Reference: arthas-client/src/stores/chatStore.ts
 * Requirements: 2.1, 2.4, 2.8, 3.1–3.6, 4.1–4.7, 5.1–5.6, 9.1–9.4, 13.1–13.7, 14.1–14.4
 */

import { create } from 'zustand';
import * as ws from '../network/websocket';
import {
  MSG_CREATE_ROOM,
  MSG_JOIN_ROOM,
  MSG_SEND_MESSAGE,
  MSG_LEAVE_ROOM,
  MSG_TYPING,
  MSG_ROOM_CREATED,
  MSG_ROOM_JOINED,
  MSG_MEMBER_JOINED,
  MSG_MEMBER_LEFT,
  MSG_RELAY_MESSAGE,
  MSG_MEMBER_TYPING,
  MSG_ROOM_CLOSED,
  MSG_ERROR,
  ERR_ROOM_NOT_FOUND,
  ERR_ROOM_FULL,
  type Message,
  type RoomCreatedData,
  type RoomJoinedData,
  type MemberJoinedData,
  type MemberLeftData,
  type ErrorData,
  type RelayMessageData,
  type MemberTypingData,
} from '../network/protocol';
import { loadSession, saveSession, clearSession, loadSettings } from '../utils/storage';
import { generateRoomKey, exportRoomKey, importRoomKey } from '../crypto/keys';
import { encryptMessage } from '../crypto/encrypt';
import { decryptMessage } from '../crypto/decrypt';
import { encryptTypingStatus, decryptTypingStatus } from '../crypto/typingEncrypt';
import { encodeShareKey, decodeShareKey } from '../crypto/shareKey';
import { buildPayload, parsePayload } from '../utils/payload';
import { canSend, recordSend } from '../utils/rateLimit';
import { generateMessageId, makeStableId } from '../utils/messageId';

// ===== Types =====

export interface ChatMessage {
  id: string;
  stableId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isMine: boolean;
  isSystem: boolean;
}

export interface Member {
  id: string;
  name: string;
  color: string;
}

export interface ChatState {
  // Connection
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  consecutiveFailures: number;
  isConnecting: boolean; // true during createRoom/joinRoom connection phase
  myId: string | null;
  myName: string;

  // Room
  roomId: string | null;
  roomKey: CryptoKey | null;
  shareCode: string | null;
  members: Member[];

  // Messages
  messages: ChatMessage[];
  typingMembers: Map<string, number>;

  // Session indicator
  hasActiveSession: boolean;
  sessionError: string | null;

  // Actions
  initialize: () => Promise<void>;
  createRoom: (name: string) => Promise<void>;
  joinRoom: (shareCode: string, name: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  setTyping: (typing: boolean) => Promise<void>;
  leaveRoom: () => Promise<void>;
  retryConnection: () => void;
}

// ===== Constants =====

/** Maximum number of messages kept in the chat view (oldest removed when exceeded). */
export const MAX_MESSAGES = 200;

/** Auto-cancel typing after this duration (ms). */
export const TYPING_TIMEOUT_MS = 2000;

/** Auto-remove typing indicator display after this duration (ms). */
export const TYPING_DISPLAY_TIMEOUT_MS = 5000;

// ===== Module-level state =====

/** Server URL stored during initialization for reconnection */
let storedServerUrl = '';

/** Flag to distinguish auto-rejoin from fresh join (affects RoomJoined handler) */
let isAutoRejoining = false;

// ===== Typing Concurrency Control =====

let typingVersion = 0;
let typingTimer: ReturnType<typeof setTimeout> | null = null;
let isCurrentlyTyping = false;

// ===== Utilities =====

/** Execute an async operation without blocking, logging errors in dev mode. */
function safeAsync(fn: () => Promise<void>): void {
  fn().catch((err) => {
    console.error('[chatStore] Async error:', err);
  });
}

function clearBadge(): void {
  try {
    chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' });
  } catch {
    // Service worker may not be available
  }
}

/** Validate nickname: 1–20 chars after trimming. */
export function validateNickname(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 20;
}

/** Validate message text: 1–500 chars. */
export function validateMessage(text: string): boolean {
  return text.length >= 1 && text.length <= 500;
}

/**
 * Wait for WebSocket connection using event-driven approach.
 * Subscribes to state changes and resolves on 'connected', rejects on 'failed' or timeout.
 */
function waitForConnection(timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already connected
    const current = ws.getConnectionState();
    if (current.status === 'connected') {
      resolve();
      return;
    }
    if (current.status === 'failed') {
      reject(new Error('Connection failed'));
      return;
    }

    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Connection timeout'));
    }, timeoutMs);

    const unsubscribe = ws.onStateChange((state) => {
      if (state.status === 'connected') {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      } else if (state.status === 'failed') {
        clearTimeout(timeout);
        unsubscribe();
        reject(new Error('Connection failed'));
      }
    });
  });
}

// ===== Type Guards for Server Message Validation =====

function isRoomCreatedData(data: unknown): data is RoomCreatedData {
  return typeof data === 'object' && data !== null
    && 'roomId' in data && typeof (data as Record<string, unknown>).roomId === 'string';
}

function isRoomJoinedData(data: unknown): data is RoomJoinedData {
  return typeof data === 'object' && data !== null
    && 'roomId' in data && typeof (data as Record<string, unknown>).roomId === 'string'
    && 'members' in data && Array.isArray((data as Record<string, unknown>).members);
}

function isMemberJoinedData(data: unknown): data is MemberJoinedData {
  return typeof data === 'object' && data !== null
    && 'id' in data && typeof (data as Record<string, unknown>).id === 'string'
    && 'name' in data && typeof (data as Record<string, unknown>).name === 'string'
    && 'color' in data && typeof (data as Record<string, unknown>).color === 'string';
}

function isMemberLeftData(data: unknown): data is MemberLeftData {
  return typeof data === 'object' && data !== null
    && 'id' in data && typeof (data as Record<string, unknown>).id === 'string';
}

function isRelayMessageData(data: unknown): data is RelayMessageData {
  return typeof data === 'object' && data !== null
    && 'senderId' in data && typeof (data as Record<string, unknown>).senderId === 'string'
    && 'iv' in data && typeof (data as Record<string, unknown>).iv === 'string'
    && 'ciphertext' in data && typeof (data as Record<string, unknown>).ciphertext === 'string';
}

function isMemberTypingData(data: unknown): data is MemberTypingData {
  return typeof data === 'object' && data !== null
    && 'id' in data && typeof (data as Record<string, unknown>).id === 'string';
}

function isErrorData(data: unknown): data is ErrorData {
  return typeof data === 'object' && data !== null
    && 'code' in data && typeof (data as Record<string, unknown>).code === 'string';
}

// ===== Helper: Add system message =====

function addSystemMessage(text: string): void {
  const currentMessages = useChatStore.getState().messages;
  const timestamp = Date.now();
  const newMessage: ChatMessage = {
    id: generateMessageId(),
    stableId: makeStableId('system', timestamp),
    senderId: 'system',
    senderName: '',
    text,
    timestamp,
    isMine: false,
    isSystem: true,
  };

  const updated = [...currentMessages, newMessage];
  const capped = updated.length > MAX_MESSAGES
    ? updated.slice(updated.length - MAX_MESSAGES)
    : updated;

  useChatStore.setState({ messages: capped });
}

/** Persist current members to session storage (non-blocking, non-critical). */
function persistMembers(updatedMembers: Member[]): void {
  safeAsync(async () => {
    const session = await loadSession();
    if (session) {
      await saveSession({ ...session, members: updatedMembers });
    }
  });
}

// ===== Message Handlers (extracted for readability) =====

function handleRoomCreated(msg: Message): void {
  if (!isRoomCreatedData(msg.data)) return;
  useChatStore.setState({ roomId: msg.data.roomId });
}

function handleRoomJoined(msg: Message): void {
  if (!isRoomJoinedData(msg.data)) return;
  const data = msg.data;
  const members: Member[] = data.members.map((m) => ({
    id: m.id,
    name: m.name,
    color: m.color,
  }));

  // Determine myId: last member in the list is the joining user
  const myId = members[members.length - 1]?.id ?? null;

  useChatStore.setState({
    roomId: data.roomId,
    members,
    myId,
    hasActiveSession: true,
    sessionError: null,
    isConnecting: false,
  });

  if (isAutoRejoining) {
    addSystemMessage('Reconnected');
    isAutoRejoining = false;
  }

  // Generate share code and save session
  const state = useChatStore.getState();
  if (state.roomKey) {
    safeAsync(async () => {
      const keyEncoded = await exportRoomKey(state.roomKey!);
      const shareCode = await encodeShareKey(data.roomId, state.roomKey!);
      useChatStore.setState({ shareCode });
      await saveSession({
        roomId: data.roomId,
        nickname: state.myName,
        keyEncoded,
        serverUrl: storedServerUrl,
        members: state.members,
      });
    });
  }
}

function handleMemberJoined(msg: Message): void {
  if (!isMemberJoinedData(msg.data)) return;
  const data = msg.data;
  const newMember: Member = { id: data.id, name: data.name, color: data.color };

  const currentMembers = useChatStore.getState().members;
  const updatedMembers = [...currentMembers, newMember];
  useChatStore.setState({ members: updatedMembers });

  addSystemMessage(`${data.name} joined the room`);
  persistMembers(updatedMembers);
}

function handleMemberLeft(msg: Message): void {
  if (!isMemberLeftData(msg.data)) return;
  const data = msg.data;
  const state = useChatStore.getState();

  const leavingMember = state.members.find((m) => m.id === data.id);
  const memberName = leavingMember?.name ?? 'Unknown';
  const updatedMembers = state.members.filter((m) => m.id !== data.id);

  // Remove from typingMembers if present
  const typingMembers = new Map(state.typingMembers);
  if (typingMembers.has(data.id)) {
    const handle = typingMembers.get(data.id);
    if (handle !== undefined) clearTimeout(handle);
    typingMembers.delete(data.id);
  }

  useChatStore.setState({ members: updatedMembers, typingMembers });
  addSystemMessage(`${memberName} left the room`);
  persistMembers(updatedMembers);
}

function handleRelayMessage(msg: Message): void {
  if (!isRelayMessageData(msg.data)) return;
  const { senderId, senderName, iv, ciphertext, t } = msg.data;
  const { roomKey } = useChatStore.getState();

  if (!roomKey) return;

  safeAsync(async () => {
    let text: string;
    try {
      const plaintext = await decryptMessage(roomKey, iv, ciphertext);
      // Skip pubkey broadcast messages (Ed25519 key exchange from web clients)
      try {
        const raw: unknown = JSON.parse(plaintext);
        if (typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).type === 'pubkey') {
          return;
        }
      } catch {
        // Not valid JSON — handled by parsePayload as legacy plaintext
      }
      const parsed = parsePayload(plaintext);
      text = parsed.text;
    } catch {
      text = '[Cannot decrypt this message]';
    }

    const currentMessages = useChatStore.getState().messages;
    const newMessage: ChatMessage = {
      id: generateMessageId(),
      stableId: makeStableId(senderId, t),
      senderId,
      senderName: senderName ?? 'Unknown',
      text,
      timestamp: t,
      isMine: false,
      isSystem: false,
    };

    const updated = [...currentMessages, newMessage];
    const capped = updated.length > MAX_MESSAGES
      ? updated.slice(updated.length - MAX_MESSAGES)
      : updated;
    useChatStore.setState({ messages: capped });
  });
}

function handleMemberTyping(msg: Message): void {
  if (!isMemberTypingData(msg.data)) return;
  const data = msg.data;
  const senderId = data.id;
  const iv = 'iv' in data ? (data as unknown as Record<string, unknown>).iv : undefined;
  const ciphertext = 'ciphertext' in data ? (data as unknown as Record<string, unknown>).ciphertext : undefined;
  const { roomKey } = useChatStore.getState();

  if (!roomKey || typeof iv !== 'string' || typeof ciphertext !== 'string') return;

  safeAsync(async () => {
    let typing: boolean;
    try {
      typing = await decryptTypingStatus(roomKey, iv, ciphertext);
    } catch {
      return; // Silently ignore decryption failure (backward compat)
    }

    const currentState = useChatStore.getState();
    const typingMembers = new Map(currentState.typingMembers);

    if (typing) {
      const existingHandle = typingMembers.get(senderId);
      if (existingHandle) clearTimeout(existingHandle);

      const handle = setTimeout(() => {
        const s = useChatStore.getState();
        const updated = new Map(s.typingMembers);
        updated.delete(senderId);
        useChatStore.setState({ typingMembers: updated });
      }, TYPING_DISPLAY_TIMEOUT_MS) as unknown as number;

      typingMembers.set(senderId, handle);
    } else {
      const handle = typingMembers.get(senderId);
      if (handle) clearTimeout(handle);
      typingMembers.delete(senderId);
    }

    useChatStore.setState({ typingMembers });
  });
}

function handleRoomClosed(): void {
  addSystemMessage('Room has been closed');
  ws.disconnect();
  safeAsync(async () => { await clearSession(); });
  clearBadge();

  useChatStore.setState({
    connectionStatus: 'disconnected',
    consecutiveFailures: 0,
    isConnecting: false,
    myId: null,
    roomId: null,
    roomKey: null,
    shareCode: null,
    members: [],
    typingMembers: new Map(),
    hasActiveSession: false,
  });
}

function handleError(msg: Message): void {
  if (!isErrorData(msg.data)) return;
  const data = msg.data;

  if (isAutoRejoining && data.code === ERR_ROOM_NOT_FOUND) {
    isAutoRejoining = false;
    ws.disconnect();
    safeAsync(async () => { await clearSession(); });
    clearBadge();

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
      sessionError: 'error.sessionExpired',
    });
    return;
  }

  if (data.code === ERR_ROOM_FULL) {
    useChatStore.setState({ sessionError: 'error.E002', isConnecting: false });
    ws.disconnect();
    return;
  }

  if (data.code === ERR_ROOM_NOT_FOUND) {
    useChatStore.setState({ sessionError: 'error.E001', isConnecting: false });
    ws.disconnect();
    return;
  }

  // E004 (rate limited by server) — informational only
  if (data.code === 'E004') {
    addSystemMessage('Server: Too many messages, slow down');
  }
}

// ===== Message Dispatcher =====

/**
 * Dispatches server messages by type.
 * Unknown message types are silently ignored (no crash, no state change).
 */
function handleServerMessage(msg: Message): void {
  switch (msg.type) {
    case MSG_ROOM_CREATED: handleRoomCreated(msg); break;
    case MSG_ROOM_JOINED: handleRoomJoined(msg); break;
    case MSG_MEMBER_JOINED: handleMemberJoined(msg); break;
    case MSG_MEMBER_LEFT: handleMemberLeft(msg); break;
    case MSG_RELAY_MESSAGE: handleRelayMessage(msg); break;
    case MSG_MEMBER_TYPING: handleMemberTyping(msg); break;
    case MSG_ROOM_CLOSED: handleRoomClosed(); break;
    case MSG_ERROR: handleError(msg); break;
    default: break; // Unknown types silently ignored
  }
}

// ===== Store =====

export const useChatStore = create<ChatState>((_set, get) => ({
  // Initial state
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

  initialize: async () => {
    // Subscribe to WebSocket connection state changes
    ws.onStateChange((state) => {
      const currentState = useChatStore.getState();

      useChatStore.setState({
        connectionStatus: state.status,
        consecutiveFailures: state.consecutiveFailures,
      });

      // When connection is established during auto-rejoin, send JoinRoom
      if (isAutoRejoining && state.status === 'connected' && currentState.roomId && currentState.myName) {
        ws.send(MSG_JOIN_ROOM, {
          roomId: currentState.roomId,
          name: currentState.myName,
          password: '',
        });
      }
    });

    // Set up message handler dispatch
    ws.onMessage(handleServerMessage);

    // Load existing session from storage
    const session = await loadSession();
    if (session) {
      storedServerUrl = session.serverUrl;

      let roomKey: CryptoKey | null = null;
      try {
        roomKey = await importRoomKey(session.keyEncoded);
      } catch {
        await clearSession();
        const settings = await loadSettings();
        storedServerUrl = settings.serverUrl;
        useChatStore.setState({ hasActiveSession: false });
        clearBadge();
        return;
      }

      useChatStore.setState({
        myName: session.nickname,
        roomId: session.roomId,
        members: session.members,
        roomKey,
        hasActiveSession: true,
        sessionError: null,
      });

      // Auto-rejoin
      isAutoRejoining = true;
      ws.connect(session.serverUrl);
    } else {
      const settings = await loadSettings();
      storedServerUrl = settings.serverUrl;
      useChatStore.setState({ hasActiveSession: false });
    }

    clearBadge();
  },

  createRoom: async (name: string) => {
    if (!validateNickname(name)) return;
    const trimmedName = name.trim();

    const settings = await loadSettings();
    if (!settings.serverUrl) {
      useChatStore.setState({ sessionError: 'error.serverNotConfigured' });
      return;
    }
    storedServerUrl = settings.serverUrl;

    const roomKey = await generateRoomKey();

    useChatStore.setState({
      myName: trimmedName,
      roomKey,
      sessionError: null,
      isConnecting: true,
    });

    ws.connect(settings.serverUrl);

    try {
      await waitForConnection();
      ws.send(MSG_CREATE_ROOM, {
        name: trimmedName,
        password: '',
        ephemeral: 0,
        expiry: 0,
      });
    } catch {
      useChatStore.setState({ sessionError: 'error.connectionFailed', isConnecting: false });
    }
  },

  joinRoom: async (shareCode: string, name: string) => {
    if (!validateNickname(name)) return;
    const trimmedName = name.trim();

    const decoded = decodeShareKey(shareCode.trim());
    if (!decoded) {
      useChatStore.setState({ sessionError: 'error.invalidShareCode' });
      return;
    }

    const settings = await loadSettings();
    if (!settings.serverUrl) {
      useChatStore.setState({ sessionError: 'error.serverNotConfigured' });
      return;
    }
    storedServerUrl = settings.serverUrl;

    let roomKey: CryptoKey;
    try {
      roomKey = await importRoomKey(decoded.keyEncoded);
    } catch {
      useChatStore.setState({ sessionError: 'error.invalidShareCode' });
      return;
    }

    useChatStore.setState({
      myName: trimmedName,
      roomKey,
      sessionError: null,
      isConnecting: true,
    });

    ws.connect(settings.serverUrl);

    try {
      await waitForConnection();
      ws.send(MSG_JOIN_ROOM, {
        roomId: decoded.roomId,
        name: trimmedName,
        password: '',
      });
    } catch {
      useChatStore.setState({ sessionError: 'error.connectionFailed', isConnecting: false });
    }
  },

  sendMessage: async (text: string) => {
    if (!validateMessage(text)) return;
    if (!canSend()) return;

    const { roomKey, myId, myName } = get();
    if (!roomKey) return;

    const plaintext = buildPayload(text);
    const { iv, ciphertext } = await encryptMessage(roomKey, plaintext);

    ws.send(MSG_SEND_MESSAGE, { iv, ciphertext });
    recordSend();

    const timestamp = Date.now();
    const newMessage: ChatMessage = {
      id: generateMessageId(),
      stableId: makeStableId(myId ?? '', timestamp),
      senderId: myId ?? '',
      senderName: myName,
      text,
      timestamp,
      isMine: true,
      isSystem: false,
    };

    const currentMessages = get().messages;
    const updated = [...currentMessages, newMessage];
    const capped = updated.length > MAX_MESSAGES
      ? updated.slice(updated.length - MAX_MESSAGES)
      : updated;

    useChatStore.setState({ messages: capped });
  },

  setTyping: async (typing: boolean) => {
    if (typing === isCurrentlyTyping) return;
    isCurrentlyTyping = typing;

    const version = ++typingVersion;

    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }

    if (typing) {
      typingTimer = setTimeout(() => {
        typingTimer = null;
        isCurrentlyTyping = false;

        const currentRoomKey = useChatStore.getState().roomKey;
        const cancelVersion = ++typingVersion;

        if (currentRoomKey) {
          safeAsync(async () => {
            const encrypted = await encryptTypingStatus(currentRoomKey, false);
            if (typingVersion === cancelVersion) {
              ws.send(MSG_TYPING, encrypted);
            }
          });
        }
      }, TYPING_TIMEOUT_MS);
    }

    const { roomKey } = get();
    if (!roomKey) return;

    try {
      const encrypted = await encryptTypingStatus(roomKey, typing);
      if (typingVersion !== version) return;
      ws.send(MSG_TYPING, encrypted);
    } catch {
      // Encryption failure — non-critical
    }
  },

  leaveRoom: async () => {
    ws.send(MSG_LEAVE_ROOM, {});
    ws.disconnect();

    const { typingMembers } = get();
    typingMembers.forEach((handle) => clearTimeout(handle));

    isCurrentlyTyping = false;
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }

    await clearSession();
    clearBadge();

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
  },

  retryConnection: () => {
    if (!storedServerUrl) return;
    useChatStore.setState({ connectionStatus: 'connecting', consecutiveFailures: 0 });
    ws.connect(storedServerUrl);
  },
}));

/** Get the stored server URL (for external use). */
export function getStoredServerUrl(): string {
  return storedServerUrl;
}

/** Set the stored server URL (for external use). */
export function setStoredServerUrl(url: string): void {
  storedServerUrl = url;
}
