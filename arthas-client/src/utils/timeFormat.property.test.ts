/**
 * 时间格式化属性测试（Property-Based Test）。
 *
 * 本文件使用 fast-check 验证 timeFormat.ts 的核心属性：
 * - Property 6: Remaining time formatting — 验证分段格式化规则和警告阈值
 *
 * 📚 学习要点: 为什么时间格式化需要属性测试？
 * 时间格式化有明确的分段规则（>3600s 显示小时，<=3600s 显示分钟），
 * 以及警告阈值（<=300s 触发警告）。这些规则适用于整个正整数域，
 * 单元测试只能覆盖有限的边界值，而属性测试通过随机生成大量秒数值，
 * 验证格式化规则在整个合法输入空间中始终成立。
 *
 * Feature: qr-share-and-room-expiry, Property 6: Remaining time formatting
 *
 * **Validates: Requirements 8.3, 8.4**
 *
 * @module utils/timeFormat.property.test
 * @see timeFormat.ts — 时间格式化实现
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatRemainingTime, isExpiryWarning } from './timeFormat';

/**
 * 支持的 locale 列表。
 * 属性测试需要验证所有 locale 下格式化规则都成立。
 */
const SUPPORTED_LOCALES = ['zh', 'en', 'ja'] as const;

/**
 * 生成 locale 的 fast-check arbitrary。
 */
const arbLocale = fc.constantFrom(...SUPPORTED_LOCALES);

describe('Feature: qr-share-and-room-expiry, Property 6: Remaining time formatting', () => {
  /**
   * 小时格式属性：对任意 remainingSeconds > 3600，formatRemainingTime 的输出
   * 必须包含小时相关文本（小时数值），且不包含分钟相关文本。
   *
   * 📚 学习要点: 分段格式化的属性验证
   * 设计文档规定 >3600s 显示小时格式。属性测试验证此规则对所有
   * 大于 3600 的正整数和所有 locale 都成立，而非仅检查几个手工用例。
   *
   * **Validates: Requirements 8.3**
   */
  it('outputs hour format for any remainingSeconds > 3600, across all locales', () => {
    fc.assert(
      fc.property(
        // 生成 > 3600 的秒数（上限约 30 天，覆盖实际使用范围）
        fc.integer({ min: 3601, max: 2592000 }),
        arbLocale,
        (remainingSeconds, locale) => {
          const result = formatRemainingTime(remainingSeconds, locale);
          const expectedHours = Math.floor(remainingSeconds / 3600);

          // 输出必须包含计算出的小时数
          expect(result).toContain(String(expectedHours));

          // 验证包含小时相关的 locale 标识文本
          // 📚 学习要点: 日文中"残り"是共用前缀（小时: "残り{n}時間"，分钟: "残り{n}分"）
          // 因此用"時間"作为小时格式的唯一标识，用末尾"分"作为分钟格式标识
          switch (locale) {
            case 'zh':
              expect(result).toContain('小时');
              expect(result).not.toContain('分钟');
              break;
            case 'en':
              expect(result).toContain('h remaining');
              expect(result).not.toContain('min remaining');
              break;
            case 'ja':
              expect(result).toContain('時間');
              // 确保不是分钟格式（分钟格式以"分"结尾，不含"時間"）
              expect(result).not.toMatch(/残り\d+分$/);
              break;
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 分钟格式属性：对任意 remainingSeconds in [1, 3600]，formatRemainingTime 的输出
   * 必须包含分钟相关文本，且不包含小时相关文本。
   *
   * 📚 学习要点: 边界值的属性覆盖
   * 3600 是小时/分钟格式的切换边界。属性测试自动覆盖 3600 本身
   * （应显示分钟格式：60 分钟），以及 1（应显示 1 分钟）。
   *
   * **Validates: Requirements 8.4**
   */
  it('outputs minute format for any remainingSeconds in [1, 3600], across all locales', () => {
    fc.assert(
      fc.property(
        // 生成 [1, 3600] 范围的秒数
        fc.integer({ min: 1, max: 3600 }),
        arbLocale,
        (remainingSeconds, locale) => {
          const result = formatRemainingTime(remainingSeconds, locale);
          const expectedMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));

          // 输出必须包含计算出的分钟数
          expect(result).toContain(String(expectedMinutes));

          // 验证包含分钟相关的 locale 标识文本
          switch (locale) {
            case 'zh':
              expect(result).toContain('分钟');
              expect(result).not.toContain('小时');
              break;
            case 'en':
              expect(result).toContain('min remaining');
              expect(result).not.toContain('h remaining');
              break;
            case 'ja':
              // 日文分钟格式: "残り{n}分"（不含"時間"）
              expect(result).toMatch(/分$/);
              expect(result).not.toContain('時間');
              break;
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 警告阈值属性：对任意 remainingSeconds <= 300，isExpiryWarning 必须返回 true。
   *
   * 📚 学习要点: 布尔属性的全域验证
   * isExpiryWarning 的行为由一个简单的阈值决定（<=300 → true）。
   * 属性测试验证此阈值在整个 [1, 300] 范围内都正确触发。
   *
   * **Validates: Requirements 8.4**
   */
  it('isExpiryWarning returns true for any remainingSeconds <= 300', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 300 }),
        (remainingSeconds) => {
          expect(isExpiryWarning(remainingSeconds)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 非警告属性：对任意 remainingSeconds > 300，isExpiryWarning 必须返回 false。
   *
   * **Validates: Requirements 8.4**
   */
  it('isExpiryWarning returns false for any remainingSeconds > 300', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 301, max: 2592000 }),
        (remainingSeconds) => {
          expect(isExpiryWarning(remainingSeconds)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
