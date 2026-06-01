/**
 * ChatRoom page — main chat interface displayed when the user is in a room.
 *
 * Layout (top to bottom):
 * - Header: member count, ConnectionStatus indicator, Leave button
 * - MemberList (expandable) below header
 * - ShareCode display (collapsible)
 * - MessageList in scrollable area (flex-1)
 * - TypingIndicator below messages
 * - MessageInput at bottom
 *
 * Subscribes to chatStore for room state.
 * Uses useTranslation hook for i18n.
 * Uses Tailwind CSS for styling. TypeScript strict mode.
 *
 * Requirements: 8.3, 8.4, 8.5
 */

import { useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useChatStore } from '../stores/chatStore';
import { useTranslation } from '../i18n';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { MessageList } from '../components/MessageList';
import { MessageInput } from '../components/MessageInput';
import { MemberList } from '../components/MemberList';
import { ShareCode } from '../components/ShareCode';
import { TypingIndicator } from '../components/TypingIndicator';

export function ChatRoom() {
  const { members, leaveRoom, shareCode } = useChatStore(useShallow((s) => ({
    members: s.members,
    leaveRoom: s.leaveRoom,
    shareCode: s.shareCode,
  })));
  const { t } = useTranslation();

  const [shareCodeVisible, setShareCodeVisible] = useState(true);

  const handleLeave = () => {
    void leaveRoom();
  };

  return (
    <div className="flex h-full flex-col bg-gray-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">
            {t('chat.header.members', { count: members.length })}
          </span>
          <ConnectionStatus />
        </div>
        <button
          type="button"
          onClick={handleLeave}
          className="rounded px-2 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/30 hover:text-red-300"
          aria-label={t('chat.header.leave')}
        >
          {t('chat.header.leave')}
        </button>
      </header>

      {/* MemberList (expandable) below header */}
      <MemberList />

      {/* ShareCode display (collapsible) */}
      {shareCode && (
        <div className="border-b border-gray-700">
          <button
            type="button"
            onClick={() => setShareCodeVisible((prev) => !prev)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
            aria-expanded={shareCodeVisible}
            aria-controls="share-code-panel"
          >
            <span>{t('share.label')}</span>
            <svg
              className={`h-3.5 w-3.5 transition-transform ${shareCodeVisible ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {shareCodeVisible && (
            <div id="share-code-panel" className="px-3 pb-2">
              <ShareCode />
            </div>
          )}
        </div>
      )}

      {/* MessageList in scrollable area */}
      <MessageList />

      {/* TypingIndicator below messages */}
      <TypingIndicator />

      {/* MessageInput at bottom */}
      <MessageInput />
    </div>
  );
}
