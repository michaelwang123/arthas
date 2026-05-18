/**
 * @file 纯翻译函数 — 根据 locale 和 key 返回翻译文本
 *
 * 📚 学习要点: 为什么翻译函数是纯函数？
 * 纯函数（无副作用、相同输入相同输出）便于测试和推理。
 * 状态（当前 locale）由 store 管理，翻译函数只负责查找和插值。
 */

import { locales } from './locales';
import type { Locale, TranslationKey, TranslationParams } from './types';

/**
 * 翻译函数 — 根据 locale 和 key 查找翻译文本，支持参数插值
 *
 * 📚 学习要点: Fallback 链设计
 * 1. 当前 locale 的翻译
 * 2. 英文翻译（通用回退 — 英文比中文对非中文用户更友好）
 * 3. 原始 key（开发时易发现遗漏）
 *
 * @param locale - 目标语言
 * @param key - 翻译 key（如 'home.title'）
 * @param params - 插值参数（如 { name: 'Alice' }）
 * @returns 翻译后的文本
 */
export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const template = locales[locale]?.[key] ?? locales['en']?.[key] ?? key;
  if (!params) return template;

  // 📚 学习要点: {{name}} 插值语法
  // 使用正则替换 {{key}} 为 params 中对应的值
  // \w+ 匹配字母数字下划线，覆盖常见参数名
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(params[k] ?? ''));
}
