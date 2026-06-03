/**
 * @file protocol.ts — Arthas WebSocket protocol message types and data structures
 *
 * Defines all message type IDs and corresponding data interfaces for the
 * Chrome extension's communication with the relay server.
 *
 * Protocol numbering scheme (single-byte hex):
 * | Range       | Direction         | Domain     |
 * |-------------|-------------------|------------|
 * | 0x01–0x06   | Client → Server   | Chat core  |
 * | 0x10–0x18   | Server → Client   | Chat core  |
 *
 * The extension uses the chat-core subset only (no file transfer, no reactions in MVP).
 * Reference: arthas-client/src/network/protocol.ts
 */

// ===== Message Type Constants =====

// Client → Server (Chat core: 0x01–0x06)
export const MSG_CREATE_ROOM = 0x01;
export const MSG_JOIN_ROOM = 0x02;
export const MSG_SEND_MESSAGE = 0x03;
export const MSG_LEAVE_ROOM = 0x04;
export const MSG_TYPING = 0x05;
export const MSG_PONG = 0x06;

// Server → Client (Chat core: 0x10–0x18)
export const MSG_ROOM_CREATED = 0x10;
export const MSG_ROOM_JOINED = 0x11;
export const MSG_MEMBER_JOINED = 0x12;
export const MSG_MEMBER_LEFT = 0x13;
export const MSG_RELAY_MESSAGE = 0x14;
export const MSG_MEMBER_TYPING = 0x15;
export const MSG_ROOM_CLOSED = 0x16;
export const MSG_ERROR = 0x17;
export const MSG_PING = 0x18;

// ===== Message Envelope =====

/** Wire-format message envelope: type byte + arbitrary data payload. */
export interface Message {
  type: number;
  data: unknown;
}

// ===== Client → Server Data Structures =====

/** Data payload for MSG_CREATE_ROOM (0x01). */
export interface CreateRoomData {
  name: string;
  password?: string;
  ephemeral?: number;
  expiry?: number;
}

/** Data payload for MSG_JOIN_ROOM (0x02). */
export interface JoinRoomData {
  roomId: string;
  name: string;
  password?: string;
}

/** Data payload for MSG_SEND_MESSAGE (0x03). */
export interface SendMessageData {
  iv: string;
  ciphertext: string;
}

/** Data payload for MSG_LEAVE_ROOM (0x04). Empty — no fields required. */
export interface LeaveRoomData {}

/** Data payload for MSG_TYPING (0x05). Encrypted typing status for interop. */
export interface TypingData {
  iv: string;
  ciphertext: string;
}

/** Data payload for MSG_PONG (0x06). */
export interface PongData {
  t: number;
}

// ===== Server → Client Data Structures =====

/** Data payload for MSG_ROOM_CREATED (0x10). */
export interface RoomCreatedData {
  roomId: string;
  expiresAt: number;
}

/** Data payload for MSG_ROOM_JOINED (0x11). */
export interface RoomJoinedData {
  roomId: string;
  members: MemberInfo[];
  hasPassword: boolean;
  ephemeral: number;
  expiresAt: number;
}

/** Data payload for MSG_MEMBER_JOINED (0x12). */
export interface MemberJoinedData {
  id: string;
  name: string;
  color: string;
}

/** Data payload for MSG_MEMBER_LEFT (0x13). */
export interface MemberLeftData {
  id: string;
}

/** Data payload for MSG_RELAY_MESSAGE (0x14). */
export interface RelayMessageData {
  senderId: string;
  senderName: string;
  iv: string;
  ciphertext: string;
  t: number;
}

/** Data payload for MSG_MEMBER_TYPING (0x15). Encrypted typing status. */
export interface MemberTypingData {
  id: string;
  iv: string;
  ciphertext: string;
}

/** Data payload for MSG_ROOM_CLOSED (0x16). */
export interface RoomClosedData {
  reason?: string;
}

/** Data payload for MSG_ERROR (0x17). */
export interface ErrorData {
  code: string;
  msg: string;
}

/** Data payload for MSG_PING (0x18). */
export interface PingData {
  t: number;
}

// ===== Shared Structures =====

/** Member information returned in RoomJoined and used throughout the extension. */
export interface MemberInfo {
  id: string;
  name: string;
  color: string;
}

// ===== Error Codes =====

export const ERR_ROOM_NOT_FOUND = 'E001';
export const ERR_ROOM_FULL = 'E002';
export const ERR_NOT_IN_ROOM = 'E003';
export const ERR_RATE_LIMITED = 'E004';
export const ERR_INVALID_MESSAGE = 'E005';
