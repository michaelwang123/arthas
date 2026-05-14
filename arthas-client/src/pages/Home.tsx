import { useState, useEffect, useMemo } from 'react';
import { useChatStore } from '../stores/chatStore';
import { decodeShareKey } from '../crypto/shareKey';

/**
 * Home page — create or join an E2EE chat room.
 * Supports hash routing: /#/join/{shareCode} auto-fills the share code input.
 */
export function Home() {
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

  // Join room: password
  const [joinPassword, setJoinPassword] = useState('');

  // Parse hash route on mount: /#/join/{shareCode}
  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/^#\/join\/(.+)$/);
    if (match) {
      setShareCode(decodeURIComponent(match[1]));
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
  const canCreate = nicknameValid && passwordValid;
  const canJoin = nicknameValid && shareCode.trim().length > 0;

  const handleCreate = () => {
    if (!canCreate) return;
    createRoom(
      nickname.trim(),
      createPassword.length > 0 ? createPassword : undefined,
      ephemeralEnabled ? ephemeralTime : undefined,
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
      <div className="w-full max-w-md bg-gray-800 rounded-2xl shadow-2xl p-8 space-y-6">
        {/* Title / Logo */}
        <div className="text-center space-y-2">
          <div className="text-4xl">🔒</div>
          <h1 className="text-2xl font-bold text-white">Arthas Chat</h1>
          <p className="text-sm text-gray-400">端到端加密 · 临时聊天室</p>
        </div>

        {/* Connection status */}
        <div className="flex items-center justify-center gap-2 text-sm">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              connected ? 'bg-green-400' : 'bg-red-400'
            }`}
          />
          <span className={connected ? 'text-green-400' : 'text-red-400'}>
            {connected ? '已连接' : '未连接'}
          </span>
        </div>

        {/* Nickname input */}
        <div className="space-y-2">
          <label htmlFor="nickname" className="block text-sm text-gray-300">
            昵称
          </label>
          <input
            id="nickname"
            type="text"
            maxLength={20}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="输入昵称（1-20 字符）"
            className="w-full px-4 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors"
          />
          {nickname.length > 0 && !nicknameValid && (
            <p className="text-xs text-red-400">昵称需要 1-20 个字符</p>
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
              🔐 设置密码
            </button>
          ) : (
            <div className="space-y-1">
              <input
                type="password"
                maxLength={20}
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                placeholder="房间密码（4-20字符）"
                className="w-full px-4 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors"
              />
              {createPassword.length > 0 && !passwordValid && (
                <p className="text-xs text-red-400">密码需要 4-20 个字符</p>
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
              ⏱️ 阅后即焚
            </label>
            {ephemeralEnabled && (
              <select
                value={ephemeralTime}
                onChange={(e) => setEphemeralTime(Number(e.target.value))}
                className="ml-auto px-2 py-1 bg-gray-700 text-white text-sm rounded border border-gray-600 focus:border-indigo-500 outline-none"
              >
                <option value={10}>10秒</option>
                <option value={30}>30秒</option>
                <option value={60}>60秒</option>
                <option value={300}>5分钟</option>
              </select>
            )}
          </div>

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={!canCreate}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            创建房间
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-600" />
          <span className="text-sm text-gray-500">或</span>
          <div className="flex-1 h-px bg-gray-600" />
        </div>

        {/* Join Room */}
        <div className="space-y-3">
          <label htmlFor="share-code" className="block text-sm text-gray-300">
            加入房间
          </label>
          <input
            id="share-code"
            type="text"
            value={shareCode}
            onChange={(e) => setShareCode(e.target.value)}
            placeholder="输入分享码"
            className="w-full px-4 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none placeholder-gray-500 transition-colors"
          />

          {/* Ephemeral hint from share code */}
          {ephemeralHint > 0 && (
            <p className="text-xs text-amber-400">
              ⏱️ 此房间为阅后即焚模式（{ephemeralHint}秒）
            </p>
          )}

          {/* Join password */}
          <input
            type="password"
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
            placeholder="房间密码（如有）"
            className="w-full px-4 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none placeholder-gray-500 transition-colors"
          />

          <button
            onClick={handleJoin}
            disabled={!canJoin}
            className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            加入
          </button>
        </div>
      </div>
    </div>
  );
}
