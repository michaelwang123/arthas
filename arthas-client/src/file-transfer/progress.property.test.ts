/**
 * 属性测试：文件传输进度计算的数学不变量验证。
 *
 * 本文件使用 fast-check 属性测试框架验证 calculateProgress、calculateSpeed、calculateEta
 * 三个纯函数的核心不变量。这些函数被 UI 组件（ProgressBar、FileMessage）使用，
 * 必须对所有合法输入都返回合理的结果。
 *
 * 📚 学习要点: 为什么进度计算适合属性测试？
 * 进度计算函数有明确的数学不变量（如"结果永远在 [0, 100]"），
 * 这些不变量对所有合法输入都必须成立。
 * 属性测试通过随机生成大量输入来验证这些不变量，
 * 比手动编写几个固定输入的测试用例覆盖面广得多。
 *
 * 验证的属性：
 * 1. Progress 永远在 [0, 100] 范围内
 * 2. receivedChunks=0 时 Progress=0
 * 3. receivedChunks=totalChunks 时 Progress=100
 * 4. Speed 对合法输入永远非负
 * 5. ETA 非负或 Infinity（speed=0 时）
 *
 * **Validates: Requirements 7.1, 7.4, 7.5**
 *
 * @module file-transfer/progress.property.test
 * @see progress.ts — calculateProgress, calculateSpeed, calculateEta 实现
 * @see requirements.md — Requirements 7.1, 7.4, 7.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { calculateProgress, calculateSpeed, calculateEta } from './progress';

/**
 * **Validates: Requirements 7.1, 7.4, 7.5**
 *
 * Property 8: Progress calculation correctness
 * - Progress = Math.floor(receivedChunks / totalChunks * 100), always in [0, 100]
 * - Speed = bytesTransferred / elapsedSeconds (KB/s), non-negative
 * - ETA = remainingBytes / speed (seconds), non-negative or Infinity when speed=0
 */
describe('Property: Progress calculation correctness', () => {
  // ==========================================================================
  // Property 8.1: Progress is always in [0, 100]
  // ==========================================================================

  it('progress is always in [0, 100] for any valid receivedChunks and totalChunks > 0', () => {
    fc.assert(
      fc.property(
        // 📚 学习要点: 智能生成器设计
        // totalChunks 范围 [1, 80]：1 是最小合法值（1 byte 文件），80 是最大值（5MB / 64KB）
        // receivedChunks 范围 [0, totalChunks]：从未接收到全部接收
        fc.integer({ min: 1, max: 80 }),
        fc.integer({ min: 0, max: 80 }),
        (totalChunks, receivedChunks) => {
          // Clamp receivedChunks to valid range for this totalChunks
          const validReceived = Math.min(receivedChunks, totalChunks);
          const progress = calculateProgress(validReceived, totalChunks);

          expect(progress).toBeGreaterThanOrEqual(0);
          expect(progress).toBeLessThanOrEqual(100);
          // Progress must be an integer (Math.floor guarantees this)
          expect(Number.isInteger(progress)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  // ==========================================================================
  // Property 8.2: Progress is 0 when receivedChunks is 0
  // ==========================================================================

  it('progress is 0 when receivedChunks is 0', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 80 }),
        (totalChunks) => {
          const progress = calculateProgress(0, totalChunks);
          expect(progress).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Property 8.3: Progress is 100 when receivedChunks equals totalChunks
  // ==========================================================================

  it('progress is 100 when receivedChunks equals totalChunks', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 80 }),
        (totalChunks) => {
          const progress = calculateProgress(totalChunks, totalChunks);
          expect(progress).toBe(100);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ==========================================================================
  // Property 8.4: Speed is always non-negative
  // ==========================================================================

  it('speed is always non-negative for any non-negative bytesTransferred and positive elapsedMs', () => {
    fc.assert(
      fc.property(
        // 📚 学习要点: 生成器范围选择
        // bytesTransferred: [0, 5_242_880] — 从 0 到最大文件大小
        // elapsedMs: [1, 120_000] — 从 1ms 到 2 分钟（覆盖超时场景）
        // 使用 min=1 for elapsedMs 避免除以零（这是函数的前置条件）
        fc.integer({ min: 0, max: 5_242_880 }),
        fc.integer({ min: 1, max: 120_000 }),
        (bytesTransferred, elapsedMs) => {
          const speed = calculateSpeed(bytesTransferred, elapsedMs);

          expect(speed).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(speed)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  // ==========================================================================
  // Property 8.5: ETA is non-negative or Infinity when speed is 0
  // ==========================================================================

  it('ETA is non-negative when speed > 0, and Infinity when speed is 0', () => {
    fc.assert(
      fc.property(
        // remainingBytes: [0, 5_242_880] — 从 0 到最大文件大小
        // speedKBps: [0, 10_000] — 从 0 到 10 MB/s（覆盖极快网络）
        fc.integer({ min: 0, max: 5_242_880 }),
        fc.integer({ min: 0, max: 10_000 }),
        (remainingBytes, speedKBps) => {
          const eta = calculateEta(remainingBytes, speedKBps);

          if (remainingBytes <= 0) {
            // No remaining bytes → ETA is 0
            expect(eta).toBe(0);
          } else if (speedKBps <= 0) {
            // Speed is 0 → ETA is Infinity
            expect(eta).toBe(Infinity);
          } else {
            // Normal case: ETA is non-negative and finite
            expect(eta).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(eta)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  // ==========================================================================
  // Additional: Progress monotonicity (more chunks → higher or equal progress)
  // ==========================================================================

  it('progress is monotonically non-decreasing as receivedChunks increases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 80 }),
        fc.integer({ min: 0, max: 79 }),
        (totalChunks, received) => {
          // Ensure received and received+1 are both valid
          const r = Math.min(received, totalChunks - 1);
          const progressLow = calculateProgress(r, totalChunks);
          const progressHigh = calculateProgress(r + 1, totalChunks);

          expect(progressHigh).toBeGreaterThanOrEqual(progressLow);
        }
      ),
      { numRuns: 200 }
    );
  });
});
