/**
 * @file TemplateCard — animated card component for a single room template.
 *
 * Renders emoji icon with pulse-glow, translated name/description, preset badges,
 * shimmer background, hover lift, staggered fade-in, and full keyboard/ARIA accessibility.
 *
 * @module hub/templates/TemplateCard
 * @see templateConfig.ts — TemplateConfig type
 * @see design.md — animation specifications
 */

import { useCallback } from 'react';
import type { TemplateConfig, TemplateThemeColor } from './templateConfig';
import { useTranslation } from '../../i18n';

export interface TemplateCardProps {
  /** Template data to render */
  template: TemplateConfig;
  /** Stagger index for animation delay calculation */
  index: number;
  /** Triggered when user clicks/activates the card */
  onSelect: (template: TemplateConfig) => void;
}

/** Map theme colors to CSS rgba glow values */
const GLOW_COLOR_MAP: Record<TemplateThemeColor, string> = {
  indigo: 'rgba(99,102,241,0.5)',
  emerald: 'rgba(16,185,129,0.5)',
  amber: 'rgba(245,158,11,0.5)',
  purple: 'rgba(168,85,247,0.5)',
  blue: 'rgba(59,130,246,0.5)',
  orange: 'rgba(249,115,22,0.5)',
  pink: 'rgba(236,72,153,0.5)',
};

/** Map theme colors to Tailwind border classes for hover state */
const BORDER_COLOR_MAP: Record<TemplateThemeColor, string> = {
  indigo: 'hover:border-indigo-400',
  emerald: 'hover:border-emerald-400',
  amber: 'hover:border-amber-400',
  purple: 'hover:border-purple-400',
  blue: 'hover:border-blue-400',
  orange: 'hover:border-orange-400',
  pink: 'hover:border-pink-400',
};

/**
 * Format expiry seconds into a human-readable time badge string.
 * e.g. 3600 → "1h", 86400 → "24h", 7200 → "2h", 1800 → "30min", 5400 → "1h30min"
 */
function formatExpiryBadge(seconds: number): string {
  if (seconds <= 0) return '';
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h${m}min` : `${h}h`;
  }
  return `${Math.round(seconds / 60)}min`;
}

/**
 * TemplateCard renders a single room template as an animated, accessible card.
 *
 * Features:
 * - Pulse-glow animation on emoji icon with theme-colored glow
 * - Shimmer background sweep animation (3.5s cycle)
 * - Staggered fade-in-up entry animation via index-based delay
 * - Hover lift (translateY -4px) with border brighten
 * - Preset badges: expiry time, ephemeral, password
 * - Full keyboard support (Enter/Space triggers onSelect)
 * - ARIA: role="listitem", aria-label, aria-hidden on emoji
 * - motion-reduce:animate-none for prefers-reduced-motion
 */
export function TemplateCard({ template, index, onSelect }: TemplateCardProps) {
  const { t } = useTranslation();

  const handleSelect = useCallback(() => {
    onSelect(template);
  }, [onSelect, template]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(template);
      }
    },
    [onSelect, template]
  );

  const glowColor = GLOW_COLOR_MAP[template.themeColor];
  const hoverBorderClass = BORDER_COLOR_MAP[template.themeColor];
  const templateName = t(template.nameKey);
  const templateDesc = t(template.descriptionKey);

  return (
    <div
      role="listitem"
      aria-label={templateName}
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={handleKeyDown}
      className={`
        group relative overflow-hidden rounded-xl p-4 cursor-pointer
        bg-gray-800 border border-gray-700
        ${hoverBorderClass}
        hover:-translate-y-1 hover:shadow-lg
        transition-all duration-250 ease-out
        focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900
        opacity-0 animate-fade-in-up
        motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:transition-none
      `}
      style={{
        animationDelay: `${index * 120}ms`,
      }}
    >
      {/* Shimmer overlay */}
      <div
        className="absolute inset-0 pointer-events-none animate-shimmer motion-reduce:animate-none"
        style={{
          backgroundImage: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%)`,
          backgroundSize: '200% 100%',
        }}
        aria-hidden="true"
      />

      {/* Card content */}
      <div className="relative z-10 space-y-2">
        {/* Emoji with pulse-glow */}
        <div
          className="w-12 h-12 flex items-center justify-center rounded-lg text-2xl animate-pulse-glow motion-reduce:animate-none"
          style={{ '--glow-color': glowColor } as React.CSSProperties}
          aria-hidden="true"
        >
          {template.emoji}
        </div>

        {/* Name */}
        <h4 className="text-white font-semibold text-sm leading-tight">
          {templateName}
        </h4>

        {/* Description */}
        <p className="text-gray-400 text-xs leading-relaxed line-clamp-2">
          {templateDesc}
        </p>

        {/* Badges */}
        <div className="flex flex-wrap gap-1 pt-1">
          {template.expirySeconds > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-700/80 text-gray-300 rounded">
              {t('hub.templates.badge.expiry', { time: formatExpiryBadge(template.expirySeconds) })}
            </span>
          )}
          {template.ephemeralSeconds > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-700/80 text-gray-300 rounded">
              {t('hub.templates.badge.ephemeral')}
            </span>
          )}
          {template.passwordRecommended && (
            <span className="px-1.5 py-0.5 text-[10px] bg-gray-700/80 text-gray-300 rounded">
              {t('hub.templates.badge.password')}
            </span>
          )}
        </div>
      </div>

      {/* Hover gradient overlay */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-250 pointer-events-none rounded-xl bg-gradient-to-t from-white/[0.02] to-transparent"
        aria-hidden="true"
      />
    </div>
  );
}
