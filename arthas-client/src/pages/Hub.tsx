/**
 * @file Hub page — public room directory for browsing and joining rooms.
 *
 * Displays a responsive grid of public room cards with search/filter controls.
 * Polls the Hub API every 30s for fresh data. Supports "Load more" pagination.
 *
 * @module pages/Hub
 */

import { useEffect, useCallback } from 'react';
import { useHubStore } from '../hub/hubStore';
import { useChatStore } from '../stores/chatStore';
import { usePageStore } from '../stores/pageStore';
import { useTranslation } from '../i18n';
import { HubRoomCard } from '../components/HubRoomCard';
import { HubFilters } from '../components/HubFilters';
import { DailyTopicCard } from '../components/DailyTopicCard';

export function Hub() {
  const { t } = useTranslation();
  const rooms = useHubStore((s) => s.rooms);
  const dailyTopic = useHubStore((s) => s.dailyTopic);
  const total = useHubStore((s) => s.total);
  const loading = useHubStore((s) => s.loading);
  const loadingMore = useHubStore((s) => s.loadingMore);
  const error = useHubStore((s) => s.error);
  const hasMore = useHubStore((s) => s.hasMore);
  const setPage = usePageStore((s) => s.setPage);
  const joinRoom = useChatStore((s) => s.joinRoom);

  // Polling lifecycle: start on mount, stop on unmount.
  useEffect(() => {
    useHubStore.getState().startPolling();
    return () => useHubStore.getState().stopPolling();
  }, []);

  const handleRetry = () => {
    useHubStore.getState().retry();
  };

  const handleLoadMore = () => {
    useHubStore.getState().loadMore();
  };

  /** Join a daily topic room using the stored Hub nickname. */
  const handleJoinDailyTopic = useCallback((shareCode: string) => {
    const nickname = localStorage.getItem('arthas_hub_nickname')?.trim() ?? '';
    if (!nickname) {
      // If no nickname yet, scroll to first room card where user can set one,
      // or fall through — joinRoom validates and shows error if name is empty.
    }
    joinRoom(shareCode, nickname);
  }, [joinRoom]);

  return (
    <div className="min-h-screen bg-gray-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden="true">🌐</span>
            <h1 className="text-xl md:text-2xl font-bold text-white">{t('hub.title')}</h1>
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
