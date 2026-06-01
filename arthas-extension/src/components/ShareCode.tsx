/**
 * ShareCode component — displays the room share code with a one-click copy button.
 *
 * Shows copy success feedback ("Copied!" text) briefly after copying.
 * Subscribes to chatStore shareCode state.
 * Uses navigator.clipboard.writeText for clipboard access.
 *
 * @module components/ShareCode
 * Requirements: 3.5
 */

import { useState, useCallback } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useTranslation } from '../i18n';

/** Duration (ms) to show "Copied!" feedback before reverting to "Copy" button. */
const COPY_FEEDBACK_MS = 2000;

export function ShareCode(): React.ReactElement | null {
  const shareCode = useChatStore((s) => s.shareCode);
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!shareCode) return;

    try {
      await navigator.clipboard.writeText(shareCode);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      // Clipboard write failed — silently ignore (non-critical)
    }
  }, [shareCode]);

  if (!shareCode) return null;

  return (
    <div className="flex items-center gap-2 rounded bg-gray-800 px-3 py-2">
      <span className="text-sm text-gray-400">{t('share.label')}</span>
      <code className="flex-1 truncate text-sm text-gray-100">{shareCode}</code>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500"
      >
        {copied ? t('share.copied') : t('share.copy')}
      </button>
    </div>
  );
}
