/**
 * @file matchStore.ts — Random Match 模块的 Zustand 状态管理
 *
 * 管理匹配状态机（idle → selecting-tags → waiting → pairing → found → in-room）、
 * 兴趣标签选择、等待计时器、和基础 WebSocket 交互。
 *
 * 设计决策：
 * - 使用 ws.send() 直接发送消息（与 chatStore 保持一致的模式）
 * - localStorage 持久化 lastSelectedTags（便利性）
 * - 状态在页面刷新时重置为 idle（无持久化匹配会话）
 * - handleMatchMessage dispatches incoming server messages to state transitions
 */

import { create } from 'zustand';
import * as ws from '../network/websocket';
import { generateRoomKey, exportRoomKey, importRoomKey } from '../crypto/keys';
import { useChatStore } from '../stores/chatStore';
import { resetChatStoreForMatch } from './matchCleanup';
import {
  MSG_MATCH_REQUEST,
  MSG_MATCH_CANCEL,
  MSG_MATCH_NEXT,
  MSG_MATCH_REPORT,
  MSG_MATCH_EXTEND,
  MSG_MATCH_KEY_RELAY,
  MSG_MATCH_GENERATE_KEY,
  MSG_MATCH_FOUND,
  MSG_MATCH_TIMEOUT,
  MSG_MATCH_ERROR,
  MSG_MATCH_PARTNER_LEFT,
  MSG_MATCH_EXTEND_REQ,
  MSG_MATCH_EXTENDED,
  MSG_MATCH_INVITE_CREATED,
  ERR_MATCH_COOLDOWN,
  ERR_MATCH_RATE_LIMIT,
  type MatchRequestData,
  type MatchNextData,
  type MatchReportData,
  type MatchKeyRelayData,
  type MatchGenerateKeyData,
  type MatchFoundData,
  type MatchTimeoutData,
  type MatchErrorData,
  type MatchExtendedData,
  type MatchInviteCreatedData,
} from './protocol';

// ===== Constants =====

/** localStorage key for persisting last selected tags */
const STORAGE_KEY_TAGS = 'arthas-match-tags';

/**
 * Default values for all match session fields.
 * Used by nextMatch() and handleBackToHub() to reset matchStore to a clean state.
 * Single source of truth — prevents field list drift between reset call sites.
 */
export const MATCH_SESSION_RESET = {
  matchRoomId: null,
  matchKey: null,
  matchKeyRaw: null,
  matchExpiresAt: null,
  matchEphemeral: null,
  isKeyGenerator: false,
  partnerId: null,
  inviteLink: null,
  inviteToken: null,
  extensionProposed: false,
  extensionCount: 0,
  partnerProposedExtend: false,
  partnerLeft: false,
  waitedSeconds: 0,
  error: null,
  retryAfter: null,
} as const;

// ===== Types =====

export type MatchStatus =
  | 'idle'
  | 'selecting-tags'
  | 'waiting'
  | 'pairing'
  | 'found'
  | 'timeout'
  | 'expired'
  | 'in-room';

export interface MatchState {
  // Status — full state machine
  status: MatchStatus;

  // Queue state
  selectedTags: string[];
  waitStartTime: number | null;
  elapsedSeconds: number;

  // Match result
  matchRoomId: string | null;
  matchKey: CryptoKey | null;
  matchKeyRaw: string | null;
  matchExpiresAt: number | null;
  matchEphemeral: number | null;
  isKeyGenerator: boolean;
  partnerId: string | null;

  // Invite link
  inviteLink: string | null;
  inviteToken: string | null;

  // Room extension
  extensionProposed: boolean;
  extensionCount: number;
  partnerProposedExtend: boolean;

  // Partner state
  partnerLeft: boolean;

  // Timeout / Error
  waitedSeconds: number;
  error: { code: string; msg: string } | null;
  retryAfter: number | null;

  // Recent partners (session loop — UI hint only, server enforces)
  recentPartnerIds: string[];

  // Feature availability (from Hub Stats API)
  matchEnabled: boolean;
  onlineCount: number;

  // Actions
  startMatch: (tags?: string[]) => void;
  cancelMatch: () => void;
  nextMatch: () => void;
  generateInviteLink: () => void;
  reportPartner: (reason: MatchReportData['reason']) => void;
  proposeExtension: () => void;
  handleMatchMessage: (msgType: number, data: unknown) => void;
  fetchMatchStatus: () => Promise<void>;
}

// ===== localStorage helpers =====

function loadLastSelectedTags(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_TAGS);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string')) {
      return parsed as string[];
    }
    return [];
  } catch {
    return [];
  }
}

function persistSelectedTags(tags: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_TAGS, JSON.stringify(tags));
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded)
  }
}

// ===== API helpers =====

/**
 * Derives the Hub Stats API base URL (same logic as hubApi.ts).
 * - Development: relative path (Vite proxy)
 * - Production same-origin: relative path
 * - Production split deployment: derives from VITE_WS_URL
 */
function getApiBase(): string {
  if (import.meta.env.DEV) {
    return '';
  }
  const wsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (wsUrl) {
    return wsUrl
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://')
      .replace(/\/ws$/, '');
  }
  return '';
}

// ===== Store =====

/**
 * Generate AES-256-GCM key, export as base64url, relay to server, and store in state.
 *
 * Called when this client is designated as the key generator (Client A).
 * Uses Web Crypto API for key generation — browser-native, no third-party deps.
 *
 * Flow:
 * 1. Generate AES-256-GCM CryptoKey (extractable for export)
 * 2. Export raw key bytes → base64url string (43 chars, no padding)
 * 3. Send MSG_MATCH_KEY_RELAY with encoded key to server for relay to Client B
 * 4. Store CryptoKey in matchStore state for later encryption/decryption
 */
async function generateAndRelayKey(set: (partial: Partial<MatchState>) => void): Promise<void> {
  try {
    // 1. Generate AES-256-GCM key
    const key = await generateRoomKey();

    // 2. Export as base64url (no padding)
    const encodedKey = await exportRoomKey(key);

    // 3. Relay key to server for forwarding to partner
    const relayData: MatchKeyRelayData = { key: encodedKey };
    ws.send(MSG_MATCH_KEY_RELAY, relayData);

    // 4. Store CryptoKey in matchStore state
    set({ matchKey: key });

    // 5. Sync to chatStore immediately so chat can work as soon as room is joined
    useChatStore.setState({ roomKey: key });
  } catch (err) {
    // Web Crypto API failure is rare but possible (insecure context, etc.)
    console.error('[Match] Key generation failed:', err);
    set({
      status: 'idle',
      isKeyGenerator: false,
      error: { code: 'LOCAL', msg: 'Key generation failed' },
    });
  }
}

export const useMatchStore = create<MatchState>((set, get) => ({
  // Initial state
  status: 'idle',
  selectedTags: loadLastSelectedTags(),
  waitStartTime: null,
  elapsedSeconds: 0,
  matchRoomId: null,
  matchKey: null,
  matchKeyRaw: null,
  matchExpiresAt: null,
  matchEphemeral: null,
  isKeyGenerator: false,
  partnerId: null,
  inviteLink: null,
  inviteToken: null,
  extensionProposed: false,
  extensionCount: 0,
  partnerProposedExtend: false,
  partnerLeft: false,
  waitedSeconds: 0,
  error: null,
  retryAfter: null,
  recentPartnerIds: [],
  matchEnabled: true,
  onlineCount: 0,

  startMatch: (tags?: string[]) => {
    const { status } = get();
    // Prevent double-queue: only start from idle or selecting-tags
    if (status !== 'idle' && status !== 'selecting-tags') return;

    const selectedTags = tags ?? get().selectedTags;

    // Persist tags for next visit
    persistSelectedTags(selectedTags);

    // Update state to waiting
    set({
      status: 'waiting',
      selectedTags,
      waitStartTime: Date.now(),
      elapsedSeconds: 0,
      matchRoomId: null,
      matchKey: null,
      matchKeyRaw: null,
      matchExpiresAt: null,
      matchEphemeral: null,
      isKeyGenerator: false,
      partnerId: null,
      inviteLink: null,
      inviteToken: null,
      extensionProposed: false,
      extensionCount: 0,
      partnerProposedExtend: false,
      partnerLeft: false,
      waitedSeconds: 0,
      error: null,
      retryAfter: null,
    });

    // Send match request via WebSocket
    const data: MatchRequestData = { tags: selectedTags };
    ws.send(MSG_MATCH_REQUEST, data);
  },

  cancelMatch: () => {
    const { status } = get();
    // Only cancel if currently waiting
    if (status !== 'waiting') return;

    // Send cancel to server
    ws.send(MSG_MATCH_CANCEL, {});

    // Return to idle
    set({
      status: 'idle',
      waitStartTime: null,
      elapsedSeconds: 0,
    });
  },

  nextMatch: () => {
    const { status, selectedTags } = get();
    // Only allowed when in a match room
    if (status !== 'in-room') return;

    // Step 1: Clean up chatStore (voice, file transfers, room state) before re-queue
    resetChatStoreForMatch();

    // Step 2: Reset matchStore session fields and transition to waiting
    set({
      ...MATCH_SESSION_RESET,
      status: 'waiting',
      waitStartTime: Date.now(),
      elapsedSeconds: 0,
    });

    // Step 3: Send next-match request with current tags
    const data: MatchNextData = { tags: selectedTags };
    ws.send(MSG_MATCH_NEXT, data);
  },

  generateInviteLink: () => {
    const { status, inviteLink } = get();
    // Only meaningful when waiting in queue and invite link already received from server.
    // Server auto-generates the invite link when user enters queue.
    // This action is a UI intent marker — show the invite link UI.
    if (status !== 'waiting') return;
    // If server hasn't sent invite link yet, this is a no-op.
    // The link will appear when MSG_MATCH_INVITE_CREATED arrives.
    if (!inviteLink) return;
    // Invite link already available — nothing to do, UI will render it.
  },

  reportPartner: (reason: MatchReportData['reason']) => {
    const { status } = get();
    // Only allowed when in a match room
    if (status !== 'in-room') return;

    // Send report to server — user stays in the room
    const data: MatchReportData = { reason };
    ws.send(MSG_MATCH_REPORT, data);
  },

  proposeExtension: () => {
    const { status, extensionProposed } = get();
    // Only allowed when in room and not already proposed
    if (status !== 'in-room' || extensionProposed) return;

    // Send extension proposal to server
    ws.send(MSG_MATCH_EXTEND, {});

    // Mark as proposed locally
    set({ extensionProposed: true });
  },

  handleMatchMessage: (msgType: number, data: unknown) => {
    switch (msgType) {
      case MSG_MATCH_GENERATE_KEY: {
        const payload = data as MatchGenerateKeyData;
        set({
          status: 'pairing',
          isKeyGenerator: true,
          partnerId: payload.partnerId,
          error: null,
        });
        // Initiate key generation and relay (async, fire-and-forget with internal error handling)
        void generateAndRelayKey(set);
        break;
      }

      case MSG_MATCH_FOUND: {
        const payload = data as MatchFoundData;
        const updates: Partial<MatchState> = {
          status: 'found',
          matchRoomId: payload.roomId,
          matchExpiresAt: payload.expiresAt,
          matchEphemeral: payload.ephemeral,
          waitStartTime: null,
          error: null,
        };
        // Client B receives the key from server (Client A generated it)
        if (payload.key) {
          updates.matchKeyRaw = payload.key;
          updates.isKeyGenerator = false;
          // Import the raw key as a CryptoKey for actual encryption/decryption
          void importRoomKey(payload.key).then((cryptoKey) => {
            set({ matchKey: cryptoKey });
            // Sync to chatStore so chat messages can be encrypted/decrypted
            useChatStore.setState({ roomKey: cryptoKey });
          }).catch((err) => {
            console.error('[Match] Failed to import room key:', err);
          });
        }
        set(updates);
        break;
      }

      case MSG_MATCH_TIMEOUT: {
        const payload = data as MatchTimeoutData;
        set({
          status: 'timeout',
          waitedSeconds: payload.waitedSeconds,
          waitStartTime: null,
          elapsedSeconds: 0,
          error: null,
        });
        break;
      }

      case MSG_MATCH_ERROR: {
        const payload = data as MatchErrorData;
        const { code, msg, retryAfter } = payload;

        // Rate-limiting errors: store retryAfter and return to idle for countdown display
        if (code === ERR_MATCH_COOLDOWN || code === ERR_MATCH_RATE_LIMIT) {
          set({
            error: { code, msg },
            retryAfter: retryAfter ?? null,
            status: 'idle',
            waitStartTime: null,
          });
        } else {
          // All other errors: show error and return to idle
          set({
            error: { code, msg },
            retryAfter: null,
            status: 'idle',
            waitStartTime: null,
          });
        }
        break;
      }

      case MSG_MATCH_PARTNER_LEFT: {
        const { status } = get();
        if (status === 'in-room') {
          // Partner left while in room — mark for UI display
          set({ partnerLeft: true });
        } else if (status === 'pairing' || status === 'waiting') {
          // Partner left during pairing/waiting — return to waiting state
          set({
            status: 'waiting',
            isKeyGenerator: false,
            partnerId: null,
            matchKeyRaw: null,
          });
        }
        break;
      }

      case MSG_MATCH_EXTEND_REQ: {
        set({ partnerProposedExtend: true });
        break;
      }

      case MSG_MATCH_EXTENDED: {
        const payload = data as MatchExtendedData;
        set({
          extensionCount: get().extensionCount + 1,
          extensionProposed: false,
          partnerProposedExtend: false,
          matchExpiresAt: payload.newExpiresAt,
        });
        break;
      }

      case MSG_MATCH_INVITE_CREATED: {
        const payload = data as MatchInviteCreatedData;
        set({
          inviteLink: payload.link,
          inviteToken: payload.token,
        });
        break;
      }
    }
  },

  fetchMatchStatus: async () => {
    try {
      const base = getApiBase();
      const res = await fetch(`${base}/api/hub/stats`);
      if (!res.ok) {
        // Non-200 — assume match is disabled (conservative)
        set({ matchEnabled: false, onlineCount: 0 });
        return;
      }
      const data: { online?: number; matchEnabled?: boolean } = await res.json();
      set({
        matchEnabled: data.matchEnabled ?? false,
        onlineCount: data.online ?? 0,
      });
    } catch {
      // Network error — assume feature unavailable
      set({ matchEnabled: false, onlineCount: 0 });
    }
  },
}));
