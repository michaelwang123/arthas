import { encode, decode } from '@msgpack/msgpack'
import {
  MSG_PLAYER_INPUT,
  MSG_SKILL_USE,
  MSG_PONG,
  MSG_GAME_STATE,
  MSG_WELCOME,
  MSG_PLAYER_JOINED,
  MSG_PLAYER_LEFT,
  MSG_PLAYER_DIED,
  MSG_PLAYER_RESPAWNED,
  MSG_SCORE_UPDATE,
  MSG_GAME_OVER,
  MSG_SERVER_PING,
  type Message,
  type GameStateMessage,
  type WelcomeMessage,
  type ScoreUpdateMessage,
  type GameOverMessage,
} from './protocol'
import { useGameStore } from '../stores/gameStore'
import type { PlayerInput } from '../game/systems/InputSystem'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws'

export class WebSocketManager {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private inputSeq = 0

  connect() {
    try {
      this.ws = new WebSocket(WS_URL)
      this.ws.binaryType = 'arraybuffer'

      this.ws.onopen = () => {
        console.log('[WS] Connected to server')
        useGameStore.getState().setConnected(true)
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.ws.onclose = () => {
        console.log('[WS] Disconnected')
        useGameStore.getState().setConnected(false)
        this.scheduleReconnect()
      }

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err)
      }
    } catch (err) {
      console.error('[WS] Connection failed:', err)
      this.scheduleReconnect()
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  sendInput(input: PlayerInput) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    // 只在有实际输入时发送
    if (input.dx === 0 && input.dy === 0 && !input.attack && !input.skill1 && !input.skill2) {
      return
    }

    this.inputSeq++

    // 发送移动/攻击输入
    this.send({
      type: MSG_PLAYER_INPUT,
      data: {
        seq: this.inputSeq,
        dx: input.dx,
        dy: input.dy,
        attack: input.attack,
        mouseX: input.mouseX,
        mouseY: input.mouseY,
      },
    })

    // 发送技能使用
    if (input.skill1) {
      this.send({
        type: MSG_SKILL_USE,
        data: { skillId: 1, targetX: input.mouseX, targetY: input.mouseY },
      })
    }
    if (input.skill2) {
      this.send({
        type: MSG_SKILL_USE,
        data: { skillId: 2, targetX: input.mouseX, targetY: input.mouseY },
      })
    }
  }

  private send(msg: Message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const data = encode(msg)
    this.ws.send(data)
  }

  private handleMessage(raw: ArrayBuffer) {
    try {
      const msg = decode(new Uint8Array(raw)) as Message
      const store = useGameStore.getState()

      switch (msg.type) {
        case MSG_WELCOME: {
          const data = msg.data as WelcomeMessage
          store.setPlayerId(data.playerId)
          console.log('[WS] Welcome! Player ID:', data.playerId)
          break
        }

        case MSG_GAME_STATE: {
          const data = msg.data as GameStateMessage
          store.updateGameState(data)
          break
        }

        case MSG_PLAYER_JOINED: {
          const data = msg.data as { id: string }
          console.log('[WS] Player joined:', data.id)
          break
        }

        case MSG_PLAYER_LEFT: {
          const data = msg.data as { id: string }
          console.log('[WS] Player left:', data.id)
          break
        }

        case MSG_PLAYER_DIED: {
          const data = msg.data as { id: string; killerId: string }
          if (data.id === store.playerId) {
            store.setDead(true)
          }
          break
        }

        case MSG_PLAYER_RESPAWNED: {
          const data = msg.data as { id: string }
          if (data.id === store.playerId) {
            store.setDead(false)
          }
          break
        }

        case MSG_SCORE_UPDATE: {
          const data = msg.data as ScoreUpdateMessage
          store.updateScores(data.scores)
          break
        }

        case MSG_GAME_OVER: {
          const data = msg.data as GameOverMessage
          store.setGameOver(data.winnerId, data.scores)
          break
        }

        case MSG_SERVER_PING: {
          // 回复 Pong
          this.send({ type: MSG_PONG, data: { timestamp: Date.now() } })
          break
        }
      }
    } catch (err) {
      console.error('[WS] Failed to decode message:', err)
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    console.log('[WS] Reconnecting in 3s...')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 3000)
  }
}
