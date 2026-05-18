/**
 * Vitest 测试框架配置
 *
 * 📚 学习要点: 为什么使用独立的 vitest.config.ts？
 * - Vite 的构建配置（vite.config.ts）面向浏览器打包
 * - 测试配置需要不同的环境（happy-dom 模拟 DOM）和额外插件
 * - 分离配置避免测试设置污染生产构建
 *
 * happy-dom 是一个轻量级 DOM 实现，比 jsdom 更快，
 * 适合 React 组件测试中模拟浏览器环境。
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    /** 使用 happy-dom 作为测试环境，提供 DOM API 模拟 */
    environment: 'happy-dom',
    /** 全局引入测试工具函数（describe, it, expect 等），无需每个文件手动 import */
    globals: true,
    /** 测试文件匹配模式 */
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    /** 测试启动前执行的 setup 文件（如全局 matchers 扩展） */
    setupFiles: ['src/__tests__/setup.ts'],
  },
});
