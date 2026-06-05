/**
 * @file HubRoomCard — displays a single public room listing card.
 *
 * Shows room title, description, tags, member count, creation time,
 * expiry countdown, and password icon. Click to join.
 *
 * @module components/HubRoomCard
 */

import { memo, useState, useEffect, useRef } from 'react';
import type { RoomListing } from '../hub/types';
import { useChatStore } from '../stores/chatStore';
import { useTranslation } from '../i18n';

interface HubRoomCardProps {
  room: RoomListing;
}

/**
 * Format a relative time string from a Unix timestamp (seconds).
 */
function formatRelativeTime(unixSeconds: number): string {
  const diffMs = Date.now() - unixSeconds * 1000;
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return '<1m';
  if (diffMinutes < 60) return `${diffMinutes}m`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

/**
 * Format expiry countdown from a Unix timestamp (seconds).
 * Returns null if no expiry or already expired.
 */
function formatExpiry(expiresAt: number): string | null {
  if (expiresAt === 0) return null;

  const remainingMs = expiresAt * 1000 - Date.now();
  if (remainingMs <= 0) return null;

  const remainingMin = Math.floor(remainingMs / 60_000);
  if (remainingMin < 60) return `${remainingMin}m`;

  const remainingHours = Math.floor(remainingMin / 60);
  return `${remainingHours}h`;
}

export const HubRoomCard = memo(function HubRoomCard({ room }: HubRoomCardProps) {
  const { t } = useTranslation();
  const joinRoom = useChatStore((s) => s.joinRoom);
  const roomId = useChatStore((s) => s.roomId);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState(
    () => localStorage.getItem('arthas_hub_nickname') ?? ''
  );
  const [joining, setJoining] = useState(false);
  const joinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset joining state if join doesn't succeed within 5s (covers all failure modes)
  useEffect(() => {
    if (joining) {
      joinTimeoutRef.current = setTimeout(() => setJoining(false), 5000);
      return () => {
        if (joinTimeoutRef.current) clearTimeout(joinTimeoutRef.current);
      };
    }
  }, [joining]);

  // If roomId becomes non-null, join succeeded — component will unmount via App routing
  useEffect(() => {
    if (roomId && joining) {
      setJoining(false);
      if (joinTimeoutRef.current) clearTimeout(joinTimeoutRef.current);
    }
  }, [roomId, joining]);

  const expiry = formatExpiry(room.expiresAt);
  const desc = room.description ?? '';
  const truncatedDesc = desc.length > 100
    ? desc.slice(0, 100) + '…'
    : desc;

  const handleJoin = () => {
    if (joining || !nickname.trim()) return;

    if (room.hasPassword && !showPasswordPrompt) {
      setShowPasswordPrompt(true);
      return;
    }

    // Remember nickname for next time
    localStorage.setItem('arthas_hub_nickname', nickname.trim());

    setJoining(true);
    joinRoom(
      room.shareCode,
      nickname.trim(),
      room.hasPassword ? password : undefined,
    );
    // No navigation here — App.tsx automatically renders ChatRoom when roomId becomes non-null.
    // If join fails, user stays on Hub page and sees error in chatStore messages.
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleJoin();
  };

  return (
    <article
      className="bg-gray-800 rounded-xl p-5 space-y-3 border border-gray-700 hover:border-gray-500 transition-colors"
      aria-label={`${t('hub.joinRoom')} ${room.title}`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-white font-semibold text-base truncate flex-1">
          {room.hasPassword && <span className="mr-1" aria-label="Password protected">🔒</span>}
          {room.title}
        </h3>
        <div className="flex items-center gap-1 text-gray-400 text-xs shrink-0" aria-label={`${room.memberCount} members`}>
          <span aria-hidden="true">👥</span>
          <span>{room.memberCount}</span>
        </div>
      </div>

      {/* Description */}
      {truncatedDesc && (
        <p className="text-sm text-gray-400 leading-relaxed">{truncatedDesc}</p>
      )}

      {/* Tags */}
      {(room.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Room tags">
          {(room.tags ?? []).map((tag) => (
            <span
              key={tag}
              role="listitem"
              className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded-full"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer: time info */}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>{formatRelativeTime(room.createdAt)} {t('hub.ago')}</span>
        {expiry && (
          <span className="text-amber-400">⏱ {expiry} {t('hub.remaining')}</span>
        )}
      </div>

      {/* Join section */}
      <div className="pt-2 border-t border-gray-700 space-y-2">
        <input
          type="text"
          maxLength={20}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('home.nickname.placeholder')}
          aria-label={t('home.nickname')}
          className="w-full px-3 py-2 bg-gray-700 text-white text-sm rounded-lg border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-gray-500 transition-colors"
        />

        {showPasswordPrompt && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('home.join.password')}
            aria-label={t('home.join.password')}
            className="w-full px-3 py-2 bg-gray-700 text-white text-sm rounded-lg border border-gray-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none placeholder-gray-500 transition-colors"
          />
        )}

        <button
          onClick={handleJoin}
          disabled={!nickname.trim() || joining}
          className="w-full py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
        >
          {joining ? '...' : t('hub.joinRoom')}
        </button>
      </div>
    </article>
  );
});
