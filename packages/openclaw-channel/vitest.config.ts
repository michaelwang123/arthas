/**
 * @file vitest.config.ts — Vitest 测试框架配置
 *
 * 📚 学习要点: 测试框架选择
 * 选择 Vitest 而非 Jest 的原因：
 * 1. 原生 ESM 支持（本项目使用 "type": "module"）
 * 2. 与 TypeScript 无缝集成（无需 ts-jest 转换器）
 * 3. 与 arthas-client 保持一致的测试工具链
 * 4. 更快的执行速度（基于 Vite 的转换管线）
 *
 * @module openclaw-channel/vitest.config
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /* 测试文件匹配模式：tests/ 目录下的 .test.ts 文件 */
    include: ['tests/**/*.test.ts'],

    /* 使用 Node.js 环境（本插件运行在 OpenClaw Gateway 进程中） */
    environment: 'node',

    /* 启用全局 describe/it/expect（减少 import 样板代码） */
    globals: true,

    /* 测试超时时间（加密操作可能较慢） */
    testTimeout: 10000,
  },
});
