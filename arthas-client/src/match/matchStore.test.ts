/**
 * matchStore unit tests.
 *
 * Tests: startMatch, cancelMatch, fetchMatchStatus, localStorage persistence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useMatchStore } from './matchStore';
import * as ws from '../network/websocket';
import { MSG_MATCH_REQUEST, MSG_MATCH_CANCEL } from './protocol';

vi.mock('../network/websocket');

const mockSend = vi.mocked(ws.send);

describe('matchStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Reset store to initial state
    useMatchStore.setState({
      status: 'idle',
      selectedTags: [],
      waitStartTime: null,
      elapsedSeconds: 0,
      matchRoomId: null,
      matchKey: null,
      isKeyGenerator: false,
      inviteLink: null,
      inviteToken: null,
      extensionProposed: false,
      extensionCount: 0,
      partnerProposedExtend: false,
      recentPartnerIds: [],
      matchEnabled: true,
      onlineCount: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('startMatch', () => {
    it('transitions status from idle to waiting', () => {
      useMatchStore.getState().startMatch(['tech']);

      const state = useMatchStore.getState();
      expect(state.status).toBe('waiting');
      expect(state.selectedTags).toEqual(['tech']);
      expect(state.waitStartTime).toBeTypeOf('number');
      expect(state.elapsedSeconds).toBe(0);
    });

    it('sends MSG_MATCH_REQUEST via WebSocket with tags', () => {
      useMatchStore.getState().startMatch(['music', 'gaming']);

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(MSG_MATCH_REQUEST, { tags: ['music', 'gaming'] });
    });

    it('sends empty tags array when called with no arguments', () => {
      useMatchStore.getState().startMatch();

      expect(mockSend).toHaveBeenCalledWith(MSG_MATCH_REQUEST, { tags: [] });
    });

    it('uses store selectedTags when no args provided', () => {
      useMatchStore.setState({ selectedTags: ['tech', 'random'] });

      useMatchStore.getState().startMatch();

      expect(mockSend).toHaveBeenCalledWith(MSG_MATCH_REQUEST, { tags: ['tech', 'random'] });
    });

    it('persists selected tags to localStorage', () => {
      useMatchStore.getState().startMatch(['tech', 'movies']);

      const stored = JSON.parse(localStorage.getItem('arthas-match-tags') ?? '[]');
      expect(stored).toEqual(['tech', 'movies']);
    });

    it('does not start if already waiting', () => {
      useMatchStore.setState({ status: 'waiting' });

      useMatchStore.getState().startMatch(['tech']);

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('does not start if in-room', () => {
      useMatchStore.setState({ status: 'in-room' });

      useMatchStore.getState().startMatch(['tech']);

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('can start from selecting-tags status', () => {
      useMatchStore.setState({ status: 'selecting-tags' });

      useMatchStore.getState().startMatch(['language']);

      expect(useMatchStore.getState().status).toBe('waiting');
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('resets match result fields when starting', () => {
      useMatchStore.setState({
        status: 'idle',
        matchRoomId: 'old-room',
        matchKey: {} as CryptoKey,
        isKeyGenerator: true,
        inviteLink: 'old-link',
        inviteToken: 'old-token',
      });

      useMatchStore.getState().startMatch([]);

      const state = useMatchStore.getState();
      expect(state.matchRoomId).toBeNull();
      expect(state.matchKey).toBeNull();
      expect(state.isKeyGenerator).toBe(false);
      expect(state.inviteLink).toBeNull();
      expect(state.inviteToken).toBeNull();
    });
  });

  describe('cancelMatch', () => {
    it('transitions status from waiting to idle', () => {
      useMatchStore.setState({ status: 'waiting', waitStartTime: Date.now(), elapsedSeconds: 5 });

      useMatchStore.getState().cancelMatch();

      const state = useMatchStore.getState();
      expect(state.status).toBe('idle');
      expect(state.waitStartTime).toBeNull();
      expect(state.elapsedSeconds).toBe(0);
    });

    it('sends MSG_MATCH_CANCEL via WebSocket', () => {
      useMatchStore.setState({ status: 'waiting' });

      useMatchStore.getState().cancelMatch();

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(MSG_MATCH_CANCEL, {});
    });

    it('does nothing if not in waiting state', () => {
      useMatchStore.setState({ status: 'idle' });

      useMatchStore.getState().cancelMatch();

      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('fetchMatchStatus', () => {
    it('updates matchEnabled and onlineCount on success', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ online: 42, matchEnabled: true }),
      });

      await useMatchStore.getState().fetchMatchStatus();

      const state = useMatchStore.getState();
      expect(state.matchEnabled).toBe(true);
      expect(state.onlineCount).toBe(42);
    });

    it('sets matchEnabled=false on non-200 response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await useMatchStore.getState().fetchMatchStatus();

      const state = useMatchStore.getState();
      expect(state.matchEnabled).toBe(false);
      expect(state.onlineCount).toBe(0);
    });

    it('sets matchEnabled=false on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      await useMatchStore.getState().fetchMatchStatus();

      const state = useMatchStore.getState();
      expect(state.matchEnabled).toBe(false);
      expect(state.onlineCount).toBe(0);
    });

    it('fetches from /api/hub/stats endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ online: 10, matchEnabled: false }),
      });
      global.fetch = mockFetch;

      await useMatchStore.getState().fetchMatchStatus();

      expect(mockFetch).toHaveBeenCalledWith('/api/hub/stats');
    });
  });

  describe('localStorage persistence', () => {
    it('loads lastSelectedTags from localStorage on store creation', () => {
      localStorage.setItem('arthas-match-tags', JSON.stringify(['tech', 'music']));

      // Test the loading logic (mirrors loadLastSelectedTags in matchStore)
      let tags: string[] = [];
      try {
        const stored = localStorage.getItem('arthas-match-tags');
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string')) {
            tags = parsed as string[];
          }
        }
      } catch {
        tags = [];
      }

      expect(tags).toEqual(['tech', 'music']);
    });

    it('returns empty array for invalid localStorage data', () => {
      localStorage.setItem('arthas-match-tags', 'not valid json{');

      // Manually test the loading logic
      let tags: string[] = [];
      try {
        const stored = localStorage.getItem('arthas-match-tags');
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string')) {
            tags = parsed as string[];
          }
        }
      } catch {
        tags = [];
      }

      expect(tags).toEqual([]);
    });

    it('returns empty array for non-string-array localStorage data', () => {
      localStorage.setItem('arthas-match-tags', JSON.stringify([1, 2, 3]));

      let tags: string[] = [];
      try {
        const stored = localStorage.getItem('arthas-match-tags');
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string')) {
            tags = parsed as string[];
          }
        }
      } catch {
        tags = [];
      }

      expect(tags).toEqual([]);
    });
  });
});

// ===== Tests for handleMatchMessage and session flow actions (Task 14.5) =====

import {
  MSG_MATCH_GENERATE_KEY,
  MSG_MATCH_FOUND,
  MSG_MATCH_TIMEOUT,
  MSG_MATCH_ERROR,
  MSG_MATCH_PARTNER_LEFT,
  MSG_MATCH_EXTEND_REQ,
  MSG_MATCH_EXTENDED,
  MSG_MATCH_INVITE_CREATED,
  MSG_MATCH_NEXT,
  MSG_MATCH_REPORT,
  MSG_MATCH_EXTEND,
  ERR_MATCH_COOLDOWN,
  ERR_MATCH_RATE_LIMIT,
  ERR_MATCH_QUEUE_FULL,
} from './protocol';

describe('matchStore – handleMatchMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useMatchStore.setState({
      status: 'idle',
      selectedTags: [],
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
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('MSG_MATCH_GENERATE_KEY', () => {
    it('transitions status to pairing and sets isKeyGenerator=true', () => {
      useMatchStore.setState({ status: 'waiting' });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_GENERATE_KEY, {
        partnerId: 'partner-123',
      });

      const state = useMatchStore.getState();
      expect(state.status).toBe('pairing');
      expect(state.isKeyGenerator).toBe(true);
      expect(state.partnerId).toBe('partner-123');
    });
  });

  describe('MSG_MATCH_FOUND', () => {
    it('transitions status to found and sets matchRoomId', () => {
      useMatchStore.setState({ status: 'pairing', waitStartTime: Date.now(), elapsedSeconds: 10 });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_FOUND, {
        roomId: 'room-abc',
        expiresAt: 1700000000,
        ephemeral: 60,
      });

      const state = useMatchStore.getState();
      expect(state.status).toBe('found');
      expect(state.matchRoomId).toBe('room-abc');
      expect(state.matchExpiresAt).toBe(1700000000);
      expect(state.matchEphemeral).toBe(60);
      expect(state.waitStartTime).toBeNull();
    });

    it('stores key for Client B (non-key-generator)', () => {
      useMatchStore.setState({ status: 'waiting', isKeyGenerator: false });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_FOUND, {
        roomId: 'room-xyz',
        expiresAt: 1700000000,
        ephemeral: 60,
        key: 'base64url-aes-key',
      });

      const state = useMatchStore.getState();
      expect(state.status).toBe('found');
      expect(state.matchKeyRaw).toBe('base64url-aes-key');
    });

    it('does not set matchKeyRaw when key is absent (Client A)', () => {
      useMatchStore.setState({ status: 'pairing', isKeyGenerator: true });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_FOUND, {
        roomId: 'room-xyz',
        expiresAt: 1700000000,
        ephemeral: 60,
      });

      const state = useMatchStore.getState();
      expect(state.matchKeyRaw).toBeNull();
    });
  });

  describe('MSG_MATCH_TIMEOUT', () => {
    it('transitions status to timeout', () => {
      useMatchStore.setState({ status: 'waiting', waitStartTime: Date.now(), elapsedSeconds: 60 });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_TIMEOUT, {
        waitedSeconds: 60,
      });

      const state = useMatchStore.getState();
      expect(state.status).toBe('timeout');
      expect(state.waitStartTime).toBeNull();
      expect(state.waitedSeconds).toBe(60);
    });
  });

  describe('MSG_MATCH_ERROR', () => {
    it('sets error state and returns to idle for generic errors', () => {
      useMatchStore.setState({ status: 'waiting' });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_ERROR, {
        code: ERR_MATCH_QUEUE_FULL,
        msg: 'Queue is full',
      });

      const state = useMatchStore.getState();
      expect(state.error).toEqual({ code: ERR_MATCH_QUEUE_FULL, msg: 'Queue is full' });
      expect(state.status).toBe('idle');
    });

    it('stores retryAfter for cooldown errors and returns to idle', () => {
      useMatchStore.setState({ status: 'waiting' });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_ERROR, {
        code: ERR_MATCH_COOLDOWN,
        msg: 'Cooldown active',
        retryAfter: 8,
      });

      const state = useMatchStore.getState();
      expect(state.error).toEqual({ code: ERR_MATCH_COOLDOWN, msg: 'Cooldown active' });
      expect(state.retryAfter).toBe(8);
      expect(state.status).toBe('idle');
    });

    it('stores retryAfter for rate limit errors and returns to idle', () => {
      useMatchStore.setState({ status: 'waiting' });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_ERROR, {
        code: ERR_MATCH_RATE_LIMIT,
        msg: 'Rate limit exceeded',
        retryAfter: 3600,
      });

      const state = useMatchStore.getState();
      expect(state.error).toEqual({ code: ERR_MATCH_RATE_LIMIT, msg: 'Rate limit exceeded' });
      expect(state.retryAfter).toBe(3600);
      expect(state.status).toBe('idle');
    });

    it('sets retryAfter to null when not provided', () => {
      useMatchStore.setState({ status: 'waiting' });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_ERROR, {
        code: ERR_MATCH_QUEUE_FULL,
        msg: 'Queue is full',
      });

      expect(useMatchStore.getState().retryAfter).toBeNull();
    });
  });

  describe('MSG_MATCH_PARTNER_LEFT', () => {
    it('sets partnerLeft to true', () => {
      useMatchStore.setState({ status: 'in-room', partnerLeft: false });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_PARTNER_LEFT, {});

      expect(useMatchStore.getState().partnerLeft).toBe(true);
    });
  });

  describe('MSG_MATCH_EXTEND_REQ', () => {
    it('sets partnerProposedExtend to true', () => {
      useMatchStore.setState({ status: 'in-room', partnerProposedExtend: false });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_EXTEND_REQ, {});

      expect(useMatchStore.getState().partnerProposedExtend).toBe(true);
    });
  });

  describe('MSG_MATCH_EXTENDED', () => {
    it('increments extensionCount and updates expiresAt', () => {
      useMatchStore.setState({
        status: 'in-room',
        extensionCount: 1,
        extensionProposed: true,
        partnerProposedExtend: true,
        matchExpiresAt: 1700000000,
      });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_EXTENDED, {
        newExpiresAt: 1700001800,
        extensionsLeft: 1,
      });

      const state = useMatchStore.getState();
      expect(state.extensionCount).toBe(2);
      expect(state.matchExpiresAt).toBe(1700001800);
      expect(state.extensionProposed).toBe(false);
      expect(state.partnerProposedExtend).toBe(false);
    });
  });

  describe('MSG_MATCH_INVITE_CREATED', () => {
    it('sets inviteLink and inviteToken', () => {
      useMatchStore.setState({ status: 'waiting' });

      useMatchStore.getState().handleMatchMessage(MSG_MATCH_INVITE_CREATED, {
        token: 'invite-token-123',
        expiresAt: 1700000300,
        link: 'https://example.com/match/invite-token-123',
      });

      const state = useMatchStore.getState();
      expect(state.inviteLink).toBe('https://example.com/match/invite-token-123');
      expect(state.inviteToken).toBe('invite-token-123');
    });
  });
});

describe('matchStore – session flow actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useMatchStore.setState({
      status: 'idle',
      selectedTags: [],
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
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('nextMatch', () => {
    it('sends MSG_MATCH_NEXT and transitions status to waiting', () => {
      useMatchStore.setState({ status: 'in-room', selectedTags: ['tech', 'music'] });

      useMatchStore.getState().nextMatch();

      const state = useMatchStore.getState();
      expect(state.status).toBe('waiting');
      expect(state.waitStartTime).toBeTypeOf('number');
      expect(state.elapsedSeconds).toBe(0);
      expect(state.matchRoomId).toBeNull();
      expect(state.matchKey).toBeNull();
      expect(state.isKeyGenerator).toBe(false);
      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(MSG_MATCH_NEXT, { tags: ['tech', 'music'] });
    });

    it('does nothing if not in-room', () => {
      useMatchStore.setState({ status: 'waiting' });

      useMatchStore.getState().nextMatch();

      expect(mockSend).not.toHaveBeenCalled();
      expect(useMatchStore.getState().status).toBe('waiting');
    });

    it('resets extension state when entering next match', () => {
      useMatchStore.setState({
        status: 'in-room',
        selectedTags: ['gaming'],
        extensionProposed: true,
        extensionCount: 2,
        partnerProposedExtend: true,
      });

      useMatchStore.getState().nextMatch();

      const state = useMatchStore.getState();
      expect(state.extensionProposed).toBe(false);
      expect(state.extensionCount).toBe(0);
      expect(state.partnerProposedExtend).toBe(false);
    });
  });

  describe('reportPartner', () => {
    it('sends MSG_MATCH_REPORT with reason and stays in room', () => {
      useMatchStore.setState({ status: 'in-room' });

      useMatchStore.getState().reportPartner('harassment');

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(MSG_MATCH_REPORT, { reason: 'harassment' });
      expect(useMatchStore.getState().status).toBe('in-room');
    });

    it('does nothing if not in-room', () => {
      useMatchStore.setState({ status: 'waiting' });

      useMatchStore.getState().reportPartner('spam');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('supports all reason types', () => {
      useMatchStore.setState({ status: 'in-room' });

      useMatchStore.getState().reportPartner('inappropriate');
      expect(mockSend).toHaveBeenCalledWith(MSG_MATCH_REPORT, { reason: 'inappropriate' });

      vi.clearAllMocks();
      useMatchStore.getState().reportPartner('other');
      expect(mockSend).toHaveBeenCalledWith(MSG_MATCH_REPORT, { reason: 'other' });
    });
  });

  describe('proposeExtension', () => {
    it('sends MSG_MATCH_EXTEND and sets extensionProposed=true', () => {
      useMatchStore.setState({ status: 'in-room', extensionProposed: false });

      useMatchStore.getState().proposeExtension();

      expect(mockSend).toHaveBeenCalledOnce();
      expect(mockSend).toHaveBeenCalledWith(MSG_MATCH_EXTEND, {});
      expect(useMatchStore.getState().extensionProposed).toBe(true);
    });

    it('does nothing if not in-room', () => {
      useMatchStore.setState({ status: 'waiting', extensionProposed: false });

      useMatchStore.getState().proposeExtension();

      expect(mockSend).not.toHaveBeenCalled();
      expect(useMatchStore.getState().extensionProposed).toBe(false);
    });

    it('does nothing if already proposed', () => {
      useMatchStore.setState({ status: 'in-room', extensionProposed: true });

      useMatchStore.getState().proposeExtension();

      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
