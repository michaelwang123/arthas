/**
 * Verification test: confirms the test environment supports Web Crypto API
 * and chrome.* mocks are functional.
 *
 * Validates: NFR-1 (testability prerequisite)
 */
import { describe, it, expect } from 'vitest';

describe('Test environment setup', () => {
  describe('Web Crypto API', () => {
    it('crypto.subtle is available', () => {
      expect(crypto).toBeDefined();
      expect(crypto.subtle).toBeDefined();
    });

    it('crypto.subtle.generateKey works for AES-256-GCM', async () => {
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
      expect(key.extractable).toBe(true);
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('crypto.subtle.encrypt/decrypt round-trip works', async () => {
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      const plaintext = new TextEncoder().encode('hello arthas');
      const iv = crypto.getRandomValues(new Uint8Array(12));

      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        plaintext
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      );

      const result = new TextDecoder().decode(decrypted);
      expect(result).toBe('hello arthas');
    });

    it('crypto.getRandomValues generates random bytes', () => {
      const bytes = crypto.getRandomValues(new Uint8Array(12));
      expect(bytes).toHaveLength(12);
      // Verify not all zeros (extremely unlikely for random)
      expect(bytes.some((b) => b !== 0)).toBe(true);
    });
  });

  describe('Chrome API mocks', () => {
    it('chrome.storage.session get/set works', async () => {
      await chrome.storage.session.set({ roomId: 'test-room-123' });
      const result = await chrome.storage.session.get('roomId');
      expect(result).toEqual({ roomId: 'test-room-123' });
    });

    it('chrome.storage.session remove works', async () => {
      await chrome.storage.session.set({ key1: 'val1', key2: 'val2' });
      await chrome.storage.session.remove('key1');
      const result = await chrome.storage.session.get(['key1', 'key2']);
      expect(result).toEqual({ key1: undefined, key2: 'val2' });
    });

    it('chrome.storage.session clear works', async () => {
      await chrome.storage.session.set({ a: 1, b: 2 });
      await chrome.storage.session.clear();
      const result = await chrome.storage.session.get(null);
      expect(result).toEqual({});
    });

    it('chrome.storage.local get/set works', async () => {
      await chrome.storage.local.set({ serverUrl: 'wss://example.com/ws' });
      const result = await chrome.storage.local.get('serverUrl');
      expect(result).toEqual({ serverUrl: 'wss://example.com/ws' });
    });

    it('chrome.storage.local remove works', async () => {
      await chrome.storage.local.set({ lang: 'en', url: 'wss://x.com/ws' });
      await chrome.storage.local.remove('lang');
      const result = await chrome.storage.local.get(['lang', 'url']);
      expect(result).toEqual({ lang: undefined, url: 'wss://x.com/ws' });
    });

    it('chrome.storage.local clear works', async () => {
      await chrome.storage.local.set({ x: 1 });
      await chrome.storage.local.clear();
      const result = await chrome.storage.local.get(null);
      expect(result).toEqual({});
    });

    it('chrome.runtime.sendMessage is callable', async () => {
      const response = await chrome.runtime.sendMessage({ type: 'SET_BADGE', text: '●' });
      expect(response).toEqual({ ok: true });
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'SET_BADGE', text: '●' });
    });

    it('chrome.runtime.onMessage listener can be added', () => {
      const handler = () => {};
      chrome.runtime.onMessage.addListener(handler);
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledWith(handler);
    });

    it('chrome.runtime.onConnect listener can be added', () => {
      const handler = () => {};
      chrome.runtime.onConnect.addListener(handler);
      expect(chrome.runtime.onConnect.addListener).toHaveBeenCalledWith(handler);
    });

    it('chrome.runtime.onInstalled listener can be added', () => {
      const handler = () => {};
      chrome.runtime.onInstalled.addListener(handler);
      expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalledWith(handler);
    });

    it('chrome.runtime.onStartup listener can be added', () => {
      const handler = () => {};
      chrome.runtime.onStartup.addListener(handler);
      expect(chrome.runtime.onStartup.addListener).toHaveBeenCalledWith(handler);
    });

    it('chrome.action.setBadgeText is callable', async () => {
      await chrome.action.setBadgeText({ text: '●' });
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '●' });
    });

    it('chrome.action.setBadgeBackgroundColor is callable', async () => {
      await chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#6366f1' });
    });

    it('storage is isolated between tests (reset in beforeEach)', async () => {
      // This test verifies that the beforeEach reset works
      const result = await chrome.storage.session.get(null);
      expect(result).toEqual({});
    });
  });
});
