import { describe, it, expect } from 'vitest';
import { ROOM_TEMPLATES, type TemplateThemeColor } from './templateConfig';
import { locales } from '../../i18n/locales';

/**
 * Deterministic tests for ROOM_TEMPLATES configuration completeness.
 *
 * **Validates: Requirements 1.3**
 *
 * Property 1: Template Config Completeness
 * For every template in ROOM_TEMPLATES, all required fields SHALL be present
 * with valid types and values.
 *
 * Uses deterministic it.each over the fixed template array for clarity and speed.
 */

const VALID_THEME_COLORS: TemplateThemeColor[] = [
  'indigo',
  'emerald',
  'amber',
  'purple',
  'blue',
  'orange',
  'pink',
];

describe('Property 1: Template Config Completeness', () => {
  it.each(ROOM_TEMPLATES.map((t, i) => [t.id, i] as const))(
    'template "%s" has all required fields with valid types/values',
    (_id, index) => {
      const template = ROOM_TEMPLATES[index];

      // Non-empty emoji
      expect(template.emoji).toBeTruthy();

      // Non-empty nameKey
      expect(template.nameKey).toBeTruthy();

      // Non-empty descriptionKey
      expect(template.descriptionKey).toBeTruthy();

      // Tags array with at least 1 non-empty string
      expect(template.tags.length).toBeGreaterThanOrEqual(1);
      for (const tag of template.tags) {
        expect(tag.length).toBeGreaterThan(0);
      }

      // expirySeconds >= 0
      expect(template.expirySeconds).toBeGreaterThanOrEqual(0);

      // ephemeralSeconds >= 0
      expect(template.ephemeralSeconds).toBeGreaterThanOrEqual(0);

      // boolean passwordRecommended
      expect(typeof template.passwordRecommended).toBe('boolean');

      // valid themeColor
      expect(VALID_THEME_COLORS).toContain(template.themeColor);
    }
  );
});


/**
 * Deterministic tests for i18n key completeness.
 *
 * **Validates: Requirements 6.1, 6.2**
 *
 * Property 3: i18n Key Completeness
 * For every template in ROOM_TEMPLATES, resolving nameKey and descriptionKey
 * through the translation system SHALL produce a non-empty string for both
 * the zh and en locales.
 */
describe('Property 3: i18n Key Completeness', () => {
  it.each(ROOM_TEMPLATES.map((t) => [t.id, t.nameKey, t.descriptionKey] as const))(
    'template "%s" has non-empty translations in zh and en',
    (_id, nameKey, descriptionKey) => {
      // Resolve nameKey in both locales
      const zhName = locales.zh[nameKey as keyof typeof locales.zh];
      const enName = locales.en[nameKey as keyof typeof locales.en];

      expect(zhName).toBeTruthy();
      expect(enName).toBeTruthy();

      // Resolve descriptionKey in both locales
      const zhDesc = locales.zh[descriptionKey as keyof typeof locales.zh];
      const enDesc = locales.en[descriptionKey as keyof typeof locales.en];

      expect(zhDesc).toBeTruthy();
      expect(enDesc).toBeTruthy();
    }
  );
});
