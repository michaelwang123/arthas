import { useEffect, useRef } from 'react';
import type { ChatMessage, Member } from '../stores/chatStore';

interface MessageListProps {
  messages: ChatMessage[];
  myId: string | null;
  members: Member[];
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

const DECRYPT_FAIL_TEXT = '无法解密此消息';

export function MessageList({ messages, myId, members }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function getMemberColor(senderId: string): string | undefined {
    return members.find((m) => m.id === senderId)?.color;
  }

  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 flex items-center justify-center"
      >
        <span className="text-gray-500">暂无消息，开始聊天吧</span>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
      {messages.map((msg) => {
        // System messages
        if (msg.isSystem) {
          return (
            <div key={msg.id} className="flex justify-center">
              <span className="text-xs text-gray-500 italic">
                {msg.text}
              </span>
            </div>
          );
        }

        const isOwn = msg.isMine || msg.senderId === myId;
        const isDecryptFailed = msg.text === DECRYPT_FAIL_TEXT;
        const senderColor = getMemberColor(msg.senderId);

        // Own messages — right-aligned
        if (isOwn) {
          return (
            <div key={msg.id} className="flex justify-end">
              <div className="max-w-[70%] flex flex-col items-end">
                <div className="bg-indigo-600 text-white px-3 py-2 rounded-lg rounded-br-sm">
                  {isDecryptFailed ? (
                    <span className="italic text-red-300">{msg.text}</span>
                  ) : (
                    <span className="break-words">{msg.text}</span>
                  )}
                </div>
                <span className="text-xs text-gray-500 mt-0.5">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </div>
          );
        }

        // Others' messages — left-aligned
        return (
          <div key={msg.id} className="flex justify-start">
            <div className="max-w-[70%] flex flex-col items-start">
              <span
                className="text-xs font-medium mb-0.5"
                style={{ color: senderColor ?? '#9ca3af' }}
              >
                {msg.senderName}
              </span>
              <div className="bg-gray-700 text-white px-3 py-2 rounded-lg rounded-bl-sm">
                {isDecryptFailed ? (
                  <span className="italic text-red-400">{msg.text}</span>
                ) : (
                  <span className="break-words">{msg.text}</span>
                )}
              </div>
              <span className="text-xs text-gray-500 mt-0.5">
                {formatTime(msg.timestamp)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
