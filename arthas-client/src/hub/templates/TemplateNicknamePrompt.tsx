/**
 * @file TemplateNicknamePrompt — Nickname (+ optional password) prompt shown after template selection.
 *
 * Displays the selected template context (emoji + name), a nickname input with
 * localStorage persistence, and an optional password field when the template
 * recommends one. Handles validation, Enter-key submission, loading state, and errors.
 *
 * @module hub/templates/TemplateNicknamePrompt
 * @see templateConfig.ts — TemplateConfig interface
 * @see pages/Hub.tsx — Daily topic nickname prompt (similar pattern)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from '../../i18n';
import type { TemplateConfig } from './templateConfig';

const NICKNAME_STORAGE_KEY = 'arthas_hub_nickname';
const NICKNAME_MAX_LENGTH = 20;

/** Safe localStorage read — returns fallback on failure (e.g. Safari private mode). */
function safeGetItem(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** Safe localStorage write — silently fails on error. */
function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota exceeded) — graceful degradation
  }
}

interface TemplateNicknamePromptProps {
  template: TemplateConfig;
  isCreating: boolean;
  createError: string | null;
  onConfirm: (nickname: string, password?: string) => void;
  onCancel: () => void;
}

export function TemplateNicknamePrompt({
  template,
  isCreating,
  createError,
  onConfirm,
  onCancel,
}: TemplateNicknamePromptProps) {
  const { t } = useTranslation();

  const [nickname, setNickname] = useState(
    () => safeGetItem(NICKNAME_STORAGE_KEY)
  );
  const [password, setPassword] = useState('');
  const nicknameInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus nickname input on mount
  useEffect(() => {
    nicknameInputRef.current?.focus();
  }, []);

  const nicknameValid = nickname.trim().length >= 1 && nickname.trim().length <= NICKNAME_MAX_LENGTH;
  const canSubmit = nicknameValid && !isCreating;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const trimmedNickname = nickname.trim();
    safeSetItem(NICKNAME_STORAGE_KEY, trimmedNickname);
    onConfirm(
      trimmedNickname,
      template.passwordRecommended && password ? password : undefined
    );
  }, [canSubmit, nickname, password, template.passwordRecommended, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="p-4 bg-gray-800 rounded-lg border border-gray-700 space-y-3">
      {/* Template context header */}
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden="true">
          {template.emoji}
        </span>
        <span className="text-white font-medium text-sm">
          {t(template.nameKey)}
        </span>
      </div>

      {/* Nickname input */}
      <div>
        <input
          ref={nicknameInputRef}
          type="text"
          maxLength={NICKNAME_MAX_LENGTH}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('home.nickname.placeholder')}
          aria-label={t('home.nickname')}
          className="w-full px-3 py-2 bg-gray-700 text-white text-sm rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors"
        />
      </div>

      {/* Password input (conditional) */}
      {template.passwordRecommended && (
        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('hub.templates.badge.password')}
            aria-label={t('hub.templates.badge.password')}
            className="w-full px-3 py-2 bg-gray-700 text-white text-sm rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors"
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all flex items-center gap-2"
        >
          {isCreating && (
            <svg
              className="animate-spin h-4 w-4 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {t('hub.templates.createButton')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          {t('hub.templates.cancel')}
        </button>
      </div>

      {/* Error display */}
      {createError && (
        <p className="text-sm text-red-400" role="alert">
          {createError}
        </p>
      )}
    </div>
  );
}
