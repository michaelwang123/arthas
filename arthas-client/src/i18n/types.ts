/**
 * @file i18n 类型定义 — 集中导出所有 i18n 相关类型
 *
 * 📚 学习要点: 单一类型来源
 * TranslationKey 和 Locale 的真正定义在 locales/index.ts（从 JSON 推导）。
 * 本文件仅 re-export，确保外部模块有统一的导入路径。
 * 避免在多处重复定义类型导致不一致。
 */

export type { TranslationKey, Locale } from './locales';

/** 翻译函数的插值参数类型 */
export type TranslationParams = Record<string, string | number>;
