import { useState, useCallback } from 'react';
import { useTranslation } from '../i18n';

interface ShareKeyProps {
  shareCode: string | null;
}

export function ShareKey({ shareCode }: ShareKeyProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

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

      {/* Desktop: show full share link */}
      {shareLink && (
        <span className="text-xs text-gray-500 truncate max-w-sm hidden lg:inline">
          {shareLink}
        </span>
      )}
    </div>
  );
}
