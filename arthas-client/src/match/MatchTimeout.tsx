/**
 * @file MatchTimeout — 匹配超时 UI 组件
 *
 * 显示三个操作选项：重试、邀请好友、返回 Hub。
 * 显示已等待的秒数。
 *
 * @module match/MatchTimeout
 */

import { useTranslation } from '../i18n';
import { useMatchStore } from './matchStore';

interface MatchTimeoutProps {
  /** 重试匹配 */
  onRetry: () => void;
  /** 邀请好友 */
  onInvite: () => void;
  /** 返回 Hub */
  onBack: () => void;
}

/**
 * 匹配超时组件。
 *
 * 功能：
 * - 显示等待了多少秒
 * - 三个操作按钮：Try Again / Invite a Friend / Back to Hub
 */
export function MatchTimeout({ onRetry, onInvite, onBack }: MatchTimeoutProps) {
  const { t } = useTranslation();
  const waitedSeconds = useMatchStore((s) => s.waitedSeconds);

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-8">
      {/* Timeout icon */}
      <span className="text-4xl" aria-hidden="true">⏰</span>

      {/* Status message */}
      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold text-white">
          {t('match.timeout.title')}
        </h2>
        <p className="text-sm text-gray-400">
          {t('match.timeout.waited', { seconds: String(waitedSeconds) })}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col items-center gap-3 w-full max-w-xs">
        <button
          type="button"
          onClick={onRetry}
          className="w-full px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          {t('match.timeout.retry')}
        </button>

        <button
          type="button"
          onClick={onInvite}
          className="w-full px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 border border-gray-600 hover:border-gray-400 rounded-lg transition-colors"
        >
          {t('match.timeout.invite')}
        </button>

        <button
          type="button"
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          {t('match.timeout.back')}
        </button>
      </div>
    </div>
  );
}
