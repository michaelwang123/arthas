import type { HubFilters, HubListResponse } from './types';

/**
 * Derives the Hub API base URL.
 * - Development mode: always uses relative path (Vite proxy handles /api → backend)
 * - Production same-origin: uses relative path (Go server serves frontend + API)
 * - Production split deployment (VITE_WS_URL set): derives HTTP(S) base from WS(S) URL
 */
function getHubApiBase(): string {
  // In development, always use relative path — Vite proxy forwards /api to backend
  if (import.meta.env.DEV) {
    return '';
  }

  const wsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (wsUrl) {
    // wss://server.hf.space/ws → https://server.hf.space
    // ws://server.example.com/ws → http://server.example.com
    return wsUrl
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://')
      .replace(/\/ws$/, '');
  }
  return ''; // same-origin, use relative path
}

const HUB_API_PATH = '/api/hub';

export interface FetchHubOptions {
  filters: HubFilters;
  limit?: number;
  offset?: number;
}

/**
 * Fetches the Hub directory with optional filters and pagination.
 * @throws Error on non-200 responses
 */
export async function fetchHubRooms(options: FetchHubOptions): Promise<HubListResponse> {
  const { filters, limit, offset } = options;
  const params = new URLSearchParams();
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.query) params.set('q', filters.query);
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined && offset > 0) params.set('offset', String(offset));

  const base = getHubApiBase();
  const url = `${base}${HUB_API_PATH}${params.toString() ? '?' + params.toString() : ''}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Hub API error: ${res.status}`);
  }
  return res.json();
}
