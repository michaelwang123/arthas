import { useChatStore } from '../stores/chatStore';
import { MessageInput } from '../components/MessageInput';
import { MessageList } from '../components/MessageList';
import { MemberList } from '../components/MemberList';
import { ShareKey } from '../components/ShareKey';
import { TypingIndicator } from '../components/TypingIndicator';

export function ChatRoom() {
  const roomId = useChatStore((s) => s.roomId);
  const shareCode = useChatStore((s) => s.shareCode);
  const members = useChatStore((s) => s.members);
  const messages = useChatStore((s) => s.messages);
  const myId = useChatStore((s) => s.myId);
  const typingMembers = useChatStore((s) => s.typingMembers);
  const leaveRoom = useChatStore((s) => s.leaveRoom);

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">房间</span>
          <span className="text-sm text-gray-400">{roomId}</span>
          <span className="text-green-400" title="端到端加密">🔒</span>
        </div>
        <button
          onClick={leaveRoom}
          className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
        >
          离开房间
        </button>
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat area (messages + typing + input) */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Message List */}
          <MessageList messages={messages} myId={myId} members={members} />

          {/* Typing Indicator */}
          <div className="px-4 py-1 shrink-0">
            <TypingIndicator typingMembers={typingMembers} members={members} />
          </div>

          {/* Message Input */}
          <div className="px-4 py-3 bg-gray-800 border-t border-gray-700 shrink-0">
            <MessageInput />
          </div>
        </div>

        {/* Member List Sidebar */}
        <aside className="w-56 bg-gray-800 border-l border-gray-700 overflow-y-auto shrink-0 hidden md:block">
          <MemberList members={members} />
        </aside>
      </div>

      {/* Footer: Share Key */}
      <footer className="flex items-center px-4 py-2 bg-gray-800 border-t border-gray-700 shrink-0">
        <ShareKey shareCode={shareCode} />
      </footer>
    </div>
  );
}
