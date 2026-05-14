/**
 * Chat state management using Zustand.
 * Integrates crypto layer (encrypt/decrypt) and network layer (WebSocket).
 */

import { create } from 'zustand';
import * as ws from '../network/websocket';
import {
  MSG_CREATE_ROOM,
  MSG_JOIN_ROOM,
  MSG_SEND_MESSAGE,
  MSG_LEAVE_ROOM,
  MSG_TYPING,
  MSG_SEND_REACTION,
  MSG_ROOM_CREATED,
  MSG_ROOM_JOINED,
  MSG_MEMBER_JOINED,
  MSG_MEMBER_LEFT,
  MSG_RELAY_MESSAGE,
  MSG_RELAY_REACTION,
  MSG_MEMBER_TYPING,
  MSG_ROOM_CLOSED,
  MSG_ERROR,
  type Message,
  type RoomCreatedData,
  type RoomJoinedData,
  type MemberJoinedData,
  type MemberLeftData,
  type RelayMessageData,
  type RelayReactionData,
  type MemberTypingData,
  type ErrorData,
} from '../network/protocol';
import { generateRoomKey } from '../crypto/keys';
import { importRoomKey } from '../crypto/keys';
import { encryptMessage } from '../crypto/encrypt';
import { decryptMessage } from '../crypto/decrypt';
import { encodeShareKey, decodeShareKey } from '../crypto/shareKey';
import { playNotificationSound, showDesktopNotification, playJoinSound, playLeaveSound } from '../utils/notification';
import { buildPayload, parsePayload, makeStableId } from '../utils/payload';

// ===== Types =====

export interface ReplyData {
  stableId: string;
  senderName: string;
  preview: string;
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface ChatMessage {
  id: string;
  stableId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isMine: boolean;
  isSystem: boolean;
  reply?: ReplyData;
}

export interface Member {
  id: string;
  name: string;
  color: string;
}

export interface ChatState {
  // Connection
  connected: boolean;
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

  // Notification
  muted: boolean;

  // Reply
  replyTo: ReplyData | null;

  // Reactions
  reactions: Map<string, Reaction[]>;

  // Actions
  connect: () => void;
  createRoom: (name: string) => Promise<void>;
  joinRoom: (shareCode: string, name: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  setTyping: (typing: boolean) => void;
  leaveRoom: () => void;
  toggleMute: () => void;
  setReplyTo: (reply: ReplyData) => void;
  clearReply: () => void;
  sendReaction: (stableId: string, emoji: string) => void;

  // Internal
  handleServerMessage: (msg: Message) => void;
}

// ===== Constants =====

const MAX_MESSAGES = 200;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 10;
const TYPING_TIMEOUT_MS = 2000;

// ===== Rate limiter state (module-level to avoid store bloat) =====

const messageTimes: number[] = [];

function isRateLimited(): boolean {
  const now = Date.now();
  // Remove timestamps older than the window
  while (messageTimes.length > 0 && now - messageTimes[0] > RATE_LIMIT_WINDOW_MS) {
    messageTimes.shift();
  }
  return messageTimes.length >= RATE_LIMIT_MAX;
}

function recordMessageSent(): void {
  messageTimes.push(Date.now());
}

// ===== Typing debounce state =====

let typingTimer: ReturnType<typeof setTimeout> | null = null;
let isCurrentlyTyping = false;

// ===== Unique ID generator =====

let messageCounter = 0;

function generateMessageId(): string {
  return `${Date.now()}-${++messageCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

// ===== Store =====

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  connected: false,
  myId: null,
  myName: '',
  roomId: null,
  roomKey: null,
  shareCode: null,
  members: [],
  messages: [],
  typingMembers: new Map(),
  muted: localStorage.getItem('arthas_muted') === 'true',
  replyTo: null,
  reactions: new Map(),

  connect: () => {
    ws.onMessage((msg: Message) => {
      get().handleServerMessage(msg);
    });
    ws.connect();
    // Track connection state via polling (ws module exposes isConnected)
    const checkConnection = () => {
      const wasConnected = get().connected;
      const nowConnected = ws.isConnected();
      if (wasConnected !== nowConnected) {
        set({ connected: nowConnected });
      }
    };
    // Check connection state periodically
    setInterval(checkConnection, 500);
  },

  createRoom: async (name: string) => {
    const roomKey = await generateRoomKey();
    set({ myName: name, roomKey });
    ws.send(MSG_CREATE_ROOM, { name });
  },

  joinRoom: async (shareCode: string, name: string) => {
    const decoded = decodeShareKey(shareCode);
    if (!decoded) {
      // Invalid share code — add system error message
      const errorMsg: ChatMessage = {
        id: generateMessageId(),
        stableId: '',
        senderId: 'system',
        senderName: 'System',
        text: '分享码无效',
        timestamp: Date.now(),
        isMine: false,
        isSystem: true,
      };
      set((state) => ({ messages: [...state.messages, errorMsg] }));
      return;
    }

    const { roomId, keyEncoded } = decoded;
    const roomKey = await importRoomKey(keyEncoded);
    set({ myName: name, roomKey, shareCode });
    ws.send(MSG_JOIN_ROOM, { roomId, name });
  },

  sendMessage: async (text: string) => {
    const { roomKey, myId, myName, replyTo } = get();
    if (!roomKey || !myId) return;

    // Rate limiting check
    if (isRateLimited()) {
      const errorMsg: ChatMessage = {
        id: generateMessageId(),
        stableId: '',
        senderId: 'system',
        senderName: 'System',
        text: '发送过快，请稍后再试',
        timestamp: Date.now(),
        isMine: false,
        isSystem: true,
      };
      set((state) => ({ messages: [...state.messages, errorMsg] }));
      return;
    }

    // Build payload with optional reply
    const payload = buildPayload(text, replyTo);

    // Encrypt
    const { iv, ciphertext } = await encryptMessage(roomKey, payload);

    // Send over WebSocket
    ws.send(MSG_SEND_MESSAGE, { iv, ciphertext });
    recordMessageSent();

    // Optimistic local render
    const timestamp = Date.now();
    const localMsg: ChatMessage = {
      id: generateMessageId(),
      stableId: makeStableId(myId, timestamp),
      senderId: myId,
      senderName: myName,
      text,
      timestamp,
      isMine: true,
      isSystem: false,
      reply: replyTo ?? undefined,
    };

    set((state) => {
      const updated = [...state.messages, localMsg];
      return {
        messages: updated.length > MAX_MESSAGES ? updated.slice(-MAX_MESSAGES) : updated,
        replyTo: null, // Clear reply after sending
      };
    });
  },

  setTyping: (typing: boolean) => {
    if (typing === isCurrentlyTyping) return;

    if (typing) {
      isCurrentlyTyping = true;
      ws.send(MSG_TYPING, { typing: true });

      // Auto-cancel after timeout
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        isCurrentlyTyping = false;
        ws.send(MSG_TYPING, { typing: false });
        typingTimer = null;
      }, TYPING_TIMEOUT_MS);
    } else {
      isCurrentlyTyping = false;
      if (typingTimer) {
        clearTimeout(typingTimer);
        typingTimer = null;
      }
      ws.send(MSG_TYPING, { typing: false });
    }
  },

  leaveRoom: () => {
    ws.send(MSG_LEAVE_ROOM, {});

    // Clear typing timers
    const { typingMembers } = get();
    typingMembers.forEach((handle) => clearTimeout(handle));

    // Reset room state
    set({
      roomId: null,
      roomKey: null,
      shareCode: null,
      members: [],
      messages: [],
      typingMembers: new Map(),
      replyTo: null,
      reactions: new Map(),
    });

    // Reset module-level state
    isCurrentlyTyping = false;
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    messageTimes.length = 0;
  },

  toggleMute: () => {
    const newMuted = !get().muted;
    localStorage.setItem('arthas_muted', String(newMuted));
    set({ muted: newMuted });
  },

  setReplyTo: (reply: ReplyData) => {
    set({ replyTo: reply });
  },

  clearReply: () => {
    set({ replyTo: null });
  },

  sendReaction: (stableId: string, emoji: string) => {
    const { myId, roomKey, reactions } = get();
    if (!myId || !roomKey) return;

    const msgReactions = reactions.get(stableId) || [];
    const myExisting = msgReactions.find((r) => r.userIds.includes(myId));

    const encryptAndSend = async (targetStableId: string, targetEmoji: string, action: 'add' | 'remove') => {
      const payload = JSON.stringify({ stableId: targetStableId, emoji: targetEmoji, action });
      const { iv, ciphertext } = await encryptMessage(roomKey, payload);
      ws.send(MSG_SEND_REACTION, { iv, ciphertext });
    };

    const updateLocal = (targetEmoji: string, action: 'add' | 'remove') => {
      set((state) => {
        const current = new Map(state.reactions);
        const list = [...(current.get(stableId) || [])];

        if (action === 'add') {
          const existing = list.find((r) => r.emoji === targetEmoji);
          if (existing) {
            existing.userIds = [...existing.userIds, myId];
          } else {
            list.push({ emoji: targetEmoji, userIds: [myId] });
          }
        } else {
          const existing = list.find((r) => r.emoji === targetEmoji);
          if (existing) {
            existing.userIds = existing.userIds.filter((id) => id !== myId);
            if (existing.userIds.length === 0) {
              const idx = list.indexOf(existing);
              list.splice(idx, 1);
            }
          }
        }

        current.set(stableId, list);
        return { reactions: current };
      });
    };

    if (myExisting) {
      if (myExisting.emoji === emoji) {
        // Toggle off
        encryptAndSend(stableId, emoji, 'remove');
        updateLocal(emoji, 'remove');
      } else {
        // Switch: remove old + add new
        encryptAndSend(stableId, myExisting.emoji, 'remove');
        encryptAndSend(stableId, emoji, 'add');
        updateLocal(myExisting.emoji, 'remove');
        updateLocal(emoji, 'add');
      }
    } else {
      // New reaction
      encryptAndSend(stableId, emoji, 'add');
      updateLocal(emoji, 'add');
    }
  },

  handleServerMessage: (msg: Message) => {
    switch (msg.type) {
      case MSG_ROOM_CREATED: {
        const data = msg.data as RoomCreatedData;
        const { roomKey } = get();

        // Generate share code asynchronously
        if (roomKey) {
          encodeShareKey(data.roomId, roomKey).then((code) => {
            set({ shareCode: code });
          });
        }

        set({ roomId: data.roomId });
        break;
      }

      case MSG_ROOM_JOINED: {
        const data = msg.data as RoomJoinedData;
        const members: Member[] = data.members.map((m) => ({
          id: m.id,
          name: m.name,
          color: m.color,
        }));

        // The last member in the list is us (just joined)
        const myId = members[members.length - 1]?.id ?? get().myId;

        set({ roomId: data.roomId, members, myId });
        break;
      }

      case MSG_MEMBER_JOINED: {
        const data = msg.data as MemberJoinedData;
        const newMember: Member = { id: data.id, name: data.name, color: data.color };

        const systemMsg: ChatMessage = {
          id: generateMessageId(),
          stableId: '',
          senderId: 'system',
          senderName: 'System',
          text: `${data.name} 加入了房间`,
          timestamp: Date.now(),
          isMine: false,
          isSystem: true,
        };

        set((state) => {
          const messages = [...state.messages, systemMsg];
          return {
            members: [...state.members, newMember],
            messages: messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages,
          };
        });

        // Play join sound
        if (!get().muted) playJoinSound();
        break;
      }

      case MSG_MEMBER_LEFT: {
        const data = msg.data as MemberLeftData;

        // Find member name before removing
        const leavingMember = get().members.find((m) => m.id === data.id);
        const memberName = leavingMember?.name ?? 'Unknown';

        const systemMsg: ChatMessage = {
          id: generateMessageId(),
          stableId: '',
          senderId: 'system',
          senderName: 'System',
          text: `${memberName} 离开了房间`,
          timestamp: Date.now(),
          isMine: false,
          isSystem: true,
        };

        set((state) => {
          const members = state.members.filter((m) => m.id !== data.id);
          const messages = [...state.messages, systemMsg];

          // Clear typing state for this member
          const typingMembers = new Map(state.typingMembers);
          const handle = typingMembers.get(data.id);
          if (handle) {
            clearTimeout(handle);
            typingMembers.delete(data.id);
          }

          return {
            members,
            messages: messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages,
            typingMembers,
          };
        });

        // Play leave sound
        if (!get().muted) playLeaveSound();
        break;
      }

      case MSG_RELAY_MESSAGE: {
        const data = msg.data as RelayMessageData;
        const { roomKey } = get();

        if (!roomKey) break;

        // Decrypt asynchronously
        decryptMessage(roomKey, data.iv, data.ciphertext)
          .then((plaintext) => {
            // Parse payload (supports both new JSON format and old plain text)
            const { text, reply } = parsePayload(plaintext);

            const chatMsg: ChatMessage = {
              id: generateMessageId(),
              stableId: makeStableId(data.senderId, data.t),
              senderId: data.senderId,
              senderName: data.senderName,
              text,
              timestamp: data.t,
              isMine: false,
              isSystem: false,
              reply,
            };

            set((state) => {
              const messages = [...state.messages, chatMsg];
              return {
                messages: messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages,
              };
            });

            // Notification: sound + desktop
            const { muted } = get();
            if (!muted) {
              playNotificationSound();
            }
            if (document.hidden) {
              showDesktopNotification(data.senderName);
            }
          })
          .catch(() => {
            // Decryption failed — show placeholder
            const errorMsg: ChatMessage = {
              id: generateMessageId(),
              stableId: makeStableId(data.senderId, data.t),
              senderId: data.senderId,
              senderName: data.senderName,
              text: '无法解密此消息',
              timestamp: data.t,
              isMine: false,
              isSystem: false,
            };

            set((state) => {
              const messages = [...state.messages, errorMsg];
              return {
                messages: messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages,
              };
            });
          });
        break;
      }

      case MSG_RELAY_REACTION: {
        const data = msg.data as RelayReactionData;
        const { roomKey } = get();

        if (!roomKey) break;

        decryptMessage(roomKey, data.iv, data.ciphertext)
          .then((plaintext) => {
            try {
              const { stableId, emoji, action } = JSON.parse(plaintext);
              if (!stableId || !emoji || !action) return;

              set((state) => {
                const reactions = new Map(state.reactions);
                const list = [...(reactions.get(stableId) || [])];

                if (action === 'add') {
                  const existing = list.find((r) => r.emoji === emoji);
                  if (existing) {
                    if (!existing.userIds.includes(data.senderId)) {
                      existing.userIds = [...existing.userIds, data.senderId];
                    }
                  } else {
                    list.push({ emoji, userIds: [data.senderId] });
                  }
                } else if (action === 'remove') {
                  const existing = list.find((r) => r.emoji === emoji);
                  if (existing) {
                    existing.userIds = existing.userIds.filter((id) => id !== data.senderId);
                    if (existing.userIds.length === 0) {
                      const idx = list.indexOf(existing);
                      list.splice(idx, 1);
                    }
                  }
                }

                reactions.set(stableId, list);
                return { reactions };
              });
            } catch {
              // Invalid reaction payload — ignore
            }
          })
          .catch(() => {
            // Decryption failed — ignore
          });
        break;
      }

      case MSG_MEMBER_TYPING: {
        const data = msg.data as MemberTypingData;

        set((state) => {
          const typingMembers = new Map(state.typingMembers);

          if (data.typing) {
            // Clear existing timeout for this member
            const existingHandle = typingMembers.get(data.id);
            if (existingHandle) clearTimeout(existingHandle);

            // Set auto-clear timeout (2s)
            const handle = setTimeout(() => {
              set((s) => {
                const updated = new Map(s.typingMembers);
                updated.delete(data.id);
                return { typingMembers: updated };
              });
            }, TYPING_TIMEOUT_MS) as unknown as number;

            typingMembers.set(data.id, handle);
          } else {
            const handle = typingMembers.get(data.id);
            if (handle) clearTimeout(handle);
            typingMembers.delete(data.id);
          }

          return { typingMembers };
        });
        break;
      }

      case MSG_ROOM_CLOSED: {
        // Clear typing timers
        const { typingMembers } = get();
        typingMembers.forEach((handle) => clearTimeout(handle));

        const systemMsg: ChatMessage = {
          id: generateMessageId(),
          stableId: '',
          senderId: 'system',
          senderName: 'System',
          text: '房间已关闭',
          timestamp: Date.now(),
          isMine: false,
          isSystem: true,
        };

        set((state) => ({
          roomId: null,
          roomKey: null,
          shareCode: null,
          members: [],
          messages: [...state.messages, systemMsg],
          typingMembers: new Map(),
          replyTo: null,
          reactions: new Map(),
        }));
        break;
      }

      case MSG_ERROR: {
        const data = msg.data as ErrorData;

        const errorMessages: Record<string, string> = {
          E001: '房间不存在或已关闭',
          E002: '房间已满，无法加入',
          E003: '请先加入房间',
          E004: '发送过快，请稍后再试',
          E005: '消息格式无效',
        };

        const text = errorMessages[data.code] ?? data.msg ?? '未知错误';

        const errorMsg: ChatMessage = {
          id: generateMessageId(),
          stableId: '',
          senderId: 'system',
          senderName: 'System',
          text,
          timestamp: Date.now(),
          isMine: false,
          isSystem: true,
        };

        set((state) => {
          const messages = [...state.messages, errorMsg];
          return {
            messages: messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages,
          };
        });
        break;
      }
    }
  },
}));
