/**
 * 文件大小验证的属性测试（Property-Based Test）。
 *
 * 📚 学习要点: 属性测试 vs 单元测试
 * 单元测试验证特定输入的输出是否正确（example-based）。
 * 属性测试验证对于**所有可能的输入**，某个属性是否恒成立。
 * 例如："任何大于 0 且不超过 5MB 的文件大小都应被接受"——
 * 这是一个对无限输入空间成立的属性，fast-check 会随机生成大量输入来验证。
 *
 * **Validates: Requirements 1.1**
 *
 * @module file-transfer/fileSize.property.test
 * @see requirements.md — Requirement 1: File Selection and Validation
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MAX_FILE_SIZE } from './types';

/**
 * 文件大小验证函数。
 *
 * 📚 学习要点: 为什么内联定义验证函数？
 * 在实际应用中，文件大小验证逻辑可能分散在 UI 层和引擎层。
 * 这里提取为纯函数进行属性测试，确保核心验证逻辑的正确性。
 * 规则：文件大小必须大于 0 且不超过 MAX_FILE_SIZE (5,242,880 bytes = 5MB)。
 *
 * @param size - 文件大小（字节）
 * @returns true 如果文件大小在有效范围内
 */
function isValidFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE;
}

describe('Property 9: File size validation', () => {
  /**
   * 属性 1: 有效范围内的文件大小应被接受。
   * 对于任何 size ∈ [1, MAX_FILE_SIZE]，isValidFileSize 返回 true。
   *
   * 📚 学习要点: fc.integer() 的范围约束
   * fast-check 的 integer arbitrary 可以指定 min/max 范围，
   * 确保生成的随机值都在我们关心的有效输入空间内。
   * 这比生成任意整数再过滤更高效（避免大量无效样本被丢弃）。
   */
  it('accepts any file size in range [1, MAX_FILE_SIZE]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_FILE_SIZE }),
        (size) => {
          expect(isValidFileSize(size)).toBe(true);
        }
      )
    );
  });

  /**
   * 属性 2: 非正数文件大小应被拒绝。
   * 对于任何 size ≤ 0，isValidFileSize 返回 false。
   *
   * 📚 学习要点: 负数和零的边界
   * 文件大小为 0 表示空文件（无内容可传输），应被拒绝。
   * 负数在逻辑上不可能是有效文件大小，也应被拒绝。
   * 使用 fc.integer({ max: 0 }) 生成 ≤ 0 的整数来验证。
   */
  it('rejects any file size <= 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 0 }),
        (size) => {
          expect(isValidFileSize(size)).toBe(false);
        }
      )
    );
  });

  /**
   * 属性 3: 超过 MAX_FILE_SIZE 的文件大小应被拒绝。
   * 对于任何 size > MAX_FILE_SIZE，isValidFileSize 返回 false。
   *
   * 📚 学习要点: 上界测试策略
   * 使用 MAX_FILE_SIZE + 1 作为最小值，确保所有生成的值都超过限制。
   * 上界设置为合理的大值（100MB），覆盖常见的超大文件场景。
   */
  it('rejects any file size > MAX_FILE_SIZE', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_FILE_SIZE + 1, max: 100_000_000 }),
        (size) => {
          expect(isValidFileSize(size)).toBe(false);
        }
      )
    );
  });

  /**
   * 边界值测试: MAX_FILE_SIZE (5,242,880) 恰好被接受。
   *
   * 📚 学习要点: 边界值分析（Boundary Value Analysis）
   * 边界值是 off-by-one 错误最容易出现的地方。
   * 明确测试 MAX_FILE_SIZE 本身被接受，确保使用的是 <= 而非 <。
   */
  it('accepts exactly MAX_FILE_SIZE (5,242,880)', () => {
    expect(isValidFileSize(5_242_880)).toBe(true);
  });

  /**
   * 边界值测试: MAX_FILE_SIZE + 1 (5,242,881) 被拒绝。
   */
  it('rejects MAX_FILE_SIZE + 1 (5,242,881)', () => {
    expect(isValidFileSize(5_242_881)).toBe(false);
  });

  /**
   * 边界值测试: 0 被拒绝（空文件）。
   */
  it('rejects size 0 (empty file)', () => {
    expect(isValidFileSize(0)).toBe(false);
  });
});
