import { describe, it, expect } from 'vitest';
import {
  saveSession,
  loadSession,
  clearSession,
  hasSession,
  saveSettings,
  loadSettings,
  validateServerUrl,
} from '../../src/utils/storage';
import type { SessionState } from '../../src/utils/storage';

describe('storage - session', () => {
  const mockSession: SessionState = {
    roomId: 'abc123def456ghi789xyz',
    nickname: 'Alice',
    keyEncoded: 'dGVzdC1rZXktZW5jb2RlZC1iYXNlNjR1cmwtNDNj',
    serverUrl: 'wss://chat.example.com/ws',
    members: [
      { id: 'user1', name: 'Alice', color: '#ff0000' },
      { id: 'user2', name: 'Bob', color: '#00ff00' },
    ],
  };

  it('loadSession returns null when no session stored', async () => {
    const result = await loadSession();
    expect(result).toBeNull();
  });

  it('hasSession returns false when no session stored', async () => {
    const result = await hasSession();
    expect(result).toBe(false);
  });

  it('saveSession and loadSession round-trip', async () => {
    await saveSession(mockSession);
    const loaded = await loadSession();
    expect(loaded).toEqual(mockSession);
  });

  it('hasSession returns true after saving', async () => {
    await saveSession(mockSession);
    const result = await hasSession();
    expect(result).toBe(true);
  });

  it('clearSession removes session data', async () => {
    await saveSession(mockSession);
    await clearSession();
    const loaded = await loadSession();
    expect(loaded).toBeNull();
  });

  it('hasSession returns false after clearing', async () => {
    await saveSession(mockSession);
    await clearSession();
    const result = await hasSession();
    expect(result).toBe(false);
  });
});

describe('storage - settings', () => {
  it('loadSettings returns defaults when nothing stored', async () => {
    const settings = await loadSettings();
    expect(settings).toEqual({ serverUrl: '', language: 'en' });
  });

  it('saveSettings persists partial updates', async () => {
    await saveSettings({ serverUrl: 'wss://my-server.com/ws' });
    const settings = await loadSettings();
    expect(settings.serverUrl).toBe('wss://my-server.com/ws');
    expect(settings.language).toBe('en');
  });

  it('saveSettings merges with existing settings', async () => {
    await saveSettings({ serverUrl: 'wss://my-server.com/ws' });
    await saveSettings({ language: 'zh' });
    const settings = await loadSettings();
    expect(settings.serverUrl).toBe('wss://my-server.com/ws');
    expect(settings.language).toBe('zh');
  });

  it('saveSettings overwrites specific fields', async () => {
    await saveSettings({ serverUrl: 'wss://old.com/ws', language: 'ja' });
    await saveSettings({ serverUrl: 'wss://new.com/ws' });
    const settings = await loadSettings();
    expect(settings.serverUrl).toBe('wss://new.com/ws');
    expect(settings.language).toBe('ja');
  });
});

describe('validateServerUrl', () => {
  it('returns true for valid wss:// URL ending with /ws', () => {
    expect(validateServerUrl('wss://chat.example.com/ws')).toBe(true);
  });

  it('returns true for valid ws:// URL ending with /ws', () => {
    expect(validateServerUrl('ws://localhost:8080/ws')).toBe(true);
  });

  it('returns false for http:// URL', () => {
    expect(validateServerUrl('http://example.com/ws')).toBe(false);
  });

  it('returns false for https:// URL', () => {
    expect(validateServerUrl('https://example.com/ws')).toBe(false);
  });

  it('returns false for URL not ending with /ws', () => {
    expect(validateServerUrl('wss://example.com/chat')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(validateServerUrl('')).toBe(false);
  });

  it('returns true for minimal ws://x/ws', () => {
    expect(validateServerUrl('ws://x/ws')).toBe(true);
  });

  it('returns false for wss:// without /ws suffix', () => {
    expect(validateServerUrl('wss://example.com')).toBe(false);
  });

  it('returns false for just /ws', () => {
    expect(validateServerUrl('/ws')).toBe(false);
  });

  it('returns false for ws:// alone', () => {
    expect(validateServerUrl('ws://')).toBe(false);
  });
});
