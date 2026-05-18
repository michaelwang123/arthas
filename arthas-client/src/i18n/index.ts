/**
 * @file i18n 模块公共 API — 统一导出翻译系统的所有公共接口
 *
 * 📚 学习要点: Barrel 文件模式
 * 外部模块只需 `import { useTranslation, translate } from '../i18n'`
 * 无需关心内部文件结构。修改内部实现不影响外部导入路径。
 *
 * @module i18n
 * @see store.ts — 状态管理
 * @see translate.ts — 翻译函数
 * @see locales/ — 翻译文件
 */

import { useCallback } from 'react';
import { useI18nStore } from './store';
import { translate } from './translate';
import type { TranslationKey, TranslationParams } from './types';

// Re-export public API
export { useI18nStore } from './store';
export { translate } from './translate';
export type { TranslationKey, Locale, TranslationParams } from './types';

/**
 * React Hook — 在组件中使用翻译
 *
 * 📚 学习要点: 为什么用 useCallback 包裹 t？
 * 当 locale 不变时，t 函数引用保持稳定，
 * 避免将 t 作为 prop 传递时触发子组件不必要的重渲染。
 * locale 变化时 useCallback 重新创建 t，所有使用 t 的组件自动更新。
 *
 * @returns { t, locale, setLocale }
 */
export function useTranslation() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    [locale]
  );

  return { t, locale, setLocale };
}
