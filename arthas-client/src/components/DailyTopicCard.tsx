/**
 * @file DailyTopicCard — 今日话题卡片组件，置顶显示在 Hub 页面上方
 *
 * 每天服务器自动创建一个公开话题房间，本组件以醒目的渐变边框卡片形式展示。
 * 包含话题标题、描述、标签、参与人数、剩余时间倒计时和加入按钮。
 *
 * @module components/DailyTopicCard
 * @see hub/types.ts — RoomListing 类型定义
 * @see hub/hubStore.ts — dailyTopic 状态管理
 */

import { useState, useEffect, useCallback } from 'react';
import type { RoomListing } from '../hub/types';
import { useTranslation } from '../i18n';

interface DailyTopicCardProps {
  /** 今日话题房间信息 */
  room: RoomListing;
  /** 点击加入时回调，传入 shareCode */
  onJoin: (shareCode: string) => void;
}

/**
 * 计算剩余分钟数。
 * @param expiresAt - 过期时间戳（Unix 秒）
 * @returns 剩余分钟数（可能为负数，表示已过期）
 */
function calcRemainingMinutes(expiresAt: number): number {
  const remainingSec = expiresAt - Math.floor(Date.now() / 1000);
  return Math.floor(remainingSec / 60);
}

/**
 * 格式化剩余时间为可读字符串。
 * - >1h: "Xh Ym"
 * - <=1h 且 >0: "Xm"
 * - <=0: 即将刷新
 */
function formatCountdown(minutes: number, refreshingSoonText: string): string {
  if (minutes <= 0) return refreshingSoonText;
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  }
  return `${minutes}m`;
}

/**
 * 今日话题卡片组件。
 *
 * 功能：
 * - 渐变边框（amber → orange）醒目展示
 * - 倒计时每 60s 更新
 * - 标签以 badge 形式展示
 * - 加入按钮触发 onJoin 回调
 * - 完整的无障碍支持
 */
export function DailyTopicCard({ room, onJoin }: DailyTopicCardProps) {
  const { t } = useTranslation();
  const tags = room.tags ?? [];

  const [remainingMinutes, setRemainingMinutes] = useState<number>(() =>
    calcRemainingMinutes(room.expiresAt)
  );

  // 每 60s 更新倒计时
  useEffect(() => {
    setRemainingMinutes(calcRemainingMinutes(room.expiresAt));

    const interval = setInterval(() => {
      setRemainingMinutes(calcRemainingMinutes(room.expiresAt));
    }, 60000);

    return () => clearInterval(interval);
  }, [room.expiresAt]);

  const handleJoin = useCallback(() => {
    onJoin(room.shareCode);
  }, [onJoin, room.shareCode]);

  const countdownText = formatCountdown(remainingMinutes, t('hub.dailyTopic.refreshingSoon'));

  return (
    <article
      className="w-full relative rounded-xl p-[2px] bg-gradient-to-r from-amber-400 to-orange-500"
      aria-label={`${t('hub.dailyTopic.title')} - ${room.title}`}
    >
      <div className="rounded-[10px] bg-gray-900 bg-gradient-to-br from-amber-900/10 to-transparent p-4 sm:p-5 space-y-3">
        {/* Header: 标题 + 倒计时 */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-amber-400 font-semibold text-sm sm:text-base flex items-center gap-1.5">
            <span aria-hidden="true">📅</span>
            {t('hub.dailyTopic.title')}
          </h3>
          <span
            className="text-xs text-amber-300/80 font-medium"
            role="timer"
            aria-live="polite"
            aria-label={`⏱ ${countdownText}`}
          >
            ⏱ {countdownText}
          </span>
        </div>

        {/* 话题标题 */}
        <h4 className="text-white font-semibold text-base sm:text-lg leading-snug">
          {room.title}
        </h4>

        {/* 话题描述 */}
        {room.description && (
          <p className="text-sm text-gray-400 leading-relaxed">
            {room.description}
          </p>
        )}

        {/* 标签列表 */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="list" aria-label="Topic tags">
            {tags.map((tag) => (
              <span
                key={tag}
                role="listitem"
                className="px-2 py-0.5 text-xs bg-amber-900/30 text-amber-300 rounded-full border border-amber-700/50"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer: 参与人数 + 公开标记 + 加入按钮 */}
        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span aria-label={`${room.memberCount} ${t('hub.dailyTopic.discussing')}`}>
              <span aria-hidden="true">👥</span> {room.memberCount} {t('hub.dailyTopic.discussing')}
            </span>
            <span className="text-emerald-400/80">
              <span aria-hidden="true">🌐</span> {t('hub.dailyTopic.publicRoom')}
            </span>
          </div>

          <button
            type="button"
            onClick={handleJoin}
            className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
          >
            {t('hub.dailyTopic.join')} →
          </button>
        </div>
      </div>
    </article>
  );
}
