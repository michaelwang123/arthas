/**
 * @file sender.flowcontrol.test.ts — 发送引擎流控和网络感知测试
 *
 * 测试 sender.ts 中的自适应延迟、RTT 拥塞检测和离线暂停机制。
 *
 * @see sender.ts — 被测模块
 * @see requirements.md — Requirements 3.5, 3.6, 11.1, 11.6, NFR-1, NFR-2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordRtt,
  resetRttState,
  getRttMultiplier,
  getIsPaused,
  setIsPaused,
  setupOfflineDetection,
} from './sender';

describe('RTT-aware congestion detection', () => {
  beforeEach(() => {
    resetRttState();
  });

  it('should not adjust multiplier with fewer than 3 samples', () => {
    recordRtt(100);
    recordRtt(200);
    expect(getRttMultiplier()).toBe(1.0);
  });

  it('should increase multiplier when latest RTT > avg × 1.5 (congestion)', () => {
    // 建立基线：3 个稳定的 RTT 样本
    recordRtt(100);
    recordRtt(100);
    recordRtt(100);
    // 此时 avg = 100, 下一个 RTT 需要 > 150 才触发拥塞

    // 发送一个高 RTT 值（200 > 100 × 1.5 = 150）
    recordRtt(200);

    // 倍数应该增加（1.0 × 1.5 = 1.5）
    expect(getRttMultiplier()).toBeCloseTo(1.5, 1);
  });

  it('should decrease multiplier when latest RTT < avg × 0.8 (recovery)', () => {
    // 先制造拥塞状态
    recordRtt(100);
    recordRtt(100);
    recordRtt(100);
    recordRtt(200); // 触发拥塞，multiplier → 1.5

    // 现在发送一个低 RTT 值
    // 当前 history = [100, 100, 100, 200], avg = 125
    // 需要 RTT < 125 × 0.8 = 100
    recordRtt(50); // 50 < 100，触发恢复

    // 倍数应该减少（1.5 × 0.7 = 1.05）
    expect(getRttMultiplier()).toBeLessThan(1.5);
    expect(getRttMultiplier()).toBeGreaterThanOrEqual(1.0);
  });

  it('should cap multiplier at 3.0 maximum', () => {
    // 连续发送高 RTT 值，触发多次拥塞增加
    recordRtt(100);
    recordRtt(100);
    recordRtt(100);

    // 多次触发拥塞
    for (let i = 0; i < 20; i++) {
      recordRtt(500); // 远超平均值
    }

    // 倍数不应超过 3.0
    expect(getRttMultiplier()).toBeLessThanOrEqual(3.0);
  });

  it('should not go below 1.0 minimum', () => {
    recordRtt(100);
    recordRtt(100);
    recordRtt(100);

    // 多次触发恢复
    for (let i = 0; i < 20; i++) {
      recordRtt(10); // 远低于平均值
    }

    // 倍数不应低于 1.0
    expect(getRttMultiplier()).toBeGreaterThanOrEqual(1.0);
  });

  it('should maintain sliding window of 5 samples', () => {
    // 填充 5 个稳定样本
    recordRtt(100);
    recordRtt(100);
    recordRtt(100);
    recordRtt(100);
    recordRtt(100);

    // 再添加一个，应该移除最旧的
    recordRtt(100);

    // 倍数应该保持不变（所有样本相同）
    expect(getRttMultiplier()).toBe(1.0);
  });

  it('should ignore invalid RTT values (negative or too large)', () => {
    recordRtt(100);
    recordRtt(100);
    recordRtt(100);

    const multiplierBefore = getRttMultiplier();

    // 这些无效值应该被忽略
    recordRtt(-1);
    recordRtt(0);
    recordRtt(31000); // > 30000

    expect(getRttMultiplier()).toBe(multiplierBefore);
  });

  it('should not adjust when RTT is in normal range (0.8x ~ 1.5x avg)', () => {
    recordRtt(100);
    recordRtt(100);
    recordRtt(100);

    // avg = 100, 正常范围 = 80 ~ 150
    recordRtt(120); // 在正常范围内

    // 倍数不应变化
    expect(getRttMultiplier()).toBe(1.0);
  });
});

describe('Offline detection state', () => {
  beforeEach(() => {
    setIsPaused(false);
  });

  it('should start in non-paused state', () => {
    expect(getIsPaused()).toBe(false);
  });

  it('should allow setting paused state', () => {
    setIsPaused(true);
    expect(getIsPaused()).toBe(true);

    setIsPaused(false);
    expect(getIsPaused()).toBe(false);
  });
});
