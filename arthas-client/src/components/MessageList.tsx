import { useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore } from '../stores/chatStore';
import type { ChatMessage, Member } from '../stores/chatStore';
import { MessageBubble } from './MessageBubble';
import { FileMessage } from '../file-transfer/components/FileMessage';
import { useFileTransferStore } from '../file-transfer/fileTransferStore';
import { truncatePreview } from '../utils/payload';
import type { ChatFileMessage } from '../network/protocol';

interface MessageListProps {
  messages: (ChatMessage | ChatFileMessage)[];
  myId: string | null;
  members: Member[];
}

const FIVE_MINUTES = 5 * 60 * 1000;
const DECRYPT_FAIL_TEXT = '无法解密此消息';

/**
 * 📚 学习要点: 类型守卫（Type Guard）
 * TypeScript 的类型守卫允许在运行时缩窄联合类型。
 * 通过检查 `type === 'file'` 字段，TypeScript 编译器能够推断出
 * 消息是 ChatFileMessage 类型，从而安全地访问 transferId 等字段。
 * 这比使用 `as` 类型断言更安全，因为它在运行时进行实际检查。
 */
function isFileMessage(msg: ChatMessage | ChatFileMessage): msg is ChatFileMessage {
  return 'type' in msg && (msg as ChatFileMessage).type === 'file';
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function shouldShowTimeSeparator(prev: (ChatMessage | ChatFileMessage) | null, curr: ChatMessage | ChatFileMessage): boolean {
  if (!prev) return true;
  return curr.timestamp - prev.timestamp > FIVE_MINUTES;
}

function formatSeparatorTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const hh = date.getHours().toString().padStart(2, '0');
  const mm = date.getMinutes().toString().padStart(2, '0');
  if (isToday) return `${hh}:${mm}`;
  const MM = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  return `${MM}-${dd} ${hh}:${mm}`;
}

export function MessageList({ messages, myId, members }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(messages.length);
  const reactions = useChatStore((s) => s.reactions);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const sendReaction = useChatStore((s) => s.sendReaction);
  const ephemeral = useChatStore((s) => s.ephemeral);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Track message count for send animation
  const isNewBatch = messages.length > prevCountRef.current;
  useEffect(() => {
    prevCountRef.current = messages.length;
  }, [messages.length]);

  const scrollToMessage = useCallback((stableId: string) => {
    const el = document.querySelector(`[data-stable-id="${stableId}"]`) as HTMLElement;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-indigo-500/50');
    setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-500/50'), 1500);
  }, []);

  function getMemberColor(senderId: string): string | undefined {
    return members.find((m) => m.id === senderId)?.color;
  }

  function handleReply(msg: ChatMessage) {
    setReplyTo({
      stableId: msg.stableId,
      senderName: msg.senderName,
      preview: truncatePreview(msg.text),
    });
  }

  if (messages.length === 0) {
    return (
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 flex items-center justify-center"
      >
        <span className="text-gray-500">暂无消息，开始聊天吧</span>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
      {messages.map((msg, index) => {
        const prevMsg = index > 0 ? messages[index - 1] : null;
        const showSeparator = shouldShowTimeSeparator(prevMsg, msg);

        // System messages
        if (msg.isSystem) {
          return (
            <div key={msg.id} data-stable-id={msg.stableId || undefined}>
              {showSeparator && <TimeSeparator timestamp={msg.timestamp} />}
              <div className="flex justify-center">
                <span className="text-xs text-gray-500 italic">{msg.text}</span>
              </div>
            </div>
          );
        }

        const isOwn = msg.isMine || msg.senderId === myId;
        const isDecryptFailed = msg.text === DECRYPT_FAIL_TEXT;
        const senderColor = getMemberColor(msg.senderId);
        const canCopy = !isDecryptFailed;
        const msgReactions = reactions.get(msg.stableId) || undefined;

        // 📚 学习要点: 文件消息条件渲染
        // 检测消息是否为文件类型（type === 'file'），如果是则渲染 FileMessage 组件。
        // FileMessage 通过 transferId 从 fileTransferStore 订阅实时传输状态，
        // 无需在此处传递进度、速度等动态数据（单一数据源原则）。
        const isFile = isFileMessage(msg);

        // Determine if this is the newest own message (for animation)
        const isNewestOwn = isNewBatch && index === messages.length - 1 && isOwn;
        const animClass = isNewestOwn ? 'animate-slide-in-msg motion-reduce:animate-none' : '';

        // Own messages — right-aligned
        if (isOwn) {
          return (
            <EphemeralWrapper key={msg.id} msgId={msg.id} stableId={msg.stableId} ephemeral={ephemeral} transferId={isFile ? msg.transferId : undefined}>
              {showSeparator && <TimeSeparator timestamp={msg.timestamp} />}
              <div className={`flex justify-end ${animClass}`}>
                <div className="max-w-[70%] flex flex-col items-end">
                  {/* 文件消息：渲染 FileMessage 组件；普通消息：渲染 MessageBubble */}
                  {isFile ? (
                    <FileMessage transferId={msg.transferId} />
                  ) : (
                    <MessageBubble
                      text={msg.text}
                      isOwn={true}
                      canCopy={canCopy}
                      isDecryptFailed={isDecryptFailed}
                      stableId={msg.stableId}
                      reply={msg.reply}
                      reactions={msgReactions}
                      myId={myId}
                      verificationStatus={(msg as ChatMessage).verificationStatus}
                      onReply={canCopy ? () => handleReply(msg) : undefined}
                      onReact={canCopy ? (emoji) => sendReaction(msg.stableId, emoji) : undefined}
                      onScrollToMessage={scrollToMessage}
                    />
                  )}
                  <span className="text-xs text-gray-500 mt-0.5">
                    {formatTime(msg.timestamp)}
                  </span>
                  {ephemeral > 0 && (
                    <div className="h-0.5 w-full bg-gray-700 rounded-full mt-1 overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full motion-reduce:hidden"
                        style={{ animation: `shrink-bar ${ephemeral}s linear forwards` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </EphemeralWrapper>
          );
        }

        // Others' messages — left-aligned
        return (
          <EphemeralWrapper key={msg.id} msgId={msg.id} stableId={msg.stableId} ephemeral={ephemeral} transferId={isFile ? msg.transferId : undefined}>
            {showSeparator && <TimeSeparator timestamp={msg.timestamp} />}
            <div className="flex justify-start">
              <div className="max-w-[70%] flex flex-col items-start">
                <span
                  className="text-xs font-medium mb-0.5"
                  style={{ color: senderColor ?? '#9ca3af' }}
                >
                  {msg.senderName}
                </span>
                {/* 文件消息：渲染 FileMessage 组件；普通消息：渲染 MessageBubble */}
                {isFile ? (
                  <FileMessage transferId={msg.transferId} />
                ) : (
                  <MessageBubble
                    text={msg.text}
                    isOwn={false}
                    canCopy={canCopy}
                    isDecryptFailed={isDecryptFailed}
                    stableId={msg.stableId}
                    reply={msg.reply}
                    reactions={msgReactions}
                    myId={myId}
                    verificationStatus={(msg as ChatMessage).verificationStatus}
                    onReply={canCopy ? () => handleReply(msg) : undefined}
                    onReact={canCopy ? (emoji) => sendReaction(msg.stableId, emoji) : undefined}
                    onScrollToMessage={scrollToMessage}
                  />
                )}
                <span className="text-xs text-gray-500 mt-0.5">
                  {formatTime(msg.timestamp)}
                </span>
                {ephemeral > 0 && (
                  <div className="h-0.5 w-full bg-gray-700 rounded-full mt-1 overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full motion-reduce:hidden"
                      style={{ animation: `shrink-bar ${ephemeral}s linear forwards` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </EphemeralWrapper>
        );
      })}
    </div>
  );
}

function TimeSeparator({ timestamp }: { timestamp: number }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex-1 h-px bg-gray-700" />
      <span className="text-xs text-gray-500">{formatSeparatorTime(timestamp)}</span>
      <div className="flex-1 h-px bg-gray-700" />
    </div>
  );
}

interface EphemeralWrapperProps {
  msgId: string;
  stableId: string;
  ephemeral: number;
  children: React.ReactNode;
  /** 可选：文件传输 ID，用于延迟 ephemeral 倒计时直到传输完成 */
  transferId?: string;
}

/**
 * 📚 学习要点: 文件消息的 Ephemeral 模式集成
 *
 * 普通文本消息：ephemeral 倒计时从消息出现时立即开始。
 * 文件消息：ephemeral 倒计时从传输完成（或终态）时才开始。
 *
 * 为什么文件消息需要延迟倒计时？
 * - 如果传输需要 30 秒，而 ephemeral 设为 10 秒，消息会在传输完成前消失
 * - 用户还没来得及下载文件，消息就被移除了
 * - 正确行为：等传输完成后再开始 10 秒倒计时，给用户足够时间下载
 *
 * 边界情况处理：
 * - 如果 ephemeral 超时触发时传输仍在进行中（理论上不应发生，但作为防御性编程）：
 *   先中止传输、释放缓冲区内存，然后再移除消息气泡
 * - 已下载到用户设备的文件不受 ephemeral 移除影响（下载是永久的）
 * - 消息气泡被移除时，FileMessage 组件的 useEffect cleanup 会自动释放 Blob URL
 *
 * @see requirements.md — Requirements 10.1, 10.2, 10.3, 10.4
 * @see NFR-7 — Blob URL 内存泄漏防护
 */
function EphemeralWrapper({ msgId: _msgId, stableId, ephemeral, children, transferId }: EphemeralWrapperProps) {
  const [fading, setFading] = useState(false);

  // 📚 学习要点: 订阅文件传输状态（仅文件消息需要）
  // 当 transferId 存在时，订阅该传输的 status 字段。
  // 使用精确的 selector 只提取 status，避免传输进度更新导致不必要的重渲染。
  const transferStatus = useFileTransferStore((state) => {
    if (!transferId) return undefined;
    return state.transfers.get(transferId)?.status;
  });

  // 📚 学习要点: 判断传输是否已到达终态
  // 终态包括：complete（传输完成）、failed（传输失败）、cancelled（已取消）
  // 只有到达终态后，ephemeral 倒计时才开始。
  // 如果 transferId 不存在（非文件消息），视为"已完成"，立即开始倒计时。
  const isTransferTerminal = !transferId || (
    transferStatus === 'complete' ||
    transferStatus === 'failed' ||
    transferStatus === 'cancelled'
  );

  useEffect(() => {
    if (ephemeral <= 0) return;

    // 📚 学习要点: 文件消息延迟倒计时
    // 对于文件消息，只有当传输到达终态时才启动 ephemeral 倒计时。
    // 这确保用户有完整的 ephemeral 秒数来查看/下载已完成的文件。
    if (!isTransferTerminal) return;

    const fadeDelay = (ephemeral * 1000) - 200;
    if (fadeDelay <= 0) return;

    const timer = setTimeout(() => {
      // 📚 学习要点: 防御性中止 — 处理 ephemeral 超时时传输仍在进行的边界情况
      // 正常情况下，到达此处时传输已经是终态（因为上面的 isTransferTerminal 检查）。
      // 但作为防御性编程，如果传输状态在 setTimeout 期间发生了意外变化
      // （例如状态回退 bug），我们仍然确保中止传输并释放资源。
      if (transferId) {
        const currentTransfer = useFileTransferStore.getState().transfers.get(transferId);
        if (currentTransfer &&
            currentTransfer.status !== 'complete' &&
            currentTransfer.status !== 'failed' &&
            currentTransfer.status !== 'cancelled') {
          // 传输仍在进行中：先中止传输，释放缓冲区内存
          useFileTransferStore.getState().cancelTransfer(transferId);
        }
      }
      setFading(true);
    }, fadeDelay);

    return () => clearTimeout(timer);
  }, [ephemeral, isTransferTerminal, transferId]);

  // 📚 学习要点: 消息气泡移除时的资源清理
  // 当 fading 变为 true 后，组件会通过 CSS transition 淡出并折叠。
  // 子组件（包括 FileMessage）会在 DOM 移除时触发 useEffect cleanup，
  // 自动释放 Blob URL（@see FileMessage.tsx 的 cleanup 逻辑）。
  // 已下载到用户设备的文件不受影响 — 浏览器下载是独立于 Blob URL 的持久操作。

  return (
    <div
      data-stable-id={stableId}
      className={fading ? 'opacity-0 max-h-0 overflow-hidden transition-all duration-200' : 'transition-all duration-200'}
    >
      {children}
    </div>
  );
}
