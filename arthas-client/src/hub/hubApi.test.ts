/**
 * Hub API client tests.
 *
 * Tests: URL construction, error handling, filter parameter encoding, pagination.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchHubRooms } from './hubApi';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('hubApi — fetchHubRooms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear VITE_WS_URL (same-origin mode)
    vi.stubEnv('VITE_WS_URL', '');
  });

  it('fetches from relative /api/hub path with no filters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rooms: [], total: 0, limit: 50, offset: 0 }),
    });

    await fetchHubRooms({ filters: { tag: '', query: '' } });

    expect(mockFetch).toHaveBeenCalledWith('/api/hub', expect.any(Object));
  });

  it('includes tag param when set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rooms: [], total: 0, limit: 50, offset: 0 }),
    });

    await fetchHubRooms({ filters: { tag: 'golang', query: '' } });

    expect(mockFetch).toHaveBeenCalledWith('/api/hub?tag=golang', expect.any(Object));
  });

  it('includes query param when set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rooms: [], total: 0, limit: 50, offset: 0 }),
    });

    await fetchHubRooms({ filters: { tag: '', query: 'react' } });

    expect(mockFetch).toHaveBeenCalledWith('/api/hub?q=react', expect.any(Object));
  });

  it('includes both params when both set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rooms: [], total: 0, limit: 50, offset: 0 }),
    });

    await fetchHubRooms({ filters: { tag: 'dev', query: 'help' } });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('tag=dev');
    expect(url).toContain('q=help');
  });

  it('includes limit and offset params for pagination', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rooms: [], total: 100, limit: 50, offset: 50 }),
    });

    await fetchHubRooms({ filters: { tag: '', query: '' }, limit: 50, offset: 50 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('limit=50');
    expect(url).toContain('offset=50');
  });

  it('does not include offset param when offset is 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rooms: [], total: 0, limit: 50, offset: 0 }),
    });

    await fetchHubRooms({ filters: { tag: '', query: '' }, limit: 50, offset: 0 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('limit=50');
    expect(url).not.toContain('offset');
  });

  it('throws on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
    });

    await expect(fetchHubRooms({ filters: { tag: '', query: '' } })).rejects.toThrow('Hub API error: 429');
  });

  it('returns parsed JSON response', async () => {
    const mockResponse = {
      rooms: [{ roomId: 'abc', title: 'Test', shareCode: 'abc:key:0:0', description: '', tags: [], memberCount: 1, hasPassword: false, createdAt: 1000, expiresAt: 0 }],
      total: 1,
      limit: 50,
      offset: 0,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const result = await fetchHubRooms({ filters: { tag: '', query: '' } });

    expect(result).toEqual(mockResponse);
    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].roomId).toBe('abc');
  });
});
