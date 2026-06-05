/**
 * Hub store integration tests.
 *
 * Tests: polling lifecycle, filter actions, debounce, error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useHubStore } from './hubStore';
import * as hubApi from './hubApi';

vi.mock('./hubApi');

const mockFetchHubRooms = vi.mocked(hubApi.fetchHubRooms);

const MOCK_ROOMS = [
  {
    roomId: 'room-1',
    shareCode: 'room-1:key123:0:0',
    title: 'Golang AMA',
    description: 'Ask me anything about Go',
    tags: ['golang', 'ama'],
    memberCount: 5,
    hasPassword: false,
    createdAt: Math.floor(Date.now() / 1000) - 120,
    expiresAt: 0,
  },
  {
    roomId: 'room-2',
    shareCode: 'room-2:key456:0:1700003600',
    title: 'React Q&A',
    description: 'Help with React',
    tags: ['react'],
    memberCount: 3,
    hasPassword: true,
    createdAt: Math.floor(Date.now() / 1000) - 600,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  },
];

describe('hubStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset store
    useHubStore.setState({
      rooms: [],
      total: 0,
      loading: false,
      loadingMore: false,
      error: null,
      filters: { tag: '', query: '' },
      hasMore: false,
    });
  });

  afterEach(() => {
    useHubStore.getState().stopPolling();
    vi.useRealTimers();
  });

  describe('fetchRooms', () => {
    it('fetches rooms and updates state on success', async () => {
      mockFetchHubRooms.mockResolvedValueOnce({
        rooms: MOCK_ROOMS,
        total: 2,
        limit: 50,
        offset: 0,
      });

      await useHubStore.getState().fetchRooms();

      const state = useHubStore.getState();
      expect(state.rooms).toHaveLength(2);
      expect(state.total).toBe(2);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sets error on fetch failure', async () => {
      mockFetchHubRooms.mockRejectedValueOnce(new Error('Hub API error: 500'));

      await useHubStore.getState().fetchRooms();

      const state = useHubStore.getState();
      expect(state.rooms).toHaveLength(0);
      expect(state.error).toBe('Hub API error: 500');
      expect(state.loading).toBe(false);
    });

    it('sets loading to true during fetch', async () => {
      let resolvePromise: (value: unknown) => void;
      const pending = new Promise((resolve) => { resolvePromise = resolve; });
      mockFetchHubRooms.mockReturnValueOnce(pending as never);

      const fetchPromise = useHubStore.getState().fetchRooms();
      expect(useHubStore.getState().loading).toBe(true);

      resolvePromise!({ rooms: [], total: 0, limit: 50, offset: 0 });
      await fetchPromise;

      expect(useHubStore.getState().loading).toBe(false);
    });

    it('handles null rooms from API (Go empty slice serialization)', async () => {
      mockFetchHubRooms.mockResolvedValueOnce({
        rooms: null as unknown as typeof MOCK_ROOMS,
        total: 0,
        limit: 50,
        offset: 0,
      });

      await useHubStore.getState().fetchRooms();

      const state = useHubStore.getState();
      expect(state.rooms).toEqual([]);
      expect(state.total).toBe(0);
      expect(state.hasMore).toBe(false);
      expect(state.loading).toBe(false);
    });
  });

  describe('setTagFilter', () => {
    it('updates tag filter and triggers fetch', async () => {
      mockFetchHubRooms.mockResolvedValue({ rooms: [], total: 0, limit: 50, offset: 0 });

      useHubStore.getState().setTagFilter('golang');

      expect(useHubStore.getState().filters.tag).toBe('golang');
      // fetchRooms was called
      expect(mockFetchHubRooms).toHaveBeenCalledWith({ filters: { tag: 'golang', query: '' }, limit: 50, offset: 0 });
    });
  });

  describe('setSearchQuery', () => {
    it('debounces search query (300ms)', async () => {
      mockFetchHubRooms.mockResolvedValue({ rooms: [], total: 0, limit: 50, offset: 0 });

      useHubStore.getState().setSearchQuery('react');

      // Should NOT fetch immediately
      expect(mockFetchHubRooms).not.toHaveBeenCalled();

      // Advance time by 300ms
      vi.advanceTimersByTime(300);

      expect(mockFetchHubRooms).toHaveBeenCalledWith({ filters: { tag: '', query: 'react' }, limit: 50, offset: 0 });
    });

    it('cancels previous debounce on rapid input', () => {
      mockFetchHubRooms.mockResolvedValue({ rooms: [], total: 0, limit: 50, offset: 0 });

      useHubStore.getState().setSearchQuery('r');
      vi.advanceTimersByTime(100);
      useHubStore.getState().setSearchQuery('re');
      vi.advanceTimersByTime(100);
      useHubStore.getState().setSearchQuery('rea');
      vi.advanceTimersByTime(300);

      // Only the final value should trigger a fetch
      expect(mockFetchHubRooms).toHaveBeenCalledTimes(1);
      expect(mockFetchHubRooms).toHaveBeenCalledWith({ filters: { tag: '', query: 'rea' }, limit: 50, offset: 0 });
    });
  });

  describe('polling lifecycle', () => {
    it('startPolling fetches immediately and then every 30s', async () => {
      mockFetchHubRooms.mockResolvedValue({ rooms: [], total: 0, limit: 50, offset: 0 });

      useHubStore.getState().startPolling();

      // Immediate fetch
      expect(mockFetchHubRooms).toHaveBeenCalledTimes(1);

      // Advance 30s
      vi.advanceTimersByTime(30_000);
      expect(mockFetchHubRooms).toHaveBeenCalledTimes(2);

      // Another 30s
      vi.advanceTimersByTime(30_000);
      expect(mockFetchHubRooms).toHaveBeenCalledTimes(3);
    });

    it('stopPolling clears interval', () => {
      mockFetchHubRooms.mockResolvedValue({ rooms: [], total: 0, limit: 50, offset: 0 });

      useHubStore.getState().startPolling();
      expect(mockFetchHubRooms).toHaveBeenCalledTimes(1);

      useHubStore.getState().stopPolling();

      vi.advanceTimersByTime(60_000);
      // No additional calls after stop
      expect(mockFetchHubRooms).toHaveBeenCalledTimes(1);
    });
  });

  describe('pagination (loadMore)', () => {
    it('sets hasMore=true when rooms.length < total', async () => {
      mockFetchHubRooms.mockResolvedValueOnce({
        rooms: MOCK_ROOMS,
        total: 100,
        limit: 50,
        offset: 0,
      });

      await useHubStore.getState().fetchRooms();

      expect(useHubStore.getState().hasMore).toBe(true);
    });

    it('sets hasMore=false when all rooms loaded', async () => {
      mockFetchHubRooms.mockResolvedValueOnce({
        rooms: MOCK_ROOMS,
        total: 2,
        limit: 50,
        offset: 0,
      });

      await useHubStore.getState().fetchRooms();

      expect(useHubStore.getState().hasMore).toBe(false);
    });

    it('loadMore appends rooms and updates hasMore', async () => {
      // Initial load
      mockFetchHubRooms.mockResolvedValueOnce({
        rooms: MOCK_ROOMS,
        total: 4,
        limit: 50,
        offset: 0,
      });
      await useHubStore.getState().fetchRooms();
      expect(useHubStore.getState().rooms).toHaveLength(2);
      expect(useHubStore.getState().hasMore).toBe(true);

      // Load more
      const moreRooms = [
        { ...MOCK_ROOMS[0], roomId: 'room-3', title: 'Room 3' },
        { ...MOCK_ROOMS[1], roomId: 'room-4', title: 'Room 4' },
      ];
      mockFetchHubRooms.mockResolvedValueOnce({
        rooms: moreRooms,
        total: 4,
        limit: 50,
        offset: 2,
      });
      await useHubStore.getState().loadMore();

      expect(useHubStore.getState().rooms).toHaveLength(4);
      expect(useHubStore.getState().hasMore).toBe(false);
    });

    it('loadMore passes correct offset', async () => {
      // Set initial rooms
      useHubStore.setState({ rooms: MOCK_ROOMS, total: 100, hasMore: true });
      mockFetchHubRooms.mockResolvedValueOnce({
        rooms: [],
        total: 100,
        limit: 50,
        offset: 2,
      });

      await useHubStore.getState().loadMore();

      expect(mockFetchHubRooms).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 2 })
      );
    });

    it('loadMore does not fire when already loading more', async () => {
      useHubStore.setState({ loadingMore: true, rooms: MOCK_ROOMS, hasMore: true });

      await useHubStore.getState().loadMore();

      expect(mockFetchHubRooms).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it('retry calls fetchRooms', async () => {
      mockFetchHubRooms.mockResolvedValue({ rooms: [], total: 0, limit: 50, offset: 0 });

      useHubStore.getState().retry();

      expect(mockFetchHubRooms).toHaveBeenCalledTimes(1);
    });
  });
});
