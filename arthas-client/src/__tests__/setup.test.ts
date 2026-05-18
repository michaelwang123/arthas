/**
 * 测试环境验证 — 确认 Vitest + happy-dom + fast-check 正常工作
 *
 * 📚 学习要点: 为什么需要验证测试环境？
 * - 确保 vitest.config.ts 配置正确（globals、environment、setupFiles）
 * - 确保 happy-dom 提供了必要的 DOM API
 * - 确保 fast-check 属性测试库可正常导入和运行
 * - 这个文件在后续开发中可以删除，仅用于初始验证
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

describe('Test environment verification', () => {
  it('should run a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have access to DOM APIs via happy-dom', () => {
    const div = document.createElement('div');
    div.textContent = 'hello';
    expect(div.textContent).toBe('hello');
  });

  it('should run a fast-check property test', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => {
        // 加法交换律：a + b === b + a
        expect(a + b).toBe(b + a);
      })
    );
  });
});
