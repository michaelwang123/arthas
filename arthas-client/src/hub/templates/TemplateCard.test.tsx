import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { render, fireEvent } from '@testing-library/react';
import { TemplateCard } from './TemplateCard';
import { ROOM_TEMPLATES } from './templateConfig';

/**
 * Mock the i18n useTranslation hook — returns the key itself as the translated string.
 */
vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    t: (key: string, _params?: Record<string, string>) => key,
    locale: 'en',
    setLocale: vi.fn(),
  }),
}));

/**
 * Deterministic tests for TemplateCard accessibility structure.
 *
 * **Validates: Requirements 7.1, 7.4, 7.5**
 *
 * Property 4: Accessibility Structure
 * For every rendered template card, the card element SHALL be keyboard-focusable
 * (tabIndex 0), have role="listitem", have an aria-label containing the template name,
 * and the emoji icon element SHALL have aria-hidden="true".
 */
describe('Property 4: Accessibility Structure', () => {
  it.each(ROOM_TEMPLATES.map((t, i) => [t.id, i] as const))(
    'template "%s" card has correct ARIA attributes and focusability',
    (_id, index) => {
      const template = ROOM_TEMPLATES[index];
      const onSelect = vi.fn();

      const { container, unmount } = render(
        <TemplateCard template={template} index={0} onSelect={onSelect} />
      );

      const card = container.querySelector('[role="listitem"]');
      expect(card).not.toBeNull();
      expect(card!.getAttribute('tabindex')).toBe('0');

      const ariaLabel = card!.getAttribute('aria-label');
      expect(ariaLabel).toContain(template.nameKey);

      // Emoji element has aria-hidden="true"
      const ariaHiddenEls = container.querySelectorAll('[aria-hidden="true"]');
      const emojiEl = Array.from(ariaHiddenEls).find(
        (el) => el.textContent?.includes(template.emoji)
      );
      expect(emojiEl).toBeDefined();

      unmount();
    }
  );
});

/**
 * Property-based test for TemplateCard keyboard activation equivalence.
 *
 * **Validates: Requirements 7.3**
 *
 * Property 5: Keyboard Activation Equivalence
 * For any rendered template card, pressing Enter or Space on the focused card
 * SHALL trigger the same selection handler as a mouse click on that card.
 *
 * Kept as PBT because it tests interaction behavior across all templates.
 */
describe('Property 5: Keyboard Activation Equivalence', () => {
  it('Enter and Space keypresses on a focused card trigger onSelect same as click', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: ROOM_TEMPLATES.length - 1 }),
        (index) => {
          const template = ROOM_TEMPLATES[index];
          const onSelect = vi.fn();

          const { getByRole, unmount } = render(
            <TemplateCard template={template} index={index} onSelect={onSelect} />
          );

          const card = getByRole('listitem');

          // Verify click triggers onSelect with the template
          fireEvent.click(card);
          expect(onSelect).toHaveBeenCalledTimes(1);
          expect(onSelect).toHaveBeenCalledWith(template);

          // Reset mock, verify Enter keyDown triggers onSelect
          onSelect.mockReset();
          fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' });
          expect(onSelect).toHaveBeenCalledTimes(1);
          expect(onSelect).toHaveBeenCalledWith(template);

          // Reset mock, verify Space keyDown triggers onSelect
          onSelect.mockReset();
          fireEvent.keyDown(card, { key: ' ', code: 'Space' });
          expect(onSelect).toHaveBeenCalledTimes(1);
          expect(onSelect).toHaveBeenCalledWith(template);

          unmount();
        }
      ),
      { numRuns: 50 }
    );
  });
});


/**
 * Deterministic tests for TemplateCard reduced-motion compliance.
 *
 * **Validates: Requirements 3.5**
 *
 * Property 6: Reduced-Motion Compliance
 * For every rendered template card, motion-reduce:* Tailwind utility classes SHALL be
 * present on the card container, shimmer overlay, and pulse-glow emoji element.
 */
describe('Property 6: Reduced-Motion Compliance', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it.each(ROOM_TEMPLATES.map((t, i) => [t.id, i] as const))(
    'template "%s" has motion-reduce classes on card, shimmer, and pulse-glow',
    (_id, index) => {
      const template = ROOM_TEMPLATES[index];
      const onSelect = vi.fn();

      const { container, unmount } = render(
        <TemplateCard template={template} index={index} onSelect={onSelect} />
      );

      // Card container
      const card = container.querySelector('[role="listitem"]');
      expect(card).not.toBeNull();
      expect(card!.className).toContain('motion-reduce:animate-none');
      expect(card!.className).toContain('motion-reduce:transition-none');
      expect(card!.className).toContain('motion-reduce:opacity-100');

      // Shimmer overlay
      const shimmer = container.querySelector('.animate-shimmer');
      expect(shimmer).not.toBeNull();
      expect(shimmer!.className).toContain('motion-reduce:animate-none');

      // Pulse-glow emoji
      const pulseGlow = container.querySelector('.animate-pulse-glow');
      expect(pulseGlow).not.toBeNull();
      expect(pulseGlow!.className).toContain('motion-reduce:animate-none');

      unmount();
    }
  );
});
