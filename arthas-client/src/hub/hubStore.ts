/**
 * Hub state management using Zustand.
 * Manages public room directory listing with polling, search, and pagination.
 * Daily topic is fetched independently (without filters) so search/tags don't hide it.
 */

import { create } from 'zustand';
import type { RoomListing, HubFilters } from './types';
import { fetchHubRooms } from './hubApi';

/** Default page size for Hub listing. */
const PAGE_SIZE = 50;

/** Daily topic refresh interval: 5 minutes. */
const DAILY_TOPIC_INTERVAL = 300_000;

/** Rooms polling interval: 30 seconds. */
const ROOMS_POLL_INTERVAL = 30_000;

interface HubState {
  rooms: RoomListing[];
  dailyTopic: RoomListing | null;
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  filters: HubFilters;
  hasMore: boolean;

  // Actions
  fetchRooms: () => Promise<void>;
  fetchDailyTopic: () => Promise<void>;
  loadMore: () => Promise<void>;
  retry: () => void;
  setTagFilter: (tag: string) => void;
  setSearchQuery: (query: string) => void;
  startPolling: () => void;
  stopPolling: () => void;
}

// Module-level timer state (avoids store bloat with non-serializable values)
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let dailyTopicInterval: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useHubStore = create<HubState>((set, get) => ({
  rooms: [],
  dailyTopic: null,
  total: 0,
  loading: false,
  loadingMore: false,
  error: null,
  filters: { tag: '', query: '' },
  hasMore: false,

  fetchDailyTopic: async () => {
    try {
      const response = await fetchHubRooms({
        filters: { tag: '', query: '' },
        limit: PAGE_SIZE,
        offset: 0,
      });
      const allRooms = response.rooms ?? [];
      const daily = allRooms.find((r) => r.isDailyTopic) ?? null;
      set({ dailyTopic: daily });
    } catch {
      // Daily topic fetch failure is non-critical; keep existing value
    }
  },

  fetchRooms: async () => {
    set({ loading: true, error: null });
    try {
      const response = await fetchHubRooms({
        filters: get().filters,
        limit: PAGE_SIZE,
        offset: 0,
      });
      const allRooms = response.rooms ?? [];
      const rooms = allRooms.filter((r) => !r.isDailyTopic);
      const dailyTopicCount = allRooms.length - rooms.length;
      const adjustedTotal = response.total - dailyTopicCount;
      set({
        rooms,
        total: adjustedTotal,
        loading: false,
        hasMore: rooms.length < adjustedTotal,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch rooms',
        loading: false,
      });
    }
  },

  loadMore: async () => {
    const { rooms, loadingMore, filters } = get();
    if (loadingMore) return;

    set({ loadingMore: true });
    try {
      const response = await fetchHubRooms({
        filters,
        limit: PAGE_SIZE,
        offset: rooms.length,
      });
      const allNewRooms = response.rooms ?? [];
      const newRooms = allNewRooms.filter((r) => !r.isDailyTopic);
      const dailyTopicCount = allNewRooms.length - newRooms.length;
      const adjustedTotal = response.total - dailyTopicCount;
      set({
        rooms: [...rooms, ...newRooms],
        total: adjustedTotal,
        loadingMore: false,
        hasMore: rooms.length + newRooms.length < adjustedTotal,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load more rooms',
        loadingMore: false,
      });
    }
  },

  retry: () => {
    get().fetchDailyTopic();
    get().fetchRooms();
  },

  setTagFilter: (tag: string) => {
    set({ filters: { ...get().filters, tag } });
    get().fetchRooms();
  },

  setSearchQuery: (query: string) => {
    set({ filters: { ...get().filters, query } });
    // Debounce search (300ms)
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      get().fetchRooms();
    }, 300);
  },

  startPolling: () => {
    // 初始加载：合并为单次请求，同时获取 dailyTopic 和 rooms
    // 后续轮询分离（rooms 30s，dailyTopic 5min）
    const initLoad = async () => {
      try {
        const response = await fetchHubRooms({
          filters: { tag: '', query: '' },
          limit: PAGE_SIZE,
          offset: 0,
        });
        const allRooms = response.rooms ?? [];
        const daily = allRooms.find((r) => r.isDailyTopic) ?? null;
        const rooms = allRooms.filter((r) => !r.isDailyTopic);
        const adjustedTotal = response.total - (daily ? 1 : 0);
        set({
          dailyTopic: daily,
          rooms,
          total: adjustedTotal,
          loading: false,
          hasMore: rooms.length < adjustedTotal,
        });
      } catch (err) {
        set({
          error: err instanceof Error ? err.message : 'Failed to fetch rooms',
          loading: false,
        });
      }
    };

    set({ loading: true, error: null });
    initLoad();

    // Poll rooms every 30 seconds (with user filters applied)
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(() => {
      get().fetchRooms();
    }, ROOMS_POLL_INTERVAL);

    // Refresh daily topic every 5 minutes (detect expiry / new topic)
    if (dailyTopicInterval) clearInterval(dailyTopicInterval);
    dailyTopicInterval = setInterval(() => {
      const dt = get().dailyTopic;
      if (dt && dt.expiresAt < Date.now() / 1000) {
        set({ dailyTopic: null });
      }
      get().fetchDailyTopic();
    }, DAILY_TOPIC_INTERVAL);
  },

  stopPolling: () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    if (dailyTopicInterval) {
      clearInterval(dailyTopicInterval);
      dailyTopicInterval = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  },
}));
