/**
 * i18n 工具模块 — 国际化翻译辅助函数
 *
 * 本文件提供 Arthas 官网的多语言支持基础设施。
 * 所有 .astro 组件通过 t() 函数获取当前语言的 UI 文案，
 * 通过 getLocaleFromUrl() 从 URL 路径推断当前语言。
 *
 * 📚 学习要点: 静态站点 i18n 策略
 * Astro 是静态站点生成器，i18n 在 build-time 完成（非运行时）。
 * 每个语言版本生成独立的 HTML 文件（/arthas/ 和 /arthas/zh/），
 * 翻译函数在 Astro 组件的 frontmatter（服务端）中执行，
 * 输出的 HTML 已包含正确语言的文案，无需客户端 JS 切换。
 */

import zh from './zh.json';
import en from './en.json';

/**
 * 📚 学习要点: as const 断言
 * `as const` 让 TypeScript 将 translations 的 key 推断为字面量类型 'zh' | 'en'，
 * 而非宽泛的 string。这使得 Locale 类型自动与实际翻译文件保持同步 —
 * 新增语言只需添加 JSON 文件并在此处导入，类型系统自动更新。
 */
const translations = { zh, en } as const;

/** 支持的语言标识符类型，从 translations 对象的 key 自动推断 */
export type Locale = keyof typeof translations;

/**
 * 获取指定 key 在目标语言下的翻译文案。
 *
 * 查找策略（fallback chain）：
 * 1. 目标语言的翻译
 * 2. 英文翻译（默认 fallback）
 * 3. 原始 key 字符串（兜底，便于发现缺失翻译）
 *
 * @param key - 点分隔的翻译键，如 "hero.title" 或 "features.e2ee.description"
 * @param locale - 目标语言，默认为 'en'
 * @returns 翻译后的字符串，若 key 不存在则返回 key 本身
 *
 * @example
 * ```typescript
 * t('hero.title', 'zh')  // → "Arthas"
 * t('hero.tagline', 'en') // → "Encrypted AirDrop + Ephemeral Chat..."
 * t('nonexistent.key')    // → "nonexistent.key"（fallback 到 key 本身）
 * ```
 */
export function t(key: string, locale: Locale = 'en'): string {
  // 📚 学习要点: Record 索引访问
  // JSON 文件被 TypeScript 推断为 { [key: string]: string } 类型，
  // 使用可选链 (?.) 安全访问，避免 locale 或 key 不存在时抛出异常。
  const dict = translations[locale] as Record<string, string>;
  const fallback = translations['en'] as Record<string, string>;
  return dict?.[key] ?? fallback[key] ?? key;
}

/**
 * 从 URL 路径推断当前页面的语言。
 *
 * 检测逻辑：如果 URL 路径以 `/arthas/zh` 开头，则为中文；否则为英文。
 * 这与 Astro 的路由结构一致：
 * - `/arthas/` → 英文（defaultLocale，无前缀）
 * - `/arthas/zh/` → 中文
 *
 * @param url - 当前页面的 URL 对象（在 Astro 组件中通过 `Astro.url` 获取）
 * @returns 检测到的语言标识符 ('zh' | 'en')
 *
 * @example
 * ```typescript
 * getLocaleFromUrl(new URL('https://example.com/arthas/zh/docs/'))  // → 'zh'
 * getLocaleFromUrl(new URL('https://example.com/arthas/docs/'))     // → 'en'
 * getLocaleFromUrl(new URL('https://example.com/arthas/'))          // → 'en'
 * ```
 */
export function getLocaleFromUrl(url: URL): Locale {
  return url.pathname.startsWith('/arthas/zh') ? 'zh' : 'en';
}

/**
 * Base URL with guaranteed trailing slash for safe path concatenation.
 *
 * 📚 学习要点: 尾部斜杠规范化
 * import.meta.env.BASE_URL 可能返回 '/arthas' 或 '/arthas/'（取决于配置和 Astro 版本）。
 * 直接拼接子路径会产生 '/arthasdownload/' 这样的错误 URL。
 * 统一导出带尾部斜杠的版本，所有组件共享同一份计算逻辑，避免重复代码。
 */
export const baseWithSlash: string = (() => {
  const base = import.meta.env.BASE_URL;
  return base.endsWith('/') ? base : `${base}/`;
})();
