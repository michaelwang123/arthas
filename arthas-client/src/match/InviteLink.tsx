/**
 * @file InviteLink — 邀请链接生成与分享组件
 *
 * 显示邀请链接 URL、过期倒计时，提供复制和 Web Share API 分享功能。
 * 从 matchStore 读取 inviteLink 和 inviteToken。
 *
 * Server sends relative path ("/match/{token}"). This component resolves it to
 * an absolute URL using window.location.origin for clipboard/share operations.
 *
 * @module match/InviteLink
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from '../i18n';
import { useMatchStore } from './matchStore';

/**
 * Resolve a potentially relative invite link path to an absolute URL.
 * If the link is already absolute (starts with http), returns as-is.
 * For hash-based routing, constructs: {origin}#{path}
 */
function resolveInviteUrl(link: string): string {
  if (link.startsWith('http://') || link.startsWith('https://')) {
    return link;
  }
  // Hash-based routing: origin + "#" + path
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}#${link}`;
}

/**
 * 邀请链接组件。
 *
 * 功能：
 * - 显示完整邀请链接 URL（绝对路径，可直接分享）
 * - 复制到剪贴板按钮
 * - Web Share API 集成（移动端显示原生分享）
 * - 过期倒计时显示
 */
export function InviteLink() {
  const { t } = useTranslation();
  const inviteLink = useMatchStore((s) => s.inviteLink);
  const [copied, setCopied] = useState(false);
  const [expiryText, setExpiryText] = useState('');

  // Resolve to absolute URL for sharing
  const fullUrl = useMemo(() => {
    if (!inviteLink) return '';
    return resolveInviteUrl(inviteLink);
  }, [inviteLink]);

  // Reset copied state after 2 seconds
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // Update expiry countdown (invite links have short TTL)
  useEffect(() => {
    if (!inviteLink) return;

    // Parse expiry from the store — invite links typically expire in 5 minutes
    // The URL contains the token; we track from creation time
    const createdAt = Date.now();
    const expiresAt = createdAt + 5 * 60 * 1000; // 5 minutes from now

    const update = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      setExpiryText(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [inviteLink]);

  const handleCopy = useCallback(async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
    } catch {
      // Fallback: select text in a temporary input (for older browsers)
      const input = document.createElement('input');
      input.value = fullUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
    }
  }, [fullUrl]);

  const handleShare = useCallback(async () => {
    if (!fullUrl || !navigator.share) return;
    try {
      await navigator.share({
        title: t('match.invite.shareTitle'),
        url: fullUrl,
      });
    } catch {
      // User cancelled share or share failed — no action needed
    }
  }, [fullUrl, t]);

  if (!inviteLink) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-gray-500">{t('match.invite.generating')}</p>
      </div>
    );
  }

  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <div className="space-y-4">
      {/* Link display — shows full absolute URL for user confidence */}
      <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
        <p className="text-xs text-gray-400 mb-1">{t('match.invite.label')}</p>
        <p className="text-sm text-white font-mono break-all select-all">
          {fullUrl}
        </p>
      </div>

      {/* Expiry countdown */}
      <p className="text-xs text-gray-500 text-center" role="timer" aria-live="polite">
        {t('match.invite.expires', { time: expiryText })}
      </p>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            copied
              ? 'bg-green-600 text-white'
              : 'bg-gray-800 border border-gray-600 text-gray-300 hover:border-gray-400'
          }`}
          aria-label={t('match.invite.copyAriaLabel')}
        >
          {copied ? t('match.invite.copied') : t('match.invite.copy')}
        </button>

        {canShare && (
          <button
            type="button"
            onClick={() => void handleShare()}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
            aria-label={t('match.invite.shareAriaLabel')}
          >
            {t('match.invite.share')}
          </button>
        )}
      </div>
    </div>
  );
}
