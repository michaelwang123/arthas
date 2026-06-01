/**
 * Chrome storage wrappers — typed access to session and local storage.
 *
 * Session storage (chrome.storage.session): memory-only, cleared on browser close.
 * Used for room key and session state — never persisted to disk.
 *
 * Local storage (chrome.storage.local): persisted to disk.
 * Used for user preferences (server URL, language) — no secrets.
 */

// --- Interfaces ---

export interface SessionState {
  roomId: string;
  nickname: string;
  keyEncoded: string; // base64url-encoded AES-256 key
  serverUrl: string;
  members: Array<{ id: string; name: string; color: string }>;
}

export interface LocalSettings {
  serverUrl: string;
  language: 'en' | 'zh' | 'ja';
}

// --- Session storage (memory-only) ---

const SESSION_KEY = 'session';

export async function saveSession(state: SessionState): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: state });
}

export async function loadSession(): Promise<SessionState | null> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  const session = result[SESSION_KEY] as SessionState | undefined;
  return session ?? null;
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}

export async function hasSession(): Promise<boolean> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return result[SESSION_KEY] !== undefined;
}

// --- Local storage (persisted) ---

const SETTINGS_KEY = 'settings';

const DEFAULT_SETTINGS: LocalSettings = {
  serverUrl: '',
  language: 'en',
};

export async function saveSettings(settings: Partial<LocalSettings>): Promise<void> {
  const current = await loadSettings();
  const merged: LocalSettings = { ...current, ...settings };
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
}

export async function loadSettings(): Promise<LocalSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<LocalSettings> | undefined;
  if (!stored) {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    serverUrl: stored.serverUrl ?? DEFAULT_SETTINGS.serverUrl,
    language: stored.language ?? DEFAULT_SETTINGS.language,
  };
}

// --- Validation ---

/**
 * Validate a WebSocket server URL.
 * Must start with ws:// or wss://, have a non-empty host between protocol and path, and end with /ws.
 */
export function validateServerUrl(url: string): boolean {
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) return false;
  if (!url.endsWith('/ws')) return false;

  // Extract the part between protocol and the path
  // e.g., "wss://host:port/path/ws" → "host:port/path/ws"
  const afterProtocol = url.startsWith('wss://') ? url.slice(6) : url.slice(5);

  // Must have content before the first slash (the host part)
  const firstSlash = afterProtocol.indexOf('/');
  if (firstSlash <= 0) return false; // No host or empty host

  const host = afterProtocol.slice(0, firstSlash);

  // Host must not be empty or whitespace-only
  if (host.trim().length === 0) return false;

  return true;
}
