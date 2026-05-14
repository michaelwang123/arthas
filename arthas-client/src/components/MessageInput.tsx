import { useState, useCallback, useRef } from 'react';
import { useChatStore } from '../stores/chatStore';

const MAX_LENGTH = 500;
const SHOW_COUNT_THRESHOLD = 400;

export function MessageInput() {
  const [text, setText] = useState('');
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setTyping = useChatStore((s) => s.setTyping);
  const wasTypingRef = useRef(false);

  const trimmedText = text.trim();
  const canSend = trimmedText.length > 0 && trimmedText.length <= MAX_LENGTH;

  const handleSend = useCallback(() => {
    if (!canSend) return;

    sendMessage(trimmedText);
    setText('');

    // Notify typing stopped
    setTyping(false);
    wasTypingRef.current = false;
  }, [canSend, trimmedText, sendMessage, setTyping]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Block input beyond max length
    if (value.length > MAX_LENGTH) return;

    setText(value);

    // Typing indicator logic
    const hasContent = value.trim().length > 0;
    if (hasContent && !wasTypingRef.current) {
      setTyping(true);
      wasTypingRef.current = true;
    } else if (!hasContent && wasTypingRef.current) {
      setTyping(false);
      wasTypingRef.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex gap-2 items-center">
      <div className="relative flex-1">
        <input
          type="text"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          maxLength={MAX_LENGTH}
          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 transition-colors"
        />
        {text.length > SHOW_COUNT_THRESHOLD && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            {text.length}/{MAX_LENGTH}
          </span>
        )}
      </div>
      <button
        onClick={handleSend}
        disabled={!canSend}
        className="min-h-[44px] min-w-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-600 rounded-lg text-white font-medium transition-colors"
      >
        发送
      </button>
    </div>
  );
}
