/**
 * Hub state management using Zustand.
 * Manages public room directory listing with polling, search, and pagination.
 */

import { create } from 'zustand';
import type { RoomListing, HubFilters } from './types';
import { fetchHubRooms } from './hubApi';

/** Default page size for Hub listing. */
const PAGE_SIZE = 50;

interface HubState {
  rooms: RoomListing[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  filters: HubFilters;
  hasMore: boolean;

  // Actions
  fetchRooms: () => Promise<void>;
  loadMore: () => Promise<void>;
  retry: () => void;
  setTagFilter: (tag: string) => void;
  setSearchQuery: (query: string) => void;
  startPolling: () => void;
  stopPolling: () => void;
}

// Module-level timer state (avoids store bloat with non-serializable values)
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useHubStore = create<HubState>((set, get) => ({
  rooms: [],
  total: 0,
  loading: false,
  loadingMore: false,
  error: null,
  filters: { tag: '', query: '' },
  hasMore: false,

  fetchRooms: async () => {
    set({ loading: true, error: null });
    try {
      const response = await fetchHubRooms({
        filters: get().filters,
        limit: PAGE_SIZE,
        offset: 0,
      });
      const rooms = response.rooms ?? [];
      set({
        rooms,
        total: response.total,
        loading: false,
        hasMore: rooms.length < response.total,
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
      const newRooms = response.rooms ?? [];
      set({
        rooms: [...rooms, ...newRooms],
        total: response.total,
        loadingMore: false,
        hasMore: rooms.length + newRooms.length < response.total,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load more rooms',
        loadingMore: false,
      });
    }
  },

  retry: () => {
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
    // Fetch immediately on mount
    get().fetchRooms();
    // Then poll every 30 seconds
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(() => {
      get().fetchRooms();
    }, 30_000);
  },

  stopPolling: () => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  },
}));
