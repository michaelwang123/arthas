/**
 * @file HubFilters — sort mode tabs, search input, and tag filter badges for the Hub page.
 *
 * Dynamically derives popular tags from the currently loaded rooms.
 * Falls back to a set of default tags when no rooms are loaded.
 *
 * @module components/HubFilters
 */

import { useMemo, useRef, useEffect, useState } from 'react';
import { useHubStore } from '../hub/hubStore';
import type { SortMode } from '../hub/hubStore';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n';

/** Sort mode button definitions. */
const SORT_MODES: ReadonlyArray<{ value: SortMode; labelKey: TranslationKey; icon?: string }> = [
  { value: '', labelKey: 'hub.sort.all' },
  { value: 'active', labelKey: 'hub.sort.active', icon: '🔥' },
  { value: 'people', labelKey: 'hub.sort.people', icon: '👥' },
  { value: 'newest', labelKey: 'hub.sort.newest', icon: '🆕' },
];

/** Fallback tags shown when no rooms are loaded or tags are empty. */
const DEFAULT_TAGS = ['dev', 'gaming', 'random', 'help', 'ama'];

/** Maximum number of tag badges to display. */
const MAX_DISPLAY_TAGS = 8;

export function HubFilters() {
  const { t } = useTranslation();
  const filters = useHubStore((s) => s.filters);
  const rooms = useHubStore((s) => s.rooms);
  const sortMode = useHubStore((s) => s.sortMode);
  const setTagFilter = useHubStore((s) => s.setTagFilter);
  const setSearchQuery = useHubStore((s) => s.setSearchQuery);
  const setSortMode = useHubStore((s) => s.setSortMode);

  // Derive popular tags from current rooms (sorted by frequency), fallback to defaults
  const popularTags = useMemo(() => {
    if (rooms.length === 0) return DEFAULT_TAGS;

    const tagCount = new Map<string, number>();
    for (const room of rooms) {
      for (const tag of (room.tags ?? [])) {
        tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      }
    }

    if (tagCount.size === 0) return DEFAULT_TAGS;

    // Sort by frequency descending, take top N
    return [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_DISPLAY_TAGS)
      .map(([tag]) => tag);
  }, [rooms]);

  const handleTagClick = (tag: string) => {
    // Toggle: click active tag to clear
    setTagFilter(filters.tag === tag ? '' : tag);
  };

  const handleClearAll = () => {
    setTagFilter('');
    setSearchQuery('');
  };

  /** Returns the display label for the current sort mode (used for aria-live announcement). */
  const currentSortLabel = useMemo(() => {
    const mode = SORT_MODES.find((m) => m.value === sortMode);
    return mode ? t(mode.labelKey) : t('hub.sort.all');
  }, [sortMode, t]);

  // Only announce sort mode changes, not the initial render.
  const [announcement, setAnnouncement] = useState('');
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setAnnouncement(t('hub.sort.changed', { mode: currentSortLabel }));
  }, [sortMode, currentSortLabel, t]);

  const hasFilters = filters.tag !== '' || filters.query !== '';

  return (
    <div className="space-y-3">
      {/* Sort mode buttons */}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('hub.sort.all')}>
        {SORT_MODES.map((mode) => (
          <button
            key={mode.value}
            onClick={() => setSortMode(mode.value)}
            aria-pressed={sortMode === mode.value}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              sortMode === mode.value
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300 border border-gray-700'
            }`}
          >
            {mode.icon && <span aria-hidden="true">{mode.icon} </span>}
            {t(mode.labelKey)}
          </button>
        ))}
      </div>

      {/* Aria-live region for sort mode change announcements (empty on initial render) */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* Search input */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm" aria-hidden="true">🔍</span>
        <input
          type="text"
          value={filters.query}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('hub.searchPlaceholder')}
          aria-label={t('hub.searchPlaceholder')}
          className="w-full pl-9 pr-4 py-2.5 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors"
        />
      </div>

      {/* Tag badges */}
      <div className="flex flex-wrap items-center gap-2">
        {popularTags.map((tag) => (
          <button
            key={tag}
            onClick={() => handleTagClick(tag)}
            aria-pressed={filters.tag === tag}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filters.tag === tag
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300 border border-gray-700'
            }`}
          >
            {tag}
          </button>
        ))}

        {hasFilters && (
          <button
            onClick={handleClearAll}
            className="px-3 py-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ✕ {t('hub.clearFilters')}
          </button>
        )}
      </div>
    </div>
  );
}
