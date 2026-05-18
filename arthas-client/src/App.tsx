import { useEffect, Component, type ReactNode } from 'react';
import { useChatStore } from './stores/chatStore';
import { Home } from './pages/Home';
import { ChatRoom } from './pages/ChatRoom';
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
  const { t } = useTranslation();

  useEffect(() => {
    connect();
  }, []);

  // 设置初始 document.title（store 的 setLocale 会在语言切换时更新）
  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  return (
    <ErrorBoundary>
      {roomId === null ? <Home /> : <ChatRoom />}
    </ErrorBoundary>
  );
}

export default App;
