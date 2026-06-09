/**
 * @file MatchEntry — Hub 页面上的 Random Match 入口组件
 *
 * 显示一个醒目的 "Random Match" 按钮/卡片，附带在线人数。
 * 当 matchEnabled 为 false 时隐藏。
 *
 * @module match/MatchEntry
 */

import { useEffect } from 'react';
import { useTranslation } from '../i18n';
import { useMatchStore } from './matchStore';

interface MatchEntryProps {
  /** 点击入口时的回调 */
  onStart: () => void;
}

/**
 * Random Match 入口组件。
 *
 * 功能：
 * - 醒目渐变按钮/卡片样式
 * - 显示 matchStore.onlineCount
 * - matchEnabled 为 false 时不渲染
 * - 支持 i18n
 */
export function MatchEntry({ onStart }: MatchEntryProps) {
  const { t } = useTranslation();
  const matchEnabled = useMatchStore((s) => s.matchEnabled);
  const onlineCount = useMatchStore((s) => s.onlineCount);
  const fetchMatchStatus = useMatchStore((s) => s.fetchMatchStatus);

  // Fetch match status on mount
  useEffect(() => {
    void fetchMatchStatus();
  }, [fetchMatchStatus]);

  if (!matchEnabled) return null;

  return (
    <button
      type="button"
      onClick={onStart}
      className="w-full relative rounded-xl p-[2px] bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 transition-all duration-200 shadow-sm hover:shadow-lg group"
      aria-label={t('match.entry.ariaLabel')}
    >
      <div className="rounded-[10px] bg-gray-900 px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">🎲</span>
          <div className="text-left">
            <h3 className="text-white font-semibold text-sm sm:text-base group-hover:text-purple-200 transition-colors">
              {t('match.entry.title')}
            </h3>
            <p className="text-xs text-gray-400">
              {t('match.entry.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-gray-400 shrink-0">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" aria-hidden="true" />
          <span aria-label={t('match.entry.online', { count: String(onlineCount) })}>
            {onlineCount}
          </span>
        </div>
      </div>
    </button>
  );
}
