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
  // 文件传输中转消息类型（Server → Client, 0x1A-0x1E）
  // 📚 学习要点: 文件传输消息路由
  // chatStore 作为所有服务器消息的统一入口，负责将文件传输消息分发给 fileTransferStore。
  // 这种「中央路由 + 委托处理」模式保持了消息处理的单一入口点，
  // 同时通过委托实现了关注点分离（chatStore 不需要了解文件传输的内部逻辑）。
  MSG_RELAY_FILE_META,
  MSG_RELAY_FILE_CHUNK,
  MSG_RELAY_FILE_COMPLETE,
  MSG_RELAY_FILE_CANCEL,
  MSG_RELAY_FILE_ACK,
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
import { useFileTransferStore } from '../file-transfer/fileTransferStore';
import { playNotificationSound, showDesktopNotification, playJoinSound, playLeaveSound } from '../utils/notification';
import { buildPayload, parsePayload, makeStableId } from '../utils/payload';
import { hashPassword } from '../utils/crypto';

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
  hasPassword: boolean;
  ephemeral: number;

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
  createRoom: (name: string, password?: string, ephemeral?: number) => Promise<void>;
  joinRoom: (shareCode: string, name: string, password?: string) => Promise<void>;
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

// ===== Ephemeral message removal =====

function scheduleEphemeralRemoval(msgId: string, ephemeral: number): void {
  if (ephemeral <= 0) return;
  setTimeout(() => {
    useChatStore.setState((state) => ({
      messages: state.messages.filter((m) => m.id !== msgId),
    }));
  }, ephemeral * 1000);
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
  hasPassword: false,
  ephemeral: 0,
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

  createRoom: async (name: string, password?: string, ephemeral?: number) => {
    const roomKey = await generateRoomKey();
    const hashedPwd = await hashPassword(password ?? '');
    set({ myName: name, roomKey, ephemeral: ephemeral ?? 0 });
    ws.send(MSG_CREATE_ROOM, { name, password: hashedPwd, ephemeral: ephemeral ?? 0 });
  },

  joinRoom: async (shareCode: string, name: string, password?: string) => {
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

    const { roomId, keyEncoded, ephemeral } = decoded;
    const roomKey = await importRoomKey(keyEncoded);
    const hashedPwd = await hashPassword(password ?? '');
    set({ myName: name, roomKey, shareCode, ephemeral });
    ws.send(MSG_JOIN_ROOM, { roomId, name, password: hashedPwd });
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

    // Schedule ephemeral removal for sent messages
    const { ephemeral } = get();
    if (ephemeral > 0 && !localMsg.isSystem) {
      scheduleEphemeralRemoval(localMsg.id, ephemeral);
    }
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
      hasPassword: false,
      ephemeral: 0,
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
        const { roomKey, ephemeral } = get();

        // Generate share code asynchronously (includes ephemeral info)
        if (roomKey) {
          encodeShareKey(data.roomId, roomKey, ephemeral).then((code) => {
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

        set({
          roomId: data.roomId,
          members,
          myId,
          hasPassword: data.hasPassword ?? false,
          ephemeral: data.ephemeral ?? 0,
        });
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

        // 📚 学习要点: 成员离开时中止相关文件传输
        // 当发送方离开房间时，其所有正在进行的文件传输都无法继续完成。
        // 调用 handleSenderLeft() 将该发送方的所有接收中传输标记为 failed，
        // 让接收方立即看到"发送方已离开，传输中断"的反馈，
        // 而不是等待 60 秒超时才显示失败（更好的用户体验）。
        // 同时释放接收缓冲区内存，防止无用数据占用内存。
        useFileTransferStore.getState().handleSenderLeft(data.id);
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

            // Schedule ephemeral removal for received messages
            const { ephemeral } = get();
            if (ephemeral > 0 && !chatMsg.isSystem) {
              scheduleEphemeralRemoval(chatMsg.id, ephemeral);
            }

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

        // 📚 学习要点: 房间关闭时中止所有文件传输
        // 房间关闭意味着所有成员都将断开连接，任何进行中的文件传输都无法继续。
        // 必须在清理房间状态之前调用 abortAllTransfers()，
        // 因为 abortAllTransfers() 需要将所有非终态传输标记为 failed 并释放缓冲区内存。
        // 这确保了：
        // 1. 接收方的 chunk 缓冲区被释放（防止内存泄漏）
        // 2. 发送方的发送循环被停止（防止继续发送到已关闭的连接）
        // 3. UI 正确显示传输失败状态（而非永远停留在"传输中"）
        useFileTransferStore.getState().abortAllTransfers();

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
          hasPassword: false,
          ephemeral: 0,
          messages: [...state.messages, systemMsg],
          typingMembers: new Map(),
          replyTo: null,
          reactions: new Map(),
        }));
        break;
      }

      // ===== 文件传输中转消息（Server → Client, 0x1A-0x1E）=====
      // 📚 学习要点: 消息路由委托模式（Message Routing Delegation）
      // chatStore 是所有服务器消息的统一入口点（单一职责：消息分发）。
      // 文件传输消息不在 chatStore 中处理，而是委托给 fileTransferStore.handleFileMessage()。
      // 这种设计的优势：
      // 1. chatStore 保持简洁，只负责路由，不包含文件传输业务逻辑
      // 2. fileTransferStore 独立管理传输状态（缓冲区、进度、超时），与消息数组解耦
      // 3. 可测试性：文件传输逻辑可以独立于 chatStore 进行单元测试
      // 4. 内存隔离：传输状态（可能包含 5MB 缓冲区）不会污染 chatStore 的状态树
      case MSG_RELAY_FILE_META:
      case MSG_RELAY_FILE_CHUNK:
      case MSG_RELAY_FILE_COMPLETE:
      case MSG_RELAY_FILE_CANCEL:
      case MSG_RELAY_FILE_ACK: {
        // 将所有文件传输消息统一委托给 fileTransferStore 处理
        // fileTransferStore.handleFileMessage() 内部会根据 msg.type 进行二次路由：
        // - META → 解密 metadata → 准备接收缓冲区 → 插入聊天占位符
        // - CHUNK → 验证 → 解密 → 存入缓冲区 → 更新进度
        // - COMPLETE → 验证完整性 → 重组文件 → 发送 ACK
        // - CANCEL → 释放缓冲区 → 显示取消信息
        // - ACK → 更新发送方的已送达计数
        useFileTransferStore.getState().handleFileMessage(msg);
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
          E006: '房间密码错误',
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
