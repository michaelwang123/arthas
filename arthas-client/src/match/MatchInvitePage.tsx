/**
 * @file MatchInvitePage — /match/:token 路由页面
 *
 * 处理邀请链接加入流程：
 * 1. 解析 URL hash 中的 token（格式: #/match/{token}）
 * 2. 确保 WebSocket 已连接
 * 3. 发送 MsgMatchInviteJoin
 * 4. 等待响应：MatchFound → 导航到房间；MatchError → 显示错误 + 提供常规队列选项
 *
 * @module match/MatchInvitePage
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import { useMatchStore } from './matchStore';
import * as ws from '../network/websocket';
import { MSG_MATCH_INVITE_JOIN, type MatchInviteJoinData } from './protocol';

type InviteStatus = 'connecting' | 'waiting' | 'error';

/**
 * Parse match invite token from URL hash.
 * Expected format: #/match/{token}
 *
 * @param hash - window.location.hash
 * @returns token string or null if format doesn't match
 */
export function parseMatchInviteRoute(hash: string): string | null {
  if (typeof hash !== 'string') return null;
  const match = hash.match(/^#\/match\/(.+)$/);
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

interface MatchInvitePageProps {
  /** Invite token parsed from URL (passed by parent routing logic) */
  token: string;
}

/**
 * 邀请链接页面组件。
 *
 * 功能：
 * - 接收由父路由解析的 token
 * - 挂载时确保 WebSocket 连接，发送 MsgMatchInviteJoin
 * - MatchFound → 匹配成功（由父路由处理导航）
 * - MatchError → 显示 "链接已过期" + 提供进入常规队列选项
 */
export function MatchInvitePage({ token }: MatchInvitePageProps) {
  const { t } = useTranslation();
  const status = useMatchStore((s) => s.status);
  const error = useMatchStore((s) => s.error);
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>('connecting');

  // Send invite join message on mount
  useEffect(() => {
    if (!token) {
      setInviteStatus('error');
      return;
    }

    const sendInviteJoin = () => {
      const data: MatchInviteJoinData = { token };
      ws.send(MSG_MATCH_INVITE_JOIN, data);
      setInviteStatus('waiting');
    };

    // Check if already connected
    if (ws.isConnected()) {
      sendInviteJoin();
    } else {
      // Wait for connection
      const checkInterval = setInterval(() => {
        if (ws.isConnected()) {
          clearInterval(checkInterval);
          sendInviteJoin();
        }
      }, 500);

      // Timeout after 10s
      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        setInviteStatus('error');
      }, 10000);

      return () => {
        clearInterval(checkInterval);
        clearTimeout(timeout);
      };
    }
  }, [token]);

  // Watch for match status changes
  useEffect(() => {
    if (status === 'found' || status === 'in-room') {
      // Success — parent route will handle navigation
      return;
    }
    if (error) {
      setInviteStatus('error');
    }
  }, [status, error]);

  // Connecting state
  if (inviteStatus === 'connecting') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
        <div className="w-12 h-12 rounded-full bg-purple-600/30 animate-pulse flex items-center justify-center">
          <span className="text-xl" aria-hidden="true">🔗</span>
        </div>
        <p className="mt-4 text-sm text-gray-400">{t('match.invite.connecting')}</p>
      </div>
    );
  }

  // Waiting for server response
  if (inviteStatus === 'waiting' && status !== 'found') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
        <div className="w-12 h-12 rounded-full bg-purple-600/30 animate-pulse flex items-center justify-center">
          <span className="text-xl" aria-hidden="true">⏳</span>
        </div>
        <p className="mt-4 text-sm text-gray-400">{t('match.invite.joining')}</p>
      </div>
    );
  }

  // Error state
  if (inviteStatus === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4 space-y-6">
        <span className="text-4xl" aria-hidden="true">😕</span>

        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold text-white">
            {t('match.invite.expired')}
          </h2>
          <p className="text-sm text-gray-400">
            {error?.msg ?? t('match.invite.expiredHint')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => { window.location.hash = '#/'; }}
          className="px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
        >
          {t('match.invite.regularQueue')}
        </button>
      </div>
    );
  }

  // Match found — brief confirmation before parent navigates
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
      <span className="text-4xl" aria-hidden="true">🎉</span>
      <p className="mt-4 text-sm text-gray-300">{t('match.invite.matched')}</p>
    </div>
  );
}
