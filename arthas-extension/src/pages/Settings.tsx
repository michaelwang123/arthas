/**
 * Settings page — server URL configuration, connection testing, and language selection.
 *
 * Features:
 * - Server URL input with ws:// or wss:// protocol validation and /ws suffix check
 * - "Test Connection" button that attempts a WebSocket handshake
 * - Language switcher with immediate apply (English, 中文, 日本語)
 * - Back button to return to home
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.6
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation, type Locale } from '../i18n';
import { loadSettings, saveSettings, validateServerUrl } from '../utils/storage';

interface SettingsProps {
  onBack: () => void;
}

type TestStatus = 'idle' | 'testing' | 'success' | 'failed';

const LANGUAGES: Array<{ code: Locale; labelKey: 'language.en' | 'language.zh' | 'language.ja' }> = [
  { code: 'en', labelKey: 'language.en' },
  { code: 'zh', labelKey: 'language.zh' },
  { code: 'ja', labelKey: 'language.ja' },
];

export function Settings({ onBack }: SettingsProps) {
  const { t, locale, setLocale } = useTranslation();

  const [serverUrl, setServerUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [validationError, setValidationError] = useState('');
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [isLoading, setIsLoading] = useState(true);

  // Load settings on mount
  useEffect(() => {
    let cancelled = false;
    loadSettings().then((settings) => {
      if (cancelled) return;
      setServerUrl(settings.serverUrl);
      setSavedUrl(settings.serverUrl);
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Save server URL with validation
  const handleSave = useCallback(async () => {
    const trimmed = serverUrl.trim();

    if (trimmed === '') {
      // Allow clearing the URL
      await saveSettings({ serverUrl: '' });
      setSavedUrl('');
      setValidationError('');
      setTestStatus('idle');
      return;
    }

    if (!validateServerUrl(trimmed)) {
      setValidationError(t('settings.server.invalid'));
      return;
    }

    setValidationError('');
    await saveSettings({ serverUrl: trimmed });
    setSavedUrl(trimmed);
    setTestStatus('idle');
  }, [serverUrl, t]);

  // Test WebSocket connection
  const handleTestConnection = useCallback(() => {
    const trimmed = serverUrl.trim();

    if (!validateServerUrl(trimmed)) {
      setValidationError(t('settings.server.invalid'));
      return;
    }

    setValidationError('');
    setTestStatus('testing');

    let ws: WebSocket | null = null;
    const timeout = setTimeout(() => {
      if (ws) {
        ws.close();
        ws = null;
      }
      setTestStatus('failed');
    }, 5000);

    try {
      ws = new WebSocket(trimmed);

      ws.onopen = () => {
        clearTimeout(timeout);
        setTestStatus('success');
        ws?.close();
        ws = null;
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        setTestStatus('failed');
        ws = null;
      };

      ws.onclose = (event) => {
        // Only mark as failed if we haven't already set success
        if (!event.wasClean && testStatus === 'testing') {
          clearTimeout(timeout);
          setTestStatus('failed');
        }
        ws = null;
      };
    } catch {
      clearTimeout(timeout);
      setTestStatus('failed');
    }
  }, [serverUrl, t, testStatus]);

  // Handle language change
  const handleLanguageChange = useCallback((code: Locale) => {
    setLocale(code);
  }, [setLocale]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
      </div>
    );
  }

  const hasUnsavedChanges = serverUrl.trim() !== savedUrl;

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header with back button */}
      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
          aria-label={t('settings.back')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <h1 className="text-lg font-semibold text-gray-100">{t('settings.title')}</h1>
      </div>

      {/* Server URL section */}
      <section className="mb-6">
        <label htmlFor="server-url" className="mb-2 block text-sm font-medium text-gray-300">
          {t('settings.server.label')}
        </label>
        <input
          id="server-url"
          type="text"
          value={serverUrl}
          onChange={(e) => {
            setServerUrl(e.target.value);
            setValidationError('');
            setTestStatus('idle');
          }}
          placeholder={t('settings.server.placeholder')}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          spellCheck={false}
          autoComplete="off"
        />

        {/* Validation error */}
        {validationError && (
          <p className="mt-1.5 text-xs text-red-400" role="alert">
            {validationError}
          </p>
        )}

        {/* Action buttons */}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasUnsavedChanges}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('settings.server.save')}
          </button>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testStatus === 'testing' || serverUrl.trim() === ''}
            className="rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testStatus === 'testing' ? '...' : t('settings.server.test')}
          </button>
        </div>

        {/* Test connection result */}
        {testStatus === 'success' && (
          <p className="mt-2 text-xs text-green-400" role="status">
            ✓ {t('settings.server.testSuccess')}
          </p>
        )}
        {testStatus === 'failed' && (
          <p className="mt-2 text-xs text-red-400" role="status">
            ✗ {t('settings.server.testFailed')}
          </p>
        )}
      </section>

      {/* Language section */}
      <section>
        <label className="mb-2 block text-sm font-medium text-gray-300">
          {t('settings.language.label')}
        </label>
        <div className="flex gap-2">
          {LANGUAGES.map(({ code, labelKey }) => (
            <button
              key={code}
              type="button"
              onClick={() => handleLanguageChange(code)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                locale === code
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
              aria-pressed={locale === code}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
