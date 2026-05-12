// ===== 消息类型 ID =====

// 客户端 → 服务器
export const MSG_PLAYER_INPUT = 0x01
export const MSG_SKILL_USE = 0x02
export const MSG_PONG = 0x03

// 服务器 → 客户端
export const MSG_GAME_STATE = 0x10
export const MSG_PLAYER_JOINED = 0x11
export const MSG_PLAYER_LEFT = 0x12
export const MSG_SKILL_EFFECT = 0x13
export const MSG_PLAYER_DIED = 0x14
export const MSG_PLAYER_RESPAWNED = 0x15
export const MSG_SCORE_UPDATE = 0x16
export const MSG_GAME_OVER = 0x17
export const MSG_SERVER_PING = 0x18
export const MSG_WELCOME = 0x19

// ===== 数据类型 =====

export type PlayerStateEnum = 'idle' | 'moving' | 'attacking' | 'dead'

export interface PlayerState {
  id: string
  x: number
  y: number
  hp: number
  maxHp: number
  dir: number
  state: PlayerStateEnum
  lastInputSeq: number
}

export interface ProjectileState {
  id: string
  x: number
  y: number
  dx: number
  dy: number
  ownerId: string
  skillId: number
}

export interface CoreshardState {
  x: number
  y: number
  state: 'idle' | 'capturing' | 'cooldown'
  capturingPlayerId: string | null
  captureProgress: number
  respawnTimer: number
}

export interface GameStateMessage {
  tick: number
  players: PlayerState[]
  projectiles: ProjectileState[]
  coreshard: CoreshardState
}

export interface WelcomeMessage {
  playerId: string
  gameConfig: {
    worldWidth: number
    worldHeight: number
    tickRate: number
  }
}

export interface PlayerInputMessage {
  seq: number
  dx: number
  dy: number
  attack: boolean
  mouseX: number
  mouseY: number
}

export interface SkillUseMessage {
  skillId: number
  targetX: number
  targetY: number
}

export interface ScoreUpdateMessage {
  scores: Record<string, number>
}

export interface GameOverMessage {
  winnerId: string
  scores: Record<string, number>
}

// ===== 消息信封 =====

export interface Message {
  type: number
  data: unknown
}
