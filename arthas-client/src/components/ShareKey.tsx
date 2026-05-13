import { useState, useCallback } from 'react';

interface ShareKeyProps {
  shareCode: string | null;
}

export function ShareKey({ shareCode }: ShareKeyProps) {
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
      <span className="text-sm text-gray-400 shrink-0">分享码:</span>

      <code className="text-xs text-indigo-300 bg-gray-700 px-2 py-1 rounded max-w-xs truncate">
        {shareCode ?? '生成中...'}
      </code>

      <button
        onClick={handleCopy}
        disabled={!shareCode}
        className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
      >
        {copied ? '已复制' : '复制'}
      </button>

      {shareLink && (
        <span className="text-xs text-gray-500 truncate max-w-sm hidden lg:inline">
          {shareLink}
        </span>
      )}
    </div>
  );
}
