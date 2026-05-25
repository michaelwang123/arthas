/**
 * QR_Generator 模块单元测试
 *
 * 验证 generateQRCode 和 buildJoinURL 的核心功能：
 * - generateQRCode 返回有效的 data URL 格式
 * - buildJoinURL 正确拼接 Join URL（含尾部斜杠处理和 fallback 逻辑）
 *
 * @module qr/generator.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateQRCode, buildJoinURL } from './generator';

describe('generateQRCode', () => {
  it('should return a valid data URL for a given text', async () => {
    const dataUrl = await generateQRCode('https://example.com/#/join/abc123:key456');

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('should use default options when none provided', async () => {
    const dataUrl = await generateQRCode('test-text');

    // Should still produce a valid data URL with defaults
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(dataUrl.length).toBeGreaterThan(100);
  });

  it('should accept custom options', async () => {
    const dataUrl = await generateQRCode('test-text', {
      errorCorrectionLevel: 'H',
      width: 128,
      margin: 2,
    });

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('should produce different output for different error correction levels', async () => {
    const dataUrlL = await generateQRCode('same-text', { errorCorrectionLevel: 'L' });
    const dataUrlH = await generateQRCode('same-text', { errorCorrectionLevel: 'H' });

    // Higher error correction = more data = different output
    expect(dataUrlL).not.toBe(dataUrlH);
  });
});

describe('buildJoinURL', () => {
  const originalEnv = import.meta.env.VITE_APP_URL;

  beforeEach(() => {
    // Reset env before each test
    delete (import.meta.env as Record<string, unknown>).VITE_APP_URL;
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      (import.meta.env as Record<string, unknown>).VITE_APP_URL = originalEnv;
    } else {
      delete (import.meta.env as Record<string, unknown>).VITE_APP_URL;
    }
  });

  it('should use VITE_APP_URL when available', () => {
    (import.meta.env as Record<string, unknown>).VITE_APP_URL = 'https://chat.example.com';

    const url = buildJoinURL('roomId:key:0:1700000000');

    expect(url).toBe('https://chat.example.com/#/join/roomId:key:0:1700000000');
  });

  it('should strip trailing slashes from VITE_APP_URL', () => {
    (import.meta.env as Record<string, unknown>).VITE_APP_URL = 'https://chat.example.com/';

    const url = buildJoinURL('roomId:key:0');

    expect(url).toBe('https://chat.example.com/#/join/roomId:key:0');
  });

  it('should strip multiple trailing slashes', () => {
    (import.meta.env as Record<string, unknown>).VITE_APP_URL = 'https://chat.example.com///';

    const url = buildJoinURL('abc:def');

    expect(url).toBe('https://chat.example.com/#/join/abc:def');
  });

  it('should fallback to window.location.origin when VITE_APP_URL is not set', () => {
    // happy-dom provides window.location.origin
    const url = buildJoinURL('roomId:key456');

    expect(url).toBe(`${window.location.origin}/#/join/roomId:key456`);
  });

  it('should produce URL in the format base/#/join/{shareCode}', () => {
    (import.meta.env as Record<string, unknown>).VITE_APP_URL = 'https://arthas.dev';

    const shareCode = 'abcdefghijklmnopqrstu:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1:1700000000';
    const url = buildJoinURL(shareCode);

    expect(url).toBe(`https://arthas.dev/#/join/${shareCode}`);
    // Verify no double slashes between base and hash
    expect(url).not.toContain('///#');
    expect(url).not.toContain('//#');
  });
});
