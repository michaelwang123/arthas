/**
 * 分享面板组件 — 显示分享码文本、复制按钮和 QR 码入口。
 *
 * 在整体架构中的角色：
 * - 作为 ChatRoom 页面 footer 的核心组件，提供房间分享功能
 * - 分享码文本始终可复制（QR 码是补充手段，不是替代）
 * - QR 码按钮打开 QRCodeModal，供手机用户扫码加入
 *
 * 📚 学习要点: QR 码作为补充分享方式
 * QR 码和文本分享码并存，满足不同场景：
 * - 文本分享码：适合通过聊天工具发送（复制粘贴）
 * - QR 码：适合面对面场景（手机扫码加入，无需手动输入）
 * 两者编码相同的 Join_URL，只是呈现方式不同。
 *
 * @module components/ShareKey
 */

import { useState, useCallback } from 'react';
import { useTranslation } from '../i18n';
import { QRCodeModal } from './QRCodeModal';

interface ShareKeyProps {
  shareCode: string | null;
}

/**
 * 分享面板 — 显示分享码、复制按钮和 QR 码按钮。
 *
 * @param props.shareCode - 当前房间的分享码字符串，null 表示尚未生成
 */
export function ShareKey({ shareCode }: ShareKeyProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!shareCode) return;
    try {
      await navigator.clipboard.writeText(shareCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in insecure contexts; silently ignore
    }
  }, [shareCode]);

  // Build share link for display
  const shareLink = shareCode
    ? `${window.location.origin}${window.location.pathname}#/join/${shareCode}`
    : null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Desktop: show share code text */}
      <span className="text-sm text-gray-400 shrink-0 hidden md:inline">{t('share.label')}</span>
      <code className="text-xs text-indigo-300 bg-gray-700 px-2 py-1 rounded max-w-xs truncate hidden md:inline">
        {shareCode ?? t('share.generating')}
      </code>

      {/* Copy button — mobile shows full text, desktop shows icon */}
      <button
        onClick={handleCopy}
        disabled={!shareCode}
        aria-label={t('share.copyAriaLabel')}
        className="min-h-[44px] min-w-[44px] px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1"
      >
        <span className="md:hidden">{copied ? t('share.copiedMobile') : t('share.copyMobile')}</span>
        <span className="hidden md:inline">{copied ? t('share.copied') : t('share.copy')}</span>
      </button>

      {/* QR code button — opens modal with scannable QR code */}
      <button
        onClick={() => setQrModalOpen(true)}
        disabled={!shareCode}
        aria-label={t('share.qr.button')}
        className="min-h-[44px] min-w-[44px] px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1"
      >
        <span className="md:hidden">📱 {t('share.qr.button')}</span>
        <span className="hidden md:inline">{t('share.qr.button')}</span>
      </button>

      {/* Desktop: show full share link */}
      {shareLink && (
        <span className="text-xs text-gray-500 truncate max-w-sm hidden lg:inline">
          {shareLink}
        </span>
      )}

      {/* QR Code Modal — renders QR code of the Join URL for mobile scanning */}
      {shareCode && (
        <QRCodeModal
          open={qrModalOpen}
          onClose={() => setQrModalOpen(false)}
          shareCode={shareCode}
        />
      )}
    </div>
  );
}
