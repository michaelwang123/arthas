/**
 * sanitize.ts 模块的单元测试。
 *
 * 验证文件名清理和文件类型图标映射的正确性。
 */
import { describe, it, expect } from 'vitest';
import { sanitizeFileName, getFileTypeIcon } from './sanitize';

describe('sanitizeFileName', () => {
  it('removes forward slashes', () => {
    expect(sanitizeFileName('path/to/file.txt')).toBe('pathtofile.txt');
  });

  it('removes backslashes', () => {
    expect(sanitizeFileName('path\\to\\file.txt')).toBe('pathtofile.txt');
  });

  it('removes null bytes', () => {
    expect(sanitizeFileName('file\0name.txt')).toBe('filename.txt');
  });

  it('removes mixed dangerous characters', () => {
    expect(sanitizeFileName('../../../etc/passwd\0')).toBe('......etcpasswd');
  });

  it('truncates to 255 characters', () => {
    const longName = 'a'.repeat(300);
    expect(sanitizeFileName(longName)).toBe('a'.repeat(255));
  });

  it('preserves safe file names unchanged', () => {
    expect(sanitizeFileName('photo.png')).toBe('photo.png');
    expect(sanitizeFileName('my document (1).pdf')).toBe('my document (1).pdf');
    expect(sanitizeFileName('日本語ファイル.txt')).toBe('日本語ファイル.txt');
  });

  it('handles empty string', () => {
    expect(sanitizeFileName('')).toBe('');
  });

  it('is idempotent — applying twice gives same result', () => {
    const inputs = [
      '../secret.txt',
      'path/to\\file\0.pdf',
      'a'.repeat(300),
      'normal.txt',
      '',
    ];
    for (const input of inputs) {
      const once = sanitizeFileName(input);
      const twice = sanitizeFileName(once);
      expect(twice).toBe(once);
    }
  });
});

describe('getFileTypeIcon', () => {
  it('returns 🖼️ for image types', () => {
    expect(getFileTypeIcon('image/png')).toBe('🖼️');
    expect(getFileTypeIcon('image/jpeg')).toBe('🖼️');
    expect(getFileTypeIcon('image/gif')).toBe('🖼️');
    expect(getFileTypeIcon('image/webp')).toBe('🖼️');
    expect(getFileTypeIcon('image/svg+xml')).toBe('🖼️');
  });

  it('returns 📄 for document/text types', () => {
    expect(getFileTypeIcon('application/pdf')).toBe('📄');
    expect(getFileTypeIcon('text/plain')).toBe('📄');
    expect(getFileTypeIcon('text/html')).toBe('📄');
    expect(getFileTypeIcon('text/csv')).toBe('📄');
  });

  it('returns 📦 for archive types', () => {
    expect(getFileTypeIcon('application/zip')).toBe('📦');
    expect(getFileTypeIcon('application/x-rar-compressed')).toBe('📦');
    expect(getFileTypeIcon('application/x-rar')).toBe('📦');
    expect(getFileTypeIcon('application/gzip')).toBe('📦');
    expect(getFileTypeIcon('application/x-gzip')).toBe('📦');
    expect(getFileTypeIcon('application/x-tar')).toBe('📦');
    expect(getFileTypeIcon('application/x-7z-compressed')).toBe('📦');
    expect(getFileTypeIcon('application/x-bzip2')).toBe('📦');
    expect(getFileTypeIcon('application/x-xz')).toBe('📦');
  });

  it('returns 📁 for other/unknown types', () => {
    expect(getFileTypeIcon('application/octet-stream')).toBe('📁');
    expect(getFileTypeIcon('application/json')).toBe('📁');
    expect(getFileTypeIcon('video/mp4')).toBe('📁');
    expect(getFileTypeIcon('audio/mpeg')).toBe('📁');
  });
});
