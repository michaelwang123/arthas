/**
 * @file Home 页面 — 创建或加入 E2EE 聊天室的入口页面。
 *
 * 📚 学习要点: URL Hash 路由
 * 本页面支持 `/#/join/{shareCode}` 格式的 hash 路由。
 * 当用户通过 QR 码扫描或点击分享链接打开应用时，
 * URL 中的 shareCode 会被自动提取并预填到加入输入框中。
 * 这种 hash-based 路由不需要服务器端配置（SPA 友好），
 * 且不会触发页面刷新（hash 变化不发送网络请求）。
 *
 * 验证流程：
 * 1. parseJoinRoute 提取 shareCode 字符串
 * 2. decodeShareKey 验证格式有效性（段数、长度、数值合法性）
 * 3. 有效 → 预填输入框；无效 → 显示错误消息，允许手动输入
 * 4. 有效但 expiresAt 已过期 → 显示警告，仍允许尝试加入（服务器是唯一权威）
 *
 * @module pages/Home
 */

import { useState, useEffect, useMemo } from 'react';
import { useChatStore } from '../stores/chatStore';
import { usePageStore } from '../stores/pageStore';
import { decodeShareKey } from '../crypto/shareKey';
import { useTranslation } from '../i18n';
import { LanguageSwitcher } from '../i18n/components/LanguageSwitcher';
import { CreateRoomPublicFields, type PublicFieldsData } from '../components/CreateRoomPublicFields';

/**
 * 解析 URL hash 中的 join 路由，提取分享码。
 *
 * 📚 学习要点: Hash 路由解析策略
 * 使用正则匹配 `#/join/{shareCode}` 格式。shareCode 部分使用 `.+`（贪婪匹配），
 * 因为分享码本身包含 `:` 分隔符（如 `roomId:key:ephemeral:expiresAt`），
 * 不能使用 `[^/]+` 等限制性模式。
 * 对提取的 shareCode 进行 decodeURIComponent 解码，处理 URL 编码的特殊字符
 * （虽然 base64url 和 NanoID 通常不含需要编码的字符，但防御性解码更安全）。
 *
 * @param hash - window.location.hash 值（如 "#/join/abc123:key456:0:1700000000"）
 * @returns 解码后的分享码字符串，不匹配 join 路由格式时返回 null
 */
export function parseJoinRoute(hash: string): string | null {
  if (typeof hash !== 'string') return null;

  const match = hash.match(/^#\/join\/(.+)$/);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    // decodeURIComponent 可能抛出 URIError（如 "%ZZ" 无效编码）
    // 此时返回原始字符串，让后续 decodeShareKey 验证决定是否有效
    return match[1];
  }
}

/**
 * Home page — create or join an E2EE chat room.
 * Supports hash routing: /#/join/{shareCode} auto-fills the share code input.
 */
export function Home() {
  const { t } = useTranslation();
  const [nickname, setNickname] = useState('');
  const [shareCode, setShareCode] = useState('');
  const connected = useChatStore((s) => s.connected);
  const createRoom = useChatStore((s) => s.createRoom);
  const joinRoom = useChatStore((s) => s.joinRoom);

  // Create room: password
  const [showPassword, setShowPassword] = useState(false);
  const [createPassword, setCreatePassword] = useState('');

  // Create room: ephemeral
  const [ephemeralEnabled, setEphemeralEnabled] = useState(false);
  const [ephemeralTime, setEphemeralTime] = useState(30);

  // Create room: expiry duration (seconds, 0 = never)
  const [expiryDuration, setExpiryDuration] = useState(0);

  // Join room: password
  const [joinPassword, setJoinPassword] = useState('');

  // Create room: public listing fields
  const [publicFields, setPublicFields] = useState<PublicFieldsData>({
    isPublic: false,
    title: '',
    description: '',
    tags: [],
  });

  // Page navigation
  const setPage = usePageStore((s) => s.setPage);

  // URL hash route validation messages
  const [hashError, setHashError] = useState('');
  const [hashWarning, setHashWarning] = useState('');

  // 📚 学习要点: URL hash 路由处理与分享码验证
  // 在组件挂载时（useEffect 空依赖数组）检查 URL hash：
  // 1. parseJoinRoute 提取 shareCode（纯字符串匹配，不验证内容）
  // 2. decodeShareKey 验证分享码格式（段数、长度、数值合法性）
  // 3. 根据验证结果设置不同的 UI 状态：
  //    - 有效：预填输入框，检查 expiresAt 是否过期
  //    - 无效：显示错误消息，输入框保持空白允许手动输入
  // 4. expiresAt 过期检查是信息性的（advisory）：
  //    服务器是过期时间的唯一权威，客户端仅显示警告不阻止加入
  useEffect(() => {
    const extractedCode = parseJoinRoute(window.location.hash);
    if (!extractedCode) return;

    // 验证分享码格式
    const parsed = decodeShareKey(extractedCode);

    if (!parsed) {
      // 分享码格式无效 — 显示错误消息，不预填输入框
      setHashError(t('error.invalidShareCode'));
      return;
    }

    // 分享码有效 — 预填到输入框
    setShareCode(extractedCode);

    // 检查 expiresAt 是否已过期（信息性警告，不阻止加入）
    // 📚 学习要点: 客户端-服务器时钟偏差
    // 使用 Math.floor(Date.now() / 1000) 获取当前 Unix 秒时间戳。
    // 如果客户端时钟偏快，可能误报"已过期"（保守方向，可接受）。
    // 服务器是过期的唯一权威 — 即使客户端认为已过期，仍允许尝试加入。
    if (parsed.expiresAt > 0) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (nowSeconds > parsed.expiresAt) {
        setHashWarning(t('error.roomMayExpired'));
      }
    }
  }, []);

  // Parse share code to detect ephemeral info
  const parsedCode = useMemo(() => {
    const trimmed = shareCode.trim();
    return trimmed ? decodeShareKey(trimmed) : null;
  }, [shareCode]);
  const ephemeralHint = parsedCode?.ephemeral ?? 0;

  // Validation
  const nicknameValid = nickname.length >= 1 && nickname.length <= 20;
  const passwordValid = createPassword.length === 0 || (createPassword.length >= 4 && createPassword.length <= 20);
  const publicFieldsValid = !publicFields.isPublic || (publicFields.title.trim().length >= 1 && publicFields.title.trim().length <= 50);
  const canCreate = nicknameValid && passwordValid && publicFieldsValid;
  const canJoin = nicknameValid && shareCode.trim().length > 0;

  const handleCreate = () => {
    if (!canCreate) return;
    createRoom(
      nickname.trim(),
      createPassword.length > 0 ? createPassword : undefined,
      ephemeralEnabled ? ephemeralTime : undefined,
      expiryDuration > 0 ? expiryDuration : undefined,
      publicFields.isPublic ? {
        title: publicFields.title.trim(),
        description: publicFields.description.trim(),
        tags: publicFields.tags,
      } : undefined,
    );
  };

  const handleJoin = () => {
    if (!canJoin) return;
    joinRoom(
      shareCode.trim(),
      nickname.trim(),
      joinPassword.length > 0 ? joinPassword : undefined,
    );
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-gray-800 rounded-2xl shadow-2xl p-8 space-y-6 relative">
        {/* Language Switcher — top right */}
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>

        {/* Title / Logo */}
        <div className="text-center space-y-2">
          <div className="text-4xl">🔒</div>
          <h1 className="text-2xl font-bold text-white">Arthas Chat</h1>
          <p className="text-sm text-gray-400">{t('home.subtitle')}</p>
        </div>

        {/* Connection status */}
        <div className="flex items-center justify-center gap-2 text-sm">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              connected ? 'bg-green-400' : 'bg-red-400'
            }`}
          />
          <span className={connected ? 'text-green-400' : 'text-red-400'}>
            {connected ? t('home.status.connected') : t('home.status.disconnected')}
          </span>
        </div>

        {/* Nickname input */}
        <div className="space-y-2">
          <label htmlFor="nickname" className="block text-sm text-gray-300">
            {t('home.nickname')}
          </label>
          <input
            id="nickname"
            type="text"
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={t('home.nickname.placeholder')}
            className="w-full px-4 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors"
          />
          {nickname.length > 0 && !nicknameValid && (
            <p className="text-xs text-red-400">{t('home.nickname.error')}</p>
          )}
        </div>

        {/* Create Room Section */}
        <div className="space-y-3">
          {/* Password toggle */}
          {!showPassword ? (
            <button
              type="button"
              onClick={() => setShowPassword(true)}
              className="text-xs text-gray-400 hover:text-indigo-400 transition-colors"
            >
              {t('home.password.set')}
            </button>
          ) : (
            <div className="space-y-1">
              <input
                type="password"
                maxLength={20}
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder={t('home.password.placeholder')}
                className="w-full px-4 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors"
              />
              {createPassword.length > 0 && !passwordValid && (
                <p className="text-xs text-red-400">{t('home.password.error')}</p>
              )}
            </div>
          )}

          {/* Ephemeral checkbox + time select */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ephemeral"
              checked={ephemeralEnabled}
              onChange={(e) => setEphemeralEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500"
            />
            <label htmlFor="ephemeral" className="text-sm text-gray-300">
              {t('home.ephemeral')}
            </label>
            {ephemeralEnabled && (
              <select
                value={ephemeralTime}
                onChange={(e) => setEphemeralTime(Number(e.target.value))}
                className="ml-auto px-2 py-1 bg-gray-700 text-white text-sm rounded border border-gray-600 focus:border-indigo-500 outline-none"
              >
                <option value={10}>{t('home.ephemeral.10s')}</option>
                <option value={30}>{t('home.ephemeral.30s')}</option>
                <option value={60}>{t('home.ephemeral.60s')}</option>
                <option value={300}>{t('home.ephemeral.5min')}</option>
              </select>
            )}
          </div>

          {/* Expiry duration selector */}
          <div className="flex items-center gap-2">
            <label htmlFor="expiry-duration" className="text-sm text-gray-300">
              ⏳ {t('room.expiry.label')}
            </label>
            <select
              id="expiry-duration"
              value={expiryDuration}
              onChange={(e) => setExpiryDuration(Number(e.target.value))}
              className="ml-auto px-2 py-1 bg-gray-700 text-white text-sm rounded border border-gray-600 focus:border-indigo-500 outline-none"
            >
              <option value={0}>{t('room.expiry.never')}</option>
              <option value={3600}>{t('room.expiry.1h')}</option>
              <option value={86400}>{t('room.expiry.24h')}</option>
              <option value={604800}>{t('room.expiry.7d')}</option>
            </select>
          </div>

          {/* Create Room: Public listing fields */}
          <CreateRoomPublicFields value={publicFields} onChange={setPublicFields} />

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {t('home.create')}
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-600" />
          <span className="text-sm text-gray-500">{t('home.divider')}</span>
          <div className="flex-1 h-px bg-gray-600" />
        </div>

        {/* Join Room */}
        <div className="space-y-3">
          <label htmlFor="share-code" className="block text-sm text-gray-300">
            {t('home.join.label')}
          </label>
          <input
            id="share-code"
            type="text"
            value={shareCode}
            onChange={(e) => {
              setShareCode(e.target.value);
              // 用户手动输入时清除 hash 路由产生的错误/警告
              setHashError('');
              setHashWarning('');
            }}
            placeholder={t('home.join.placeholder')}
            className="w-full px-4 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none placeholder-gray-500 transition-colors"
          />

          {/* Hash route error: invalid share code from URL */}
          {hashError && (
            <p className="text-xs text-red-400">{hashError}</p>
          )}

          {/* Hash route warning: share code expiresAt is in the past */}
          {hashWarning && (
            <p className="text-xs text-amber-400">⚠️ {hashWarning}</p>
          )}

          {/* Ephemeral hint from share code */}
          {ephemeralHint > 0 && (
            <p className="text-xs text-amber-400">
              {t('home.ephemeral.hint', { seconds: ephemeralHint })}
            </p>
          )}

          {/* Join password */}
          <input
            type="password"
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
            placeholder={t('home.join.password')}
            className="w-full px-4 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none placeholder-gray-500 transition-colors"
          />

          <button
            onClick={handleJoin}
            disabled={!canJoin}
            className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {t('home.join.button')}
          </button>
        </div>

        {/* Hub navigation */}
        <div className="pt-2">
          <button
            onClick={() => setPage('hub')}
            className="w-full py-2.5 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            🌐 {t('hub.browseButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
