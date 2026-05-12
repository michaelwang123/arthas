import { create } from 'zustand'
import type { PlayerState, ProjectileState, CoreshardState, GameStateMessage } from '../network/protocol'

interface GameStore {
  // 连接状态
  connected: boolean
  playerId: string | null

  // 游戏状态
  players: PlayerState[]
  projectiles: ProjectileState[]
  coreshard: CoreshardState | null
  scores: Record<string, number>

  // UI 状态
  isDead: boolean
  gameOver: boolean
  winnerId: string | null

  // Actions
  setConnected: (connected: boolean) => void
  setPlayerId: (id: string) => void
  updateGameState: (state: GameStateMessage) => void
  updateScores: (scores: Record<string, number>) => void
  setDead: (dead: boolean) => void
  setGameOver: (winnerId: string, scores: Record<string, number>) => void
}

export const useGameStore = create<GameStore>((set) => ({
  connected: false,
  playerId: null,
  players: [],
  projectiles: [],
  coreshard: null,
  scores: {},
  isDead: false,
  gameOver: false,
  winnerId: null,

  setConnected: (connected) => set({ connected }),

  setPlayerId: (id) => set({ playerId: id }),

  updateGameState: (state) =>
    set({
      players: state.players,
      projectiles: state.projectiles,
      coreshard: state.coreshard,
    }),

  updateScores: (scores) => set({ scores }),

  setDead: (dead) => set({ isDead: dead }),

  setGameOver: (winnerId, scores) =>
    set({ gameOver: true, winnerId, scores }),
}))
