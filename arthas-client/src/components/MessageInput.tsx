import { useState, useCallback, useRef, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore';
import { EmojiPicker } from './EmojiPicker';
import { FileAttachButton } from '../file-transfer/components/FileAttachButton';
import { useFileTransferStore } from '../file-transfer/fileTransferStore';
import { useTranslation } from '../i18n';
import { PttButton, RecordingIndicator, VoiceErrorToast } from '../voice';

const MAX_LENGTH = 500;
const SHOW_COUNT_THRESHOLD = 400;

export function MessageInput() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setTyping = useChatStore((s) => s.setTyping);
  const replyTo = useChatStore((s) => s.replyTo);
  const clearReply = useChatStore((s) => s.clearReply);
  const wasTypingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const cursorPosRef = useRef<number | null>(null);

  const trimmedText = text.trim();
  const canSend = trimmedText.length > 0 && trimmedText.length <= MAX_LENGTH;

  // 光标位置恢复（emoji 插入后）
  useEffect(() => {
    if (cursorPosRef.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(cursorPosRef.current, cursorPosRef.current);
      inputRef.current.focus();
      cursorPosRef.current = null;
    }
  }, [text]);

  // 选择回复时自动聚焦输入框
  useEffect(() => {
    if (replyTo) {
      inputRef.current?.focus();
    }
  }, [replyTo]);

  const handleSend = useCallback(() => {
    if (!canSend) return;

    sendMessage(trimmedText);
    setText('');

    // Notify typing stopped
    setTyping(false);
    wasTypingRef.current = false;
  }, [canSend, trimmedText, sendMessage, setTyping]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Block input beyond max length
    if (value.length > MAX_LENGTH) return;

    setText(value);

    // Typing indicator logic
    const hasContent = value.trim().length > 0;
    if (hasContent && !wasTypingRef.current) {
      setTyping(true);
      wasTypingRef.current = true;
    } else if (!hasContent && wasTypingRef.current) {
      setTyping(false);
      wasTypingRef.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape' && replyTo) {
      clearReply();
    }
  };

  /**
   * 处理粘贴事件：检测剪贴板中的图片文件并发起文件传输。
   *
   * 📚 学习要点: 非阻塞式文件传输发起
   * 粘贴处理只拦截图片类型的剪贴板数据，不干扰正常的文本粘贴。
   * 调用 initiateTransfer 是同步的（将文件加入传输队列），
   * 实际的加密和发送在后台异步进行，不阻塞文本消息的发送。
   *
   * 📚 学习要点: 为什么只处理图片粘贴？
   * 1. 剪贴板中的非图片文件无法通过 paste 事件获取实际文件内容
   * 2. 文本粘贴应正常插入输入框（不应被拦截为文件传输）
   * 3. 图片是最常见的剪贴板文件类型（截图、复制的图片）
   *
   * @see requirements.md — Requirement 1.6(c), 12.8
   */
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // 只处理文件类型且 MIME 为图片的条目
      if (item.kind !== 'file') continue;
      if (!item.type.startsWith('image/')) continue;

      const blob = item.getAsFile();
      if (!blob) continue;

      // 创建带时间戳的文件名，避免多次粘贴时文件名冲突
      const timestamp = Date.now();
      const fileName = `clipboard-${timestamp}.png`;
      const file = new File([blob], fileName, { type: blob.type || 'image/png' });

      // 异步发起文件传输，不阻塞文本消息发送
      useFileTransferStore.getState().initiateTransfer(file);

      // 阻止默认粘贴行为（防止浏览器将图片数据插入输入框）
      e.preventDefault();

      // 只处理第一个图片文件
      break;
    }
  }, []);

  const insertEmoji = (emoji: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    if (newText.length > MAX_LENGTH) return;
    cursorPosRef.current = start + emoji.length;
    setText(newText);

    // Trigger typing indicator
    if (!wasTypingRef.current) {
      setTyping(true);
      wasTypingRef.current = true;
    }
  };

  return (
    <div className="relative">
      {/* 📚 学习要点: 录音状态指示器（绝对定位覆盖层）
        * RecordingIndicator 使用 absolute + bottom-full 定位，
        * 浮动显示在 MessageInput 容器的正上方。
        * 它依赖最近的 position: relative 祖先（即这个外层 div）。
        *
        * RecordingIndicator 内部已处理条件渲染：
        * - recordingState !== 'recording' 时返回 null（不渲染任何 DOM）
        * - 只在用户按住 PTT 按钮录音时才显示
        * - 显示脉冲红点 + 已录制时长 + "录音中" 文本
        *
        * @see requirements.md — Requirement 1.6, 5.7
        * @see RecordingIndicator.tsx — 组件实现细节
        */}
      <RecordingIndicator />

      {/* 📚 学习要点: 语音错误 Toast（非阻塞错误通知）
        * VoiceErrorToast 显示 voiceStore.recordingError 中的错误信息。
        * 与 RecordingIndicator 互补：
        * - RecordingIndicator 只在 recordingState === 'recording' 时显示
        * - VoiceErrorToast 在 recordingError 非 null 时显示（通常 recordingState === 'idle'）
        * 两者不会同时出现（录音中不会有错误，有错误时不在录音）。
        *
        * 关键设计：错误不阻塞文本消息功能
        * Toast 是纯展示组件，不影响文本输入框或发送按钮的状态。
        * 用户可以在看到语音错误提示的同时继续输入和发送文本消息。
        *
        * @see requirements.md — Requirements 7.1-7.6
        */}
      <VoiceErrorToast />

      {/* Reply preview bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-3 py-2 mb-1 bg-gray-700/50 border-l-2 border-indigo-500 rounded-t-lg">
          <div className="flex-1 min-w-0">
            <span className="text-xs text-indigo-400 font-medium">{replyTo.senderName}</span>
            <p className="text-xs text-gray-400 truncate">{replyTo.preview}</p>
          </div>
          <button
            onClick={clearReply}
            aria-label={t('message.cancelReply')}
            className="text-gray-500 hover:text-white transition-colors shrink-0 w-6 h-6 flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      )}

      {/* Input row */}
      <div className="flex gap-2 items-center">
        {/* Emoji button */}
        <button
          ref={emojiBtnRef}
          onClick={() => setEmojiOpen((v) => !v)}
          aria-label={t('emoji.select')}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-xl text-gray-400 hover:text-white transition-colors"
        >
          😊
        </button>

        {/* Input */}
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={replyTo ? t('chat.input.replyPlaceholder') : t('chat.input.placeholder')}
            maxLength={MAX_LENGTH}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {text.length > SHOW_COUNT_THRESHOLD && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              {text.length}/{MAX_LENGTH}
            </span>
          )}
        </div>

        {/* 文件附件按钮 — 位于发送按钮左侧，提供文件选择入口 */}
        {/* @see requirements.md — Requirement 12.1 */}
        <FileAttachButton />

        {/* 📚 学习要点: PTT 按钮集成
          * PttButton 放置在 FileAttachButton 和 Send 按钮之间。
          * 布局顺序: [Emoji] [Input] [FileAttach] [🎤 PTT] [Send]
          *
          * PttButton 内部已处理优雅降级：
          * - 如果浏览器不支持 MediaRecorder API，组件返回 null（不渲染）
          * - 不需要在此处额外做条件判断
          *
          * 录音操作完全独立于文本输入：
          * - 按住 PTT 录音不会清空或修改 text state
          * - 用户可以先输入文字，再录音发送语音，文字保持不变
          * - 这满足 Requirement 1.10（录音不干扰文本编辑）
          *
          * @see requirements.md — Requirement 5.1, 1.10
          * @see design.md — PTT 按钮布局集成
          */}
        <PttButton />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="min-h-[44px] min-w-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-indigo-600 rounded-lg text-white font-medium transition-colors"
        >
          {t('chat.input.send')}
        </button>
      </div>

      {/* Emoji Picker */}
      {emojiOpen && (
        <EmojiPicker
          onSelect={insertEmoji}
          onClose={() => setEmojiOpen(false)}
          excludeRef={emojiBtnRef}
        />
      )}
    </div>
  );
}
