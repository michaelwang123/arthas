/**
 * @file MatchPage.tsx — Match flow container that orchestrates state-based rendering
 *
 * Renders the appropriate match UI component based on matchStore.status:
 * - 'waiting' / 'pairing' → MatchWaiting
 * - 'found' → MatchFound (auto-transitions to 'in-room' after animation)
 * - 'in-room' → MatchRoom
 * - 'timeout' → MatchTimeout
 *
 * Also handles:
 * - Browser beforeunload: sends MatchCancel if in waiting state
 * - Component unmount: sends MatchCancel if in waiting state
 * - Browser back button: returns to Hub
 *
 * @module match/MatchPage
 */

import { useEffect, useCallback } from 'react';
import { useMatchStore } from './matchStore';
import { useChatStore } from '../stores/chatStore';
import { MatchWaiting } from './MatchWaiting';
import { MatchFound } from './MatchFound';
import { MatchRoom } from './MatchRoom';
import { MatchTimeout } from './MatchTimeout';
import { usePageStore } from '../stores/pageStore';
import * as ws from '../network/websocket';
import { MSG_MATCH_CANCEL } from './protocol';

/**
 * MatchPage — Orchestrates the entire match flow UI based on matchStore status.
 *
 * This component is rendered by App.tsx when matchStore.status is an active match state
 * (waiting, pairing, found, in-room, timeout).
 */
export function MatchPage() {
  const status = useMatchStore((s) => s.status);
  const cancelMatch = useMatchStore((s) => s.cancelMatch);
  const startMatch = useMatchStore((s) => s.startMatch);
  const generateInviteLink = useMatchStore((s) => s.generateInviteLink);

  // Navigate back to hub — cancel match if waiting
  const handleBackToHub = useCallback(() => {
    if (status === 'waiting' || status === 'pairing') {
      cancelMatch();
    }
    useMatchStore.setState({ status: 'idle' });
    usePageStore.getState().setPage('hub');
  }, [status, cancelMatch]);

  // MatchFound animation complete → transition to 'in-room'
  const handleMatchFoundComplete = useCallback(() => {
    useMatchStore.setState({ status: 'in-room' });
  }, []);

  // Fallback: if stuck in 'found' state for more than 3 seconds (animation didn't fire callback),
  // force transition to 'in-room'. This prevents the UI from getting stuck.
  useEffect(() => {
    if (status !== 'found') return;
    const fallback = setTimeout(() => {
      if (useMatchStore.getState().status === 'found') {
        useMatchStore.setState({ status: 'in-room' });
      }
    }, 3000);
    return () => clearTimeout(fallback);
  }, [status]);

  // Sync matchStore state → chatStore when entering 'in-room'.
  // This is a backup sync in case the direct sync in matchStore (on key generation/import)
  // hasn't fired yet due to timing. Ensures roomKey is set before user tries to send messages.
  useEffect(() => {
    if (status !== 'in-room') return;

    const { matchKey, matchRoomId, matchEphemeral } = useMatchStore.getState();
    if (matchKey) {
      const chatState = useChatStore.getState();
      // Only sync if chatStore doesn't already have the key (avoid overwriting)
      if (!chatState.roomKey) {
        useChatStore.setState({
          roomKey: matchKey,
          roomId: matchRoomId,
          ephemeral: matchEphemeral ?? 0,
          myName: 'Anonymous',
        });
      }
    }
  }, [status]);

  // Retry match from timeout state
  const handleRetry = useCallback(() => {
    startMatch();
  }, [startMatch]);

  // Invite friend action
  const handleInvite = useCallback(() => {
    generateInviteLink();
  }, [generateInviteLink]);

  // Send MatchCancel on beforeunload if in waiting/pairing state
  useEffect(() => {
    const handleBeforeUnload = () => {
      const currentStatus = useMatchStore.getState().status;
      if (currentStatus === 'waiting' || currentStatus === 'pairing') {
        // Best-effort cancel — may not arrive if connection closes first
        ws.send(MSG_MATCH_CANCEL, {});
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Send MatchCancel on unmount if in waiting state
  useEffect(() => {
    return () => {
      const currentStatus = useMatchStore.getState().status;
      if (currentStatus === 'waiting' || currentStatus === 'pairing') {
        ws.send(MSG_MATCH_CANCEL, {});
        useMatchStore.setState({ status: 'idle', waitStartTime: null, elapsedSeconds: 0 });
      }
    };
  }, []);

  // Handle browser back button via popstate
  useEffect(() => {
    const handlePopState = () => {
      handleBackToHub();
    };

    // Push a history entry so back button can be intercepted
    window.history.pushState({ match: true }, '');
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [handleBackToHub]);

  // Render based on current status
  switch (status) {
    case 'waiting':
    case 'pairing':
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <MatchWaiting onInvite={handleInvite} />
        </div>
      );

    case 'found':
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <MatchFound onComplete={handleMatchFoundComplete} />
        </div>
      );

    case 'in-room':
      return (
        <div className="min-h-screen bg-gray-900 flex flex-col">
          <MatchRoom />
        </div>
      );

    case 'timeout':
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <MatchTimeout onRetry={handleRetry} onInvite={handleInvite} onBack={handleBackToHub} />
        </div>
      );

    // idle / selecting-tags should not reach here (App.tsx guards)
    default:
      return null;
  }
}
