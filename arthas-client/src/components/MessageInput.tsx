import { useState, useCallback, useRef, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { EmojiPicker } from './EmojiPicker';

const MAX_LENGTH = 500;
const SHOW_COUNT_THRESHOLD = 400;

export function MessageInput() {
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setTyping = useChatStore((s) => s.setTyping);
  const wasTypingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const cursorPosRef = useRef<number | null>(null);

  const trimmedText = text.trim();
  const canSend = trimmedText.length > 0 && trimmedText.length <= MAX_LENGTH;

  // 光标位置恢复（emoji 插入后）
  useEffect(() => {
    if (cursorPosRef.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(cursorPosRef.current, cursorPosRef.current);
      inputRef.current.focus();
      cursorPosRef.current = null;
    }
  }, [text]);

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

  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    if (newText.length > MAX_LENGTH) return;
    cursorPosRef.current = start + emoji.length;
    setText(newText);

    // Trigger typing indicator
    if (!wasTypingRef.current) {
      setTyping(true);
      wasTypingRef.current = true;
    }
  };

  return (
    <div className="relative flex gap-2 items-center">
      {/* Emoji button */}
      <button
        ref={emojiBtnRef}
        onClick={() => setEmojiOpen((v) => !v)}
        aria-label="选择表情"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xl text-gray-400 hover:text-white transition-colors"
      >
        😊
      </button>

      {/* Input */}
      <div className="relative flex-1">
        <input
          ref={inputRef}
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

      {/* Send button */}
      <button
        onClick={handleSend}
        disabled={!canSend}
        className="min-h-[44px] min-w-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-600 rounded-lg text-white font-medium transition-colors"
      >
        发送
      </button>

      {/* Emoji Picker */}
      {emojiOpen && (
        <EmojiPicker
          onSelect={insertEmoji}
          onClose={() => setEmojiOpen(false)}
          excludeRef={emojiBtnRef}
        />
      )}
    </div>
  );
}
