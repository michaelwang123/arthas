/**
 * @file protocol.ts — Arthas WebSocket 协议消息类型与数据结构定义
 *
 * 本文件是客户端与服务器通信的「契约」，定义了所有消息类型 ID 和对应的数据接口。
 * 服务器端 Go 代码中有对应的 protocol.go 文件，两者必须保持同步。
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
 * 设计决策：
 * - Client→Server 从 0x01 开始，Server→Client 从 0x10 开始，中间留有扩展空间
 * - 文件传输消息紧跟在聊天消息之后（0x08-0x0C, 0x1A-0x1E），保持逻辑连续性
 * - 使用十六进制而非十进制，因为 msgpack 对 0x00-0x7F 使用单字节 fixint 编码（高效）
 * - 所有消息类型 ID 都在 0x00-0x7F 范围内，确保 msgpack 编码为单字节
 */

// ===== 消息类型 ID =====

// Client → Server（聊天核心: 0x01-0x07）
export const MSG_CREATE_ROOM = 0x01;
export const MSG_JOIN_ROOM = 0x02;
export const MSG_SEND_MESSAGE = 0x03;
export const MSG_LEAVE_ROOM = 0x04;
export const MSG_TYPING = 0x05;
export const MSG_PONG = 0x06;
export const MSG_SEND_REACTION = 0x07;

// Client → Server（文件传输: 0x08-0x0C）
/**
 * 📚 学习要点: 文件传输消息类型设计
 * 文件传输需要 5 个 Client→Server 消息类型，对应传输生命周期的 5 个阶段：
 * 1. META — 传输开始，发送加密的文件元数据（文件名、大小、分片数等）
 * 2. CHUNK — 传输进行中，逐片发送加密数据
 * 3. COMPLETE — 传输完成，通知接收方可以重组文件
 * 4. CANCEL — 传输取消，通知接收方释放缓冲区
 * 5. ACK — 接收确认，接收方通知发送方已成功接收
 *
 * 每个 Client→Server 消息都有对应的 Server→Client 中转消息（Relay），
 * 服务器只做转发，不解密、不存储、不检查内容（零知识架构）。
 */

/** 发送加密文件元数据（传输开始信号） */
export const MSG_SEND_FILE_META = 0x08;
/** 发送加密文件分片（高频消息，每个文件最多 80 次） */
export const MSG_SEND_FILE_CHUNK = 0x09;
/** 传输完成信号（所有分片已发送） */
export const MSG_SEND_FILE_COMPLETE = 0x0A;
/** 取消传输信号（发送方主动取消） */
export const MSG_SEND_FILE_CANCEL = 0x0B;
/** 接收确认信号（接收方确认文件完整接收） */
export const MSG_SEND_FILE_ACK = 0x0C;

// Server → Client（聊天核心: 0x10-0x19）
export const MSG_ROOM_CREATED = 0x10;
export const MSG_ROOM_JOINED = 0x11;
export const MSG_MEMBER_JOINED = 0x12;
export const MSG_MEMBER_LEFT = 0x13;
export const MSG_RELAY_MESSAGE = 0x14;
export const MSG_MEMBER_TYPING = 0x15;
export const MSG_ROOM_CLOSED = 0x16;
export const MSG_ERROR = 0x17;
export const MSG_PING = 0x18;
export const MSG_RELAY_REACTION = 0x19;

// Server → Client（文件传输中转: 0x1A-0x1E）
/**
 * 📚 学习要点: 中转消息（Relay Messages）
 * Server→Client 的文件传输消息都以 RELAY 前缀命名，强调服务器的角色是「中转」而非「处理」。
 * 中转消息在原始消息基础上添加了 senderId 和 senderName 字段，
 * 让接收方知道是谁发送的文件（服务器从 Client 连接状态中获取这些信息）。
 *
 * 编号从 0x1A 开始（紧跟 MSG_RELAY_REACTION = 0x19），保持 Server→Client 消息的连续性。
 */

/** 中转文件元数据给房间成员 */
export const MSG_RELAY_FILE_META = 0x1A;
/** 中转文件分片给房间成员 */
export const MSG_RELAY_FILE_CHUNK = 0x1B;
/** 中转传输完成信号 */
export const MSG_RELAY_FILE_COMPLETE = 0x1C;
/** 中转取消信号 */
export const MSG_RELAY_FILE_CANCEL = 0x1D;
/** 中转接收确认给发送方 */
export const MSG_RELAY_FILE_ACK = 0x1E;

// ===== 错误码 =====

export const ERR_ROOM_NOT_FOUND = 'E001';
export const ERR_ROOM_FULL = 'E002';
export const ERR_NOT_IN_ROOM = 'E003';
export const ERR_RATE_LIMITED = 'E004';
export const ERR_INVALID_MESSAGE = 'E005';
export const ERR_WRONG_PASSWORD = 'E006';

// ===== 消息信封 =====

export interface Message {
  type: number;
  data: unknown;
}

// ===== Client → Server 数据结构 =====

export interface CreateRoomData {
  name: string;
  password?: string;
  ephemeral?: number;
}

export interface JoinRoomData {
  roomId: string;
  name: string;
  password?: string;
}

export interface SendMessageData {
  iv: string;
  ciphertext: string;
}

export interface LeaveRoomData {}

export interface TypingData {
  typing: boolean;
}

export interface PongData {
  t: number;
}

// ===== Server → Client 数据结构 =====

export interface RoomCreatedData {
  roomId: string;
}

export interface RoomJoinedData {
  roomId: string;
  members: MemberInfo[];
  hasPassword: boolean;
  ephemeral: number;
}

export interface MemberJoinedData {
  id: string;
  name: string;
  color: string;
}

export interface MemberLeftData {
  id: string;
}

export interface RelayMessageData {
  senderId: string;
  senderName: string;
  iv: string;
  ciphertext: string;
  t: number;
}

export interface RelayReactionData {
  senderId: string;
  senderName: string;
  iv: string;
  ciphertext: string;
  t: number;
}

export interface MemberTypingData {
  id: string;
  typing: boolean;
}

export interface RoomClosedData {}

export interface ErrorData {
  code: string;
  msg: string;
}

export interface PingData {
  t: number;
}

// ===== 共用结构 =====

export interface MemberInfo {
  id: string;
  name: string;
  color: string;
}

// ===== 文件传输 Client → Server 数据结构 =====

/**
 * 📚 学习要点: 文件传输数据结构设计原则
 * 1. transferId 始终明文传输（不加密），因为服务器需要它来路由消息和追踪活跃传输
 * 2. 文件内容相关的数据（文件名、分片数据）全部加密，服务器无法获知文件信息
 * 3. Chunk 的 iv 使用 Uint8Array（二进制）而非 string（base64url），
 *    因为 Chunk 是高频消息（每个文件最多 80 次），避免 base64 编码/解码开销
 * 4. Metadata 的 iv 使用 string（base64url），因为只发送一次，方便调试和日志记录
 */

/**
 * 发送加密文件元数据 (Client → Server)。
 * 传输的第一个消息，包含加密后的文件信息（文件名、大小、MIME 类型、分片总数、可选缩略图）。
 * 服务器只读取 transferId 用于路由，不解密 ciphertext。
 */
export interface SendFileMetaData {
  /** 传输唯一标识符（NanoID 21 chars，明文，用于服务器路由） */
  transferId: string;
  /** 加密 IV（base64url 编码，用于解密 ciphertext） */
  iv: string;
  /** 加密后的 FileMetadata JSON（msgpack bin 格式） */
  ciphertext: Uint8Array;
}

/**
 * 发送加密文件分片 (Client → Server)。
 * 高频消息，每个 5MB 文件最多发送 80 次（ceil(5MB / 64KB)）。
 *
 * 📚 学习要点: 为什么 iv 和 data 使用 Uint8Array 而非 string？
 * - Chunk 是高频消息，每次 base64 编码 12 bytes IV → 16 chars 字符串，解码需要字符串解析
 * - msgpack 对 Uint8Array 使用 bin 格式，比 string 更紧凑（无 base64 的 33% 膨胀）
 * - 直接传输原始字节，零额外编码开销
 * - 对比：Metadata 的 iv 用 string 是因为只发一次，方便调试
 */
export interface SendFileChunkData {
  /** 传输唯一标识符（关联到对应的 META 消息） */
  transferId: string;
  /** 分片索引（0-based，uint16 范围，最大 65535） */
  index: number;
  /** 加密 IV（12 bytes 原始二进制，每个 chunk 独立随机生成） */
  iv: Uint8Array;
  /** 加密后的分片数据（原始二进制，包含 GCM auth tag） */
  data: Uint8Array;
}

/**
 * 传输完成信号 (Client → Server)。
 * 发送方在所有 Chunk 发送完毕后发送此消息，通知接收方可以开始重组文件。
 */
export interface SendFileCompleteData {
  /** 传输唯一标识符 */
  transferId: string;
}

/**
 * 取消传输信号 (Client → Server)。
 * 发送方主动取消传输时发送，通知接收方释放缓冲区。
 */
export interface SendFileCancelData {
  /** 传输唯一标识符 */
  transferId: string;
}

/**
 * 接收确认信号 (Client → Server)。
 * 接收方成功接收并重组完整文件后发送，用于发送方显示"已送达"状态。
 */
export interface SendFileAckData {
  /** 传输唯一标识符 */
  transferId: string;
}

// ===== 文件传输 Server → Client 数据结构 =====

/**
 * 📚 学习要点: 中转消息的额外字段
 * Server→Client 的中转消息在原始 Client→Server 消息基础上添加了：
 * - senderId: 发送方的客户端 ID（服务器从连接状态获取）
 * - senderName: 发送方的显示名称（服务器从连接状态获取）
 * - t: 服务器时间戳（仅 META 消息包含，用于消息排序）
 *
 * 这些字段由服务器填充，客户端无法伪造（防止身份冒充）。
 * Chunk 消息不包含 senderName 和 t，因为高频消息应尽量精简。
 */

/**
 * 中转文件元数据 (Server → Client)。
 * 接收方收到此消息后解密 ciphertext 获取文件信息，准备接收缓冲区。
 */
export interface RelayFileMetaData {
  /** 发送方客户端 ID（服务器填充） */
  senderId: string;
  /** 发送方显示名称（服务器填充） */
  senderName: string;
  /** 传输唯一标识符 */
  transferId: string;
  /** 加密 IV（base64url 编码） */
  iv: string;
  /** 加密后的 FileMetadata JSON（msgpack bin 格式） */
  ciphertext: Uint8Array;
  /** 服务器时间戳（毫秒，用于消息列表排序） */
  t: number;
}

/**
 * 中转文件分片 (Server → Client)。
 * 高频消息，结构精简：不包含 senderName 和 t（从 META 消息已知发送方信息）。
 */
export interface RelayFileChunkData {
  /** 发送方客户端 ID（用于关联到正确的传输状态） */
  senderId: string;
  /** 传输唯一标识符 */
  transferId: string;
  /** 分片索引（0-based） */
  index: number;
  /** 加密 IV（12 bytes 原始二进制） */
  iv: Uint8Array;
  /** 加密后的分片数据（原始二进制） */
  data: Uint8Array;
}

/**
 * 中转传输完成信号 (Server → Client)。
 * 接收方收到后验证所有 chunk 已收齐，然后重组文件。
 */
export interface RelayFileCompleteData {
  /** 发送方客户端 ID */
  senderId: string;
  /** 传输唯一标识符 */
  transferId: string;
}

/**
 * 中转取消信号 (Server → Client)。
 * 接收方收到后释放缓冲区，显示"发送方已取消传输"。
 */
export interface RelayFileCancelData {
  /** 发送方客户端 ID */
  senderId: string;
  /** 传输唯一标识符 */
  transferId: string;
}

/**
 * 中转接收确认 (Server → Client)。
 * 发送方收到后更新"已送达 (N/M)"计数。
 * 注意：此消息只发送给原始发送方（定向中转），不广播给所有成员。
 */
export interface RelayFileAckData {
  /** 确认接收的接收方 ID（让发送方知道是谁确认了） */
  receiverId: string;
  /** 传输唯一标识符 */
  transferId: string;
}

// ===== 文件消息占位符（聊天列表集成） =====

/**
 * 聊天列表中的文件消息占位符。
 *
 * 📚 学习要点: 占位符模式（Placeholder Pattern）
 * 文件消息需要同时出现在聊天流中（用于 UI 展示）和文件传输 store 中（用于状态管理）。
 * 采用「占位符」模式：在 messages[] 中插入一个 type='file' 的特殊消息，
 * 包含 transferId 引用，实际传输状态（进度、速度、缓冲区）从 fileTransferStore 读取。
 *
 * 为什么不把传输状态直接存在 ChatMessage 中？
 * 1. ChatMessage 数组有 MAX_MESSAGES=200 限制，传输状态不应被溢出淘汰
 * 2. 传输状态包含大量临时数据（chunk 缓冲区），不适合放在消息数组中
 * 3. 分离关注点：消息列表负责展示，fileTransferStore 负责传输逻辑
 *
 * ChatFileMessage 继承 ChatMessage 的所有字段（id, senderId, senderName, timestamp 等），
 * 额外添加文件相关的冗余字段用于快速渲染（不需要每次都查询 fileTransferStore）。
 */
export interface ChatFileMessage {
  /** 消息唯一 ID（用于 React key） */
  id: string;
  /** 稳定 ID（用于去重，格式: senderId-timestamp） */
  stableId: string;
  /** 发送方客户端 ID */
  senderId: string;
  /** 发送方显示名称 */
  senderName: string;
  /** 固定为空字符串（文件消息不使用 text 字段，但保持与 ChatMessage 结构兼容） */
  text: string;
  /** 消息时间戳（毫秒） */
  timestamp: number;
  /** 是否为当前用户发送的消息 */
  isMine: boolean;
  /** 固定为 false（文件消息不是系统消息） */
  isSystem: boolean;
  /** 消息类型标识符，固定为 'file'（用于 MessageBubble 组件的条件渲染） */
  type: 'file';
  /** 传输唯一标识符（引用 fileTransferStore 中的 TransferState） */
  transferId: string;
  /** 文件名（冗余存储，用于消息列表快速渲染，无需查询 store） */
  fileName: string;
  /** 文件大小（字节，冗余存储，用于显示人类可读的文件大小） */
  fileSize: number;
  /** MIME 类型（冗余存储，用于显示对应的文件类型图标） */
  mimeType: string;
}
