/**
 * @file protocol.ts — Match 模块 WebSocket 协议消息类型与数据结构定义
 *
 * 本文件定义随机配对功能的所有消息类型 ID 和对应的数据接口。
 * 服务器端 Go 代码对应 `arthas-server/internal/match/protocol.go` 和 `messages.go`。
 *
 * 📚 协议编号方案:
 * Match 消息使用 0x20-0x2F 范围，与现有 0x01-0x1E 不冲突：
 *
 * | 范围        | 方向              | 功能域       |
 * |-------------|-------------------|-------------|
 * | 0x20 - 0x27 | Client → Server   | 随机配对     |
 * | 0x28 - 0x2F | Server → Client   | 随机配对     |
 *
 * Hub.HandleMessage 通过消息类型范围 (0x20-0x2F) 前置路由到 Match_Server，
 * 保持 Hub 代码精简，不在 switch 中逐一添加 case。
 */

// ===== Match 消息类型 ID =====

// Client → Server（随机配对: 0x20-0x27）

/** 进入匹配队列（附带可选兴趣标签） */
export const MSG_MATCH_REQUEST = 0x20;
/** 取消匹配（从队列中退出） */
export const MSG_MATCH_CANCEL = 0x21;
/** Client A 中转 AES-256 密钥给 Client B（经服务器转发） */
export const MSG_MATCH_KEY_RELAY = 0x22;
/** 通过邀请链接加入匹配 */
export const MSG_MATCH_INVITE_JOIN = 0x23;
/** 举报配对对象 */
export const MSG_MATCH_REPORT = 0x24;
/** 提议延长房间时间 */
export const MSG_MATCH_EXTEND = 0x25;
/** Session loop: 离开当前房间并立即重新匹配 */
export const MSG_MATCH_NEXT = 0x26;

// Server → Client（随机配对: 0x28-0x2F）

/** 指示 Client A 生成 AES-256 密钥 */
export const MSG_MATCH_GENERATE_KEY = 0x28;
/** 配对成功通知（包含房间 ID 和配置） */
export const MSG_MATCH_FOUND = 0x29;
/** 队列等待超时通知 */
export const MSG_MATCH_TIMEOUT = 0x2a;
/** 匹配错误通知 */
export const MSG_MATCH_ERROR = 0x2b;
/** 配对方离开/断线通知 */
export const MSG_MATCH_PARTNER_LEFT = 0x2c;
/** 对方提议延长房间时间 */
export const MSG_MATCH_EXTEND_REQ = 0x2d;
/** 延期成功通知（双方同意后） */
export const MSG_MATCH_EXTENDED = 0x2e;
/** 邀请链接已创建通知 */
export const MSG_MATCH_INVITE_CREATED = 0x2f;

// ===== Match 错误码 =====

/** 随机配对功能已禁用 */
export const ERR_MATCH_DISABLED = 'M001';
/** 已在匹配队列中（重复入队） */
export const ERR_MATCH_ALREADY_IN_QUEUE = 'M002';
/** 已在房间中（需先离开当前房间） */
export const ERR_MATCH_ALREADY_IN_ROOM = 'M003';
/** 冷却期内（两次匹配间隔过短） */
export const ERR_MATCH_COOLDOWN = 'M004';
/** 超过每小时匹配次数限制 */
export const ERR_MATCH_RATE_LIMIT = 'M005';
/** 匹配队列已满 */
export const ERR_MATCH_QUEUE_FULL = 'M006';
/** 无效兴趣标签 */
export const ERR_MATCH_INVALID_TAGS = 'M007';
/** IP 已被封禁 */
export const ERR_MATCH_IP_BLOCKED = 'M008';
/** 邀请链接已过期 */
export const ERR_MATCH_INVITE_EXPIRED = 'M009';
/** 无效邀请令牌 */
export const ERR_MATCH_INVITE_INVALID = 'M010';
/** 已达最大延期次数 */
export const ERR_MATCH_EXTEND_MAX_REACHED = 'M011';
/** 密钥交换超时 */
export const ERR_MATCH_KEY_EXCHANGE_TIMEOUT = 'M012';

// ===== Client → Server 数据结构 =====

/** MatchRequest 消息数据：进入匹配队列 */
export interface MatchRequestData {
  /** 兴趣标签（0-3 个，来自预定义集合） */
  tags: string[];
}

/** MatchKeyRelay 消息数据：中转 AES-256 密钥 */
export interface MatchKeyRelayData {
  /** base64url 编码的 AES-256 密钥 */
  key: string;
}

/** MatchInviteJoin 消息数据：通过邀请链接加入 */
export interface MatchInviteJoinData {
  /** 邀请链接令牌 */
  token: string;
}

/** MatchReport 消息数据：举报配对对象 */
export interface MatchReportData {
  /** 举报原因类别 */
  reason: 'harassment' | 'spam' | 'inappropriate' | 'other';
}

/** MatchNext 消息数据：复用 MatchRequestData（显式重新发送 tags） */
export type MatchNextData = MatchRequestData;

// ===== Server → Client 数据结构 =====

/** MatchGenerateKey 消息数据：指示 Client A 生成密钥 */
export interface MatchGenerateKeyData {
  /** 配对方 ID（用于 UI 显示） */
  partnerId: string;
}

/** MatchFound 消息数据：配对成功通知 */
export interface MatchFoundData {
  /** 房间 ID */
  roomId: string;
  /** 房间过期时间戳（Unix 秒） */
  expiresAt: number;
  /** 阅后即焚时间（秒） */
  ephemeral: number;
  /** base64url 编码的 AES-256 密钥（仅 Client B 收到） */
  key?: string;
}

/** MatchTimeout 消息数据：队列等待超时 */
export interface MatchTimeoutData {
  /** 等待的总秒数 */
  waitedSeconds: number;
}

/** MatchError 消息数据：匹配错误 */
export interface MatchErrorData {
  /** 错误码（M001-M012） */
  code: string;
  /** 错误描述信息 */
  msg: string;
  /** 重试等待时间（秒），速率限制时返回 */
  retryAfter?: number;
}

/** MatchExtended 消息数据：延期成功通知 */
export interface MatchExtendedData {
  /** 新的过期时间戳（Unix 秒） */
  newExpiresAt: number;
  /** 剩余可延期次数 */
  extensionsLeft: number;
}

/** MatchInviteCreated 消息数据：邀请链接已创建 */
export interface MatchInviteCreatedData {
  /** 邀请令牌 */
  token: string;
  /** 令牌过期时间戳（Unix 秒） */
  expiresAt: number;
  /** 完整邀请链接 URL */
  link: string;
}
