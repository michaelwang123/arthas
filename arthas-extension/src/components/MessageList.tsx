/**
 * MessageList component — scrollable message display with auto-scroll.
 *
 * Renders chat messages with:
 * - Own messages right-aligned (blue bubble)
 * - Others' messages left-aligned (gray bubble) with sender name + color
 * - System messages centered (italic, muted)
 * - "[Cannot decrypt this message]" placeholder for failed decryptions
 * - Formatted timestamps (HH:MM)
 * - Auto-scroll to bottom on new messages
 *
 * Requirements: 5.4, 6.3, 6.4, 8.4
 */

import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/shallow';
import { useChatStore } from '../stores/chatStore';
import type { ChatMessage } from '../stores/chatStore';

const DECRYPT_FAIL_TEXT = '[Cannot decrypt this message]';

/** Format a Unix ms timestamp to HH:MM. */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function MessageList() {
  const { messages, myId, members } = useChatStore(useShallow((s) => ({
    messages: s.messages,
    myId: s.myId,
    members: s.members,
  })));
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  /** Look up a member's assigned color by senderId. */
  function getMemberColor(senderId: string): string | undefined {
    return members.find((m) => m.id === senderId)?.color;
  }

  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 flex items-center justify-center"
      >
        <span className="text-gray-500 text-sm">No messages yet</span>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
      {messages.map((msg) => {
        if (msg.isSystem) {
          return <SystemMessage key={msg.id} message={msg} />;
        }

        const isOwn = msg.isMine || msg.senderId === myId;

        if (isOwn) {
          return <OwnMessage key={msg.id} message={msg} />;
        }

        return (
          <OtherMessage
            key={msg.id}
            message={msg}
            senderColor={getMemberColor(msg.senderId)}
          />
        );
      })}
    </div>
  );
}

/** System message — centered, italic, muted text. */
function SystemMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-center py-1">
      <span className="text-xs text-gray-500 italic">{message.text}</span>
    </div>
  );
}

/** Own message — right-aligned blue bubble. */
function OwnMessage({ message }: { message: ChatMessage }) {
  const isDecryptFailed = message.text === DECRYPT_FAIL_TEXT;

  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] flex flex-col items-end">
        <div
          className={`rounded-lg px-3 py-2 text-sm break-words ${
            isDecryptFailed
              ? 'bg-red-900/40 text-red-300 italic'
              : 'bg-accent-blue/80 text-white'
          }`}
        >
          {message.text}
        </div>
        <span className="text-[10px] text-gray-500 mt-0.5">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

/** Other user's message — left-aligned gray bubble with sender name + color. */
function OtherMessage({
  message,
  senderColor,
}: {
  message: ChatMessage;
  senderColor: string | undefined;
}) {
  const isDecryptFailed = message.text === DECRYPT_FAIL_TEXT;

  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] flex flex-col items-start">
        <span
          className="text-[10px] font-medium mb-0.5 truncate max-w-full"
          style={{ color: senderColor ?? '#9ca3af' }}
        >
          {message.senderName}
        </span>
        <div
          className={`rounded-lg px-3 py-2 text-sm break-words ${
            isDecryptFailed
              ? 'bg-red-900/40 text-red-300 italic'
              : 'bg-gray-700 text-gray-100'
          }`}
        >
          {message.text}
        </div>
        <span className="text-[10px] text-gray-500 mt-0.5">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}
