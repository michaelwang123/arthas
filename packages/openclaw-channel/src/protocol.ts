/**
 * @file protocol.ts — Arthas msgpack 协议编解码
 *
 * 本文件实现 Arthas 的二进制消息协议（基于 MessagePack）。
 * 职责：
 * 1. 定义所有消息类型常量（与 arthas-server/internal/network/protocol.go 完全对齐）
 * 2. encodeMessage(type, payload) — 将结构化消息编码为 msgpack 二进制
 * 3. decodeMessage(buffer) — 将 msgpack 二进制解码为结构化消息
 * 4. 类型安全的消息 payload 接口定义
 *
 * 📚 学习要点: 为什么使用 MessagePack 而非 JSON？
 * Arthas 选择 msgpack 作为 WebSocket 帧格式的原因：
 * - 二进制格式，比 JSON 更紧凑（节省 ~30% 带宽）
 * - 原生支持 Uint8Array/Buffer（加密数据无需 Base64 编码）
 * - 编解码速度快（比 JSON.parse/stringify 快 2-5x）
 * - 跨语言兼容（Go/TypeScript/Python 都有成熟的 msgpack 库）
 *
 * 📚 学习要点: 协议编号方案（Protocol Numbering Scheme）
 * 消息类型 ID 使用单字节十六进制编号，按方向和功能域分段：
 *
 * | 范围        | 方向              | 功能域       |
 * |-------------|-------------------|-------------|
 * | 0x01 - 0x07 | Client → Server   | 聊天核心     |
 * | 0x08 - 0x0C | Client → Server   | 文件传输     |
 * | 0x10 - 0x19 | Server → Client   | 聊天核心     |
 * | 0x1A - 0x1E | Server → Client   | 文件传输     |
 *
 * 所有消息类型 ID 都在 0x00-0x7F 范围内，确保 msgpack 编码为单字节 fixint。
 *
 * @module openclaw-channel/protocol
 * @see design.md — D4: 消息协议适配
 * @see requirements.md — Requirement 1.8: msgpack 二进制协议
 */

import { encode, decode } from '@msgpack/msgpack';

// ============================================================================
// 消息类型常量 — Client → Server（聊天核心: 0x01-0x07）
// ============================================================================

/** 创建房间请求 */
export const MSG_CREATE_ROOM = 0x01;

/** 加入房间请求 */
export const MSG_JOIN_ROOM = 0x02;

/** 发送加密聊天消息 */
export const MSG_SEND_MESSAGE = 0x03;

/** 离开房间请求 */
export const MSG_LEAVE_ROOM = 0x04;

/** 输入状态通知 */
export const MSG_TYPING = 0x05;

/** 心跳回复（响应服务器 MSG_PING） */
export const MSG_PONG = 0x06;

/** 发送加密反应消息 */
export const MSG_SEND_REACTION = 0x07;

// ============================================================================
// 消息类型常量 — Client → Server（文件传输: 0x08-0x0C）
// ============================================================================

/**
 * 📚 学习要点: 文件传输消息类型设计
 * 文件传输需要 5 个 Client→Server 消息类型，对应传输生命周期的 5 个阶段：
 * 1. META — 传输开始，发送加密的文件元数据
 * 2. CHUNK — 传输进行中，逐片发送加密数据
 * 3. COMPLETE — 传输完成，通知接收方可以重组文件
 * 4. CANCEL — 传输取消，通知接收方释放缓冲区
 * 5. ACK — 接收确认，接收方通知发送方已成功接收
 */

/** 发送加密文件元数据（传输开始信号） */
export const MSG_SEND_FILE_META = 0x08;

/** 发送加密文件分片（高频消息） */
export const MSG_SEND_FILE_CHUNK = 0x09;

/** 传输完成信号 */
export const MSG_SEND_FILE_COMPLETE = 0x0a;

/** 取消传输信号 */
export const MSG_SEND_FILE_CANCEL = 0x0b;

/** 接收确认信号 */
export const MSG_SEND_FILE_ACK = 0x0c;

// ============================================================================
// 消息类型常量 — Server → Client（聊天核心: 0x10-0x19）
// ============================================================================

/** 房间创建成功响应 */
export const MSG_ROOM_CREATED = 0x10;

/** 加入房间成功响应 */
export const MSG_ROOM_JOINED = 0x11;

/** 新成员加入通知 */
export const MSG_MEMBER_JOINED = 0x12;

/** 成员离开通知 */
export const MSG_MEMBER_LEFT = 0x13;

/** 服务器中转的加密聊天消息 */
export const MSG_RELAY_MESSAGE = 0x14;

/** 成员输入状态通知 */
export const MSG_MEMBER_TYPING = 0x15;

/** 房间关闭通知 */
export const MSG_ROOM_CLOSED = 0x16;

/** 服务器错误响应 */
export const MSG_ERROR = 0x17;

/** 服务器心跳 */
export const MSG_PING = 0x18;

/** 服务器中转的加密反应消息 */
export const MSG_RELAY_REACTION = 0x19;

// ============================================================================
// 消息类型常量 — Server → Client（文件传输中转: 0x1A-0x1E）
// ============================================================================

/**
 * 📚 学习要点: 中转消息（Relay Messages）
 * Server→Client 的文件传输消息都以 RELAY 前缀命名，强调服务器的角色是「中转」。
 * 每种 Send 消息都有对应的 Relay 消息（偏移量 = 0x12）：
 *   0x08 → 0x1A (Meta), 0x09 → 0x1B (Chunk), 0x0A → 0x1C (Complete),
 *   0x0B → 0x1D (Cancel), 0x0C → 0x1E (Ack)
 */

/** 中转文件元数据给房间成员 */
export const MSG_RELAY_FILE_META = 0x1a;

/** 中转文件分片给房间成员 */
export const MSG_RELAY_FILE_CHUNK = 0x1b;

/** 中转传输完成信号 */
export const MSG_RELAY_FILE_COMPLETE = 0x1c;

/** 中转取消信号 */
export const MSG_RELAY_FILE_CANCEL = 0x1d;

/** 中转接收确认给发送方 */
export const MSG_RELAY_FILE_ACK = 0x1e;

// ============================================================================
// 错误码常量
// ============================================================================

export const ERR_ROOM_NOT_FOUND = 'E001';
export const ERR_ROOM_FULL = 'E002';
export const ERR_NOT_IN_ROOM = 'E003';
export const ERR_RATE_LIMITED = 'E004';
export const ERR_INVALID_MESSAGE = 'E005';
export const ERR_WRONG_PASSWORD = 'E006';
export const ERR_ROOM_EXPIRED = 'E007';

// ============================================================================
// 消息信封类型
// ============================================================================

/**
 * Arthas 协议消息信封。
 *
 * 📚 学习要点: 统一信封格式（Envelope Pattern）
 * 所有 WebSocket 消息使用统一的 { type, data } 信封结构：
 * - type: uint8 消息类型码（1 字节，msgpack fixint 编码）
 * - data: 该类型对应的结构化数据（msgpack map 编码）
 *
 * 这种设计使得消息路由逻辑（switch on type）与消息解析逻辑（decode data）分离，
 * 新增消息类型只需添加常量和 data 接口，不需要修改信封结构。
 */
export interface Message<T = unknown> {
  type: number;
  data: T;
}

// ============================================================================
// Client → Server 数据结构
// ============================================================================

/** 创建房间请求数据 */
export interface CreateRoomData {
  /** 创建者显示名称（1-20 字符） */
  name: string;
  /** 房间密码的 SHA-256 哈希（64 hex chars），空字符串表示无密码 */
  password: string;
  /** 临时模式秒数（0 = 非临时） */
  ephemeral: number;
  /** 房间有效期秒数（0 = 永不过期） */
  expiry: number;
}

/** 加入房间请求数据 */
export interface JoinRoomData {
  /** 房间 ID（NanoID 21 chars） */
  roomId: string;
  /** 加入者显示名称（1-20 字符） */
  name: string;
  /** 房间密码的 SHA-256 哈希，空字符串表示无密码 */
  password: string;
}

/**
 * 发送加密消息数据。
 *
 * 📚 学习要点: 安全字段说明
 * - iv: 12 字节随机 IV 的 base64url 编码（每条消息唯一，同一密钥下绝不重复）
 * - ciphertext: AES-256-GCM 加密后的密文 + 16 字节认证标签的 base64url 编码
 * 服务器对这两个字段完全不透明处理（零知识中转）。
 */
export interface SendMessageData {
  /** 加密 IV（base64url 编码，12 字节） */
  iv: string;
  /** 加密密文 + GCM auth tag（base64url 编码） */
  ciphertext: string;
}

/** 离开房间请求数据（无字段） */
export interface LeaveRoomData {
  // 空对象，服务器仅需知道消息类型即可
}

/** 输入状态通知数据 */
export interface TypingData {
  /** true = 正在输入，false = 停止输入 */
  typing: boolean;
}

/** 心跳回复数据 */
export interface PongData {
  /** 从 PingData 中原样回传的时间戳（Unix 毫秒） */
  t: number;
}

/** 发送加密反应消息数据（与 SendMessageData 结构相同） */
export interface SendReactionData {
  /** 加密 IV（base64url 编码） */
  iv: string;
  /** 加密密文 + GCM auth tag（base64url 编码） */
  ciphertext: string;
}

// ============================================================================
// Client → Server 文件传输数据结构
// ============================================================================

/** 发送加密文件元数据 */
export interface SendFileMetaData {
  /** 传输唯一标识符（NanoID 21 chars，明文，用于服务器路由） */
  transferId: string;
  /** 加密 IV（base64url 编码，用于解密 ciphertext） */
  iv: string;
  /** 加密后的 FileMetadata JSON（二进制） */
  ciphertext: Uint8Array;
}

/**
 * 发送加密文件分片。
 *
 * 📚 学习要点: 为什么 iv 和 data 使用 Uint8Array 而非 string？
 * Chunk 是高频消息（5MB 文件 = 80 次），使用原始二进制避免 base64 编解码开销。
 * msgpack 对 Uint8Array 使用 bin 格式，比 string 更紧凑（无 33% base64 膨胀）。
 */
export interface SendFileChunkData {
  /** 传输唯一标识符 */
  transferId: string;
  /** 分片索引（0-based） */
  index: number;
  /** 加密 IV（12 bytes 原始二进制） */
  iv: Uint8Array;
  /** 加密后的分片数据（原始二进制，包含 GCM auth tag） */
  data: Uint8Array;
}

/** 传输完成信号 */
export interface SendFileCompleteData {
  /** 传输唯一标识符 */
  transferId: string;
}

/** 取消传输信号 */
export interface SendFileCancelData {
  /** 传输唯一标识符 */
  transferId: string;
}

/** 接收确认信号 */
export interface SendFileAckData {
  /** 传输唯一标识符 */
  transferId: string;
}

// ============================================================================
// Server → Client 数据结构
// ============================================================================

/** 房间创建成功响应 */
export interface RoomCreatedData {
  /** 服务器分配的房间 ID */
  roomId: string;
  /** 房间过期时间戳（Unix 秒），0 表示永不过期 */
  expiresAt: number;
}

/** 加入房间成功响应 */
export interface RoomJoinedData {
  /** 房间 ID */
  roomId: string;
  /** 当前房间成员列表 */
  members: MemberInfo[];
  /** 房间是否设置了密码 */
  hasPassword: boolean;
  /** 临时模式秒数（0 = 非临时） */
  ephemeral: number;
  /** 房间过期时间戳（Unix 秒），0 表示永不过期 */
  expiresAt: number;
}

/** 新成员加入通知 */
export interface MemberJoinedData {
  /** 成员 ID */
  id: string;
  /** 成员显示名称 */
  name: string;
  /** 服务器分配的颜色（CSS hex，如 "#4a7fbf"） */
  color: string;
}

/** 成员离开通知 */
export interface MemberLeftData {
  /** 离开成员的 ID */
  id: string;
}

/**
 * 服务器中转的加密聊天消息。
 *
 * 📚 学习要点: 中转消息的附加字段
 * 服务器在转发时附加 senderId 和 senderName（从已认证的 Client 对象提取），
 * 以及服务器时间戳 t。客户端无法伪造这些字段（防止身份冒充）。
 */
export interface RelayMessageData {
  /** 发送方客户端 ID（服务器填充） */
  senderId: string;
  /** 发送方显示名称（服务器填充） */
  senderName: string;
  /** 加密 IV（base64url 编码） */
  iv: string;
  /** 加密密文（base64url 编码） */
  ciphertext: string;
  /** 服务器时间戳（Unix 毫秒） */
  t: number;
}

/** 成员输入状态通知 */
export interface MemberTypingData {
  /** 成员 ID */
  id: string;
  /** 是否正在输入 */
  typing: boolean;
}

/** 房间关闭通知 */
export interface RoomClosedData {
  /** 关闭原因："expired" 表示过期，空/缺失表示常规关闭 */
  reason?: string;
}

/** 服务器错误响应 */
export interface ErrorData {
  /** 错误码（E001-E007） */
  code: string;
  /** 错误描述信息 */
  msg: string;
}

/** 服务器心跳数据 */
export interface PingData {
  /** 服务器时间戳（Unix 毫秒），客户端需原样回传 */
  t: number;
}

/** 服务器中转的加密反应消息（结构与 RelayMessageData 相同） */
export interface RelayReactionData {
  /** 发送方客户端 ID */
  senderId: string;
  /** 发送方显示名称 */
  senderName: string;
  /** 加密 IV */
  iv: string;
  /** 加密密文 */
  ciphertext: string;
  /** 服务器时间戳（Unix 毫秒） */
  t: number;
}

// ============================================================================
// Server → Client 文件传输中转数据结构
// ============================================================================

/** 中转文件元数据 */
export interface RelayFileMetaData {
  /** 发送方客户端 ID */
  senderId: string;
  /** 发送方显示名称 */
  senderName: string;
  /** 传输唯一标识符 */
  transferId: string;
  /** 加密 IV（base64url 编码） */
  iv: string;
  /** 加密后的 FileMetadata */
  ciphertext: Uint8Array;
  /** 服务器时间戳（Unix 毫秒） */
  t: number;
}

/** 中转文件分片 */
export interface RelayFileChunkData {
  /** 发送方客户端 ID */
  senderId: string;
  /** 传输唯一标识符 */
  transferId: string;
  /** 分片索引（0-based） */
  index: number;
  /** 加密 IV（12 bytes 原始二进制） */
  iv: Uint8Array;
  /** 加密后的分片数据 */
  data: Uint8Array;
}

/** 中转传输完成信号 */
export interface RelayFileCompleteData {
  /** 发送方客户端 ID */
  senderId: string;
  /** 传输唯一标识符 */
  transferId: string;
}

/** 中转取消信号 */
export interface RelayFileCancelData {
  /** 发送方客户端 ID */
  senderId: string;
  /** 传输唯一标识符 */
  transferId: string;
}

/** 中转接收确认 */
export interface RelayFileAckData {
  /** 确认接收的接收方 ID */
  receiverId: string;
  /** 传输唯一标识符 */
  transferId: string;
}

// ============================================================================
// 共用结构
// ============================================================================

/** 房间成员信息 */
export interface MemberInfo {
  /** 成员 ID（服务器分配的 8 字符 UUID 前缀） */
  id: string;
  /** 成员显示名称 */
  name: string;
  /** 服务器分配的 CSS hex 颜色 */
  color: string;
}

// ============================================================================
// 编解码函数
// ============================================================================

/**
 * 将结构化消息编码为 msgpack 二进制格式。
 *
 * 📚 学习要点: msgpack 编码策略
 * 编码结果是一个 msgpack map，包含 "type" 和 "data" 两个字段：
 * - type: 使用 fixint 编码（0x00-0x7F 范围内的整数只占 1 字节）
 * - data: 根据 payload 类型自动编码为 msgpack map/nil
 *
 * 这与 Go 服务器端的 Message struct 的 msgpack 序列化格式完全一致：
 * ```go
 * type Message struct {
 *   Type uint8       `msgpack:"type"`
 *   Data interface{} `msgpack:"data"`
 * }
 * ```
 *
 * @param type - 消息类型码（MSG_* 常量之一）
 * @param data - 消息负载数据（对应类型的 *Data 接口）
 * @returns msgpack 编码后的二进制数据（Uint8Array）
 *
 * @example
 * ```typescript
 * // 编码加入房间消息
 * const binary = encodeMessage(MSG_JOIN_ROOM, {
 *   roomId: 'abc123',
 *   name: 'AI Assistant',
 *   password: '',
 * });
 * ws.send(binary);
 * ```
 */
export function encodeMessage(type: number, data: unknown): Uint8Array {
  const message: Message = { type, data };
  return encode(message);
}

/**
 * 将 msgpack 二进制数据解码为结构化消息。
 *
 * 📚 学习要点: 解码安全性
 * 解码时需要注意以下安全问题：
 * 1. 输入可能是恶意构造的数据（来自网络），decode 可能抛出异常
 * 2. 解码后的 data 字段类型不确定，需要调用方根据 type 做类型断言
 * 3. msgpack 将小正整数解码为最小适配类型（与 Go 的 vmihailenco/msgpack 行为一致）
 *
 * @param buffer - msgpack 编码的二进制数据（Uint8Array 或 ArrayBuffer）
 * @returns 解码后的消息信封 { type, data }
 * @throws 如果输入不是有效的 msgpack 数据
 *
 * @example
 * ```typescript
 * const msg = decodeMessage(binaryData);
 * switch (msg.type) {
 *   case MSG_RELAY_MESSAGE:
 *     const relay = msg.data as RelayMessageData;
 *     console.log(relay.senderId, relay.ciphertext);
 *     break;
 *   case MSG_PING:
 *     const ping = msg.data as PingData;
 *     ws.send(encodeMessage(MSG_PONG, { t: ping.t }));
 *     break;
 * }
 * ```
 */
export function decodeMessage(buffer: Uint8Array | ArrayBuffer): Message {
  const input = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const decoded = decode(input) as Record<string, unknown>;

  return {
    type: decoded['type'] as number,
    data: decoded['data'],
  };
}
