/**
 * MessageInput component — text input with character counter, send button,
 * typing indicator trigger, and rate limit warning.
 *
 * Subscribes to chatStore sendMessage and setTyping actions.
 * Uses Tailwind CSS for styling. TypeScript strict mode.
 *
 * Requirements: 5.5, 5.6, 8.5, 10.1, 10.2
 */

import { useState, useCallback, useRef, useEffect, type ChangeEvent, type KeyboardEvent, type FormEvent } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useTranslation } from '../i18n';
import { canSend } from '../utils/rateLimit';

/** Maximum allowed message length. */
const MAX_MESSAGE_LENGTH = 500;

/** Debounce delay (ms) before sending typing:false. */
const TYPING_STOP_DEBOUNCE_MS = 2000;

export function MessageInput(): React.JSX.Element {
  const { t } = useTranslation();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setTyping = useChatStore((s) => s.setTyping);

  const [text, setText] = useState('');
  const [rateLimitWarning, setRateLimitWarning] = useState(false);

  /** Ref for the typing stop debounce timer. */
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Ref tracking whether we've signaled typing:true to the store. */
  const hasSignaledTypingRef = useRef(false);

  // Cleanup typing timer on unmount
  useEffect(() => {
    return () => {
      if (typingStopTimerRef.current) {
        clearTimeout(typingStopTimerRef.current);
      }
    };
  }, []);

  const charCount = text.length;
  const isOverLimit = charCount > MAX_MESSAGE_LENGTH;
  const isEmpty = charCount === 0;
  const isSendDisabled = isEmpty || isOverLimit;

  /**
   * Resets the typing stop debounce timer.
   * After TYPING_STOP_DEBOUNCE_MS of inactivity, sends typing:false.
   */
  const resetTypingStopTimer = useCallback(() => {
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
    }
    typingStopTimerRef.current = setTimeout(() => {
      typingStopTimerRef.current = null;
      hasSignaledTypingRef.current = false;
      void setTyping(false);
    }, TYPING_STOP_DEBOUNCE_MS);
  }, [setTyping]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setText(value);

      // Clear rate limit warning when user types
      if (rateLimitWarning) {
        setRateLimitWarning(false);
      }

      // Trigger typing indicator on input change
      if (value.length > 0) {
        if (!hasSignaledTypingRef.current) {
          hasSignaledTypingRef.current = true;
          void setTyping(true);
        }
        resetTypingStopTimer();
      } else {
        // Input cleared — stop typing
        if (hasSignaledTypingRef.current) {
          hasSignaledTypingRef.current = false;
          if (typingStopTimerRef.current) {
            clearTimeout(typingStopTimerRef.current);
            typingStopTimerRef.current = null;
          }
          void setTyping(false);
        }
      }
    },
    [rateLimitWarning, setTyping, resetTypingStopTimer]
  );

  const handleSend = useCallback(async () => {
    const trimmed = text;
    if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) return;

    // Check rate limit before sending
    if (!canSend()) {
      setRateLimitWarning(true);
      return;
    }

    // Clear typing state on send
    if (typingStopTimerRef.current) {
      clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    if (hasSignaledTypingRef.current) {
      hasSignaledTypingRef.current = false;
      void setTyping(false);
    }

    // Send message
    await sendMessage(trimmed);
    setText('');
    setRateLimitWarning(false);
  }, [text, sendMessage, setTyping]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isSendDisabled) {
          void handleSend();
        }
      }
    },
    [isSendDisabled, handleSend]
  );

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!isSendDisabled) {
        void handleSend();
      }
    },
    [isSendDisabled, handleSend]
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-1 border-t border-gray-700 bg-gray-800 p-3"
    >
      {/* Rate limit warning */}
      {rateLimitWarning && (
        <p className="text-xs text-amber-400" role="alert">
          {t('chat.rateLimit.warning')}
        </p>
      )}

      <div className="flex items-end gap-2">
        {/* Text input */}
        <textarea
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.input.placeholder')}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label={t('chat.input.placeholder')}
        />

        {/* Send button */}
        <button
          type="submit"
          disabled={isSendDisabled}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t('chat.input.send')}
        >
          {t('chat.input.send')}
        </button>
      </div>

      {/* Character counter */}
      <div className="flex justify-end">
        <span
          className={`text-xs ${isOverLimit ? 'text-red-400' : 'text-gray-400'}`}
          aria-live="polite"
        >
          {t('chat.input.charCount', { count: charCount })}
        </span>
      </div>
    </form>
  );
}
