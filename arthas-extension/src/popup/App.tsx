/**
 * Root application component with state-based routing.
 *
 * Responsibilities:
 * - Page routing: Home ↔ ChatRoom ↔ Settings based on store state
 * - Call chatStore.initialize() on mount (load session, auto-rejoin)
 * - Call initializeI18n() on mount (load persisted language)
 * - Connect popup port to service worker for badge lifecycle
 * - Apply Tailwind dark theme globally (gray-900 bg, gray-100 text)
 * - Set popup dimensions to 400×600px via CSS
 *
 * Requirements: 2.1, 2.9, 8.1, 8.6, 13.2, 13.3
 */

import { useEffect, useState, useCallback } from 'react';
import './index.css';
import { useChatStore } from '../stores/chatStore';
import { initializeI18n } from '../i18n';
import { Home } from '../pages/Home';
import { ChatRoom } from '../pages/ChatRoom';
import { Settings } from '../pages/Settings';

type Page = 'home' | 'chat' | 'settings';

export function App(): React.ReactElement {
  const [currentPage, setCurrentPage] = useState<Page>('home');

  // Subscribe to roomId from the chat store — determines chat vs home routing
  const roomId = useChatStore((s) => s.roomId);

  // Initialize chat store and i18n on mount
  useEffect(() => {
    void useChatStore.getState().initialize();
    void initializeI18n();
  }, []);

  // Connect popup port to service worker for badge lifecycle
  useEffect(() => {
    try {
      chrome.runtime.connect({ name: 'popup' });
    } catch {
      // chrome.runtime may not be available in test/dev environment
    }
  }, []);

  // When roomId is set in store → show ChatRoom; when cleared → show Home
  useEffect(() => {
    if (roomId) {
      setCurrentPage('chat');
    } else {
      // Only navigate away from settings if we were in chat
      setCurrentPage((prev) => (prev === 'settings' ? 'settings' : 'home'));
    }
  }, [roomId]);

  // Navigation callbacks
  const handleNavigateSettings = useCallback(() => {
    setCurrentPage('settings');
  }, []);

  const handleBackFromSettings = useCallback(() => {
    setCurrentPage(roomId ? 'chat' : 'home');
  }, [roomId]);

  return (
    <div className="w-[400px] h-[600px] bg-gray-900 text-gray-100 flex flex-col overflow-hidden">
      {currentPage === 'home' && (
        <Home onNavigateSettings={handleNavigateSettings} />
      )}
      {currentPage === 'chat' && <ChatRoom />}
      {currentPage === 'settings' && (
        <Settings onBack={handleBackFromSettings} />
      )}
    </div>
  );
}
