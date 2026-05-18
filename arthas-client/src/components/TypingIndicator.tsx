import type { Member } from '../stores/chatStore';
import { useTranslation } from '../i18n';

interface TypingIndicatorProps {
  typingMembers: Map<string, number>;
  members: Member[];
}

export function TypingIndicator({ typingMembers, members }: TypingIndicatorProps) {
  const { t } = useTranslation();

  if (typingMembers.size === 0) {
    return <div className="h-6" />;
  }

  const names = Array.from(typingMembers.keys()).map(
    (id) => members.find((m) => m.id === id)?.name ?? id
  );

  return (
    <div className="h-6 text-sm italic text-gray-400">
      {names.join(', ')} {t('typing.indicator')}
    </div>
  );
}
