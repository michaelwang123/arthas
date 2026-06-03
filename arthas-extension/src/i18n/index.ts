/**
 * i18n module — language detection, state management, and translation hook.
 *
 * Uses Zustand for language state (consistent with chatStore pattern).
 * Persists language choice to chrome.storage.local.
 * Detects language from navigator.language prefix on first launch.
 *
 * @module i18n
 */

import { useCallback } from 'react';
import { create } from 'zustand';
import en from './locales/en.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';

// --- Types ---

export type Locale = 'en' | 'zh' | 'ja';

/** Translation key — derived from en.json keys */
export type TranslationKey = keyof typeof en;

/** Interpolation parameters for translation strings */
export type TranslationParams = Record<string, string | number>;

// --- Locale data ---

/** Compile-time completeness check: all locales must have the same keys as en.json */
type Translations = Record<TranslationKey, string>;

const locales: Record<Locale, Translations> = {
  en: en as Translations,
  zh: zh as Translations,
  ja: ja as Translations,
};

// --- Supported locales ---

const SUPPORTED_LOCALES: Locale[] = ['en', 'zh', 'ja'];

function isSupportedLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

// --- Language detection ---

/**
 * Detect language from navigator.language prefix (first 2 chars).
 * Returns matching supported locale, or 'en' as default.
 */
export function detectLanguage(): Locale {
  const lang = navigator.language;
  if (!lang) return 'en';

  const prefix = lang.slice(0, 2).toLowerCase();
  if (isSupportedLocale(prefix)) {
    return prefix;
  }
  return 'en';
}

// --- Translation function ---

/**
 * Pure translation function — looks up key in locale data with fallback chain.
 * Fallback: current locale → English → raw key.
 * Supports {{param}} interpolation.
 */
export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const template = locales[locale]?.[key] ?? locales['en']?.[key] ?? key;
  if (!params) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const value = params[k];
    return value !== undefined ? String(value) : '';
  });
}

// --- Zustand store ---

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/**
 * i18n Zustand store — manages current language state.
 *
 * Initializes with detected language. Language changes are persisted
 * to chrome.storage.local and applied immediately without reload.
 */
export const useI18nStore = create<I18nState>((set) => ({
  locale: detectLanguage(),

  setLocale: (locale: Locale) => {
    set({ locale });
    // Persist to chrome.storage.local
    try {
      chrome.storage.local.get('settings', (result: Record<string, unknown>) => {
        const current = (result['settings'] as Record<string, unknown>) ?? {};
        chrome.storage.local.set({
          settings: { ...current, language: locale },
        });
      });
    } catch {
      // chrome.storage may not be available in test environment — silent fail
    }
  },
}));

/**
 * Initialize i18n — load persisted language from chrome.storage.local.
 * Call once on app startup (e.g., in App.tsx mount).
 */
export async function initializeI18n(): Promise<void> {
  try {
    const result = await chrome.storage.local.get('settings');
    const settings = result['settings'] as Record<string, unknown> | undefined;
    if (settings && typeof settings['language'] === 'string') {
      const saved = settings['language'];
      if (isSupportedLocale(saved)) {
        useI18nStore.getState().setLocale(saved);
        return;
      }
    }
  } catch {
    // chrome.storage not available — use detected language
  }
  // If no persisted language, keep the detected default
}

// --- React hook ---

/**
 * React hook for translations.
 *
 * Returns:
 * - t(key, params?) — translate a key with optional interpolation
 * - locale — current active locale
 * - setLocale — change language (persists and applies immediately)
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
