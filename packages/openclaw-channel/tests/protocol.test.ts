/**
 * @file protocol.test.ts — Arthas msgpack 协议编解码测试
 *
 * 测试策略：
 * 1. 编解码往返测试（roundtrip）：验证 encode → decode 保持数据完整性
 * 2. 格式兼容性测试：验证编码格式与 Go 服务器期望的格式一致
 * 3. 边界条件测试：空 payload、大消息、二进制数据
 *
 * 📚 学习要点: 协议测试的重要性
 * 协议层是跨语言互操作的关键。如果 TypeScript 编码的消息格式与 Go 服务器
 * 期望的格式不一致，通信将完全失败。因此协议测试必须覆盖：
 * - 字段名称完全匹配（msgpack key = Go struct tag）
 * - 数值类型正确（整数不被编码为浮点数）
 * - 二进制数据正确传输（Uint8Array 不被转为字符串）
 *
 * @module openclaw-channel/tests/protocol
 */

import { describe, it, expect } from 'vitest';
import { encode, decode } from '@msgpack/msgpack';
import {
  // 消息类型常量
  MSG_CREATE_ROOM,
  MSG_JOIN_ROOM,
  MSG_SEND_MESSAGE,
  MSG_LEAVE_ROOM,
  MSG_TYPING,
  MSG_PONG,
  MSG_SEND_REACTION,
  MSG_SEND_FILE_META,
  MSG_SEND_FILE_CHUNK,
  MSG_SEND_FILE_COMPLETE,
  MSG_SEND_FILE_CANCEL,
  MSG_SEND_FILE_ACK,
  MSG_ROOM_CREATED,
  MSG_ROOM_JOINED,
  MSG_MEMBER_JOINED,
  MSG_MEMBER_LEFT,
  MSG_RELAY_MESSAGE,
  MSG_MEMBER_TYPING,
  MSG_ROOM_CLOSED,
  MSG_ERROR,
  MSG_PING,
  MSG_RELAY_REACTION,
  MSG_RELAY_FILE_META,
  MSG_RELAY_FILE_CHUNK,
  MSG_RELAY_FILE_COMPLETE,
  MSG_RELAY_FILE_CANCEL,
  MSG_RELAY_FILE_ACK,
  // 错误码
  ERR_ROOM_NOT_FOUND,
  ERR_ROOM_FULL,
  ERR_NOT_IN_ROOM,
  ERR_RATE_LIMITED,
  ERR_INVALID_MESSAGE,
  ERR_WRONG_PASSWORD,
  ERR_ROOM_EXPIRED,
  // 编解码函数
  encodeMessage,
  decodeMessage,
  // 类型
  type JoinRoomData,
  type SendMessageData,
  type TypingData,
  type PongData,
  type RelayMessageData,
  type PingData,
  type ErrorData,
  type RoomJoinedData,
  type MemberJoinedData,
  type MemberLeftData,
  type SendFileChunkData,
  type RelayFileMetaData,
  type RelayFileChunkData,
  type Message,
} from '../src/protocol';

// ============================================================================
// 消息类型常量值测试
// ============================================================================

describe('消息类型常量', () => {
  it('Client → Server 聊天核心消息类型值与服务器协议一致', () => {
    // 这些值必须与 arthas-server/internal/network/protocol.go 完全对齐
    expect(MSG_CREATE_ROOM).toBe(0x01);
    expect(MSG_JOIN_ROOM).toBe(0x02);
    expect(MSG_SEND_MESSAGE).toBe(0x03);
    expect(MSG_LEAVE_ROOM).toBe(0x04);
    expect(MSG_TYPING).toBe(0x05);
    expect(MSG_PONG).toBe(0x06);
    expect(MSG_SEND_REACTION).toBe(0x07);
  });

  it('Client → Server 文件传输消息类型值与服务器协议一致', () => {
    expect(MSG_SEND_FILE_META).toBe(0x08);
    expect(MSG_SEND_FILE_CHUNK).toBe(0x09);
    expect(MSG_SEND_FILE_COMPLETE).toBe(0x0a);
    expect(MSG_SEND_FILE_CANCEL).toBe(0x0b);
    expect(MSG_SEND_FILE_ACK).toBe(0x0c);
  });

  it('Server → Client 聊天核心消息类型值与服务器协议一致', () => {
    expect(MSG_ROOM_CREATED).toBe(0x10);
    expect(MSG_ROOM_JOINED).toBe(0x11);
    expect(MSG_MEMBER_JOINED).toBe(0x12);
    expect(MSG_MEMBER_LEFT).toBe(0x13);
    expect(MSG_RELAY_MESSAGE).toBe(0x14);
    expect(MSG_MEMBER_TYPING).toBe(0x15);
    expect(MSG_ROOM_CLOSED).toBe(0x16);
    expect(MSG_ERROR).toBe(0x17);
    expect(MSG_PING).toBe(0x18);
    expect(MSG_RELAY_REACTION).toBe(0x19);
  });

  it('Server → Client 文件传输中转消息类型值与服务器协议一致', () => {
    expect(MSG_RELAY_FILE_META).toBe(0x1a);
    expect(MSG_RELAY_FILE_CHUNK).toBe(0x1b);
    expect(MSG_RELAY_FILE_COMPLETE).toBe(0x1c);
    expect(MSG_RELAY_FILE_CANCEL).toBe(0x1d);
    expect(MSG_RELAY_FILE_ACK).toBe(0x1e);
  });

  it('所有消息类型 ID 在 fixint 范围内（0x00-0x7F）', () => {
    // 📚 学习要点: msgpack fixint 编码
    // 0x00-0x7F 范围内的正整数使用 fixint 编码（单字节），
    // 确保 type 字段在 msgpack 中只占 1 字节。
    const allTypes = [
      MSG_CREATE_ROOM, MSG_JOIN_ROOM, MSG_SEND_MESSAGE, MSG_LEAVE_ROOM,
      MSG_TYPING, MSG_PONG, MSG_SEND_REACTION,
      MSG_SEND_FILE_META, MSG_SEND_FILE_CHUNK, MSG_SEND_FILE_COMPLETE,
      MSG_SEND_FILE_CANCEL, MSG_SEND_FILE_ACK,
      MSG_ROOM_CREATED, MSG_ROOM_JOINED, MSG_MEMBER_JOINED, MSG_MEMBER_LEFT,
      MSG_RELAY_MESSAGE, MSG_MEMBER_TYPING, MSG_ROOM_CLOSED, MSG_ERROR,
      MSG_PING, MSG_RELAY_REACTION,
      MSG_RELAY_FILE_META, MSG_RELAY_FILE_CHUNK, MSG_RELAY_FILE_COMPLETE,
      MSG_RELAY_FILE_CANCEL, MSG_RELAY_FILE_ACK,
    ];

    for (const type of allTypes) {
      expect(type).toBeGreaterThanOrEqual(0x00);
      expect(type).toBeLessThanOrEqual(0x7f);
    }
  });
});

// ============================================================================
// 错误码测试
// ============================================================================

describe('错误码常量', () => {
  it('错误码值与服务器协议一致', () => {
    expect(ERR_ROOM_NOT_FOUND).toBe('E001');
    expect(ERR_ROOM_FULL).toBe('E002');
    expect(ERR_NOT_IN_ROOM).toBe('E003');
    expect(ERR_RATE_LIMITED).toBe('E004');
    expect(ERR_INVALID_MESSAGE).toBe('E005');
    expect(ERR_WRONG_PASSWORD).toBe('E006');
    expect(ERR_ROOM_EXPIRED).toBe('E007');
  });
});

// ============================================================================
// encodeMessage 测试
// ============================================================================

describe('encodeMessage', () => {
  it('编码 JOIN_ROOM 消息', () => {
    const payload: JoinRoomData = {
      roomId: 'abc123def456ghi789012',
      name: 'AI Assistant',
      password: '',
    };

    const binary = encodeMessage(MSG_JOIN_ROOM, payload);

    // 验证返回 Uint8Array
    expect(binary).toBeInstanceOf(Uint8Array);
    expect(binary.length).toBeGreaterThan(0);

    // 验证可以被 msgpack 解码
    const decoded = decode(binary) as Record<string, unknown>;
    expect(decoded['type']).toBe(MSG_JOIN_ROOM);

    const data = decoded['data'] as Record<string, unknown>;
    expect(data['roomId']).toBe('abc123def456ghi789012');
    expect(data['name']).toBe('AI Assistant');
    expect(data['password']).toBe('');
  });

  it('编码 SEND_MESSAGE 消息', () => {
    const payload: SendMessageData = {
      iv: 'dGVzdC1pdi1iYXNlNjQ',
      ciphertext: 'ZW5jcnlwdGVkLWRhdGE',
    };

    const binary = encodeMessage(MSG_SEND_MESSAGE, payload);
    const decoded = decode(binary) as Record<string, unknown>;

    expect(decoded['type']).toBe(MSG_SEND_MESSAGE);
    const data = decoded['data'] as Record<string, unknown>;
    expect(data['iv']).toBe('dGVzdC1pdi1iYXNlNjQ');
    expect(data['ciphertext']).toBe('ZW5jcnlwdGVkLWRhdGE');
  });

  it('编码 TYPING 消息', () => {
    const payload: TypingData = { typing: true };

    const binary = encodeMessage(MSG_TYPING, payload);
    const decoded = decode(binary) as Record<string, unknown>;

    expect(decoded['type']).toBe(MSG_TYPING);
    const data = decoded['data'] as Record<string, unknown>;
    expect(data['typing']).toBe(true);
  });

  it('编码 PONG 消息', () => {
    const payload: PongData = { t: 1700000000000 };

    const binary = encodeMessage(MSG_PONG, payload);
    const decoded = decode(binary) as Record<string, unknown>;

    expect(decoded['type']).toBe(MSG_PONG);
    const data = decoded['data'] as Record<string, unknown>;
    expect(data['t']).toBe(1700000000000);
  });

  it('编码 LEAVE_ROOM 消息（空 payload）', () => {
    const binary = encodeMessage(MSG_LEAVE_ROOM, {});
    const decoded = decode(binary) as Record<string, unknown>;

    expect(decoded['type']).toBe(MSG_LEAVE_ROOM);
    expect(decoded['data']).toEqual({});
  });

  it('编码包含 Uint8Array 的文件分片消息', () => {
    const iv = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const data = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]);

    const payload: SendFileChunkData = {
      transferId: 'transfer-123',
      index: 5,
      iv,
      data,
    };

    const binary = encodeMessage(MSG_SEND_FILE_CHUNK, payload);
    const decoded = decode(binary) as Record<string, unknown>;

    expect(decoded['type']).toBe(MSG_SEND_FILE_CHUNK);
    const decodedData = decoded['data'] as Record<string, unknown>;
    expect(decodedData['transferId']).toBe('transfer-123');
    expect(decodedData['index']).toBe(5);

    // 📚 学习要点: msgpack 对 Uint8Array 的编解码
    // @msgpack/msgpack 将 Uint8Array 编码为 msgpack bin 格式，
    // 解码后仍然是 Uint8Array。验证二进制数据完整性。
    expect(new Uint8Array(decodedData['iv'] as Uint8Array)).toEqual(iv);
    expect(new Uint8Array(decodedData['data'] as Uint8Array)).toEqual(data);
  });
});

// ============================================================================
// decodeMessage 测试
// ============================================================================

describe('decodeMessage', () => {
  it('解码 RELAY_MESSAGE 消息', () => {
    // 模拟服务器发送的中转消息
    const serverMessage = {
      type: MSG_RELAY_MESSAGE,
      data: {
        senderId: 'user-abc',
        senderName: 'Alice',
        iv: 'base64url-iv-here',
        ciphertext: 'base64url-ciphertext',
        t: 1700000000000,
      },
    };

    const binary = encode(serverMessage);
    const msg = decodeMessage(binary);

    expect(msg.type).toBe(MSG_RELAY_MESSAGE);
    const data = msg.data as RelayMessageData;
    expect(data.senderId).toBe('user-abc');
    expect(data.senderName).toBe('Alice');
    expect(data.iv).toBe('base64url-iv-here');
    expect(data.ciphertext).toBe('base64url-ciphertext');
    expect(data.t).toBe(1700000000000);
  });

  it('解码 PING 消息', () => {
    const serverMessage = {
      type: MSG_PING,
      data: { t: 1700000000123 },
    };

    const binary = encode(serverMessage);
    const msg = decodeMessage(binary);

    expect(msg.type).toBe(MSG_PING);
    const data = msg.data as PingData;
    expect(data.t).toBe(1700000000123);
  });

  it('解码 ERROR 消息', () => {
    const serverMessage = {
      type: MSG_ERROR,
      data: { code: 'E001', msg: 'room not found' },
    };

    const binary = encode(serverMessage);
    const msg = decodeMessage(binary);

    expect(msg.type).toBe(MSG_ERROR);
    const data = msg.data as ErrorData;
    expect(data.code).toBe('E001');
    expect(data.msg).toBe('room not found');
  });

  it('解码 ROOM_JOINED 消息（包含成员列表）', () => {
    const serverMessage = {
      type: MSG_ROOM_JOINED,
      data: {
        roomId: 'room-xyz',
        members: [
          { id: 'user-1', name: 'Alice', color: '#ff0000' },
          { id: 'user-2', name: 'Bob', color: '#00ff00' },
        ],
        hasPassword: true,
        ephemeral: 0,
        expiresAt: 1700086400,
      },
    };

    const binary = encode(serverMessage);
    const msg = decodeMessage(binary);

    expect(msg.type).toBe(MSG_ROOM_JOINED);
    const data = msg.data as RoomJoinedData;
    expect(data.roomId).toBe('room-xyz');
    expect(data.members).toHaveLength(2);
    expect(data.members[0]!.name).toBe('Alice');
    expect(data.members[1]!.color).toBe('#00ff00');
    expect(data.hasPassword).toBe(true);
    expect(data.ephemeral).toBe(0);
    expect(data.expiresAt).toBe(1700086400);
  });

  it('解码 MEMBER_JOINED 消息', () => {
    const serverMessage = {
      type: MSG_MEMBER_JOINED,
      data: { id: 'new-user', name: 'Charlie', color: '#0000ff' },
    };

    const binary = encode(serverMessage);
    const msg = decodeMessage(binary);

    expect(msg.type).toBe(MSG_MEMBER_JOINED);
    const data = msg.data as MemberJoinedData;
    expect(data.id).toBe('new-user');
    expect(data.name).toBe('Charlie');
    expect(data.color).toBe('#0000ff');
  });

  it('解码 MEMBER_LEFT 消息', () => {
    const serverMessage = {
      type: MSG_MEMBER_LEFT,
      data: { id: 'left-user' },
    };

    const binary = encode(serverMessage);
    const msg = decodeMessage(binary);

    expect(msg.type).toBe(MSG_MEMBER_LEFT);
    const data = msg.data as MemberLeftData;
    expect(data.id).toBe('left-user');
  });

  it('解码包含二进制数据的文件中转消息', () => {
    const iv = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    const chunkData = new Uint8Array(64);
    chunkData.fill(0xab);

    const serverMessage = {
      type: MSG_RELAY_FILE_CHUNK,
      data: {
        senderId: 'sender-1',
        transferId: 'transfer-abc',
        index: 3,
        iv,
        data: chunkData,
      },
    };

    const binary = encode(serverMessage);
    const msg = decodeMessage(binary);

    expect(msg.type).toBe(MSG_RELAY_FILE_CHUNK);
    const data = msg.data as RelayFileChunkData;
    expect(data.senderId).toBe('sender-1');
    expect(data.transferId).toBe('transfer-abc');
    expect(data.index).toBe(3);
    expect(new Uint8Array(data.iv)).toEqual(iv);
    expect(new Uint8Array(data.data)).toEqual(chunkData);
  });

  it('解码 RELAY_FILE_META 消息', () => {
    const ciphertext = new Uint8Array([1, 2, 3, 4, 5]);

    const serverMessage = {
      type: MSG_RELAY_FILE_META,
      data: {
        senderId: 'sender-x',
        senderName: 'FileUser',
        transferId: 'tf-001',
        iv: 'meta-iv-base64',
        ciphertext,
        t: 1700000000500,
      },
    };

    const binary = encode(serverMessage);
    const msg = decodeMessage(binary);

    expect(msg.type).toBe(MSG_RELAY_FILE_META);
    const data = msg.data as RelayFileMetaData;
    expect(data.senderId).toBe('sender-x');
    expect(data.senderName).toBe('FileUser');
    expect(data.transferId).toBe('tf-001');
    expect(data.iv).toBe('meta-iv-base64');
    expect(new Uint8Array(data.ciphertext)).toEqual(ciphertext);
    expect(data.t).toBe(1700000000500);
  });

  it('接受 ArrayBuffer 输入', () => {
    const serverMessage = { type: MSG_PING, data: { t: 999 } };
    const binary = encode(serverMessage);

    // 将 Uint8Array 转为 ArrayBuffer
    const arrayBuffer = binary.buffer.slice(
      binary.byteOffset,
      binary.byteOffset + binary.byteLength,
    );

    const msg = decodeMessage(arrayBuffer);
    expect(msg.type).toBe(MSG_PING);
    expect((msg.data as PingData).t).toBe(999);
  });

  it('解码无效数据时抛出异常', () => {
    const invalidData = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(() => decodeMessage(invalidData)).toThrow();
  });
});

// ============================================================================
// 编解码往返测试（Roundtrip）
// ============================================================================

describe('编解码往返测试', () => {
  it('JOIN_ROOM 消息往返', () => {
    const original: JoinRoomData = {
      roomId: 'test-room-id-21chars',
      name: '测试用户',
      password: 'a'.repeat(64), // SHA-256 hash
    };

    const binary = encodeMessage(MSG_JOIN_ROOM, original);
    const decoded = decodeMessage(binary);

    expect(decoded.type).toBe(MSG_JOIN_ROOM);
    const data = decoded.data as JoinRoomData;
    expect(data.roomId).toBe(original.roomId);
    expect(data.name).toBe(original.name);
    expect(data.password).toBe(original.password);
  });

  it('SEND_MESSAGE 消息往返', () => {
    const original: SendMessageData = {
      iv: 'SGVsbG8gV29ybGQ',
      ciphertext: 'RW5jcnlwdGVkIERhdGEgSGVyZQ',
    };

    const binary = encodeMessage(MSG_SEND_MESSAGE, original);
    const decoded = decodeMessage(binary);

    expect(decoded.type).toBe(MSG_SEND_MESSAGE);
    const data = decoded.data as SendMessageData;
    expect(data.iv).toBe(original.iv);
    expect(data.ciphertext).toBe(original.ciphertext);
  });

  it('TYPING 消息往返（true/false）', () => {
    for (const typing of [true, false]) {
      const binary = encodeMessage(MSG_TYPING, { typing });
      const decoded = decodeMessage(binary);

      expect(decoded.type).toBe(MSG_TYPING);
      expect((decoded.data as TypingData).typing).toBe(typing);
    }
  });

  it('PONG 消息往返（大时间戳）', () => {
    // 📚 学习要点: JavaScript 安全整数范围
    // Unix 毫秒时间戳（如 1700000000000）在 Number.MAX_SAFE_INTEGER 范围内，
    // msgpack 可以安全编解码。
    const timestamp = Date.now();
    const binary = encodeMessage(MSG_PONG, { t: timestamp });
    const decoded = decodeMessage(binary);

    expect(decoded.type).toBe(MSG_PONG);
    expect((decoded.data as PongData).t).toBe(timestamp);
  });

  it('文件分片消息往返（二进制数据完整性）', () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const chunkData = crypto.getRandomValues(new Uint8Array(65536)); // 64KB

    const original: SendFileChunkData = {
      transferId: 'roundtrip-transfer',
      index: 79, // 最大分片索引
      iv,
      data: chunkData,
    };

    const binary = encodeMessage(MSG_SEND_FILE_CHUNK, original);
    const decoded = decodeMessage(binary);

    expect(decoded.type).toBe(MSG_SEND_FILE_CHUNK);
    const data = decoded.data as SendFileChunkData;
    expect(data.transferId).toBe('roundtrip-transfer');
    expect(data.index).toBe(79);
    expect(new Uint8Array(data.iv)).toEqual(iv);
    expect(new Uint8Array(data.data)).toEqual(chunkData);
  });

  it('Unicode 内容往返', () => {
    const payload: JoinRoomData = {
      roomId: 'unicode-room',
      name: '🤖 AI 助手 — 中文名称',
      password: '',
    };

    const binary = encodeMessage(MSG_JOIN_ROOM, payload);
    const decoded = decodeMessage(binary);
    const data = decoded.data as JoinRoomData;

    expect(data.name).toBe('🤖 AI 助手 — 中文名称');
  });
});

// ============================================================================
// 服务器兼容性测试
// ============================================================================

describe('服务器兼容性', () => {
  it('编码格式使用 "type" 和 "data" 作为 msgpack map key', () => {
    /**
     * 📚 学习要点: 字段名兼容性
     * Go 服务器使用 `msgpack:"type"` 和 `msgpack:"data"` struct tag，
     * 所以 msgpack map 的 key 必须是 "type" 和 "data" 字符串。
     * 如果使用了不同的 key（如 "Type" 或 "msg_type"），服务器将无法解析。
     */
    const binary = encodeMessage(MSG_JOIN_ROOM, { roomId: 'r', name: 'n', password: '' });
    const raw = decode(binary) as Record<string, unknown>;

    // 验证 key 名称
    expect('type' in raw).toBe(true);
    expect('data' in raw).toBe(true);
    expect(Object.keys(raw).sort()).toEqual(['data', 'type']);
  });

  it('type 字段编码为整数（非字符串）', () => {
    const binary = encodeMessage(MSG_SEND_MESSAGE, { iv: 'x', ciphertext: 'y' });
    const raw = decode(binary) as Record<string, unknown>;

    expect(typeof raw['type']).toBe('number');
    expect(raw['type']).toBe(3); // MSG_SEND_MESSAGE = 0x03 = 3
  });

  it('data 字段编码为 msgpack map（对象）', () => {
    const binary = encodeMessage(MSG_TYPING, { typing: true });
    const raw = decode(binary) as Record<string, unknown>;

    expect(typeof raw['data']).toBe('object');
    expect(raw['data']).not.toBeNull();
  });

  it('模拟 Go 服务器编码的消息可以被正确解码', () => {
    /**
     * 📚 学习要点: 跨语言兼容性验证
     * Go 的 vmihailenco/msgpack/v5 和 TypeScript 的 @msgpack/msgpack
     * 对相同数据结构的编码结果应该是兼容的（可互相解码）。
     * 这里我们用 @msgpack/msgpack 模拟 Go 服务器的编码行为，
     * 验证 decodeMessage 能正确解析。
     */
    // 模拟 Go 服务器发送的 RelayMessage
    const goStyleMessage = encode({
      type: 0x14, // MsgRelayMessage
      data: {
        senderId: 'go-client-1',
        senderName: 'GoUser',
        iv: 'aWYtZnJvbS1nbw',
        ciphertext: 'Y2lwaGVydGV4dC1mcm9tLWdv',
        t: 1700000000000,
      },
    });

    const msg = decodeMessage(goStyleMessage);
    expect(msg.type).toBe(MSG_RELAY_MESSAGE);

    const data = msg.data as RelayMessageData;
    expect(data.senderId).toBe('go-client-1');
    expect(data.senderName).toBe('GoUser');
    expect(data.iv).toBe('aWYtZnJvbS1nbw');
    expect(data.ciphertext).toBe('Y2lwaGVydGV4dC1mcm9tLWdv');
    expect(data.t).toBe(1700000000000);
  });

  it('编码的 JoinRoom 消息字段名与 Go struct tag 一致', () => {
    /**
     * Go 服务器期望的字段名（来自 protocol.go 的 msgpack tag）：
     * - JoinRoomData: roomId, name, password
     * - SendMessageData: iv, ciphertext
     * - TypingData: typing
     * - PongData: t
     */
    const binary = encodeMessage(MSG_JOIN_ROOM, {
      roomId: 'test',
      name: 'user',
      password: 'pass',
    });

    const raw = decode(binary) as Record<string, unknown>;
    const data = raw['data'] as Record<string, unknown>;

    // 验证字段名与 Go struct tag 完全一致
    expect('roomId' in data).toBe(true);
    expect('name' in data).toBe(true);
    expect('password' in data).toBe(true);
  });
});
