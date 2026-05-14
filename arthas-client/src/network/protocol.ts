// ===== 消息类型 ID =====

// Client → Server
export const MSG_CREATE_ROOM = 0x01;
export const MSG_JOIN_ROOM = 0x02;
export const MSG_SEND_MESSAGE = 0x03;
export const MSG_LEAVE_ROOM = 0x04;
export const MSG_TYPING = 0x05;
export const MSG_PONG = 0x06;
export const MSG_SEND_REACTION = 0x07;

// Server → Client
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

// ===== 错误码 =====

export const ERR_ROOM_NOT_FOUND = 'E001';
export const ERR_ROOM_FULL = 'E002';
export const ERR_NOT_IN_ROOM = 'E003';
export const ERR_RATE_LIMITED = 'E004';
export const ERR_INVALID_MESSAGE = 'E005';

// ===== 消息信封 =====

export interface Message {
  type: number;
  data: unknown;
}

// ===== Client → Server 数据结构 =====

export interface CreateRoomData {
  name: string;
}

export interface JoinRoomData {
  roomId: string;
  name: string;
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
