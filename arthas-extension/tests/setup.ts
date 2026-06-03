/**
 * Test setup — chrome.* API mocks for Vitest with happy-dom environment.
 *
 * Provides in-memory implementations of:
 * - chrome.storage.session (get/set/remove/clear)
 * - chrome.storage.local (get/set/remove/clear)
 * - chrome.runtime (sendMessage, onMessage, onConnect, onInstalled, onStartup)
 * - chrome.action (setBadgeText, setBadgeBackgroundColor)
 */

import { vi } from 'vitest';

// --- In-memory storage backing stores ---

let sessionStore: Record<string, unknown> = {};
let localStore: Record<string, unknown> = {};

/**
 * Creates a mock chrome.storage area (session or local) backed by an in-memory object.
 */
function createStorageArea(store: () => Record<string, unknown>, setStore: (s: Record<string, unknown>) => void) {
  return {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      const current = store();
      if (keys === null || keys === undefined) {
        return { ...current };
      }
      if (typeof keys === 'string') {
        return { [keys]: current[keys] };
      }
      if (Array.isArray(keys)) {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          result[key] = current[key];
        }
        return result;
      }
      // keys is an object with defaults
      const result: Record<string, unknown> = {};
      for (const [key, defaultValue] of Object.entries(keys)) {
        result[key] = current[key] !== undefined ? current[key] : defaultValue;
      }
      return result;
    }),

    set: vi.fn(async (items: Record<string, unknown>) => {
      const current = store();
      setStore({ ...current, ...items });
    }),

    remove: vi.fn(async (keys: string | string[]) => {
      const current = { ...store() };
      const keyList = typeof keys === 'string' ? [keys] : keys;
      for (const key of keyList) {
        delete current[key];
      }
      setStore(current);
    }),

    clear: vi.fn(async () => {
      setStore({});
    }),

    setAccessLevel: vi.fn(async () => {
      // No-op in tests
    }),
  };
}

// --- Event listener mock factory ---

interface ChromeEventListener<T extends (...args: never[]) => void> {
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  hasListener: ReturnType<typeof vi.fn>;
  _listeners: T[];
  _fire: (...args: Parameters<T>) => void;
}

function createEvent<T extends (...args: never[]) => void>(): ChromeEventListener<T> {
  const listeners: T[] = [];
  return {
    addListener: vi.fn((fn: T) => {
      listeners.push(fn);
    }),
    removeListener: vi.fn((fn: T) => {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    hasListener: vi.fn((fn: T) => listeners.includes(fn)),
    _listeners: listeners,
    _fire: (...args: Parameters<T>) => {
      for (const listener of listeners) {
        listener(...args);
      }
    },
  };
}

// --- Build the chrome global mock ---

const chromeSessionStorage = createStorageArea(
  () => sessionStore,
  (s) => { sessionStore = s; }
);

const chromeLocalStorage = createStorageArea(
  () => localStore,
  (s) => { localStore = s; }
);

type MessageCallback = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => void;
type ConnectCallback = (port: chrome.runtime.Port) => void;
type InstalledCallback = (details: chrome.runtime.InstalledDetails) => void;
type StartupCallback = () => void;

const chromeMock = {
  storage: {
    session: chromeSessionStorage,
    local: chromeLocalStorage,
  },
  runtime: {
    sendMessage: vi.fn(async (_message: unknown) => ({ ok: true })),
    onMessage: createEvent<MessageCallback>(),
    onConnect: createEvent<ConnectCallback>(),
    onInstalled: createEvent<InstalledCallback>(),
    onStartup: createEvent<StartupCallback>(),
    id: 'mock-extension-id',
    getURL: vi.fn((path: string) => `chrome-extension://mock-extension-id/${path}`),
    connect: vi.fn((_connectInfo?: { name?: string }) => ({
      name: _connectInfo?.name ?? '',
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      onMessage: createEvent(),
      onDisconnect: createEvent(),
    })),
  },
  action: {
    setBadgeText: vi.fn(async (_details: { text: string }) => {}),
    setBadgeBackgroundColor: vi.fn(async (_details: { color: string }) => {}),
  },
};

// Assign to globalThis so tests can access chrome.* APIs
Object.assign(globalThis, { chrome: chromeMock });

// --- Reset storage between tests ---

beforeEach(() => {
  sessionStore = {};
  localStore = {};
  vi.clearAllMocks();
});

export { chromeMock };
