/**
 * @file MatchWaiting — 匹配等待中 UI 组件
 *
 * 显示动画等待指示器、已等待时间、取消按钮和邀请好友选项。
 * 支持 Escape 键取消，完整 ARIA 标签。
 *
 * @module match/MatchWaiting
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../i18n';
import { useMatchStore } from './matchStore';

interface MatchWaitingProps {
  /** 点击"邀请好友"时的回调 */
  onInvite: () => void;
}

/**
 * 匹配等待中组件。
 *
 * 功能：
 * - 脉冲 CSS 动画等待指示器
 * - 显示已等待秒数（实时计时）
 * - "取消" 按钮 + Escape 键取消
 * - "邀请好友" 选项
 * - ARIA live region 播报等待状态
 */
export function MatchWaiting({ onInvite }: MatchWaitingProps) {
  const { t } = useTranslation();
  const cancelMatch = useMatchStore((s) => s.cancelMatch);
  const waitStartTime = useMatchStore((s) => s.waitStartTime);
  const [elapsed, setElapsed] = useState(0);

  // Timer: update elapsed seconds
  useEffect(() => {
    if (!waitStartTime) return;

    const update = () => {
      setElapsed(Math.floor((Date.now() - waitStartTime) / 1000));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [waitStartTime]);

  // Escape key to cancel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelMatch();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cancelMatch]);

  const handleCancel = useCallback(() => {
    cancelMatch();
  }, [cancelMatch]);

  return (
    <div
      className="flex flex-col items-center justify-center space-y-6 py-8"
      role="status"
      aria-live="polite"
      aria-label={t('match.waiting.ariaLabel')}
    >
      {/* Pulsing animation indicator */}
      <div className="relative">
        <div className="w-16 h-16 rounded-full bg-purple-600/20 animate-ping absolute inset-0" />
        <div className="w-16 h-16 rounded-full bg-purple-600/40 animate-pulse flex items-center justify-center relative">
          <span className="text-2xl" aria-hidden="true">🔍</span>
        </div>
      </div>

      {/* Status text */}
      <div className="text-center space-y-1">
        <p className="text-white font-medium">{t('match.waiting.searching')}</p>
        <p className="text-sm text-gray-400">
          {t('match.waiting.elapsed', { seconds: String(elapsed) })}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col items-center gap-3 w-full max-w-xs">
        <button
          type="button"
          onClick={handleCancel}
          className="w-full px-4 py-2 text-sm font-medium text-gray-300 bg-gray-800 border border-gray-600 hover:border-gray-400 rounded-lg transition-colors"
          aria-label={t('match.waiting.cancelAriaLabel')}
        >
          {t('match.waiting.cancel')}
        </button>

        <button
          type="button"
          onClick={onInvite}
          className="text-sm text-purple-400 hover:text-purple-300 transition-colors underline underline-offset-2"
        >
          {t('match.waiting.inviteFriend')}
        </button>
      </div>

      {/* Hint: Escape key */}
      <p className="text-xs text-gray-600">
        {t('match.waiting.escHint')}
      </p>
    </div>
  );
}
