/**
 * @file MatchFound — 配对成功动画组件
 *
 * 显示 "Match Found!" 成功动画（1-2 秒），动画完成后触发回调。
 * 使用 CSS animation (scale + opacity transition)。
 *
 * @module match/MatchFound
 */

import { useEffect } from 'react';
import { useTranslation } from '../i18n';

/** 动画持续时间（毫秒） */
const ANIMATION_DURATION_MS = 1500;

interface MatchFoundProps {
  /** 动画完成后的回调（父组件负责导航） */
  onComplete: () => void;
}

/**
 * 配对成功动画组件。
 *
 * 功能：
 * - scale + opacity CSS 动画
 * - 1.5 秒后自动触发 onComplete
 * - ARIA live region 通知配对成功
 */
export function MatchFound({ onComplete }: MatchFoundProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const timer = setTimeout(onComplete, ANIMATION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      className="flex flex-col items-center justify-center py-12"
      role="alert"
      aria-live="assertive"
    >
      <div className="animate-match-found text-center space-y-3">
        <span className="text-5xl block" aria-hidden="true">🎉</span>
        <h2 className="text-2xl font-bold text-white">
          {t('match.found.title')}
        </h2>
        <p className="text-sm text-gray-400">
          {t('match.found.subtitle')}
        </p>
      </div>

      {/* Inline keyframes for the match-found animation */}
      <style>{`
        @keyframes match-found {
          0% {
            transform: scale(0.5);
            opacity: 0;
          }
          50% {
            transform: scale(1.1);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-match-found {
          animation: match-found 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
      `}</style>
    </div>
  );
}
