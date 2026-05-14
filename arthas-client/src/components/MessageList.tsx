import { useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore';
import type { ChatMessage, Member } from '../stores/chatStore';
import { MessageBubble } from './MessageBubble';
import { truncatePreview } from '../utils/payload';

interface MessageListProps {
  messages: ChatMessage[];
  myId: string | null;
  members: Member[];
}

const FIVE_MINUTES = 5 * 60 * 1000;
const DECRYPT_FAIL_TEXT = '无法解密此消息';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function shouldShowTimeSeparator(prev: ChatMessage | null, curr: ChatMessage): boolean {
  if (!prev) return true;
  return curr.timestamp - prev.timestamp > FIVE_MINUTES;
}

function formatSeparatorTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  if (isToday) return `${hh}:${mm}`;
  const MM = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  return `${MM}-${dd} ${hh}:${mm}`;
}

export function MessageList({ messages, myId, members }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(messages.length);
  const reactions = useChatStore((s) => s.reactions);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const sendReaction = useChatStore((s) => s.sendReaction);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Track message count for send animation
  const isNewBatch = messages.length > prevCountRef.current;
  useEffect(() => {
    prevCountRef.current = messages.length;
  }, [messages.length]);

  const scrollToMessage = useCallback((stableId: string) => {
    const el = document.querySelector(`[data-stable-id="${stableId}"]`) as HTMLElement;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-indigo-500/50');
    setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-500/50'), 1500);
  }, []);

  function getMemberColor(senderId: string): string | undefined {
    return members.find((m) => m.id === senderId)?.color;
  }

  function handleReply(msg: ChatMessage) {
    setReplyTo({
      stableId: msg.stableId,
      senderName: msg.senderName,
      preview: truncatePreview(msg.text),
    });
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
      {messages.map((msg, index) => {
        const prevMsg = index > 0 ? messages[index - 1] : null;
        const showSeparator = shouldShowTimeSeparator(prevMsg, msg);

        // System messages
        if (msg.isSystem) {
          return (
            <div key={msg.id} data-stable-id={msg.stableId || undefined}>
              {showSeparator && <TimeSeparator timestamp={msg.timestamp} />}
              <div className="flex justify-center">
                <span className="text-xs text-gray-500 italic">{msg.text}</span>
              </div>
            </div>
          );
        }

        const isOwn = msg.isMine || msg.senderId === myId;
        const isDecryptFailed = msg.text === DECRYPT_FAIL_TEXT;
        const senderColor = getMemberColor(msg.senderId);
        const canCopy = !isDecryptFailed;
        const msgReactions = reactions.get(msg.stableId) || undefined;

        // Determine if this is the newest own message (for animation)
        const isNewestOwn = isNewBatch && index === messages.length - 1 && isOwn;
        const animClass = isNewestOwn ? 'animate-slide-in-msg motion-reduce:animate-none' : '';

        // Own messages — right-aligned
        if (isOwn) {
          return (
            <div key={msg.id} data-stable-id={msg.stableId}>
              {showSeparator && <TimeSeparator timestamp={msg.timestamp} />}
              <div className={`flex justify-end ${animClass}`}>
                <div className="max-w-[70%] flex flex-col items-end">
                  <MessageBubble
                    text={msg.text}
                    isOwn={true}
                    canCopy={canCopy}
                    isDecryptFailed={isDecryptFailed}
                    stableId={msg.stableId}
                    reply={msg.reply}
                    reactions={msgReactions}
                    myId={myId}
                    onReply={canCopy ? () => handleReply(msg) : undefined}
                    onReact={canCopy ? (emoji) => sendReaction(msg.stableId, emoji) : undefined}
                    onScrollToMessage={scrollToMessage}
                  />
                  <span className="text-xs text-gray-500 mt-0.5">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          );
        }

        // Others' messages — left-aligned
        return (
          <div key={msg.id} data-stable-id={msg.stableId}>
            {showSeparator && <TimeSeparator timestamp={msg.timestamp} />}
            <div className="flex justify-start">
              <div className="max-w-[70%] flex flex-col items-start">
                <span
                  className="text-xs font-medium mb-0.5"
                  style={{ color: senderColor ?? '#9ca3af' }}
                >
                  {msg.senderName}
                </span>
                <MessageBubble
                  text={msg.text}
                  isOwn={false}
                  canCopy={canCopy}
                  isDecryptFailed={isDecryptFailed}
                  stableId={msg.stableId}
                  reply={msg.reply}
                  reactions={msgReactions}
                  myId={myId}
                  onReply={canCopy ? () => handleReply(msg) : undefined}
                  onReact={canCopy ? (emoji) => sendReaction(msg.stableId, emoji) : undefined}
                  onScrollToMessage={scrollToMessage}
                />
                <span className="text-xs text-gray-500 mt-0.5">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimeSeparator({ timestamp }: { timestamp: number }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-gray-700" />
      <span className="text-xs text-gray-500">{formatSeparatorTime(timestamp)}</span>
      <div className="flex-1 h-px bg-gray-700" />
    </div>
  );
}
