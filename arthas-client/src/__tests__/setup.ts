/**
 * Vitest 全局 Setup 文件
 *
 * 📚 学习要点: 测试 Setup 文件的作用
 * - 在所有测试文件执行前运行一次
 * - 扩展 Vitest 的 expect 断言，添加 DOM 相关的 matchers
 * - 例如：expect(element).toBeInTheDocument()、toHaveClass() 等
 * - 这些 matchers 来自 @testing-library/jest-dom，让 DOM 断言更语义化
 */
import '@testing-library/jest-dom';
