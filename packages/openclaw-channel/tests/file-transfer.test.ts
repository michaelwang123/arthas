/**
 * @file file-transfer.test.ts — 文件传输协议适配测试
 *
 * 测试 FileSender 和 FileReceiver 的核心功能：
 * 1. FileSender 正确分片文件
 * 2. FileReceiver 正确重组文件
 * 3. Sender → Receiver 端到端加密/解密 roundtrip
 * 4. 文件大小限制验证
 * 5. 进度回调正确触发
 * 6. 取消处理
 *
 * @module openclaw-channel/tests/file-transfer
 * @see src/file-transfer.ts
 * @see requirements.md — Requirement 5: 文件传输支持
 */

import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  FileSender,
  FileReceiver,
  MAX_FILE_SIZE,
  CHUNK_SIZE,
  type FileTransferMessage,
  type ProgressCallback,
} from '../src/file-transfer';
import { deriveKey } from '../src/crypto';
import {
  MSG_SEND_FILE_META,
  MSG_SEND_FILE_CHUNK,
  MSG_SEND_FILE_COMPLETE,
  type SendFileMetaData,
  type SendFileChunkData,
  type SendFileCompleteData,
  type RelayFileMetaData,
  type RelayFileChunkData,
  type RelayFileCompleteData,
  type RelayFileCancelData,
} from '../src/protocol';

// ============================================================================
// 测试辅助工具
// ============================================================================

/**
 * 生成有效的测试分享码。
 * 格式：21 字符 roomId + 43 字符 base64url 密钥
 */
function generateTestShareCode(): string {
  const roomId = 'abcdefghijklmnopqrstu'; // 21 chars
  const keyBytes = randomBytes(32);
  const keyEncoded = keyBytes.toString('base64url'); // 43 chars
  return `${roomId}:${keyEncoded}`;
}

/**
 * 生成指定大小的随机文件数据。
 */
function generateFileData(size: number): Buffer {
  return randomBytes(size);
}

/**
 * 模拟服务器中转：将 SendFileMetaData 转换为 RelayFileMetaData。
 * 服务器在中转时附加 senderId、senderName 和时间戳。
 */
function toRelayMeta(sendData: SendFileMetaData): RelayFileMetaData {
  return {
    senderId: 'test-sender-id',
    senderName: 'Test User',
    transferId: sendData.transferId,
    iv: sendData.iv,
    ciphertext: sendData.ciphertext,
    t: Date.now(),
  };
}

/**
 * 模拟服务器中转：将 SendFileChunkData 转换为 RelayFileChunkData。
 */
function toRelayChunk(sendData: SendFileChunkData): RelayFileChunkData {
  return {
    senderId: 'test-sender-id',
    transferId: sendData.transferId,
    index: sendData.index,
    iv: sendData.iv,
    data: sendData.data,
  };
}

/**
 * 模拟服务器中转：将 SendFileCompleteData 转换为 RelayFileCompleteData。
 */
function toRelayComplete(sendData: SendFileCompleteData): RelayFileCompleteData {
  return {
    senderId: 'test-sender-id',
    transferId: sendData.transferId,
  };
}

// ============================================================================
// FileSender 测试
// ============================================================================

describe('FileSender', () => {
  const shareCode = generateTestShareCode();
  const key = deriveKey(shareCode);

  describe('文件分片', () => {
    it('小文件（< 64KB）生成 1 个 chunk', () => {
      const sender = new FileSender(key);
      const fileData = generateFileData(1024); // 1KB

      const messages = sender.prepareTransfer(fileData, {
        name: 'small.txt',
        size: fileData.length,
        mimeType: 'text/plain',
      });

      // META + 1 CHUNK + COMPLETE = 3 条消息
      expect(messages).toHaveLength(3);
      expect(messages[0].type).toBe(MSG_SEND_FILE_META);
      expect(messages[1].type).toBe(MSG_SEND_FILE_CHUNK);
      expect(messages[2].type).toBe(MSG_SEND_FILE_COMPLETE);
    });

    it('恰好 64KB 的文件生成 1 个 chunk', () => {
      const sender = new FileSender(key);
      const fileData = generateFileData(CHUNK_SIZE); // 64KB

      const messages = sender.prepareTransfer(fileData, {
        name: 'exact.bin',
        size: fileData.length,
        mimeType: 'application/octet-stream',
      });

      // META + 1 CHUNK + COMPLETE = 3
      expect(messages).toHaveLength(3);
    });

    it('65KB 文件生成 2 个 chunk', () => {
      const sender = new FileSender(key);
      const fileData = generateFileData(CHUNK_SIZE + 1); // 64KB + 1 byte

      const messages = sender.prepareTransfer(fileData, {
        name: 'split.bin',
        size: fileData.length,
        mimeType: 'application/octet-stream',
      });

      // META + 2 CHUNK + COMPLETE = 4
      expect(messages).toHaveLength(4);
      expect(messages[1].type).toBe(MSG_SEND_FILE_CHUNK);
      expect(messages[2].type).toBe(MSG_SEND_FILE_CHUNK);
    });

    it('5MB 文件生成 80 个 chunk', () => {
      const sender = new FileSender(key);
      const fileData = generateFileData(MAX_FILE_SIZE); // 5MB

      const messages = sender.prepareTransfer(fileData, {
        name: 'large.bin',
        size: fileData.length,
        mimeType: 'application/octet-stream',
      });

      // META + 80 CHUNK + COMPLETE = 82
      const expectedChunks = Math.ceil(MAX_FILE_SIZE / CHUNK_SIZE);
      expect(messages).toHaveLength(expectedChunks + 2);
    });

    it('chunk 消息包含正确的 index（0-based 递增）', () => {
      const sender = new FileSender(key);
      const fileData = generateFileData(CHUNK_SIZE * 3 + 100); // 3.x chunks

      const messages = sender.prepareTransfer(fileData, {
        name: 'multi.bin',
        size: fileData.length,
        mimeType: 'application/octet-stream',
      });

      // 验证 chunk index 递增
      const chunkMessages = messages.filter(m => m.type === MSG_SEND_FILE_CHUNK);
      expect(chunkMessages).toHaveLength(4);
      for (let i = 0; i < chunkMessages.length; i++) {
        const chunkData = chunkMessages[i].data as SendFileChunkData;
        expect(chunkData.index).toBe(i);
      }
    });

    it('META 消息包含正确的 transferId', () => {
      const sender = new FileSender(key);
      const fileData = generateFileData(1024);

      const messages = sender.prepareTransfer(fileData, {
        name: 'test.txt',
        size: fileData.length,
        mimeType: 'text/plain',
      });

      const metaData = messages[0].data as SendFileMetaData;
      expect(metaData.transferId).toBeDefined();
      expect(metaData.transferId.length).toBe(21);

      // 所有消息使用相同的 transferId
      const chunkData = messages[1].data as SendFileChunkData;
      const completeData = messages[2].data as SendFileCompleteData;
      expect(chunkData.transferId).toBe(metaData.transferId);
      expect(completeData.transferId).toBe(metaData.transferId);
    });
  });

  describe('文件大小限制', () => {
    it('拒绝超过 5MB 的文件', () => {
      const sender = new FileSender(key);
      const fileData = generateFileData(MAX_FILE_SIZE + 1);

      expect(() => {
        sender.prepareTransfer(fileData, {
          name: 'too-large.bin',
          size: fileData.length,
          mimeType: 'application/octet-stream',
        });
      }).toThrow('超过限制');
    });

    it('拒绝空文件（0 字节）', () => {
      const sender = new FileSender(key);
      const fileData = Buffer.alloc(0);

      expect(() => {
        sender.prepareTransfer(fileData, {
          name: 'empty.txt',
          size: 0,
          mimeType: 'text/plain',
        });
      }).toThrow('文件为空');
    });

    it('接受恰好 5MB 的文件', () => {
      const sender = new FileSender(key);
      const fileData = generateFileData(MAX_FILE_SIZE);

      expect(() => {
        sender.prepareTransfer(fileData, {
          name: 'max.bin',
          size: fileData.length,
          mimeType: 'application/octet-stream',
        });
      }).not.toThrow();
    });
  });

  describe('进度回调', () => {
    it('每个 chunk 加密后调用进度回调', () => {
      const sender = new FileSender(key);
      const fileData = generateFileData(CHUNK_SIZE * 3 + 100); // 4 chunks
      const progressCalls: [number, number][] = [];

      sender.prepareTransfer(
        fileData,
        { name: 'progress.bin', size: fileData.length, mimeType: 'application/octet-stream' },
        (sent, total) => progressCalls.push([sent, total])
      );

      expect(progressCalls).toHaveLength(4);
      expect(progressCalls[0]).toEqual([1, 4]);
      expect(progressCalls[1]).toEqual([2, 4]);
      expect(progressCalls[2]).toEqual([3, 4]);
      expect(progressCalls[3]).toEqual([4, 4]);
    });

    it('不提供回调时不报错', () => {
      const sender = new FileSender(key);
      const fileData = generateFileData(1024);

      expect(() => {
        sender.prepareTransfer(fileData, {
          name: 'no-callback.txt',
          size: fileData.length,
          mimeType: 'text/plain',
        });
      }).not.toThrow();
    });
  });
});

// ============================================================================
// FileReceiver 测试
// ============================================================================

describe('FileReceiver', () => {
  const shareCode = generateTestShareCode();
  const key = deriveKey(shareCode);

  describe('文件重组', () => {
    it('正确重组单 chunk 文件', () => {
      const sender = new FileSender(key);
      const receiver = new FileReceiver(key);
      const originalData = generateFileData(1024);

      // 发送
      const messages = sender.prepareTransfer(originalData, {
        name: 'single.txt',
        size: originalData.length,
        mimeType: 'text/plain',
      });

      // 接收（模拟服务器中转）
      const metaData = messages[0].data as SendFileMetaData;
      receiver.handleMeta(toRelayMeta(metaData));

      const chunkData = messages[1].data as SendFileChunkData;
      receiver.handleChunk(toRelayChunk(chunkData));

      const completeData = messages[2].data as SendFileCompleteData;
      const result = receiver.handleComplete(toRelayComplete(completeData));

      expect(result).not.toBeNull();
      expect(result!.name).toBe('single.txt');
      expect(result!.mimeType).toBe('text/plain');
      expect(result!.size).toBe(originalData.length);
      expect(result!.data.equals(originalData)).toBe(true);
    });

    it('正确重组多 chunk 文件', () => {
      const sender = new FileSender(key);
      const receiver = new FileReceiver(key);
      const originalData = generateFileData(CHUNK_SIZE * 3 + 500); // 4 chunks

      const messages = sender.prepareTransfer(originalData, {
        name: 'multi.bin',
        size: originalData.length,
        mimeType: 'application/octet-stream',
      });

      // 按顺序接收所有消息
      receiver.handleMeta(toRelayMeta(messages[0].data as SendFileMetaData));

      const chunkMessages = messages.filter(m => m.type === MSG_SEND_FILE_CHUNK);
      for (const msg of chunkMessages) {
        receiver.handleChunk(toRelayChunk(msg.data as SendFileChunkData));
      }

      const completeMsg = messages[messages.length - 1];
      const result = receiver.handleComplete(toRelayComplete(completeMsg.data as SendFileCompleteData));

      expect(result).not.toBeNull();
      expect(result!.name).toBe('multi.bin');
      expect(result!.data.equals(originalData)).toBe(true);
    });

    it('支持乱序接收 chunk', () => {
      const sender = new FileSender(key);
      const receiver = new FileReceiver(key);
      const originalData = generateFileData(CHUNK_SIZE * 4); // 4 chunks

      const messages = sender.prepareTransfer(originalData, {
        name: 'outoforder.bin',
        size: originalData.length,
        mimeType: 'application/octet-stream',
      });

      // 先处理 META
      receiver.handleMeta(toRelayMeta(messages[0].data as SendFileMetaData));

      // 乱序发送 chunk：3, 1, 0, 2
      const chunkMessages = messages.filter(m => m.type === MSG_SEND_FILE_CHUNK);
      const shuffledOrder = [3, 1, 0, 2];
      for (const idx of shuffledOrder) {
        receiver.handleChunk(toRelayChunk(chunkMessages[idx].data as SendFileChunkData));
      }

      // COMPLETE
      const completeMsg = messages[messages.length - 1];
      const result = receiver.handleComplete(toRelayComplete(completeMsg.data as SendFileCompleteData));

      expect(result).not.toBeNull();
      expect(result!.data.equals(originalData)).toBe(true);
    });

    it('chunk 不完整时 handleComplete 返回 null', () => {
      const sender = new FileSender(key);
      const receiver = new FileReceiver(key);
      const originalData = generateFileData(CHUNK_SIZE * 3); // 3 chunks

      const messages = sender.prepareTransfer(originalData, {
        name: 'incomplete.bin',
        size: originalData.length,
        mimeType: 'application/octet-stream',
      });

      // 只发送 META 和第一个 chunk（缺少后续 chunk）
      receiver.handleMeta(toRelayMeta(messages[0].data as SendFileMetaData));
      receiver.handleChunk(toRelayChunk(messages[1].data as SendFileChunkData));

      // 直接发送 COMPLETE（chunk 不完整）
      const completeMsg = messages[messages.length - 1];
      const result = receiver.handleComplete(toRelayComplete(completeMsg.data as SendFileCompleteData));

      expect(result).toBeNull();
    });
  });

  describe('取消处理', () => {
    it('handleCancel 清理传输状态', () => {
      const sender = new FileSender(key);
      const receiver = new FileReceiver(key);
      const originalData = generateFileData(CHUNK_SIZE * 2);

      const messages = sender.prepareTransfer(originalData, {
        name: 'cancel.bin',
        size: originalData.length,
        mimeType: 'application/octet-stream',
      });

      const metaData = messages[0].data as SendFileMetaData;
      receiver.handleMeta(toRelayMeta(metaData));

      // 确认传输存在
      expect(receiver.hasTransfer(metaData.transferId)).toBe(true);

      // 取消传输
      const cancelData: RelayFileCancelData = {
        senderId: 'test-sender-id',
        transferId: metaData.transferId,
      };
      receiver.handleCancel(cancelData);

      // 传输已被清理
      expect(receiver.hasTransfer(metaData.transferId)).toBe(false);
    });

    it('取消后的 chunk 被静默丢弃', () => {
      const sender = new FileSender(key);
      const receiver = new FileReceiver(key);
      const originalData = generateFileData(CHUNK_SIZE * 2);

      const messages = sender.prepareTransfer(originalData, {
        name: 'cancel-then-chunk.bin',
        size: originalData.length,
        mimeType: 'application/octet-stream',
      });

      const metaData = messages[0].data as SendFileMetaData;
      receiver.handleMeta(toRelayMeta(metaData));

      // 取消
      receiver.handleCancel({
        senderId: 'test-sender-id',
        transferId: metaData.transferId,
      });

      // 后续 chunk 应被静默丢弃（不报错）
      const chunkData = messages[1].data as SendFileChunkData;
      expect(() => {
        receiver.handleChunk(toRelayChunk(chunkData));
      }).not.toThrow();
    });
  });

  describe('进度回调', () => {
    it('每收到一个 chunk 触发进度回调', () => {
      const shareCode2 = generateTestShareCode();
      const key2 = deriveKey(shareCode2);
      const progressCalls: [number, number][] = [];

      const sender = new FileSender(key2);
      const receiver = new FileReceiver(key2, (received, total) => {
        progressCalls.push([received, total]);
      });

      const originalData = generateFileData(CHUNK_SIZE * 3); // 3 chunks
      const messages = sender.prepareTransfer(originalData, {
        name: 'progress.bin',
        size: originalData.length,
        mimeType: 'application/octet-stream',
      });

      receiver.handleMeta(toRelayMeta(messages[0].data as SendFileMetaData));

      const chunkMessages = messages.filter(m => m.type === MSG_SEND_FILE_CHUNK);
      for (const msg of chunkMessages) {
        receiver.handleChunk(toRelayChunk(msg.data as SendFileChunkData));
      }

      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0]).toEqual([1, 3]);
      expect(progressCalls[1]).toEqual([2, 3]);
      expect(progressCalls[2]).toEqual([3, 3]);
    });
  });

  describe('边界情况', () => {
    it('重复 META 消息被忽略', () => {
      const sender = new FileSender(key);
      const receiver = new FileReceiver(key);
      const originalData = generateFileData(1024);

      const messages = sender.prepareTransfer(originalData, {
        name: 'dup-meta.txt',
        size: originalData.length,
        mimeType: 'text/plain',
      });

      const metaData = messages[0].data as SendFileMetaData;
      receiver.handleMeta(toRelayMeta(metaData));
      // 第二次 META 应被忽略（不报错）
      expect(() => {
        receiver.handleMeta(toRelayMeta(metaData));
      }).not.toThrow();
    });

    it('重复 chunk 被忽略（幂等性）', () => {
      const sender = new FileSender(key);
      const receiver = new FileReceiver(key);
      const originalData = generateFileData(CHUNK_SIZE * 2);

      const messages = sender.prepareTransfer(originalData, {
        name: 'dup-chunk.bin',
        size: originalData.length,
        mimeType: 'application/octet-stream',
      });

      receiver.handleMeta(toRelayMeta(messages[0].data as SendFileMetaData));

      // 发送同一个 chunk 两次
      const chunkData = messages[1].data as SendFileChunkData;
      receiver.handleChunk(toRelayChunk(chunkData));
      receiver.handleChunk(toRelayChunk(chunkData)); // 重复

      // 进度应该只计算一次
      const progress = receiver.getProgress((messages[0].data as SendFileMetaData).transferId);
      expect(progress).toEqual([1, 2]);
    });

    it('未知 transferId 的 chunk 被静默丢弃', () => {
      const receiver = new FileReceiver(key);

      const fakeChunk: RelayFileChunkData = {
        senderId: 'unknown',
        transferId: 'nonexistent-transfer-id',
        index: 0,
        iv: new Uint8Array(12),
        data: new Uint8Array(100),
      };

      expect(() => {
        receiver.handleChunk(fakeChunk);
      }).not.toThrow();
    });

    it('cleanup 清理所有活跃传输', () => {
      const sender = new FileSender(key);
      const receiver = new FileReceiver(key);
      const fileData = generateFileData(1024);

      const messages = sender.prepareTransfer(fileData, {
        name: 'cleanup.txt',
        size: fileData.length,
        mimeType: 'text/plain',
      });

      const metaData = messages[0].data as SendFileMetaData;
      receiver.handleMeta(toRelayMeta(metaData));
      expect(receiver.hasTransfer(metaData.transferId)).toBe(true);

      receiver.cleanup();
      expect(receiver.hasTransfer(metaData.transferId)).toBe(false);
    });
  });
});

// ============================================================================
// Sender → Receiver Roundtrip 测试
// ============================================================================

describe('Sender → Receiver Roundtrip', () => {
  it('小文件端到端加密/解密 roundtrip', () => {
    const shareCode = generateTestShareCode();
    const key = deriveKey(shareCode);

    const sender = new FileSender(key);
    const receiver = new FileReceiver(key);

    // 使用有意义的文本内容
    const content = 'Hello, World! 你好世界！🎉 This is a test file.';
    const originalData = Buffer.from(content, 'utf8');

    const messages = sender.prepareTransfer(originalData, {
      name: 'hello.txt',
      size: originalData.length,
      mimeType: 'text/plain',
    });

    // 模拟完整的传输流程
    receiver.handleMeta(toRelayMeta(messages[0].data as SendFileMetaData));

    const chunkMessages = messages.filter(m => m.type === MSG_SEND_FILE_CHUNK);
    for (const msg of chunkMessages) {
      receiver.handleChunk(toRelayChunk(msg.data as SendFileChunkData));
    }

    const completeMsg = messages[messages.length - 1];
    const result = receiver.handleComplete(toRelayComplete(completeMsg.data as SendFileCompleteData));

    expect(result).not.toBeNull();
    expect(result!.name).toBe('hello.txt');
    expect(result!.mimeType).toBe('text/plain');
    expect(result!.data.toString('utf8')).toBe(content);
  });

  it('大文件（接近 5MB）端到端 roundtrip', () => {
    const shareCode = generateTestShareCode();
    const key = deriveKey(shareCode);

    const sender = new FileSender(key);
    const receiver = new FileReceiver(key);

    // 4.5MB 文件
    const originalData = generateFileData(4.5 * 1024 * 1024);

    const messages = sender.prepareTransfer(originalData, {
      name: 'large-file.bin',
      size: originalData.length,
      mimeType: 'application/octet-stream',
    });

    // 完整传输
    receiver.handleMeta(toRelayMeta(messages[0].data as SendFileMetaData));

    const chunkMessages = messages.filter(m => m.type === MSG_SEND_FILE_CHUNK);
    for (const msg of chunkMessages) {
      receiver.handleChunk(toRelayChunk(msg.data as SendFileChunkData));
    }

    const completeMsg = messages[messages.length - 1];
    const result = receiver.handleComplete(toRelayComplete(completeMsg.data as SendFileCompleteData));

    expect(result).not.toBeNull();
    expect(result!.name).toBe('large-file.bin');
    expect(result!.size).toBe(originalData.length);
    expect(result!.data.equals(originalData)).toBe(true);
  });

  it('不同密钥无法解密（安全性验证）', () => {
    const shareCode1 = generateTestShareCode();
    const shareCode2 = generateTestShareCode();
    const key1 = deriveKey(shareCode1);
    const key2 = deriveKey(shareCode2);

    const sender = new FileSender(key1);
    const receiver = new FileReceiver(key2); // 使用不同的密钥

    const originalData = generateFileData(1024);
    const messages = sender.prepareTransfer(originalData, {
      name: 'secret.txt',
      size: originalData.length,
      mimeType: 'text/plain',
    });

    // META 解密应该失败
    expect(() => {
      receiver.handleMeta(toRelayMeta(messages[0].data as SendFileMetaData));
    }).toThrow();
  });
});
