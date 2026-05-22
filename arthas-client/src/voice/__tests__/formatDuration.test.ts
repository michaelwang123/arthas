/**
 * formatDuration 工具函数的单元测试。
 *
 * 📚 学习要点: 纯函数的测试策略
 * formatDuration 是一个纯函数（无副作用、无外部依赖），
 * 非常适合用 example-based 测试覆盖关键边界值，
 * 配合 property-based 测试（见 formatDuration.property.test.ts）覆盖全输入空间。
 *
 * @module voice/__tests__/formatDuration.test
 * @see formatDuration.ts
 */
import { describe, it, expect } from 'vitest';
import { formatDuration } from '../formatDuration';

describe('formatDuration', () => {
  // === 正常输入 ===

  it('formats 0 seconds as "0:00"', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('formats 5 seconds as "0:05"', () => {
    expect(formatDuration(5)).toBe('0:05');
  });

  it('formats 30 seconds as "0:30"', () => {
    expect(formatDuration(30)).toBe('0:30');
  });

  it('formats 59 seconds as "0:59"', () => {
    expect(formatDuration(59)).toBe('0:59');
  });

  it('formats 60 seconds as "1:00"', () => {
    expect(formatDuration(60)).toBe('1:00');
  });

  it('formats 65 seconds as "1:05"', () => {
    expect(formatDuration(65)).toBe('1:05');
  });

  // === 边界情况 ===

  it('treats negative numbers as 0:00', () => {
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatDuration(-100)).toBe('0:00');
  });

  it('floors fractional seconds', () => {
    expect(formatDuration(3.7)).toBe('0:03');
    expect(formatDuration(59.9)).toBe('0:59');
    expect(formatDuration(0.5)).toBe('0:00');
  });

  it('treats NaN as 0:00', () => {
    expect(formatDuration(NaN)).toBe('0:00');
  });

  it('treats Infinity as 0:00', () => {
    expect(formatDuration(Infinity)).toBe('0:00');
    expect(formatDuration(-Infinity)).toBe('0:00');
  });
});
