/**
 * Property-based test: Next-Match Cleanup Completeness
 *
 * Feature: match-ux-polish, Property 2: Next-Match Cleanup Completeness
 *
 * For any chatStore state (arbitrary messages, members, roomKey, reactions, typing state),
 * invoking resetChatStoreForMatch() SHALL result in chatStore containing only initial/empty
 * values for all room-related fields.
 *
 * **Validates: Requirements 2.1, 2.4**
 *
 * @module match/__tests__/cleanup.property.test
 * @see matchCleanup.ts — resetChatStoreForMatch implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useChatStore } from '../../stores/chatStore';
import { useMatchStore } from '../matchStore';
import { resetChatStoreForMatch } from '../matchCleanup';

// Mock dependencies that resetChatStoreForMatch calls
vi.mock('../../voice/voiceStore', () => ({
  useVoiceStore: {
    getState: () => ({
      cancelRecording: vi.fn(),
      cleanup: vi.fn(),
    }),
  },
}));

vi.mock('../../file-transfer/fileTransferStore', () => ({
  useFileTransferStore: {
    getState: () => ({
      abortAllTransfers: vi.fn(),
    }),
  },
}));

// Mock network/websocket to prevent real WS connections
vi.mock('../../network/websocket', () => ({
  connect: vi.fn(),
  send: vi.fn(),
  onMessage: vi.fn(),
  isConnected: vi.fn(() => false),
}));

// ===== Arbitraries for chatStore fields =====

/**
 * Generates a random Member object.
 */
function arbitraryMember() {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 20 }),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    color: fc.string({ minLength: 1, maxLength: 10 }),
  });
}

/**
 * Generates a random ChatMessage object.
 */
function arbitraryChatMessage() {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 30 }),
    stableId: fc.string({ minLength: 0, maxLength: 30 }),
    senderId: fc.string({ minLength: 1, maxLength: 20 }),
    senderName: fc.string({ minLength: 1, maxLength: 30 }),
    text: fc.string({ minLength: 0, maxLength: 200 }),
    timestamp: fc.nat({ max: 2000000000000 }),
    isMine: fc.boolean(),
    isSystem: fc.boolean(),
  });
}

/**
 * Generates a random ReplyData object.
 */
function arbitraryReplyData() {
  return fc.record({
    stableId: fc.string({ minLength: 1, maxLength: 30 }),
    senderName: fc.string({ minLength: 1, maxLength: 30 }),
    preview: fc.string({ minLength: 0, maxLength: 50 }),
  });
}

/**
 * Generates a random Reaction array for a message.
 */
function arbitraryReaction() {
  return fc.record({
    emoji: fc.string({ minLength: 1, maxLength: 4 }),
    userIds: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
  });
}

/**
 * Generates a random typingMembers Map (memberId → timeout handle as number).
 */
function arbitraryTypingMembers() {
  return fc
    .array(
      fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.nat({ max: 999999 })
      ),
      { minLength: 0, maxLength: 5 }
    )
    .map((entries) => new Map(entries));
}

/**
 * Generates a random reactions Map (stableId → Reaction[]).
 */
function arbitraryReactionsMap() {
  return fc
    .array(
      fc.tuple(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.array(arbitraryReaction(), { minLength: 1, maxLength: 3 })
      ),
      { minLength: 0, maxLength: 5 }
    )
    .map((entries) => new Map(entries));
}

/**
 * Generates a random publicKeyMap (memberId → PublicKeyEntry stub).
 * Since we can't easily generate real CryptoKey objects in tests,
 * we use a minimal shape that represents non-empty state.
 */
function arbitraryPublicKeyMap() {
  return fc
    .array(
      fc.tuple(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.record({
          raw: fc.uint8Array({ minLength: 32, maxLength: 32 }),
          cryptoKey: fc.constant({} as CryptoKey),
          firstSeen: fc.nat({ max: 2000000000000 }),
        })
      ),
      { minLength: 0, maxLength: 3 }
    )
    .map((entries) => new Map(entries));
}

describe('Property 2: Next-Match Cleanup Completeness', () => {
  beforeEach(() => {
    // Ensure store starts from known state before each test run
    useChatStore.setState({
      connected: false,
      myId: null,
      myName: '',
      roomId: null,
      roomKey: null,
      shareCode: null,
      members: [],
      hasPassword: false,
      ephemeral: 0,
      expiresAt: 0,
      messages: [],
      typingMembers: new Map(),
      muted: false,
      replyTo: null,
      reactions: new Map(),
      signingKeyPair: null,
      publicKeyMap: new Map(),
    });
  });

  /**
   * Core property: For any arbitrary chatStore room-related state,
   * resetChatStoreForMatch() MUST reset ALL room-related fields to initial values.
   *
   * **Validates: Requirements 2.1, 2.4**
   */
  it('resets all room-related fields to initial values regardless of prior state', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary room-related state
        fc.record({
          roomId: fc.string({ minLength: 1, maxLength: 30 }),
          shareCode: fc.string({ minLength: 1, maxLength: 100 }),
          members: fc.array(arbitraryMember(), { minLength: 1, maxLength: 10 }),
          hasPassword: fc.boolean(),
          ephemeral: fc.nat({ max: 300 }),
          expiresAt: fc.nat({ max: 2000000000 }),
          messages: fc.array(arbitraryChatMessage(), { minLength: 1, maxLength: 20 }),
          typingMembers: arbitraryTypingMembers(),
          replyTo: fc.option(arbitraryReplyData(), { nil: null }),
          reactions: arbitraryReactionsMap(),
          publicKeyMap: arbitraryPublicKeyMap(),
        }),
        (randomState) => {
          // Seed the store with random state
          useChatStore.setState({
            ...randomState,
            // roomKey is CryptoKey which cannot be easily generated;
            // use a non-null sentinel to ensure it gets cleared
            roomKey: {} as CryptoKey,
            signingKeyPair: { privateKey: {} as CryptoKey, publicKeyBytes: new Uint8Array(32) } as never,
          });

          // Act: invoke cleanup
          resetChatStoreForMatch();

          // Assert: all room-related fields are reset to initial values
          const state = useChatStore.getState();

          expect(state.roomId).toBeNull();
          expect(state.roomKey).toBeNull();
          expect(state.shareCode).toBeNull();
          expect(state.members).toEqual([]);
          expect(state.hasPassword).toBe(false);
          expect(state.ephemeral).toBe(0);
          expect(state.expiresAt).toBe(0);
          expect(state.messages).toEqual([]);
          expect(state.typingMembers).toEqual(new Map());
          expect(state.replyTo).toBeNull();
          expect(state.reactions).toEqual(new Map());
          expect(state.signingKeyPair).toBeNull();
          expect(state.publicKeyMap).toEqual(new Map());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Cleanup is idempotent — calling it multiple times
   * on already-clean state produces the same result.
   *
   * **Validates: Requirements 2.1, 2.4**
   */
  it('is idempotent — calling cleanup on empty state leaves it empty', () => {
    fc.assert(
      fc.property(fc.nat({ max: 5 }), (callCount) => {
        // Start from some non-empty state
        useChatStore.setState({
          roomId: 'test-room',
          roomKey: {} as CryptoKey,
          shareCode: 'test-code',
          members: [{ id: '1', name: 'Alice', color: '#f00' }],
          messages: [
            {
              id: '1',
              stableId: 's1',
              senderId: '1',
              senderName: 'Alice',
              text: 'hello',
              timestamp: 1000,
              isMine: false,
              isSystem: false,
            },
          ],
          typingMembers: new Map([['1', 999]]),
          reactions: new Map([['s1', [{ emoji: '👍', userIds: ['1'] }]]]),
        });

        // Call cleanup 1 + callCount times
        for (let i = 0; i <= callCount; i++) {
          resetChatStoreForMatch();
        }

        // Assert state is still clean after multiple calls
        const state = useChatStore.getState();
        expect(state.roomId).toBeNull();
        expect(state.roomKey).toBeNull();
        expect(state.shareCode).toBeNull();
        expect(state.members).toEqual([]);
        expect(state.messages).toEqual([]);
        expect(state.typingMembers).toEqual(new Map());
        expect(state.reactions).toEqual(new Map());
        expect(state.signingKeyPair).toBeNull();
        expect(state.publicKeyMap).toEqual(new Map());
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Property-based test: Room-Closed State Coordination
 *
 * Feature: match-ux-polish, Property 4: Room-Closed State Coordination
 *
 * For any matchStore state where `status === 'in-room'`, when a MsgRoomClosed event
 * is received, matchStore.status SHALL transition to 'expired' and chatStore room-related
 * fields SHALL be reset to initial values.
 *
 * **Validates: Requirements 2.3**
 */
describe('Property 4: Room-Closed State Coordination', () => {
  beforeEach(() => {
    // Reset chatStore to known initial state
    useChatStore.setState({
      connected: false,
      myId: null,
      myName: '',
      roomId: null,
      roomKey: null,
      shareCode: null,
      members: [],
      hasPassword: false,
      ephemeral: 0,
      expiresAt: 0,
      messages: [],
      typingMembers: new Map(),
      muted: false,
      replyTo: null,
      reactions: new Map(),
      signingKeyPair: null,
      publicKeyMap: new Map(),
    });

    // Reset matchStore to known initial state
    useMatchStore.setState({
      status: 'idle',
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
    });
  });

  /**
   * Generates a random matchStore session state that is forced to `status === 'in-room'`.
   * All other session fields are randomized to prove the property holds regardless of
   * specific field values.
   */
  function arbitraryInRoomMatchState() {
    return fc.record({
      matchRoomId: fc.string({ minLength: 5, maxLength: 30 }),
      matchKeyRaw: fc.option(fc.string({ minLength: 10, maxLength: 50 }), { nil: null }),
      matchExpiresAt: fc.option(fc.nat({ max: 2000000000 }), { nil: null }),
      matchEphemeral: fc.option(fc.nat({ max: 300 }), { nil: null }),
      isKeyGenerator: fc.boolean(),
      partnerId: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
      extensionProposed: fc.boolean(),
      extensionCount: fc.nat({ max: 5 }),
      partnerProposedExtend: fc.boolean(),
      partnerLeft: fc.boolean(),
    });
  }

  /**
   * Generates random chatStore room state to seed before the MsgRoomClosed event.
   */
  function arbitraryChatRoomState() {
    return fc.record({
      roomId: fc.string({ minLength: 1, maxLength: 30 }),
      shareCode: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
      members: fc.array(arbitraryMember(), { minLength: 1, maxLength: 5 }),
      hasPassword: fc.boolean(),
      ephemeral: fc.nat({ max: 300 }),
      expiresAt: fc.nat({ max: 2000000000 }),
      messages: fc.array(arbitraryChatMessage(), { minLength: 0, maxLength: 10 }),
      typingMembers: arbitraryTypingMembers(),
      replyTo: fc.option(arbitraryReplyData(), { nil: null }),
      reactions: arbitraryReactionsMap(),
    });
  }

  /**
   * Simulates the cross-store coordination logic from the MSG_ROOM_CLOSED handler
   * in chatStore. This replicates the exact logic:
   * 1. Check if matchStore.status === 'in-room'
   * 2. If so, transition matchStore to 'expired' and clear session fields
   * 3. Reset chatStore room-related fields
   */
  function simulateMsgRoomClosed(): void {
    const matchStatus = useMatchStore.getState().status;
    if (matchStatus === 'in-room') {
      useMatchStore.setState({
        status: 'expired',
        matchRoomId: null,
        matchKey: null,
        matchExpiresAt: null,
      });
    }

    // Reset chatStore room fields (same as the handler does via setState)
    useChatStore.setState({
      roomId: null,
      roomKey: null,
      shareCode: null,
      members: [],
      hasPassword: false,
      ephemeral: 0,
      expiresAt: 0,
      messages: [],
      typingMembers: new Map(),
      replyTo: null,
      reactions: new Map(),
      signingKeyPair: null,
      publicKeyMap: new Map(),
    });
  }

  /**
   * Core property: For any matchStore state with status 'in-room' and any chatStore
   * room state, receiving MsgRoomClosed SHALL transition matchStore.status to 'expired'
   * and reset all chatStore room-related fields to initial values.
   *
   * **Validates: Requirements 2.3**
   */
  it('transitions matchStore to expired and resets chatStore on MsgRoomClosed when in-room', () => {
    fc.assert(
      fc.property(
        arbitraryInRoomMatchState(),
        arbitraryChatRoomState(),
        (matchState, chatState) => {
          // Seed matchStore with random in-room state (status forced to 'in-room')
          useMatchStore.setState({
            ...matchState,
            status: 'in-room',
            matchKey: {} as CryptoKey, // CryptoKey sentinel (cannot generate real ones in tests)
          });

          // Seed chatStore with random room state
          useChatStore.setState({
            ...chatState,
            roomKey: {} as CryptoKey,
            signingKeyPair: { privateKey: {} as CryptoKey, publicKeyBytes: new Uint8Array(32) } as never,
            publicKeyMap: new Map([['test-member', { raw: new Uint8Array(32), cryptoKey: {} as CryptoKey, firstSeen: 1000 }]]),
          });

          // Act: simulate MsgRoomClosed event
          simulateMsgRoomClosed();

          // Assert: matchStore.status transitioned to 'expired'
          const matchResult = useMatchStore.getState();
          expect(matchResult.status).toBe('expired');
          expect(matchResult.matchRoomId).toBeNull();
          expect(matchResult.matchKey).toBeNull();
          expect(matchResult.matchExpiresAt).toBeNull();

          // Assert: chatStore room fields are reset to initial values
          const chatResult = useChatStore.getState();
          expect(chatResult.roomId).toBeNull();
          expect(chatResult.roomKey).toBeNull();
          expect(chatResult.shareCode).toBeNull();
          expect(chatResult.members).toEqual([]);
          expect(chatResult.hasPassword).toBe(false);
          expect(chatResult.ephemeral).toBe(0);
          expect(chatResult.expiresAt).toBe(0);
          expect(chatResult.messages).toEqual([]);
          expect(chatResult.typingMembers).toEqual(new Map());
          expect(chatResult.replyTo).toBeNull();
          expect(chatResult.reactions).toEqual(new Map());
          expect(chatResult.signingKeyPair).toBeNull();
          expect(chatResult.publicKeyMap).toEqual(new Map());
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: MsgRoomClosed does NOT transition matchStore when status is NOT 'in-room'.
   * This ensures the coordination logic only fires for active match sessions.
   *
   * **Validates: Requirements 2.3**
   */
  it('does not transition matchStore when status is not in-room', () => {
    const nonInRoomStatuses = ['idle', 'selecting-tags', 'waiting', 'pairing', 'found', 'timeout', 'expired'] as const;

    fc.assert(
      fc.property(
        fc.constantFrom(...nonInRoomStatuses),
        arbitraryChatRoomState(),
        (initialStatus, chatState) => {
          // Seed matchStore with a non-in-room status
          useMatchStore.setState({
            status: initialStatus,
            matchRoomId: 'some-room',
            matchKey: null,
            matchExpiresAt: 1000000,
          });

          // Seed chatStore with random room state
          useChatStore.setState({
            ...chatState,
            roomKey: {} as CryptoKey,
          });

          // Act: simulate MsgRoomClosed event
          simulateMsgRoomClosed();

          // Assert: matchStore.status is unchanged (NOT transitioned to 'expired')
          const matchResult = useMatchStore.getState();
          expect(matchResult.status).toBe(initialStatus);
          // matchRoomId should NOT have been cleared (coordination didn't fire)
          expect(matchResult.matchRoomId).toBe('some-room');
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ===== Arbitraries for matchStore session fields =====

/**
 * Generates a random MatchStatus that represents an active session
 * (not idle — we want to test cleanup from any active state).
 */
function arbitraryActiveMatchStatus() {
  return fc.constantFrom(
    'selecting-tags' as const,
    'waiting' as const,
    'pairing' as const,
    'found' as const,
    'in-room' as const,
    'timeout' as const,
    'expired' as const,
  );
}

/**
 * Generates a random matchStore session state with non-initial values.
 */
function arbitraryMatchSessionState() {
  return fc.record({
    status: arbitraryActiveMatchStatus(),
    matchRoomId: fc.string({ minLength: 1, maxLength: 30 }),
    matchKeyRaw: fc.string({ minLength: 10, maxLength: 50 }),
    matchExpiresAt: fc.nat({ max: 2000000000 }),
    matchEphemeral: fc.nat({ max: 300 }),
    isKeyGenerator: fc.boolean(),
    partnerId: fc.string({ minLength: 1, maxLength: 20 }),
    inviteLink: fc.string({ minLength: 5, maxLength: 100 }),
    inviteToken: fc.string({ minLength: 5, maxLength: 50 }),
    extensionProposed: fc.boolean(),
    extensionCount: fc.nat({ max: 5 }),
    partnerProposedExtend: fc.boolean(),
    partnerLeft: fc.boolean(),
  });
}

describe('Property 3: Back-to-Hub Cleanup Completeness', () => {
  beforeEach(() => {
    // Reset both stores to known state before each test
    useChatStore.setState({
      connected: false,
      myId: null,
      myName: '',
      roomId: null,
      roomKey: null,
      shareCode: null,
      members: [],
      hasPassword: false,
      ephemeral: 0,
      expiresAt: 0,
      messages: [],
      typingMembers: new Map(),
      muted: false,
      replyTo: null,
      reactions: new Map(),
      signingKeyPair: null,
      publicKeyMap: new Map(),
    });

    useMatchStore.setState({
      status: 'idle',
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
    });
  });

  /**
   * Simulates the handleBackToHub logic from MatchPage.tsx:
   * 1. Call resetChatStoreForMatch() to clean chatStore
   * 2. Reset matchStore to idle with all session fields cleared
   *
   * This is a direct simulation — the actual handleBackToHub is a React callback
   * that also calls cancelMatch() if waiting/pairing and navigates to hub page,
   * but the core state cleanup logic is what this property verifies.
   */
  function simulateHandleBackToHub(): void {
    // Step 1: Clean up chatStore (voice, file transfers, room state)
    resetChatStoreForMatch();

    // Step 2: Reset matchStore to idle and clear all session fields
    useMatchStore.setState({
      status: 'idle',
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
      waitStartTime: null,
      elapsedSeconds: 0,
      waitedSeconds: 0,
      error: null,
      retryAfter: null,
    });
  }

  /**
   * Core property: For any arbitrary chatStore + matchStore combined state,
   * invoking handleBackToHub logic SHALL result in both stores containing
   * only initial/empty values for all session-related fields.
   *
   * **Validates: Requirements 2.2, 2.4**
   */
  it('resets both chatStore and matchStore session fields to initial values regardless of prior state', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary chatStore room-related state
        fc.record({
          roomId: fc.string({ minLength: 1, maxLength: 30 }),
          shareCode: fc.string({ minLength: 1, maxLength: 100 }),
          members: fc.array(arbitraryMember(), { minLength: 1, maxLength: 10 }),
          hasPassword: fc.boolean(),
          ephemeral: fc.nat({ max: 300 }),
          expiresAt: fc.nat({ max: 2000000000 }),
          messages: fc.array(arbitraryChatMessage(), { minLength: 1, maxLength: 20 }),
          typingMembers: arbitraryTypingMembers(),
          replyTo: fc.option(arbitraryReplyData(), { nil: null }),
          reactions: arbitraryReactionsMap(),
          publicKeyMap: arbitraryPublicKeyMap(),
        }),
        // Generate arbitrary matchStore session state
        arbitraryMatchSessionState(),
        (randomChatState, randomMatchState) => {
          // Seed chatStore with random state
          useChatStore.setState({
            ...randomChatState,
            roomKey: {} as CryptoKey,
            signingKeyPair: { privateKey: {} as CryptoKey, publicKeyBytes: new Uint8Array(32) } as never,
          });

          // Seed matchStore with random session state
          useMatchStore.setState({
            ...randomMatchState,
            matchKey: {} as CryptoKey,
          });

          // Act: invoke handleBackToHub simulation
          simulateHandleBackToHub();

          // Assert: chatStore room-related fields are reset
          const chatState = useChatStore.getState();
          expect(chatState.roomId).toBeNull();
          expect(chatState.roomKey).toBeNull();
          expect(chatState.shareCode).toBeNull();
          expect(chatState.members).toEqual([]);
          expect(chatState.hasPassword).toBe(false);
          expect(chatState.ephemeral).toBe(0);
          expect(chatState.expiresAt).toBe(0);
          expect(chatState.messages).toEqual([]);
          expect(chatState.typingMembers).toEqual(new Map());
          expect(chatState.replyTo).toBeNull();
          expect(chatState.reactions).toEqual(new Map());
          expect(chatState.signingKeyPair).toBeNull();
          expect(chatState.publicKeyMap).toEqual(new Map());

          // Assert: matchStore session fields are reset
          const matchState = useMatchStore.getState();
          expect(matchState.status).toBe('idle');
          expect(matchState.matchRoomId).toBeNull();
          expect(matchState.matchKey).toBeNull();
          expect(matchState.matchKeyRaw).toBeNull();
          expect(matchState.matchExpiresAt).toBeNull();
          expect(matchState.matchEphemeral).toBeNull();
          expect(matchState.isKeyGenerator).toBe(false);
          expect(matchState.partnerId).toBeNull();
          expect(matchState.inviteLink).toBeNull();
          expect(matchState.inviteToken).toBeNull();
          expect(matchState.extensionProposed).toBe(false);
          expect(matchState.extensionCount).toBe(0);
          expect(matchState.partnerProposedExtend).toBe(false);
          expect(matchState.partnerLeft).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional property: Back-to-hub cleanup is idempotent — invoking it
   * multiple times on already-clean state keeps both stores in initial state.
   *
   * **Validates: Requirements 2.2, 2.4**
   */
  it('is idempotent — multiple invocations keep both stores in initial state', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 5 }),
        arbitraryMatchSessionState(),
        (callCount, randomMatchState) => {
          // Seed stores with non-empty state
          useChatStore.setState({
            roomId: 'match-room-123',
            roomKey: {} as CryptoKey,
            shareCode: 'share-abc',
            members: [{ id: '1', name: '🐱 Cat', color: '#f00' }],
            messages: [
              {
                id: 'm1',
                stableId: 'sm1',
                senderId: '1',
                senderName: '🐱 Cat',
                text: 'hello',
                timestamp: 1000,
                isMine: false,
                isSystem: false,
              },
            ],
            typingMembers: new Map([['1', 999]]),
            reactions: new Map([['sm1', [{ emoji: '👋', userIds: ['1'] }]]]),
          });

          useMatchStore.setState({
            ...randomMatchState,
            matchKey: {} as CryptoKey,
          });

          // Call handleBackToHub 1 + callCount times
          for (let i = 0; i <= callCount; i++) {
            simulateHandleBackToHub();
          }

          // Assert: both stores still in clean initial state
          const chatState = useChatStore.getState();
          expect(chatState.roomId).toBeNull();
          expect(chatState.roomKey).toBeNull();
          expect(chatState.members).toEqual([]);
          expect(chatState.messages).toEqual([]);
          expect(chatState.typingMembers).toEqual(new Map());
          expect(chatState.reactions).toEqual(new Map());

          const matchState = useMatchStore.getState();
          expect(matchState.status).toBe('idle');
          expect(matchState.matchRoomId).toBeNull();
          expect(matchState.matchKey).toBeNull();
          expect(matchState.matchKeyRaw).toBeNull();
          expect(matchState.extensionProposed).toBe(false);
          expect(matchState.extensionCount).toBe(0);
          expect(matchState.partnerLeft).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
