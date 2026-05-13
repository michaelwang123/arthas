import { useEffect, Component, type ReactNode } from 'react';
import { useChatStore } from './stores/chatStore';
import { Home } from './pages/Home';
import { ChatRoom } from './pages/ChatRoom';

// ===== ErrorBoundary =====

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

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
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-gray-800 rounded-xl p-6 text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h1 className="text-xl font-bold text-white">出错了</h1>
            <p className="text-sm text-gray-400">
              {this.state.error?.message ?? '发生了未知错误'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
            >
              刷新页面
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

  useEffect(() => {
    connect();
  }, []);

  return (
    <ErrorBoundary>
      {roomId === null ? <Home /> : <ChatRoom />}
    </ErrorBoundary>
  );
}

export default App;
