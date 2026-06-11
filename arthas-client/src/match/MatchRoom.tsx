/**
 * @file MatchRoom — Match 房间容器组件
 *
 * 包裹标准聊天室界面（placeholder），提供 "Next"、"Report"、"Extend" 按钮，
 * 处理剩余时间 ≤5 分钟时的延期提示，以及对方离开的通知。
 *
 * @module match/MatchRoom
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../i18n';
import { useMatchStore } from './matchStore';
import { useChatStore } from '../stores/chatStore';
import { MessageInput } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';
import { TypingIndicator } from '../components/TypingIndicator';
import { DropZone } from '../file-transfer/components/DropZone';
import { MatchRoomHeader } from './MatchRoomHeader';

/** 5 minutes in seconds — threshold for showing extend prompt */
const EXTEND_THRESHOLD_SECONDS = 300;

/**
 * Match 房间容器组件。
 *
 * 功能：
 * - 容器包裹标准聊天室（placeholder slot）
 * - "Next" 按钮（视觉突出）— 离开并重新匹配
 * - "Report" 按钮（accessible 但不突出）
 * - 剩余 ≤5 分钟时显示 "Extend" 提示
 * - 显示 extension 状态和 "partner left" 消息
 * - 连接 matchStore actions
 */
export function MatchRoom() {
  const { t } = useTranslation();
  const nextMatch = useMatchStore((s) => s.nextMatch);
  const reportPartner = useMatchStore((s) => s.reportPartner);
  const proposeExtension = useMatchStore((s) => s.proposeExtension);
  const extensionProposed = useMatchStore((s) => s.extensionProposed);
  const partnerProposedExtend = useMatchStore((s) => s.partnerProposedExtend);
  const partnerLeft = useMatchStore((s) => s.partnerLeft);
  const matchExpiresAt = useMatchStore((s) => s.matchExpiresAt);
  const matchEphemeral = useMatchStore((s) => s.matchEphemeral);

  // Chat store state for message list and input
  const messages = useChatStore((s) => s.messages);
  const myId = useChatStore((s) => s.myId);
  const members = useChatStore((s) => s.members);

  // Derive partner name from members list (exclude self)
  const partnerName = members.find((m) => m.id !== myId)?.name ?? null;
  const typingMembers = useChatStore((s) => s.typingMembers);

  const [showExtendPrompt, setShowExtendPrompt] = useState(false);
  const [showReportMenu, setShowReportMenu] = useState(false);

  // Check if remaining time <= 5 minutes to show extend prompt
  useEffect(() => {
    if (!matchExpiresAt) return;

    const check = () => {
      const remainingSec = matchExpiresAt - Math.floor(Date.now() / 1000);
      setShowExtendPrompt(remainingSec > 0 && remainingSec <= EXTEND_THRESHOLD_SECONDS);
    };

    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [matchExpiresAt]);

  const handleNext = useCallback(() => {
    nextMatch();
  }, [nextMatch]);

  const handleReport = useCallback((reason: 'harassment' | 'spam' | 'inappropriate' | 'other') => {
    reportPartner(reason);
    setShowReportMenu(false);
  }, [reportPartner]);

  const handleExtend = useCallback(() => {
    proposeExtension();
  }, [proposeExtension]);

  return (
    <div className="flex flex-col h-full">
      {/* Match room header — E2EE indicator, partner name, ephemeral badge, expiry countdown */}
      <MatchRoomHeader
        partnerName={partnerName}
        expiresAt={matchExpiresAt ?? 0}
        ephemeral={matchEphemeral ?? 0}
      />

      {/* Partner left banner */}
      {partnerLeft && (
        <div className="bg-amber-900/30 border-b border-amber-700/50 px-4 py-2 text-center">
          <p className="text-sm text-amber-300">{t('match.room.partnerLeft')}</p>
        </div>
      )}

      {/* Partner proposed extend banner */}
      {partnerProposedExtend && !extensionProposed && (
        <div className="bg-indigo-900/30 border-b border-indigo-700/50 px-4 py-2 flex items-center justify-between">
          <p className="text-sm text-indigo-300">{t('match.room.partnerWantsExtend')}</p>
          <button
            type="button"
            onClick={handleExtend}
            className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors"
          >
            {t('match.room.agreeExtend')}
          </button>
        </div>
      )}

      {/* Extend prompt — when ≤5 minutes remaining */}
      {showExtendPrompt && !extensionProposed && !partnerProposedExtend && (
        <div className="bg-gray-800/80 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
          <p className="text-sm text-gray-300">{t('match.room.extendPrompt')}</p>
          <button
            type="button"
            onClick={handleExtend}
            className="px-3 py-1 text-xs font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-md transition-colors"
          >
            {t('match.room.extend')}
          </button>
        </div>
      )}

      {/* Extension proposed status */}
      {extensionProposed && (
        <div className="bg-gray-800/50 border-b border-gray-700 px-4 py-2 text-center">
          <p className="text-xs text-gray-400">{t('match.room.extensionWaiting')}</p>
        </div>
      )}

      {/* Chat room content — reuses standard chat components */}
      <DropZone>
        <MessageList messages={messages} myId={myId} members={members} />
        <div className="px-4 py-1 shrink-0">
          <TypingIndicator typingMembers={typingMembers} members={members} />
        </div>
        <div className="px-4 py-3 bg-gray-800 border-t border-gray-700 shrink-0">
          <MessageInput />
        </div>
      </DropZone>

      {/* Bottom action bar */}
      <div className="border-t border-gray-700 px-4 py-3 flex items-center justify-between bg-gray-900/80">
        {/* Report button — accessible but not prominent */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowReportMenu((v) => !v)}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            aria-label={t('match.room.reportAriaLabel')}
            aria-expanded={showReportMenu}
          >
            {t('match.room.report')}
          </button>

          {/* Report reason menu */}
          {showReportMenu && (
            <div
              className="absolute bottom-full left-0 mb-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px] z-10"
              role="menu"
              aria-label={t('match.room.reportMenuLabel')}
            >
              {(['harassment', 'spam', 'inappropriate', 'other'] as const).map((reason) => (
                <button
                  key={reason}
                  type="button"
                  role="menuitem"
                  onClick={() => handleReport(reason)}
                  className="w-full text-left px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                >
                  {t(`match.room.reportReason.${reason}`)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Next button — visually distinct */}
        <button
          type="button"
          onClick={handleNext}
          className="px-5 py-2 text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
          aria-label={t('match.room.nextAriaLabel')}
        >
          {t('match.room.next')} →
        </button>
      </div>
    </div>
  );
}
