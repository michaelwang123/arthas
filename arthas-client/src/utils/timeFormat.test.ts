/**
 * 单元测试: 时间格式化工具函数
 *
 * 验证 formatRemainingTime 和 isExpiryWarning 的核心行为：
 * - 小时/分钟分段显示逻辑
 * - 多语言格式化输出
 * - 警告阈值判断
 * - 边界值处理
 *
 * @module utils/timeFormat.test
 * @see timeFormat.ts — 被测模块
 */

import { describe, it, expect } from 'vitest'
import { formatRemainingTime, isExpiryWarning } from './timeFormat'

describe('formatRemainingTime', () => {
  describe('hours format (remaining > 3600s)', () => {
    it('displays hours for zh locale', () => {
      expect(formatRemainingTime(3601, 'zh')).toBe('还剩 1 小时')
      expect(formatRemainingTime(82800, 'zh')).toBe('还剩 23 小时')
    })

    it('displays hours for en locale', () => {
      expect(formatRemainingTime(3601, 'en')).toBe('1h remaining')
      expect(formatRemainingTime(82800, 'en')).toBe('23h remaining')
    })

    it('displays hours for ja locale', () => {
      expect(formatRemainingTime(3601, 'ja')).toBe('残り1時間')
      expect(formatRemainingTime(82800, 'ja')).toBe('残り23時間')
    })

    it('uses Math.floor for hour calculation', () => {
      // 7199s = 1h 59m 59s → should show 1 hour (floor)
      expect(formatRemainingTime(7199, 'en')).toBe('1h remaining')
      // 7200s = exactly 2h → should show 2 hours
      expect(formatRemainingTime(7200, 'en')).toBe('2h remaining')
    })
  })

  describe('minutes format (remaining <= 3600s)', () => {
    it('displays minutes for zh locale', () => {
      expect(formatRemainingTime(2700, 'zh')).toBe('还剩 45 分钟')
      expect(formatRemainingTime(60, 'zh')).toBe('还剩 1 分钟')
    })

    it('displays minutes for en locale', () => {
      expect(formatRemainingTime(2700, 'en')).toBe('45min remaining')
      expect(formatRemainingTime(60, 'en')).toBe('1min remaining')
    })

    it('displays minutes for ja locale', () => {
      expect(formatRemainingTime(2700, 'ja')).toBe('残り45分')
      expect(formatRemainingTime(60, 'ja')).toBe('残り1分')
    })

    it('uses Math.ceil for minute calculation (rounds up)', () => {
      // 61s → ceil(61/60) = 2 minutes
      expect(formatRemainingTime(61, 'en')).toBe('2min remaining')
      // 59s → ceil(59/60) = 1 minute
      expect(formatRemainingTime(59, 'en')).toBe('1min remaining')
    })

    it('shows at least 1 minute even for very small values', () => {
      expect(formatRemainingTime(1, 'en')).toBe('1min remaining')
      expect(formatRemainingTime(5, 'zh')).toBe('还剩 1 分钟')
    })
  })

  describe('boundary at 3600s', () => {
    it('3600s exactly shows minutes format (60 minutes)', () => {
      expect(formatRemainingTime(3600, 'en')).toBe('60min remaining')
    })

    it('3601s shows hours format (1 hour)', () => {
      expect(formatRemainingTime(3601, 'en')).toBe('1h remaining')
    })
  })

  describe('unknown locale falls back to en', () => {
    it('uses English format for unsupported locale', () => {
      expect(formatRemainingTime(7200, 'fr')).toBe('2h remaining')
      expect(formatRemainingTime(1800, 'de')).toBe('30min remaining')
    })
  })
})

describe('isExpiryWarning', () => {
  it('returns true when remaining <= 300 seconds (5 minutes)', () => {
    expect(isExpiryWarning(300)).toBe(true)
    expect(isExpiryWarning(299)).toBe(true)
    expect(isExpiryWarning(1)).toBe(true)
    expect(isExpiryWarning(0)).toBe(true)
  })

  it('returns false when remaining > 300 seconds', () => {
    expect(isExpiryWarning(301)).toBe(false)
    expect(isExpiryWarning(3600)).toBe(false)
    expect(isExpiryWarning(86400)).toBe(false)
  })
})
