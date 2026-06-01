/**
 * TypingIndicator component — displays typing member names below message list.
 *
 * Shows "{name} is typing..." for a single member, or
 * "{count} people are typing..." for multiple members.
 *
 * Auto-removal after 5-second timeout is handled by the chatStore
 * (TYPING_DISPLAY_TIMEOUT_MS in the MemberTyping handler).
 *
 * Subscribes to chatStore typingMembers and members (to resolve names).
 * Uses Tailwind CSS for styling. TypeScript strict mode.
 *
 * Requirements: 10.3, 10.4
 */

import { useChatStore } from '../stores/chatStore';
import { useTranslation } from '../i18n';

export function TypingIndicator() {
  const typingMembers = useChatStore((s) => s.typingMembers);
  const members = useChatStore((s) => s.members);
  const { t } = useTranslation();

  const typingCount = typingMembers.size;

  if (typingCount === 0) {
    return null;
  }

  // Resolve typing member IDs to display names
  const typingIds = Array.from(typingMembers.keys());

  if (typingCount === 1) {
    const memberId = typingIds[0];
    const member = members.find((m) => m.id === memberId);
    const name = member?.name ?? 'Someone';

    return (
      <div className="px-3 py-1 text-xs text-gray-400 italic truncate" aria-live="polite">
        {t('typing.indicator', { name })}
      </div>
    );
  }

  // Multiple people typing
  return (
    <div className="px-3 py-1 text-xs text-gray-400 italic truncate" aria-live="polite">
      {t('typing.multiple', { count: typingCount })}
    </div>
  );
}
