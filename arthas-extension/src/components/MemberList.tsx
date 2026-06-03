/**
 * MemberList component — expandable compact member list with colored dots and names.
 *
 * Collapsed state: shows member count.
 * Expanded state: shows all members with colored dots and names.
 * Subscribes to chatStore members for reactive updates.
 *
 * Requirements: 9.4, 9.5
 */

import { useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import { useTranslation } from '../i18n';

export function MemberList() {
  const members = useChatStore((s) => s.members);
  const myId = useChatStore((s) => s.myId);
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-gray-700 px-3 py-1.5">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between text-xs text-gray-300 hover:text-gray-100 transition-colors"
        aria-expanded={expanded}
        aria-controls="member-list-panel"
      >
        <span className="font-medium">
          {t('member.title')} ({members.length})
        </span>
        <svg
          className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <ul
          id="member-list-panel"
          className="mt-1.5 flex flex-col gap-1 max-h-32 overflow-y-auto"
          role="list"
        >
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-2 text-xs text-gray-200">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: member.color }}
                aria-hidden="true"
              />
              <span className="truncate">
                {member.name}
                {member.id === myId && (
                  <span className="ml-1 text-gray-400">{t('member.you')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
