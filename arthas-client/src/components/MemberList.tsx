import type { Member } from '../stores/chatStore';
import { useTranslation } from '../i18n';

interface MemberListProps {
  members: Member[];
}

export function MemberList({ members }: MemberListProps) {
  const { t } = useTranslation();
  return (
    <div className="p-3">
      <h3 className="text-sm font-semibold text-gray-400 mb-2">
        {t('member.title')} ({members.length})
      </h3>
      <ul className="space-y-1">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-2 text-sm">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: member.color }}
            />
            <span className="truncate">{member.name}</span>
            <span className="text-gray-500 text-xs">
              #{member.id.slice(-2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
