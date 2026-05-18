/**
 * @file 翻译文件 barrel — 导入所有语言 JSON 并进行编译时完整性检查
 *
 * 📚 学习要点: 编译时翻译完整性检查
 * 利用 TypeScript 的类型系统，在编译时检测翻译缺失。
 * 如果 en.json 或 ja.json 缺少 zh.json 中的任何 key，
 * 类型注解会产生编译错误。
 *
 * 📚 学习要点: 为什么不用 `const _check: Record<Key, string> = en` 模式？
 * 因为 tsconfig 启用了 noUnusedLocals: true，未使用的局部变量会报 TS6133。
 * 改为通过类型注解约束变量，再将变量用于导出对象，避免 unused 报错。
 */

import zh from './zh.json';
import en from './en.json';
import ja from './ja.json';

/** 翻译 key 类型 — 以 zh.json 为基准自动推导 */
export type TranslationKey = keyof typeof zh;

/** 完整翻译记录类型 */
type Translations = Record<TranslationKey, string>;

// 📚 学习要点: 类型注解强制完整性
// 如果 en.json 或 ja.json 缺少任何 zh.json 中的 key，此处编译报错
const zhTranslations: Translations = zh;
const enTranslations: Translations = en;
const jaTranslations: Translations = ja;

/** 所有语言的翻译数据 */
export const locales = {
  zh: zhTranslations,
  en: enTranslations,
  ja: jaTranslations,
};

/** 支持的语言类型 */
export type Locale = keyof typeof locales;
