/**
 * @file sender.dedup.test.ts — sendFile 去重逻辑回归测试
 *
 * 验证 sendFile() 的聊天消息去重行为：
 * - 当 transfer.chatMessageId 已预设（语音消息场景），跳过 insertChatFileMessage
 * - 当 transfer.chatMessageId 为空（普通文件场景），正常插入聊天消息
 *
 * 📚 学习要点: 为什么需要这个回归测试？
 * voiceSender 在 initiateTransfer 之前就插入了 ChatVoiceMessage 占位符，
 * 并通过 options.chatMessageId 将 ID 传入 TransferState。
 * sendFile() 检查 transfer.chatMessageId 非空时跳过插入，避免重复渲染。
 * 如果未来重构不小心移除了这个条件检查，此测试会立即捕获回归。
 *
 * @module file-transfer/__tests__/sender.dedup.test
 * @see sender.ts — sendFile 函数中的 chatMessageId 条件检查
 * @see requirements.md — Requirement 2.1, 2.2, 2.4, 2.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TransferState } from '../types';

// ============================================================================
// Mock 依赖模块
// ============================================================================

/**
 * 📚 学习要点: vi.mock 的提升行为（Hoisting）
 * Vitest 会将 vi.mock() 调用提升到文件顶部（在所有 import 之前执行）。
 * 这确保了被测模块 import 依赖时，已经拿到的是 mock 版本。
 * 即使 vi.mock() 写在 import 语句之后，实际执行顺序仍然是 mock 先于 import。
 */

// Mock WebSocket 模块：阻止真实网络调用
vi.mock('../../network/websocket', () => ({
  send: vi.fn(),
  isConnected: vi.fn(() => true),
  getWs: vi.fn(() => ({ bufferedAmount: 0 })),
}));

// Mock encryptChunk：返回假的加密数据，避免需要真实 CryptoKey
vi.mock('../encryptChunk', () => ({
  encryptChunk: vi.fn(async () => ({
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(64),
  })),
}));

// Mock chunker：返回单个假 chunk，让 sendFile 快速完成发送循环
vi.mock('../chunker', () => ({
  streamChunks: vi.fn(async function* () {
    yield { index: 0, data: new ArrayBuffer(64) };
  }),
}));

// Mock thumbnail：返回 null（非图片文件）
vi.mock('../thumbnail', () => ({
  generateThumbnail: vi.fn(async () => null),
}));

// Mock crypto/utils：返回假的 base64url 字符串
vi.mock('../../crypto/utils', () => ({
  toBase64Url: vi.fn(() => 'mock-base64url-iv'),
}));

// Mock chatStore：拦截 setState 调用以验证去重逻辑
const mockChatSetState = vi.fn();
vi.mock('../../stores/chatStore', () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      myId: 'test-user-id',
      myName: 'TestUser',
      members: [{ id: 'test-user-id' }, { id: 'other-user' }],
      roomKey: 'mock-room-key',
    })),
    setState: mockChatSetState,
  },
}));

// Mock fileTransferStore：控制 transfer 状态以测试不同场景
const mockTransfers = new Map<string, TransferState>();
const mockFileTransferSetState = vi.fn();
vi.mock('../fileTransferStore', () => ({
  useFileTransferStore: {
    getState: vi.fn(() => ({
      transfers: mockTransfers,
      activeSendId: null,
    })),
    setState: mockFileTransferSetState,
  },
  triggerProcessQueue: vi.fn(),
  consumeExtraMetadata: vi.fn(() => undefined),
}));

// ============================================================================
// 测试辅助
// ============================================================================

/**
 * 创建一个最小化的 TransferState 用于测试。
 *
 * @param overrides - 覆盖默认值的字段
 */
function createMockTransfer(overrides: Partial<TransferState> = {}): TransferState {
  return {
    transferId: 'test-transfer-001',
    direction: 'send',
    status: 'sending',
    fileName: 'test-file.txt',
    fileSize: 1024,
    mimeType: 'text/plain',
    totalChunks: 1,
    receivedChunks: 0,
    lastReceivedIndex: -1,
    chunks: [],
    startTime: Date.now(),
    lastChunkTime: Date.now(),
    senderId: '',
    senderName: '',
    ackCount: 0,
    totalReceivers: 0,
    chatMessageId: '',
    ...overrides,
  };
}

// ============================================================================
// 测试用例
// ============================================================================

describe('sendFile deduplication logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransfers.clear();

    // 📚 学习要点: 模拟 Web Crypto API
    // sendFile 内部调用 crypto.subtle.encrypt 和 crypto.getRandomValues。
    // 在测试环境中需要提供 mock 实现，避免 "crypto is not defined" 错误。
    vi.stubGlobal('crypto', {
      subtle: {
        encrypt: vi.fn(async () => new ArrayBuffer(128)),
      },
      getRandomValues: vi.fn((arr: Uint8Array) => arr),
    });
  });

  it('skips insertChatFileMessage when transfer.chatMessageId is pre-set', async () => {
    // Arrange: 设置 transfer 状态，chatMessageId 已预设（语音消息场景）
    const transfer = createMockTransfer({
      transferId: 'voice-transfer-001',
      chatMessageId: '1700000000000-voice-abc12345',
    });
    mockTransfers.set('voice-transfer-001', transfer);

    // 注入 File 引用到 sender 模块的 fileRefs Map
    const { storeFileRef, sendFile } = await import('../sender');
    const mockFile = new File(['hello world'], 'voice.webm', { type: 'audio/webm' });
    storeFileRef('voice-transfer-001', mockFile);

    // Act: 执行 sendFile
    // 📚 学习要点: CryptoKey mock
    // sendFile 需要一个 CryptoKey 参数，但由于 crypto.subtle.encrypt 已被 mock，
    // 传入任意对象即可（不会执行真实加密操作）。
    await sendFile('voice-transfer-001', {} as CryptoKey);

    // Assert: useChatStore.setState 不应被调用（不插入新消息）
    // 📚 学习要点: 验证去重逻辑
    // 当 chatMessageId 已预设时，sendFile 跳过 insertChatFileMessage，
    // 因此 useChatStore.setState 不会被调用来添加新的文件消息。
    expect(mockChatSetState).not.toHaveBeenCalled();
  });

  it('calls insertChatFileMessage when transfer.chatMessageId is empty', async () => {
    // Arrange: 设置 transfer 状态，chatMessageId 为空（普通文件场景）
    const transfer = createMockTransfer({
      transferId: 'file-transfer-001',
      chatMessageId: '',
    });
    mockTransfers.set('file-transfer-001', transfer);

    // 注入 File 引用
    const { storeFileRef, sendFile } = await import('../sender');
    const mockFile = new File(['test content'], 'document.pdf', { type: 'application/pdf' });
    storeFileRef('file-transfer-001', mockFile);

    // Act: 执行 sendFile
    await sendFile('file-transfer-001', {} as CryptoKey);

    // Assert: useChatStore.setState 应被调用（插入文件消息占位符）
    // 📚 学习要点: 验证正常插入路径
    // 当 chatMessageId 为空时，sendFile 调用 insertChatFileMessage，
    // 该函数内部通过 useChatStore.setState 将 ChatFileMessage 添加到消息列表。
    expect(mockChatSetState).toHaveBeenCalled();

    // 验证 setState 被调用时传入了函数（Zustand 的 updater 模式）
    const setStateCall = mockChatSetState.mock.calls[0][0];
    expect(typeof setStateCall).toBe('function');

    // 验证 updater 函数会添加一条文件消息
    const mockState = { messages: [] };
    const result = setStateCall(mockState);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].type).toBe('file');
    expect(result.messages[0].transferId).toBe('file-transfer-001');
    expect(result.messages[0].fileName).toBe('document.pdf');
  });
});
