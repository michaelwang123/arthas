/**
 * formatDuration 时间格式化函数的属性测试（Property-Based Test）。
 *
 * 📚 学习要点: 属性测试对纯函数的价值
 * formatDuration 是一个纯函数，输入为秒数，输出为 "M:SS" 格式字符串。
 * 属性测试可以验证对于**所有可能的输入**，以下属性恒成立：
 * 1. 输出格式始终匹配 /^\d:\d{2}$/ 模式（M:SS）
 * 2. 将输出解析回数值后等于原始输入（round-trip 正确性）
 * 3. 超出 [0, 60] 范围的非负整数也能正确格式化（防御性编程验证）
 *
 * 这比手动列举几个 example 更有说服力——fast-check 会自动探索边界值和随机值。
 *
 * **Validates: Requirements 5.7**
 *
 * Feature: voice-push-to-talk, Property 4: Duration format correctness
 *
 * @module voice/__tests__/formatDuration.property.test
 * @see formatDuration.ts
 * @see design.md — Property 4: Duration format correctness
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { formatDuration } from '../formatDuration';

describe('Property 4: Duration format correctness', () => {
  /**
   * 属性 4a: 对于 [0, 60] 范围内的任意整数，输出匹配 "M:SS" 模式。
   *
   * 📚 学习要点: 正则表达式验证输出格式
   * /^\d:\d{2}$/ 确保：
   * - 以单个数字开头（分钟数，0 或 1）
   * - 紧跟冒号分隔符
   * - 以恰好两位数字结尾（秒数，00-59）
   * 这保证了 UI 显示的一致性——不会出现 "0:5" 或 "01:05" 这种不规范格式。
   *
   * **Validates: Requirements 5.7**
   */
  it('produces M:SS pattern for any t in [0, 60]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        (seconds) => {
          const result = formatDuration(seconds);
          expect(result).toMatch(/^\d:\d{2}$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 4b: 对于 [0, 60] 范围内的任意整数，解析输出回数值等于原始输入。
   *
   * 📚 学习要点: Round-trip 验证（往返正确性）
   * 如果 formatDuration(t) 产生 "M:SS"，那么 parseInt(M)*60 + parseInt(SS) 应等于 t。
   * 这验证了格式化过程没有丢失或扭曲数值信息。
   * 例如：formatDuration(65) → "1:05" → 1*60 + 5 = 65 ✓
   *
   * 这是一种常见的属性测试模式：encode → decode 应等于原始值。
   * 即使我们不能"解码"格式化字符串回原始类型，
   * 但可以通过字符串解析验证数值语义的保持。
   *
   * **Validates: Requirements 5.7**
   */
  it('round-trips correctly: parsing M:SS back gives original value for t in [0, 60]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        (seconds) => {
          const result = formatDuration(seconds);
          const [m, ss] = result.split(':');
          const reconstructed = parseInt(m, 10) * 60 + parseInt(ss, 10);
          expect(reconstructed).toBe(seconds);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性 4c: 对于超出 [0, 60] 的非负整数，输出仍匹配 M:SS 模式且 round-trip 正确。
   *
   * 📚 学习要点: 防御性编程的属性验证
   * 虽然语音消息最长 60 秒（Requirements 1.8），但 formatDuration 作为工具函数
   * 应该对任意非负整数都有确定性行为。测试 [0, 3600]（一小时）范围确保：
   * - 分钟数可以超过 1（如 120 秒 → "2:00"）
   * - 格式模式可能扩展为多位分钟数（如 600 秒 → "10:00"）
   * - 数值 round-trip 始终正确
   *
   * 注意：超过 9 分钟时模式变为 /^\d+:\d{2}$/（多位分钟数），
   * 因此这里使用更宽松的正则。
   *
   * **Validates: Requirements 5.7**
   */
  it('handles arbitrary non-negative integers beyond 60 with correct round-trip', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3600 }),
        (seconds) => {
          const result = formatDuration(seconds);
          // 通用模式：一位或多位分钟数 + 冒号 + 两位秒数
          expect(result).toMatch(/^\d+:\d{2}$/);

          // Round-trip 验证：解析回数值应等于原始输入
          const [m, ss] = result.split(':');
          const reconstructed = parseInt(m, 10) * 60 + parseInt(ss, 10);
          expect(reconstructed).toBe(seconds);
        }
      ),
      { numRuns: 100 }
    );
  });
});
