/**
 * ConnectionStatus component — displays WebSocket connection health indicator.
 *
 * - Green dot: connected (healthy)
 * - Yellow dot + "Reconnecting...": reconnecting (backoff in progress)
 * - Red dot + "Disconnected" + Retry button: failed (5 consecutive failures)
 *
 * Subscribes to chatStore connectionStatus for reactive updates.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */

import { useChatStore } from '../stores/chatStore';
import { useTranslation } from '../i18n';

export function ConnectionStatus() {
  const connectionStatus = useChatStore((s) => s.connectionStatus);
  const retryConnection = useChatStore((s) => s.retryConnection);
  const { t } = useTranslation();

  if (connectionStatus === 'connected') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-green-500" aria-label={t('connection.connected')} />
      </div>
    );
  }

  if (connectionStatus === 'reconnecting' || connectionStatus === 'connecting') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" aria-label={t('connection.reconnecting')} />
        <span className="text-xs text-yellow-400">{t('connection.reconnecting')}</span>
      </div>
    );
  }

  if (connectionStatus === 'failed') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-red-500" aria-label={t('connection.disconnected')} />
        <span className="text-xs text-red-400">{t('connection.disconnected')}</span>
        <button
          type="button"
          onClick={retryConnection}
          className="ml-1 rounded px-1.5 py-0.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 transition-colors"
        >
          {t('connection.retry')}
        </button>
      </div>
    );
  }

  // Disconnected (default/initial state) — no indicator shown in header
  return null;
}
