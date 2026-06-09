/**
 * @file Hub page — public room directory for browsing and joining rooms.
 *
 * Displays a responsive grid of public room cards with search/filter controls.
 * Polls the Hub API every 30s for fresh data. Supports "Load more" pagination.
 *
 * @module pages/Hub
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { useHubStore } from '../hub/hubStore';
import { useChatStore } from '../stores/chatStore';
import { usePageStore } from '../stores/pageStore';
import { useTranslation } from '../i18n';
import { HubRoomCard } from '../components/HubRoomCard';
import { HubFilters } from '../components/HubFilters';
import { DailyTopicCard } from '../components/DailyTopicCard';
import { TemplateGrid } from '../hub/templates/TemplateGrid';
import { MatchEntry } from '../match/MatchEntry';
import { useMatchStore } from '../match/matchStore';
import type { TemplateConfig } from '../hub/templates/templateConfig';

export function Hub() {
  const { t } = useTranslation();
  const rooms = useHubStore((s) => s.rooms);
  const dailyTopic = useHubStore((s) => s.dailyTopic);
  const total = useHubStore((s) => s.total);
  const totalOnline = useHubStore((s) => s.totalOnline);
  const loading = useHubStore((s) => s.loading);
  const loadingMore = useHubStore((s) => s.loadingMore);
  const error = useHubStore((s) => s.error);
  const hasMore = useHubStore((s) => s.hasMore);
  const setPage = usePageStore((s) => s.setPage);
  const joinRoom = useChatStore((s) => s.joinRoom);
  const createRoom = useChatStore((s) => s.createRoom);
  const roomId = useChatStore((s) => s.roomId);
  const messages = useChatStore((s) => s.messages);

  // Daily topic nickname prompt state
  const [showDailyNicknamePrompt, setShowDailyNicknamePrompt] = useState(false);
  const [dailyNickname, setDailyNickname] = useState(() => {
    try { return localStorage.getItem('arthas_hub_nickname') ?? ''; }
    catch { return ''; }
  });
  const [pendingDailyShareCode, setPendingDailyShareCode] = useState<string | null>(null);

  // Template creation state
  const [isCreating, setIsCreating] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const creationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creationStartRef = useRef<number>(0);

  // Polling lifecycle: start on mount, stop on unmount.
  useEffect(() => {
    useHubStore.getState().startPolling();
    return () => useHubStore.getState().stopPolling();
  }, []);

  // Cleanup creation timeout on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => {
      if (creationTimeoutRef.current) clearTimeout(creationTimeoutRef.current);
    };
  }, []);

  // Navigate to chat when room is created (success path)
  // App.tsx auto-renders ChatRoom when roomId is non-null;
  // this effect cleans up creation state when that transition happens.
  useEffect(() => {
    if (roomId && isCreating) {
      setIsCreating(false);
      setTemplateError(null);
      if (creationTimeoutRef.current) clearTimeout(creationTimeoutRef.current);
    }
  }, [roomId, isCreating]);

  // Detect error from chatStore system messages (failure path)
  // Only detect messages created after our creation request started
  useEffect(() => {
    if (!isCreating) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.isSystem && lastMsg.timestamp > creationStartRef.current) {
      setTemplateError(lastMsg.text);
      setIsCreating(false);
      if (creationTimeoutRef.current) clearTimeout(creationTimeoutRef.current);
    }
  }, [messages, isCreating]);

  const handleRetry = () => {
    useHubStore.getState().retry();
  };

  const handleLoadMore = () => {
    useHubStore.getState().loadMore();
  };

  /** Join a daily topic room using the stored Hub nickname. */
  const handleJoinDailyTopic = useCallback((shareCode: string) => {
    // Always show nickname prompt so user can review/change before joining
    setPendingDailyShareCode(shareCode);
    setShowDailyNicknamePrompt(true);
  }, []);

  /** Confirm nickname and join daily topic room. */
  const handleConfirmDailyJoin = useCallback(() => {
    const name = dailyNickname.trim();
    if (!name || !pendingDailyShareCode) return;
    localStorage.setItem('arthas_hub_nickname', name);
    setShowDailyNicknamePrompt(false);
    setPendingDailyShareCode(null);
    joinRoom(pendingDailyShareCode, name);
  }, [dailyNickname, pendingDailyShareCode, joinRoom]);

  /** Create a room from a template with the given nickname and optional password. */
  const handleCreateFromTemplate = useCallback((
    template: TemplateConfig,
    nickname: string,
    password?: string
  ) => {
    setIsCreating(true);
    setTemplateError(null);
    creationStartRef.current = Date.now();

    // Timeout safety net: reset after 10s if no response
    creationTimeoutRef.current = setTimeout(() => {
      setIsCreating(false);
      setTemplateError(t('hub.templates.error.timeout'));
    }, 10_000);

    createRoom(
      nickname,
      password,
      template.ephemeralSeconds,
      template.expirySeconds,
      {
        title: t(template.nameKey),
        description: t(template.descriptionKey),
        tags: template.tags,
      }
    );
  }, [createRoom, t]);

  return (
    <div className="min-h-screen bg-gray-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">🌐</span>
            <h1 className="text-xl md:text-2xl font-bold text-white">{t('hub.title')}</h1>
            <span className="text-sm text-green-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" aria-hidden="true" />
              {t('hub.onlineCount', { count: totalOnline })}
            </span>
          </div>
          <button
            onClick={() => setPage('home')}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            ← {t('hub.backHome')}
          </button>
        </div>

        {/* Daily Topic — always above filters, not affected by search */}
        {dailyTopic && <DailyTopicCard room={dailyTopic} onJoin={handleJoinDailyTopic} />}

        {/* Random Match entry point */}
        <MatchEntry onStart={() => useMatchStore.getState().startMatch()} />

        {/* Inline nickname prompt for daily topic join (shown when user has no stored nickname) */}
        {showDailyNicknamePrompt && (
          <div className="flex items-center gap-2 p-3 bg-gray-800 rounded-lg border border-amber-700/50">
            <input
              type="text"
              maxLength={20}
              value={dailyNickname}
              onChange={(e) => setDailyNickname(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmDailyJoin(); }}
              placeholder={t('home.nickname.placeholder')}
              aria-label={t('home.nickname')}
              autoFocus
              className="flex-1 px-3 py-2 bg-gray-700 text-white text-sm rounded-lg border border-gray-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none placeholder-gray-500 transition-colors"
            />
            <button
              onClick={handleConfirmDailyJoin}
              disabled={!dailyNickname.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all"
            >
              {t('hub.dailyTopic.join')} →
            </button>
            <button
              onClick={() => { setShowDailyNicknamePrompt(false); setPendingDailyShareCode(null); }}
              className="px-2 py-2 text-gray-400 hover:text-white transition-colors"
              aria-label="Cancel"
            >
              ✕
            </button>
          </div>
        )}

        {/* Quick Create — Room Templates */}
        <TemplateGrid
          onCreateFromTemplate={handleCreateFromTemplate}
          isCreating={isCreating}
          createError={templateError}
        />

        {/* Filters */}
        <HubFilters />

        {/* Room count */}
        {!loading && !error && (
          <p className="text-sm text-gray-400">
            {t('hub.roomCount', { count: total })}
          </p>
        )}

        {/* Error state */}
        {error && (
          <div className="text-center py-12 space-y-3" role="alert">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={handleRetry}
              className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
            >
              {t('hub.retry')}
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && rooms.length === 0 && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            aria-busy="true"
            role="status"
            aria-label="Loading rooms"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-gray-800 rounded-xl p-5 animate-pulse space-y-3"
              >
                <div className="h-5 bg-gray-700 rounded w-3/4" />
                <div className="h-4 bg-gray-700 rounded w-full" />
                <div className="h-4 bg-gray-700 rounded w-1/2" />
                <div className="flex gap-2 mt-2">
                  <div className="h-5 bg-gray-700 rounded-full w-12" />
                  <div className="h-5 bg-gray-700 rounded-full w-16" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && rooms.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <div className="text-4xl" aria-hidden="true">📭</div>
            <p className="text-gray-400">{t('hub.empty')}</p>
            <button
              onClick={() => setPage('home')}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
            >
              {t('hub.createFirst')}
            </button>
          </div>
        )}

        {/* Room grid */}
        {rooms.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room) => (
              <HubRoomCard key={room.roomId} room={room} />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasMore && !loading && (
          <div className="text-center pt-4">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="px-6 py-2.5 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg border border-gray-700 transition-colors"
            >
              {loadingMore ? '...' : t('hub.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
