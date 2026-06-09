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

/** Sort mode for Hub room listing. */
export type SortMode = 'active' | 'people' | 'newest' | '';

interface HubState {
  rooms: RoomListing[];
  dailyTopic: RoomListing | null;
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  filters: HubFilters;
  hasMore: boolean;
  sortMode: SortMode;
  totalOnline: number;

  // Actions
  fetchRooms: () => Promise<void>;
  fetchDailyTopic: () => Promise<void>;
  loadMore: () => Promise<void>;
  retry: () => void;
  setTagFilter: (tag: string) => void;
  setSearchQuery: (query: string) => void;
  setSortMode: (mode: SortMode) => void;
  startPolling: () => void;
  stopPolling: () => void;
}

// Module-level timer state (avoids store bloat with non-serializable values)
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let dailyTopicInterval: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let fetchController: AbortController | null = null;

/**
 * Cancels any in-flight room listing fetch and returns a fresh AbortSignal.
 * Used by all "replace" operations (fetchRooms, setSortMode, startPolling initLoad).
 * Also cancels in-flight loadMore requests to prevent stale data appending.
 */
function newFetchSignal(): AbortSignal {
  if (fetchController) fetchController.abort();
  fetchController = new AbortController();
  return fetchController.signal;
}

/** Returns true if the error is an abort (should be silently ignored). */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export const useHubStore = create<HubState>((set, get) => ({
  rooms: [],
  dailyTopic: null,
  total: 0,
  loading: false,
  loadingMore: false,
  error: null,
  filters: { tag: '', query: '' },
  hasMore: false,
  sortMode: '',
  totalOnline: 0,

  fetchDailyTopic: async () => {
    try {
      // Use server-side isDailyTopic filter — only returns the daily topic room (if any)
      const response = await fetchHubRooms({
        filters: { tag: '', query: '' },
        limit: 1,
        offset: 0,
        isDailyTopic: true,
      });
      const rooms = response.rooms ?? [];
      const daily = rooms.length > 0 ? rooms[0] : null;
      set({ dailyTopic: daily });
    } catch {
      // Daily topic fetch failure is non-critical; keep existing value
    }
  },

  fetchRooms: async () => {
    const signal = newFetchSignal();
    set({ loading: true, error: null });
    try {
      const response = await fetchHubRooms({
        filters: get().filters,
        limit: PAGE_SIZE,
        offset: 0,
        isDailyTopic: false,
        sort: get().sortMode,
        signal,
      });
      if (signal.aborted) return;
      const rooms = response.rooms ?? [];
      set({
        rooms,
        total: response.total,
        totalOnline: response.totalOnline ?? 0,
        loading: false,
        hasMore: rooms.length < response.total,
      });
    } catch (err) {
      if (isAbortError(err)) return;
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch rooms',
        loading: false,
      });
    }
  },

  loadMore: async () => {
    const { rooms, loadingMore, filters, sortMode } = get();
    if (loadingMore) return;

    // Use the current fetchController signal — if a replace operation fires
    // (fetchRooms/setSortMode) while loadMore is in flight, this request is cancelled.
    const signal = fetchController?.signal;

    set({ loadingMore: true });
    try {
      const response = await fetchHubRooms({
        filters,
        limit: PAGE_SIZE,
        offset: rooms.length,
        isDailyTopic: false,
        sort: sortMode,
        signal,
      });
      if (signal?.aborted) return;
      const newRooms = response.rooms ?? [];
      set({
        rooms: [...rooms, ...newRooms],
        total: response.total,
        totalOnline: response.totalOnline ?? 0,
        loadingMore: false,
        hasMore: rooms.length + newRooms.length < response.total,
      });
    } catch (err) {
      if (isAbortError(err)) {
        set({ loadingMore: false });
        return;
      }
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

  setSortMode: (mode: SortMode) => {
    set({ sortMode: mode });
    // Re-fetch without showing loading spinner — keep current rooms visible
    // while the server responds with the new sort order.
    const signal = newFetchSignal();

    (async () => {
      try {
        const response = await fetchHubRooms({
          filters: get().filters,
          limit: PAGE_SIZE,
          offset: 0,
          isDailyTopic: false,
          sort: mode,
          signal,
        });
        if (signal.aborted) return;
        const rooms = response.rooms ?? [];
        set({
          rooms,
          total: response.total,
          totalOnline: response.totalOnline ?? 0,
          hasMore: rooms.length < response.total,
        });
      } catch (err) {
        if (isAbortError(err)) return;
        set({
          error: err instanceof Error ? err.message : 'Failed to fetch rooms',
        });
      }
    })();
  },

  startPolling: () => {
    const signal = newFetchSignal();

    const initLoad = async () => {
      try {
        // Parallel fetch: dailyTopic (limit=1) and rooms (isDailyTopic=false)
        const [dailyRes, roomsRes] = await Promise.all([
          fetchHubRooms({ filters: { tag: '', query: '' }, limit: 1, offset: 0, isDailyTopic: true, signal }),
          fetchHubRooms({ filters: { tag: '', query: '' }, limit: PAGE_SIZE, offset: 0, isDailyTopic: false, sort: get().sortMode, signal }),
        ]);

        if (signal.aborted) return;

        const dailyRooms = dailyRes.rooms ?? [];
        const daily = dailyRooms.length > 0 ? dailyRooms[0] : null;
        const rooms = roomsRes.rooms ?? [];

        set({
          dailyTopic: daily,
          rooms,
          total: roomsRes.total,
          totalOnline: roomsRes.totalOnline ?? 0,
          loading: false,
          hasMore: rooms.length < roomsRes.total,
        });
      } catch (err) {
        if (isAbortError(err)) return;
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
    if (fetchController) {
      fetchController.abort();
      fetchController = null;
    }
  },
}));
