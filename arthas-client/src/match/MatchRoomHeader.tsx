/**
 * @file MatchRoom Header — 显示 E2EE 状态、对方名称、阅后即焚时长和过期倒计时
 *
 * 职责：渲染 MatchRoom 顶部信息栏，提供会话上下文一览。
 * - 左侧：🔒 E2EE 锁图标 + 对方名称（或等待中占位）
 * - 右侧：⏱️ 阅后即焚时长标签 + ExpiryCountdown 倒计时
 *
 * 不包含房间 ID、分享码或"离开房间"按钮（Match 导航由底部 Report/Next 处理）。
 *
 * @module match/MatchRoomHeader
 * @see components/ExpiryCountdown — 复用的过期倒计时组件
 * @see i18n — 国际化翻译
 */

import { useTranslation } from '../i18n';
import { ExpiryCountdown } from '../components/ExpiryCountdown';

interface MatchRoomHeaderProps {
  /** Partner name from members list (excluding self), null if not yet joined */
  partnerName: string | null;
  /** Room expiry timestamp (Unix seconds) */
  expiresAt: number;
  /** Ephemeral duration in seconds (0 = non-ephemeral) */
  ephemeral: number;
}

/**
 * MatchRoom 头部组件。
 *
 * 渲染内容：
 * - 🔒 E2EE 加密指示（绿色锁图标）
 * - 对方名称或"等待配对..."占位文本
 * - ⏱️ 阅后即焚时长标签（仅 ephemeral > 0 时显示）
 * - ExpiryCountdown 过期倒计时
 */
export function MatchRoomHeader({ partnerName, expiresAt, ephemeral }: MatchRoomHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="flex items-center justify-between px-4 py-2 bg-gray-800/90 border-b border-gray-700 shrink-0">
      {/* Left: E2EE indicator + partner name */}
      <div className="flex items-center gap-2">
        <span className="text-green-400" role="img" aria-label={t('match.room.e2eeLabel')}>🔒</span>
        <span className="text-sm text-gray-200 font-medium">
          {partnerName ?? t('match.room.waitingForPartner')}
        </span>
      </div>

      {/* Right: Ephemeral badge + expiry countdown */}
      <div className="flex items-center gap-3">
        {ephemeral > 0 && (
          <span className="text-xs text-purple-400 bg-purple-900/30 px-2 py-0.5 rounded">
            ⏱️ {ephemeral}s
          </span>
        )}
        <ExpiryCountdown expiresAt={expiresAt} />
      </div>
    </header>
  );
}
