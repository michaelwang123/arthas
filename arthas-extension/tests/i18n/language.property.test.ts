/**
 * Property-based test for language detection.
 *
 * **Validates: Requirements 12.3, 12.4, 12.5**
 *
 * Property 11: Language Detection
 * For any navigator.language string, detectLanguage() returns exactly one of 'en', 'zh', 'ja'.
 * If the first 2 characters match a supported locale, that locale is returned; otherwise 'en'.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { detectLanguage } from '../../src/i18n/index';
import type { Locale } from '../../src/i18n/index';

const SUPPORTED_LOCALES: Locale[] = ['en', 'zh', 'ja'];

/**
 * Helper to set navigator.language for testing.
 * happy-dom allows property assignment on navigator.
 */
function setNavigatorLanguage(lang: string): void {
  Object.defineProperty(navigator, 'language', {
    value: lang,
    writable: true,
    configurable: true,
  });
}

describe('Property 11: Language Detection', () => {
  afterEach(() => {
    // Reset navigator.language to a default after each test
    setNavigatorLanguage('en-US');
  });

  it('for any navigator.language string, detectLanguage returns exactly one of en, zh, ja', () => {
    fc.assert(
      fc.property(fc.string(), (langStr) => {
        setNavigatorLanguage(langStr);
        const result = detectLanguage();

        // Must return exactly one of the supported locales
        expect(SUPPORTED_LOCALES).toContain(result);
      }),
      { numRuns: 200 }
    );
  });

  it('if the first 2 chars match a supported locale, that locale is returned', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_LOCALES),
        fc.string(),
        (locale, suffix) => {
          // Build a navigator.language string that starts with a supported locale prefix
          const langStr = locale + suffix;
          setNavigatorLanguage(langStr);
          const result = detectLanguage();

          // The detected locale must match the prefix
          expect(result).toBe(locale);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('if the first 2 chars do NOT match any supported locale, en is returned', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 2 }).filter((s) => {
          const prefix = s.slice(0, 2).toLowerCase();
          return !SUPPORTED_LOCALES.includes(prefix as Locale);
        }),
        (langStr) => {
          setNavigatorLanguage(langStr);
          const result = detectLanguage();

          // Must default to 'en'
          expect(result).toBe('en');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('empty or short strings default to en', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 1 }).filter((s) => {
          // Single char or empty — can't match a 2-char locale prefix
          // unless it happens to be empty (which detectLanguage handles)
          const prefix = s.slice(0, 2).toLowerCase();
          return !SUPPORTED_LOCALES.includes(prefix as Locale);
        }),
        (langStr) => {
          setNavigatorLanguage(langStr);
          const result = detectLanguage();

          expect(result).toBe('en');
        }
      ),
      { numRuns: 50 }
    );
  });
});
