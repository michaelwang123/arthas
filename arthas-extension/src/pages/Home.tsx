/**
 * Home page — entry point for creating/joining rooms.
 *
 * Features:
 * - Nickname input with 1–20 character validation
 * - "Create Room" button
 * - Share code input + "Join Room" button
 * - Settings gear icon navigation
 * - "Session active" indicator with resume/discard when session exists
 * - Prompt to configure server URL if not set
 *
 * Requirements: 8.2, 11.5, 13.7
 */

import { useState, useEffect, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useTranslation } from '../i18n';
import { loadSettings } from '../utils/storage';

interface HomeProps {
  onNavigateSettings: () => void;
}

export function Home({ onNavigateSettings }: HomeProps): React.ReactElement {
  const { t } = useTranslation();

  // Subscribe to chatStore
  const hasActiveSession = useChatStore((s) => s.hasActiveSession);
  const sessionError = useChatStore((s) => s.sessionError);
  const initialize = useChatStore((s) => s.initialize);
  const createRoom = useChatStore((s) => s.createRoom);
  const joinRoom = useChatStore((s) => s.joinRoom);
  const leaveRoom = useChatStore((s) => s.leaveRoom);

  // Local form state
  const [nickname, setNickname] = useState('');
  const [shareCode, setShareCode] = useState('');
  const [nicknameError, setNicknameError] = useState(false);
  const [serverConfigured, setServerConfigured] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Check if server URL is configured on mount
  useEffect(() => {
    void (async () => {
      const settings = await loadSettings();
      setServerConfigured(settings.serverUrl.length > 0);
    })();
  }, []);

  // Validate nickname: 1–20 chars after trimming
  const isNicknameValid = useCallback((value: string): boolean => {
    const trimmed = value.trim();
    return trimmed.length >= 1 && trimmed.length <= 20;
  }, []);

  // Handle Create Room
  const handleCreateRoom = useCallback(async () => {
    if (!isNicknameValid(nickname)) {
      setNicknameError(true);
      return;
    }
    setNicknameError(false);
    setIsLoading(true);
    try {
      await createRoom(nickname.trim());
    } finally {
      setIsLoading(false);
    }
  }, [nickname, isNicknameValid, createRoom]);

  // Handle Join Room
  const handleJoinRoom = useCallback(async () => {
    if (!isNicknameValid(nickname)) {
      setNicknameError(true);
      return;
    }
    setNicknameError(false);
    setIsLoading(true);
    try {
      await joinRoom(shareCode.trim(), nickname.trim());
    } finally {
      setIsLoading(false);
    }
  }, [nickname, shareCode, isNicknameValid, joinRoom]);

  // Handle Resume session
  const handleResume = useCallback(async () => {
    setIsLoading(true);
    try {
      await initialize();
    } finally {
      setIsLoading(false);
    }
  }, [initialize]);

  // Handle Discard session
  const handleDiscard = useCallback(async () => {
    await leaveRoom();
  }, [leaveRoom]);

  // Handle nickname input change
  const handleNicknameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setNickname(e.target.value);
    if (nicknameError) {
      setNicknameError(false);
    }
  }, [nicknameError]);

  // Handle share code input change
  const handleShareCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setShareCode(e.target.value);
  }, []);

  const canCreate = isNicknameValid(nickname) && serverConfigured && !isLoading;
  const canJoin = isNicknameValid(nickname) && shareCode.trim().length > 0 && serverConfigured && !isLoading;

  return (
    <div className="flex-1 flex flex-col p-6">
      {/* Header with title and settings gear */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-purple-400">{t('app.title')}</h1>
          <p className="text-sm text-gray-400">{t('home.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={onNavigateSettings}
          className="p-2 rounded-lg hover:bg-gray-800 transition-colors text-gray-400 hover:text-gray-200"
          aria-label="Settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>

      {/* Server not configured warning */}
      {!serverConfigured && (
        <div className="mb-4 p-3 rounded-lg bg-yellow-900/30 border border-yellow-700 text-yellow-300 text-sm">
          {t('home.server.notConfigured')}
        </div>
      )}

      {/* Session error message */}
      {sessionError && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-300 text-sm">
          {t(sessionError as Parameters<typeof t>[0])}
        </div>
      )}

      {/* Session active indicator */}
      {hasActiveSession && (
        <div className="mb-4 p-3 rounded-lg bg-indigo-900/30 border border-indigo-700">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm text-indigo-200 font-medium">
              {t('home.session.active')}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleResume}
              disabled={isLoading}
              className="flex-1 px-3 py-1.5 text-sm rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('home.session.resume')}
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={isLoading}
              className="flex-1 px-3 py-1.5 text-sm rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('home.session.discard')}
            </button>
          </div>
        </div>
      )}

      {/* Nickname input */}
      <div className="mb-4">
        <label htmlFor="nickname-input" className="block text-sm font-medium text-gray-300 mb-1">
          {t('home.nickname')}
        </label>
        <input
          id="nickname-input"
          type="text"
          value={nickname}
          onChange={handleNicknameChange}
          placeholder={t('home.nickname.placeholder')}
          maxLength={20}
          className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        />
        {nicknameError && (
          <p className="mt-1 text-xs text-red-400">{t('home.nickname.error')}</p>
        )}
      </div>

      {/* Create Room button */}
      <button
        type="button"
        onClick={handleCreateRoom}
        disabled={!canCreate}
        className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-4"
      >
        {t('home.create')}
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-gray-700" />
        <span className="text-sm text-gray-500">{t('home.divider')}</span>
        <div className="flex-1 h-px bg-gray-700" />
      </div>

      {/* Join Room section */}
      <div className="mb-4">
        <label htmlFor="sharecode-input" className="block text-sm font-medium text-gray-300 mb-1">
          {t('home.join.label')}
        </label>
        <div className="flex gap-2">
          <input
            id="sharecode-input"
            type="text"
            value={shareCode}
            onChange={handleShareCodeChange}
            placeholder={t('home.join.placeholder')}
            className="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={handleJoinRoom}
            disabled={!canJoin}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('home.join.button')}
          </button>
        </div>
      </div>
    </div>
  );
}
