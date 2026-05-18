/**
 * @file i18n Zustand store — 管理当前语言状态和切换逻辑
 * 
 * 📚 学习要点: 为什么用 Zustand 而非 React Context？
 * - 项目已使用 Zustand（chatStore），保持一致性
 * - 可在 React 组件外访问（如 chatStore 中生成系统消息时）
 * - 无需 Provider 包裹
 */

import { create } from 'zustand';

/** 支持的语言类型 */
export type Locale = 'zh' | 'en' | 'ja';

/** 所有支持的语言列表（用于验证） */
const SUPPORTED_LOCALES: Locale[] = ['zh', 'en', 'ja'];

/** 验证字符串是否为有效的 Locale */
function isValidLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

/**
 * 📚 学习要点: 语言检测的优先级链
 * localStorage（用户显式选择）> navigator.languages（浏览器偏好）> 默认英文
 */
function detectLocale(): Locale {
  // 1. localStorage 缓存（用户手动选择过）
  try {
    const saved = localStorage.getItem('arthas-locale');
    if (saved && isValidLocale(saved)) return saved;
  } catch {
    // localStorage 不可用（隐私模式等），跳过
  }

  // 2. 浏览器偏好
  const browserLangs = navigator.languages ?? [navigator.language];
  for (const lang of browserLangs) {
    const prefix = lang.split('-')[0].toLowerCase();
    if (prefix === 'zh') return 'zh';
    if (prefix === 'ja') return 'ja';
    if (prefix === 'en') return 'en';
  }

  // 3. 默认英文（国际通用回退）
  return 'en';
}

interface I18nState {
  /** 当前激活的语言 */
  locale: Locale;
  /** 切换语言（持久化 + DOM 副作用） */
  setLocale: (locale: Locale) => void;
}

/**
 * i18n 全局状态 store
 * 
 * 📚 学习要点: Zustand 的 getState() 可在组件外同步访问
 * chatStore 生成系统消息时用 useI18nStore.getState().locale 获取当前语言
 */
export const useI18nStore = create<I18nState>((set) => {
  // 初始化时检测语言并设置 html lang 属性
  const initialLocale = detectLocale();
  document.documentElement.lang = initialLocale;

  return {
    locale: initialLocale,

    setLocale: (locale: Locale) => {
      set({ locale });
      // 持久化到 localStorage
      try {
        localStorage.setItem('arthas-locale', locale);
      } catch {
        // localStorage 不可用时静默失败
      }
      // DOM 副作用
      document.documentElement.lang = locale;
      // document.title 在 translate 可用后由组件或后续逻辑设置
    },
  };
});
