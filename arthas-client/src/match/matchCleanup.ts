/**
 * Match session cleanup — resets chatStore room-related fields to initial values.
 * Called before re-queue (Next) or navigation (Back to Hub) to prevent state leaks
 * between match sessions.
 *
 * Single responsibility: this module handles chatStore cleanup from a match context.
 * matchStore cleanup is handled separately by callers (nextMatch / handleBackToHub).
 */

import { useChatStore } from '../stores/chatStore';
import { useVoiceStore } from '../voice/voiceStore';
import { useFileTransferStore } from '../file-transfer/fileTransferStore';

/**
 * Resets chatStore to initial room state. Called before re-queue or navigation.
 * Must be synchronous and complete — no partial resets.
 *
 * Steps:
 * 1. Cancel active voice recording and release microphone
 * 2. Release all cached voice Blob URLs and playback state
 * 3. Abort any in-progress file transfers
 * 4. Reset all chatStore room-related fields to initial values
 */
export function resetChatStoreForMatch(): void {
  // Cancel voice recording if active and release all cached Blob URLs/playback state
  const voice = useVoiceStore.getState();
  voice.cancelRecording();
  voice.cleanup();

  // Abort any active file transfers (marks non-terminal transfers as failed)
  useFileTransferStore.getState().abortAllTransfers();

  // Reset all room-related chatStore fields to initial values
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
