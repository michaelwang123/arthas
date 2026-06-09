import { useEffect, useState, Component, type ReactNode } from 'react';
import { useChatStore } from './stores/chatStore';
import { usePageStore } from './stores/pageStore';
import { useMatchStore } from './match/matchStore';
import { disconnect } from './network/websocket';
import { Home } from './pages/Home';
import { ChatRoom } from './pages/ChatRoom';
import { Hub } from './pages/Hub';
import { MatchInvitePage, parseMatchInviteRoute } from './match/MatchInvitePage';
import { MatchPage } from './match/MatchPage';
import { useTranslation, useI18nStore, translate } from './i18n';

// ===== ErrorBoundary =====

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 📚 学习要点: Class 组件中的 i18n
 * React hooks（如 useTranslation）只能在函数组件中使用。
 * ErrorBoundary 必须是 class 组件（getDerivedStateFromError 不支持 hooks）。
 * 解决方案：直接使用 useI18nStore.getState() 获取当前 locale 快照，
 * 然后调用 translate() 纯函数。这是 Zustand 的标准组件外访问模式。
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      const locale = useI18nStore.getState().locale;
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-gray-800 rounded-xl p-6 text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h1 className="text-xl font-bold text-white">{translate(locale, 'app.error.title')}</h1>
            <p className="text-sm text-gray-400">
              {this.state.error?.message ?? translate(locale, 'app.error.unknown')}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
            >
              {translate(locale, 'app.error.refresh')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ===== App =====

function App() {
  const roomId = useChatStore((s) => s.roomId);
  const connect = useChatStore((s) => s.connect);
  const page = usePageStore((s) => s.page);
  const matchStatus = useMatchStore((s) => s.status);
  const { t } = useTranslation();

  // Hash-based route detection for /match/:token invite links
  const [matchToken, setMatchToken] = useState<string | null>(() =>
    parseMatchInviteRoute(window.location.hash)
  );

  useEffect(() => {
    const handleHashChange = () => {
      setMatchToken(parseMatchInviteRoute(window.location.hash));
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    connect();
    return () => {
      // React StrictMode 在开发模式下会 mount → unmount → remount。
      // disconnect() 确保旧连接被正确关闭，不会留下孤儿 WebSocket。
      // 生产环境不会触发此 cleanup（组件只 mount 一次）。
      disconnect();
    };
  }, []);

  // 设置初始 document.title（store 的 setLocale 会在语言切换时更新）
  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  // Determine which view to render:
  // 1. If in a room → always show ChatRoom
  // 2. If match is in an active state → show MatchPage
  // 3. If hash matches #/match/{token} → show MatchInvitePage
  // 4. If page === 'hub' → show Hub directory
  // 5. Otherwise → show Home (create/join)
  const renderPage = () => {
    if (roomId !== null) return <ChatRoom />;

    // Active match states: waiting, pairing, found, in-room, timeout
    // These take over the full screen via MatchPage container
    if (matchStatus === 'waiting' || matchStatus === 'pairing' ||
        matchStatus === 'found' || matchStatus === 'in-room' ||
        matchStatus === 'timeout') {
      return <MatchPage />;
    }

    if (matchToken) return <MatchInvitePage token={matchToken} />;
    if (page === 'hub') return <Hub />;
    return <Home />;
  };

  return (
    <ErrorBoundary>
      {renderPage()}
    </ErrorBoundary>
  );
}

export default App;
