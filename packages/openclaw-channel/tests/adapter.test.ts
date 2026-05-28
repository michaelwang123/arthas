/**
 * @file adapter.test.ts — ArthasChannelAdapter 集成测试
 *
 * 本文件使用 ws 库的 WebSocket.Server 创建模拟 Arthas 服务器，
 * 测试 ArthasChannelAdapter 的完整消息流：
 * 1. 连接与加入房间（JOIN → ROOM_JOINED）
 * 2. 接收用户消息（MSG_RELAY_MESSAGE → 解密 → onMessage 回调）
 * 3. 发送 Agent 回复（send() → 加密 → MSG_SEND_MESSAGE）
 * 4. 长消息分割（> 4000 字符拆分为多条）
 * 5. 回环过滤（自己的消息不触发 onMessage）
 * 6. 系统消息过滤（join/leave 不触发 onMessage）
 * 7. Typing indicator（send({ type: 'typing' }) → MSG_TYPING）
 * 8. 文件传输（接收加密文件 → 解密重组 → 作为附件转发）
 *
 * 📚 学习要点: 集成测试策略
 * 集成测试验证多个模块协同工作的正确性：
 * - adapter.ts + client.ts + crypto.ts + protocol.ts + file-transfer.ts
 * 使用真实的 WebSocket 连接（本地 loopback），而非 mock WebSocket 对象。
 * 这样可以发现模块间接口不匹配的问题（如编码格式不一致）。
 *
 * 📚 学习要点: Mock 服务器设计
 * Mock 服务器模拟 Arthas 服务器的核心行为：
 * - 响应 MSG_JOIN_ROOM → 发送 MSG_ROOM_JOINED
 * - 响应 MSG_PONG（客户端心跳回复）
 * - 可以主动发送 MSG_RELAY_MESSAGE（模拟其他用户发消息）
 * - 可以主动发送 MSG_PING（心跳检测）
 * 不模拟的行为：房间管理、密码验证、成员限制等（这些是服务器逻辑）
 *
 * @module openclaw-channel/tests/adapter
 * @see requirements.md — Requirements 1.1-6.5
 * @see design.md — D3, D4: 消息协议适配
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { randomBytes } from 'node:crypto';

import { ArthasChannelAdapter } from '../src/adapter';
import { encrypt, decrypt, toBase64Url, fromBase64Url, deriveKey, encryptBuffer } from '../src/crypto';
import {
  encodeMessage,
  decodeMessage,
  MSG_JOIN_ROOM,
  MSG_SEND_MESSAGE,
  MSG_ROOM_JOINED,
  MSG_RELAY_MESSAGE,
  MSG_PING,
  MSG_PONG,
  MSG_TYPING,
  MSG_MEMBER_JOINED,
  MSG_MEMBER_LEFT,
  MSG_SEND_FILE_META,
  MSG_SEND_FILE_CHUNK,
  MSG_SEND_FILE_COMPLETE,
  MSG_RELAY_FILE_META,
  MSG_RELAY_FILE_CHUNK,
  MSG_RELAY_FILE_COMPLETE,
} from '../src/protocol';
import type {
  JoinRoomData,
  SendMessageData,
  RelayMessageData,
  RoomJoinedData,
  MemberInfo,
  TypingData,
  SendFileMetaData,
  SendFileChunkData,
} from '../src/protocol';
import type { IncomingMessage, OutgoingMessage, ConnectionStatus } from '../src/types';


// ============================================================================
// 测试辅助工具
// ============================================================================

/**
 * 生成测试用的分享码。
 *
 * 📚 学习要点: 测试用分享码格式
 * 分享码格式: {roomId(21 chars)}:{base64url key(43 chars)}:{ephemeral}:{expiresAt}
 * 测试中使用固定的 roomId 和随机生成的 AES-256 密钥。
 */
function generateTestShareCode(): { shareCode: string; key: Buffer } {
  // 生成 21 字符的 roomId（模拟 NanoID）
  const roomId = 'V1StGXR8_Z5jdHi6B-myT';
  // 生成 32 字节随机 AES-256 密钥
  const key = randomBytes(32);
  // Base64URL 编码密钥（43 字符）
  const keyEncoded = key.toString('base64url');
  // 组装分享码
  const shareCode = `${roomId}:${keyEncoded}:0:0`;
  return { shareCode, key };
}

/**
 * 等待指定毫秒数。
 * 用于等待异步消息传递完成。
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Mock Arthas 服务器
// ============================================================================

/**
 * 模拟 Arthas 服务器。
 *
 * 📚 学习要点: Mock 服务器的最小实现
 * 只实现集成测试所需的核心行为：
 * - 接受 WebSocket 连接
 * - 响应 JOIN 请求（返回 ROOM_JOINED）
 * - 记录收到的消息（供断言使用）
 * - 提供发送消息的方法（模拟其他用户发消息）
 * - 定期发送 PING（心跳）
 */
class MockArthasServer {
  /** WebSocket 服务器实例 */
  private wss: WebSocketServer;
  /** 当前连接的客户端 */
  private clients: WsWebSocket[] = [];
  /** 收到的所有消息（解码后） */
  public receivedMessages: Array<{ type: number; data: unknown }> = [];
  /** 服务器监听端口 */
  public port: number = 0;
  /** 分配给客户端的 ID */
  private readonly clientId = 'agent001';
  /** 心跳定时器 */
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 使用端口 0 让操作系统自动分配可用端口
    this.wss = new WebSocketServer({ port: 0 });
  }

  /**
   * 启动 Mock 服务器并等待就绪。
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.on('listening', () => {
        const addr = this.wss.address();
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port;
        }
        resolve();
      });

      this.wss.on('connection', (ws) => {
        this.clients.push(ws);

        ws.on('message', (data: Buffer) => {
          this.handleMessage(ws, data);
        });

        ws.on('close', () => {
          this.clients = this.clients.filter((c) => c !== ws);
        });
      });
    });
  }

  /**
   * 处理客户端发来的消息。
   *
   * 📚 学习要点: Mock 服务器的消息路由
   * 只处理测试需要的消息类型：
   * - MSG_JOIN_ROOM: 返回 ROOM_JOINED（模拟加入成功）
   * - MSG_PONG: 记录但不响应（心跳回复）
   * - 其他消息: 记录到 receivedMessages 供断言使用
   */
  private handleMessage(ws: WsWebSocket, rawData: Buffer): void {
    const message = decodeMessage(new Uint8Array(rawData));
    this.receivedMessages.push(message);

    switch (message.type) {
      case MSG_JOIN_ROOM: {
        // 响应 ROOM_JOINED
        const joinData = message.data as JoinRoomData;
        const roomJoinedData: RoomJoinedData = {
          roomId: joinData.roomId,
          members: [
            { id: this.clientId, name: joinData.name, color: '#4a7fbf' },
          ] as MemberInfo[],
          hasPassword: false,
          ephemeral: 0,
          expiresAt: 0,
        };
        const response = encodeMessage(MSG_ROOM_JOINED, roomJoinedData);
        ws.send(response);
        break;
      }
      default:
        // 其他消息只记录，不响应
        break;
    }
  }

  /**
   * 向所有连接的客户端发送模拟的中转消息。
   *
   * 📚 学习要点: 模拟其他用户发消息
   * 在真实场景中，用户 A 发送消息 → 服务器中转 → Agent 收到 MSG_RELAY_MESSAGE。
   * Mock 服务器直接构造 MSG_RELAY_MESSAGE 发送给 Agent，模拟这个过程。
   *
   * @param plaintext - 明文消息内容
   * @param key - AES-256 加密密钥（与 Agent 使用相同密钥）
   * @param senderId - 模拟的发送者 ID（默认 'user001'）
   * @param senderName - 模拟的发送者名称（默认 'Alice'）
   */
  sendRelayMessage(
    plaintext: string,
    key: Buffer,
    senderId: string = 'user001',
    senderName: string = 'Alice'
  ): void {
    // 使用相同的加密密钥加密消息（模拟同一房间的用户）
    const { ciphertext, iv } = encrypt(plaintext, key);

    const relayData: RelayMessageData = {
      senderId,
      senderName,
      iv: toBase64Url(iv),
      ciphertext: toBase64Url(ciphertext),
      t: Date.now(),
    };

    const encoded = encodeMessage(MSG_RELAY_MESSAGE, relayData);
    for (const client of this.clients) {
      if (client.readyState === WsWebSocket.OPEN) {
        client.send(encoded);
      }
    }
  }

  /**
   * 发送模拟的自己的消息（用于测试回环过滤）。
   *
   * @param plaintext - 明文消息内容
   * @param key - AES-256 加密密钥
   */
  sendOwnRelayMessage(plaintext: string, key: Buffer): void {
    // 使用 Agent 自己的 clientId 作为 senderId（模拟回环）
    this.sendRelayMessage(plaintext, key, this.clientId, 'AI Assistant');
  }

  /**
   * 发送系统消息（成员加入通知）。
   */
  sendMemberJoined(memberId: string, memberName: string): void {
    const encoded = encodeMessage(MSG_MEMBER_JOINED, {
      id: memberId,
      name: memberName,
      color: '#ff6b6b',
    });
    for (const client of this.clients) {
      if (client.readyState === WsWebSocket.OPEN) {
        client.send(encoded);
      }
    }
  }

  /**
   * 发送系统消息（成员离开通知）。
   */
  sendMemberLeft(memberId: string): void {
    const encoded = encodeMessage(MSG_MEMBER_LEFT, { id: memberId });
    for (const client of this.clients) {
      if (client.readyState === WsWebSocket.OPEN) {
        client.send(encoded);
      }
    }
  }

  /**
   * 发送 PING 心跳消息。
   */
  sendPing(): void {
    const encoded = encodeMessage(MSG_PING, { t: Date.now() });
    for (const client of this.clients) {
      if (client.readyState === WsWebSocket.OPEN) {
        client.send(encoded);
      }
    }
  }

  /**
   * 启动定期 PING（模拟服务器心跳）。
   */
  startPinging(intervalMs: number = 5000): void {
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, intervalMs);
  }

  /**
   * 发送模拟的文件传输消息序列（META + CHUNK × N + COMPLETE）。
   *
   * 📚 学习要点: 模拟文件传输
   * 模拟另一个用户向 Agent 发送文件的完整流程：
   * 1. 加密文件元数据 → 发送 MSG_RELAY_FILE_META
   * 2. 将文件分片加密 → 逐片发送 MSG_RELAY_FILE_CHUNK
   * 3. 发送 MSG_RELAY_FILE_COMPLETE 标记传输结束
   *
   * @param fileData - 文件内容
   * @param fileName - 文件名
   * @param mimeType - MIME 类型
   * @param key - AES-256 加密密钥
   * @param senderId - 发送者 ID
   */
  sendFileTransfer(
    fileData: Buffer,
    fileName: string,
    mimeType: string,
    key: Buffer,
    senderId: string = 'user001'
  ): void {
    const CHUNK_SIZE = 64 * 1024;
    const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE);
    const transferId = randomBytes(16).toString('hex').slice(0, 21);

    // 1. 发送 META（加密文件元数据）
    const metadata = JSON.stringify({
      name: fileName,
      size: fileData.length,
      mimeType,
      totalChunks,
    });
    const { ciphertext: metaCipher, iv: metaIv } = encrypt(metadata, key);

    const metaMsg = encodeMessage(MSG_RELAY_FILE_META, {
      senderId,
      senderName: 'Alice',
      transferId,
      iv: toBase64Url(metaIv),
      ciphertext: new Uint8Array(metaCipher),
      t: Date.now(),
    });
    for (const client of this.clients) {
      if (client.readyState === WsWebSocket.OPEN) {
        client.send(metaMsg);
      }
    }

    // 2. 发送 CHUNK（逐片加密）
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileData.length);
      const chunk = fileData.subarray(start, end);

      // 使用 encryptBuffer 直接加密二进制数据（与 FileSender/FileReceiver 一致）
      const { ciphertext: chunkCipher, iv: chunkIv } = encryptBuffer(chunk, key);

      const chunkMsg = encodeMessage(MSG_RELAY_FILE_CHUNK, {
        senderId,
        transferId,
        index: i,
        iv: new Uint8Array(chunkIv),
        data: new Uint8Array(chunkCipher),
      });
      for (const client of this.clients) {
        if (client.readyState === WsWebSocket.OPEN) {
          client.send(chunkMsg);
        }
      }
    }

    // 3. 发送 COMPLETE
    const completeMsg = encodeMessage(MSG_RELAY_FILE_COMPLETE, {
      senderId,
      transferId,
    });
    for (const client of this.clients) {
      if (client.readyState === WsWebSocket.OPEN) {
        client.send(completeMsg);
      }
    }
  }

  /**
   * 获取收到的特定类型的消息。
   */
  getMessagesOfType(type: number): Array<{ type: number; data: unknown }> {
    return this.receivedMessages.filter((m) => m.type === type);
  }

  /**
   * 清空收到的消息记录。
   */
  clearMessages(): void {
    this.receivedMessages = [];
  }

  /**
   * 强制断开所有客户端连接（用于测试重连）。
   */
  disconnectAllClients(): void {
    for (const client of this.clients) {
      client.close(1001, 'server shutdown');
    }
  }

  /**
   * 关闭 Mock 服务器。
   */
  async close(): Promise<void> {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    // 关闭所有客户端连接
    for (const client of this.clients) {
      client.terminate();
    }
    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }
}


// ============================================================================
// 集成测试
// ============================================================================

describe('ArthasChannelAdapter 集成测试', () => {
  let server: MockArthasServer;
  let adapter: ArthasChannelAdapter;
  let testShareCode: string;
  let testKey: Buffer;

  beforeEach(async () => {
    // 1. 生成测试用分享码和密钥
    const { shareCode, key } = generateTestShareCode();
    testShareCode = shareCode;
    testKey = key;

    // 2. 启动 Mock 服务器
    server = new MockArthasServer();
    await server.start();

    // 3. 创建 adapter 实例
    adapter = new ArthasChannelAdapter();
  });

  afterEach(async () => {
    // 清理：断开 adapter 并关闭服务器
    try {
      await adapter.disconnect();
    } catch {
      // 忽略断开错误（可能已经断开）
    }
    await server.close();
  });

  // --------------------------------------------------------------------------
  // 测试组 1: 连接与加入房间
  // --------------------------------------------------------------------------

  describe('连接与加入房间', () => {
    it('应该成功连接到服务器并加入房间', async () => {
      // Arrange: 注册状态回调
      const statuses: ConnectionStatus[] = [];
      adapter.onStatusChange((status) => statuses.push(status));

      // Act: 连接
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
        displayName: 'Test Agent',
      });

      // 等待消息传递完成（JOIN 是异步发送的）
      await delay(100);

      // Assert: 服务器收到 JOIN 消息
      const joinMessages = server.getMessagesOfType(MSG_JOIN_ROOM);
      expect(joinMessages.length).toBe(1);

      const joinData = joinMessages[0]!.data as JoinRoomData;
      expect(joinData.roomId).toBe('V1StGXR8_Z5jdHi6B-myT');
      expect(joinData.name).toBe('Test Agent');

      // Assert: 状态变为 connected
      expect(statuses).toContain('connected');
    });

    it('应该在配置无效时抛出错误', async () => {
      // Act & Assert: 缺少 shareCode
      await expect(
        adapter.connect({
          serverUrl: `ws://localhost:${server.port}`,
          // shareCode 缺失
        })
      ).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 测试组 2: 接收用户消息（解密 + 转发）
  // --------------------------------------------------------------------------

  describe('接收用户消息', () => {
    it('应该解密收到的消息并通过 onMessage 回调转发', async () => {
      // Arrange: 注册消息回调
      const receivedMessages: IncomingMessage[] = [];
      adapter.onMessage((msg) => receivedMessages.push(msg));

      // 连接
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });

      // Act: 模拟用户发送加密消息
      server.sendRelayMessage('你好，AI！', testKey);

      // 等待消息传递
      await delay(100);

      // Assert: 回调收到解密后的消息
      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0]!.text).toBe('你好，AI！');
      expect(receivedMessages[0]!.userId).toBe('user001');
      expect(receivedMessages[0]!.userName).toBe('Alice');
      expect(receivedMessages[0]!.channelId).toBe('arthas');
    });

    it('应该正确处理 Unicode 消息', async () => {
      // Arrange
      const receivedMessages: IncomingMessage[] = [];
      adapter.onMessage((msg) => receivedMessages.push(msg));
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });

      // Act: 发送包含 emoji 和中文的消息
      const unicodeText = '🎉 恭喜！这是一条包含 emoji 的消息 🚀✨';
      server.sendRelayMessage(unicodeText, testKey);
      await delay(100);

      // Assert
      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0]!.text).toBe(unicodeText);
    });

    it('应该过滤自己发送的消息（防回环）', async () => {
      // Arrange
      const receivedMessages: IncomingMessage[] = [];
      adapter.onMessage((msg) => receivedMessages.push(msg));
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });

      // 等待 ROOM_JOINED 响应被处理（设置 clientId）
      // 📚 学习要点: 时序依赖
      // client.join() 发送 JOIN 后立即返回，不等待 ROOM_JOINED 响应。
      // clientId 在收到 ROOM_JOINED 后才被设置。
      // 需要等待一小段时间确保 clientId 已就绪。
      await delay(100);

      // Act: 模拟收到自己的消息（senderId === clientId）
      server.sendOwnRelayMessage('这是我自己的消息', testKey);
      await delay(100);

      // Assert: 不应触发回调（回环过滤）
      expect(receivedMessages.length).toBe(0);
    });

    it('应该过滤系统消息（join/leave）', async () => {
      // Arrange
      const receivedMessages: IncomingMessage[] = [];
      adapter.onMessage((msg) => receivedMessages.push(msg));
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });

      // Act: 发送系统消息
      server.sendMemberJoined('user002', 'Bob');
      server.sendMemberLeft('user002');
      await delay(100);

      // Assert: 系统消息不应触发回调
      expect(receivedMessages.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 测试组 3: 发送 Agent 回复（加密 + 发送）
  // --------------------------------------------------------------------------

  describe('发送 Agent 回复', () => {
    it('应该加密并发送文本消息', async () => {
      // Arrange
      adapter.onMessage(() => {}); // 注册空回调
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });
      server.clearMessages(); // 清除 JOIN 消息

      // Act: 发送 Agent 回复
      const outgoing: OutgoingMessage = {
        id: 'msg-001',
        channelId: 'arthas',
        text: '你好！我是 AI 助手。',
      };
      await adapter.send(outgoing);
      await delay(100);

      // Assert: 服务器收到加密消息
      const sendMessages = server.getMessagesOfType(MSG_SEND_MESSAGE);
      expect(sendMessages.length).toBe(1);

      // 验证可以解密
      const sendData = sendMessages[0]!.data as SendMessageData;
      const ivBuffer = fromBase64Url(sendData.iv);
      const ciphertextBuffer = fromBase64Url(sendData.ciphertext);
      const decrypted = decrypt(ciphertextBuffer, ivBuffer, testKey);
      expect(decrypted).toBe('你好！我是 AI 助手。');
    });

    it('应该将超过 4000 字符的消息分割为多条', async () => {
      // Arrange
      adapter.onMessage(() => {});
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });
      server.clearMessages();

      // Act: 发送超长消息（5000 字符）
      const longText = 'A'.repeat(5000);
      await adapter.send({
        id: 'msg-002',
        channelId: 'arthas',
        text: longText,
      });
      await delay(100);

      // Assert: 应该被分割为 2 条消息（4000 + 1000）
      const sendMessages = server.getMessagesOfType(MSG_SEND_MESSAGE);
      expect(sendMessages.length).toBe(2);

      // 验证第一条消息解密后为 4000 字符
      const firstData = sendMessages[0]!.data as SendMessageData;
      const firstDecrypted = decrypt(
        fromBase64Url(firstData.ciphertext),
        fromBase64Url(firstData.iv),
        testKey
      );
      expect(firstDecrypted.length).toBe(4000);

      // 验证第二条消息解密后为 1000 字符
      const secondData = sendMessages[1]!.data as SendMessageData;
      const secondDecrypted = decrypt(
        fromBase64Url(secondData.ciphertext),
        fromBase64Url(secondData.iv),
        testKey
      );
      expect(secondDecrypted.length).toBe(1000);

      // 验证拼接后等于原始消息
      expect(firstDecrypted + secondDecrypted).toBe(longText);
    });

    it('应该发送 typing 状态', async () => {
      // Arrange
      adapter.onMessage(() => {});
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });
      server.clearMessages();

      // Act: 发送 typing 消息
      await adapter.send({
        id: 'msg-003',
        channelId: 'arthas',
        text: '',
        type: 'typing',
      });
      await delay(100);

      // Assert: 服务器收到 TYPING 消息
      const typingMessages = server.getMessagesOfType(MSG_TYPING);
      expect(typingMessages.length).toBe(1);
      const typingData = typingMessages[0]!.data as TypingData;
      expect(typingData.typing).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 测试组 4: 心跳机制
  // --------------------------------------------------------------------------

  describe('心跳机制', () => {
    it('应该响应服务器 PING 并回复 PONG', async () => {
      // Arrange
      adapter.onMessage(() => {});
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });
      server.clearMessages();

      // Act: 服务器发送 PING
      server.sendPing();
      await delay(100);

      // Assert: 客户端回复 PONG
      const pongMessages = server.getMessagesOfType(MSG_PONG);
      expect(pongMessages.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // 测试组 5: 完整消息流（端到端）
  // --------------------------------------------------------------------------

  describe('完整消息流（端到端）', () => {
    it('应该完成完整的消息往返：用户发送 → 解密 → 回调 → Agent 回复 → 加密 → 发送', async () => {
      // Arrange: 注册消息回调，模拟 Gateway 处理逻辑
      const receivedMessages: IncomingMessage[] = [];
      adapter.onMessage((msg) => receivedMessages.push(msg));
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });
      server.clearMessages();

      // Act Step 1: 用户发送消息
      server.sendRelayMessage('请帮我写一个 Hello World 程序', testKey);
      await delay(100);

      // Assert Step 1: 回调收到解密后的消息
      expect(receivedMessages.length).toBe(1);
      expect(receivedMessages[0]!.text).toBe('请帮我写一个 Hello World 程序');

      // Act Step 2: Agent 回复
      await adapter.send({
        id: 'reply-001',
        channelId: 'arthas',
        text: 'console.log("Hello, World!");',
      });
      await delay(100);

      // Assert Step 2: 服务器收到加密的回复
      const sendMessages = server.getMessagesOfType(MSG_SEND_MESSAGE);
      expect(sendMessages.length).toBe(1);

      // 验证回复内容可以被正确解密
      const replyData = sendMessages[0]!.data as SendMessageData;
      const decryptedReply = decrypt(
        fromBase64Url(replyData.ciphertext),
        fromBase64Url(replyData.iv),
        testKey
      );
      expect(decryptedReply).toBe('console.log("Hello, World!");');
    });

    it('应该在多用户房间中响应所有非系统消息', async () => {
      // Arrange
      const receivedMessages: IncomingMessage[] = [];
      adapter.onMessage((msg) => receivedMessages.push(msg));
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });

      // Act: 多个用户发送消息
      server.sendRelayMessage('来自 Alice 的消息', testKey, 'user001', 'Alice');
      server.sendRelayMessage('来自 Bob 的消息', testKey, 'user002', 'Bob');
      await delay(150);

      // Assert: 两条消息都被接收
      expect(receivedMessages.length).toBe(2);
      expect(receivedMessages[0]!.userName).toBe('Alice');
      expect(receivedMessages[1]!.userName).toBe('Bob');
    });
  });

  // --------------------------------------------------------------------------
  // 测试组 6: 文件传输
  // --------------------------------------------------------------------------

  describe('文件传输', () => {
    it('应该接收加密文件并作为附件转发', async () => {
      // Arrange
      const receivedMessages: IncomingMessage[] = [];
      adapter.onMessage((msg) => receivedMessages.push(msg));
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });

      // Act: 模拟用户发送文件（小文件，1KB）
      const fileContent = Buffer.from('Hello, this is a test file content!');
      server.sendFileTransfer(fileContent, 'test.txt', 'text/plain', testKey);
      await delay(200);

      // Assert: 回调收到包含文件附件的消息
      expect(receivedMessages.length).toBe(1);
      const msg = receivedMessages[0]!;
      expect(msg.text).toContain('test.txt');
      expect(msg.attachments).toBeDefined();
      expect(msg.attachments!.length).toBe(1);

      const attachment = msg.attachments![0]!;
      expect(attachment.fileName).toBe('test.txt');
      expect(attachment.mimeType).toBe('text/plain');
      expect(attachment.size).toBe(fileContent.length);
      // 验证文件内容正确解密
      expect(Buffer.from(attachment.data).toString()).toBe(fileContent.toString());
    });

    it('应该正确处理多分片文件传输', async () => {
      // Arrange
      const receivedMessages: IncomingMessage[] = [];
      adapter.onMessage((msg) => receivedMessages.push(msg));
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });

      // Act: 发送大文件（128KB，需要 2 个 chunk）
      const largeContent = randomBytes(128 * 1024);
      server.sendFileTransfer(largeContent, 'large.bin', 'application/octet-stream', testKey);
      await delay(300);

      // Assert: 文件正确重组
      expect(receivedMessages.length).toBe(1);
      const attachment = receivedMessages[0]!.attachments![0]!;
      expect(attachment.fileName).toBe('large.bin');
      expect(attachment.size).toBe(largeContent.length);
      expect(Buffer.from(attachment.data).equals(largeContent)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 测试组 7: 断开连接与资源清理
  // --------------------------------------------------------------------------

  describe('断开连接', () => {
    it('应该优雅断开连接', async () => {
      // Arrange
      const statuses: ConnectionStatus[] = [];
      adapter.onStatusChange((status) => statuses.push(status));
      adapter.onMessage(() => {});
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });

      // Act: 断开连接
      await adapter.disconnect();
      await delay(100);

      // Assert: 状态变为 disconnected
      expect(statuses).toContain('disconnected');
    });

    it('断开后发送消息应该抛出错误', async () => {
      // Arrange
      adapter.onMessage(() => {});
      await adapter.connect({
        serverUrl: `ws://localhost:${server.port}`,
        shareCode: testShareCode,
      });
      await adapter.disconnect();

      // Act & Assert
      await expect(
        adapter.send({ id: 'msg-x', channelId: 'arthas', text: 'test' })
      ).rejects.toThrow('未连接');
    });
  });
});
