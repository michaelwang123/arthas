/**
 * @file EphemeralWrapper.test.tsx — EphemeralWrapper 文件消息 ephemeral 集成测试
 *
 * 测试覆盖：
 * - 普通消息：ephemeral 倒计时从消息出现时立即开始
 * - 文件消息：ephemeral 倒计时延迟到传输完成后才开始
 * - 传输进行中时 ephemeral 超时：先中止传输再移除消息
 *
 * @module components/EphemeralWrapper.test
 * @see requirements.md — Requirements 10.1, 10.2, 10.3, 10.4, NFR-7
 */

import { render, screen, act, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import type { TransferState } from '../file-transfer/types';

// ============================================================================
// Mock 设置
// ============================================================================

// Mock cancelTransfer action
const mockCancelTransfer = vi.fn();

// 当前 mock 的 transfers Map
let mockTransfersMap = new Map<string, TransferState>();

// 可变的 ephemeral 值（测试中可修改）
let mockEphemeral = 0;

// Mock chatStore
vi.mock('../stores/chatStore', () => {
  const useChatStore: any = (selector: (state: any) => any) => {
    const state = {
      reactions: new Map(),
      setReplyTo: vi.fn(),
      sendReaction: vi.fn(),
      ephemeral: mockEphemeral,
      members: [],
    };
    return selector(state);
  };
  useChatStore.getState = () => ({
    reactions: new Map(),
    members: [],
    roomKey: null,
  });
  return { useChatStore };
});

// Mock fileTransferStore
vi.mock('../file-transfer/fileTransferStore', () => {
  const useFileTransferStore: any = (selector: (state: any) => any) => {
    const state = {
      transfers: mockTransfersMap,
      sendQueue: [],
      activeSendId: null,
      activeReceiveCount: 0,
    };
    return selector(state);
  };

  useFileTransferStore.getState = () => ({
    transfers: mockTransfersMap,
    sendQueue: [],
    activeSendId: null,
    activeReceiveCount: 0,
    cancelTransfer: mockCancelTransfer,
    initiateTransfer: vi.fn(),
    cleanupTransfer: vi.fn(),
  });

  return {
    useFileTransferStore,
    getLargeRoomWarning: () => null,
  };
});

// Mock FileMessage 组件（避免复杂的内部依赖）
vi.mock('../file-transfer/components/FileMessage', () => ({
  FileMessage: ({ transferId }: { transferId: string }) => (
    <div data-testid={`file-message-${transferId}`}>FileMessage</div>
  ),
}));

// Mock MessageBubble
vi.mock('./MessageBubble', () => ({
  MessageBubble: () => <div data-testid="message-bubble">MessageBubble</div>,
}));

// Mock truncatePreview
vi.mock('../utils/payload', () => ({
  truncatePreview: (text: string) => text.slice(0, 50),
}));

// 导入被测组件
import { MessageList } from './MessageList';
import type { ChatMessage } from '../stores/chatStore';
import type { ChatFileMessage } from '../network/protocol';

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建 mock 文本消息。
 */
function createTextMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-001',
    stableId: 'stable-001',
    text: 'Hello world',
    senderId: 'user-001',
    senderName: 'Alice',
    timestamp: Date.now(),
    isMine: false,
    isSystem: false,
    ...overrides,
  } as ChatMessage;
}

/**
 * 创建 mock 文件消息。
 */
function createFileMessage(overrides: Partial<ChatFileMessage> = {}): ChatFileMessage {
  return {
    id: 'file-msg-001',
    stableId: 'stable-file-001',
    text: '',
    senderId: 'user-001',
    senderName: 'Alice',
    timestamp: Date.now(),
    isMine: false,
    isSystem: false,
    type: 'file',
    transferId: 'transfer-001',
    fileName: 'test.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    ...overrides,
  } as ChatFileMessage;
}

/**
 * 创建 mock TransferState。
 */
function createMockTransfer(overrides: Partial<TransferState> = {}): TransferState {
  return {
    transferId: 'transfer-001',
    direction: 'receive',
    status: 'receiving',
    fileName: 'test.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    totalChunks: 1,
    receivedChunks: 0,
    lastReceivedIndex: -1,
    chunks: [],
    startTime: Date.now(),
    lastChunkTime: Date.now(),
    senderId: 'sender-001',
    senderName: 'Bob',
    ackCount: 0,
    totalReceivers: 0,
    chatMessageId: 'file-msg-001',
    ...overrides,
  };
}

// ============================================================================
// 测试
// ============================================================================

describe('EphemeralWrapper — 文件消息 ephemeral 集成', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTransfersMap = new Map();
    mockCancelTransfer.mockClear();
    mockEphemeral = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // 测试 10.4: 文件消息传输未完成时，ephemeral 倒计时不应开始
  it('does NOT start ephemeral countdown while file transfer is in progress', () => {
    mockEphemeral = 5;

    // 设置传输状态为 receiving（进行中）
    const transfer = createMockTransfer({ status: 'receiving' });
    mockTransfersMap.set('transfer-001', transfer);

    const fileMsg = createFileMessage();

    render(
      <MessageList
        messages={[fileMsg]}
        myId="my-id"
        members={[]}
      />
    );

    // 文件消息应该可见
    expect(screen.getByTestId('file-message-transfer-001')).toBeInTheDocument();

    // 快进 6 秒（超过 ephemeral 超时时间）
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    // 文件消息应该仍然可见（因为传输未完成，倒计时未开始）
    const wrapper = document.querySelector('[data-stable-id="stable-file-001"]');
    expect(wrapper?.className).not.toContain('opacity-0');
  });

  // 测试 10.4: 传输完成后，ephemeral 倒计时才开始
  it('starts ephemeral countdown only after transfer completes', () => {
    mockEphemeral = 5;

    // 设置传输状态为 complete（已完成）
    const transfer = createMockTransfer({ status: 'complete' });
    mockTransfersMap.set('transfer-001', transfer);

    const fileMsg = createFileMessage();

    render(
      <MessageList
        messages={[fileMsg]}
        myId="my-id"
        members={[]}
      />
    );

    // 文件消息应该可见
    expect(screen.getByTestId('file-message-transfer-001')).toBeInTheDocument();

    // 快进到 fadeDelay 之前（4.7 秒 < 4.8 秒 fadeDelay）
    act(() => {
      vi.advanceTimersByTime(4700);
    });

    // 仍然可见（未淡出）
    const wrapper = document.querySelector('[data-stable-id="stable-file-001"]');
    expect(wrapper?.className).not.toContain('opacity-0');

    // 快进到超时后（再过 200ms，总计 4.9 秒 > fadeDelay = 4.8 秒）
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // 消息应该开始淡出
    const wrapperAfter = document.querySelector('[data-stable-id="stable-file-001"]');
    expect(wrapperAfter?.className).toContain('opacity-0');
  });

  // 测试 10.2: ephemeral 超时时传输仍在进行中，应先中止传输
  it('aborts active transfer when ephemeral timeout fires during active transfer', () => {
    mockEphemeral = 5;

    // 设置传输状态为 complete 以启动倒计时
    const transfer = createMockTransfer({ status: 'complete' });
    mockTransfersMap.set('transfer-001', transfer);

    const fileMsg = createFileMessage();

    render(
      <MessageList
        messages={[fileMsg]}
        myId="my-id"
        members={[]}
      />
    );

    // 在 timer 触发前，将传输状态改回 receiving（模拟边界情况）
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    // 修改 mock 状态为 receiving（模拟意外状态变化）
    const activeTransfer = createMockTransfer({ status: 'receiving' });
    mockTransfersMap.set('transfer-001', activeTransfer);

    // 触发 timer（再过 800ms = 4.8 秒 = fadeDelay）
    act(() => {
      vi.advanceTimersByTime(800);
    });

    // cancelTransfer 应该被调用（防御性中止）
    expect(mockCancelTransfer).toHaveBeenCalledWith('transfer-001');
  });

  // 测试 10.1: 普通文本消息的 ephemeral 行为不受影响
  it('starts ephemeral countdown immediately for non-file messages', () => {
    mockEphemeral = 3;

    const textMsg = createTextMessage();

    render(
      <MessageList
        messages={[textMsg]}
        myId="my-id"
        members={[]}
      />
    );

    // 快进到 fadeDelay (3000 - 200 = 2800ms)
    act(() => {
      vi.advanceTimersByTime(2800);
    });

    // 消息应该开始淡出
    const wrapper = document.querySelector('[data-stable-id="stable-001"]');
    expect(wrapper?.className).toContain('opacity-0');
  });

  // 测试: 传输失败后也应开始 ephemeral 倒计时
  it('starts ephemeral countdown after transfer fails', () => {
    mockEphemeral = 5;

    // 设置传输状态为 failed（终态）
    const transfer = createMockTransfer({ status: 'failed' });
    mockTransfersMap.set('transfer-001', transfer);

    const fileMsg = createFileMessage();

    render(
      <MessageList
        messages={[fileMsg]}
        myId="my-id"
        members={[]}
      />
    );

    // 快进到 fadeDelay (5000 - 200 = 4800ms)
    act(() => {
      vi.advanceTimersByTime(4800);
    });

    // 消息应该开始淡出（因为 failed 是终态，倒计时已开始）
    const wrapper = document.querySelector('[data-stable-id="stable-file-001"]');
    expect(wrapper?.className).toContain('opacity-0');
  });

  // 测试: ephemeral=0 时不应有任何淡出行为
  it('does not fade when ephemeral is 0', () => {
    mockEphemeral = 0;

    const transfer = createMockTransfer({ status: 'complete' });
    mockTransfersMap.set('transfer-001', transfer);

    const fileMsg = createFileMessage();

    render(
      <MessageList
        messages={[fileMsg]}
        myId="my-id"
        members={[]}
      />
    );

    // 快进很长时间
    act(() => {
      vi.advanceTimersByTime(60000);
    });

    // 消息不应淡出
    const wrapper = document.querySelector('[data-stable-id="stable-file-001"]');
    expect(wrapper?.className).not.toContain('opacity-0');
  });
});
