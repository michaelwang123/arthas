import { PLAYER_SPEED, WORLD_WIDTH, WORLD_HEIGHT, PLAYER_RADIUS } from '../constants'
import type { PlayerInput } from './InputSystem'

interface PendingInput {
  seq: number
  input: PlayerInput
  dt: number
}

/**
 * 客户端预测系统
 * 本地玩家的移动立即生效，收到服务器确认后校正
 */
export class PredictionSystem {
  private pendingInputs: PendingInput[] = []
  private seq = 0
  private localX = 0
  private localY = 0

  getSeq(): number {
    return this.seq
  }

  /**
   * 预测本地玩家移动
   */
  predict(input: PlayerInput, dt: number): { x: number; y: number; seq: number } {
    this.seq++

    // 保存待确认输入
    this.pendingInputs.push({ seq: this.seq, input, dt })

    // 本地立即应用移动
    this.applyInput(input, dt)

    return { x: this.localX, y: this.localY, seq: this.seq }
  }

  /**
   * 收到服务器状态后校正
   */
  reconcile(serverX: number, serverY: number, lastProcessedSeq: number) {
    // 移除已被服务器确认的输入
    this.pendingInputs = this.pendingInputs.filter((p) => p.seq > lastProcessedSeq)

    // 以服务器位置为基准
    this.localX = serverX
    this.localY = serverY

    // 重新应用未确认的输入
    for (const pending of this.pendingInputs) {
      this.applyInput(pending.input, pending.dt)
    }
  }

  private applyInput(input: PlayerInput, dt: number) {
    this.localX += input.dx * PLAYER_SPEED * dt
    this.localY += input.dy * PLAYER_SPEED * dt

    // 边界钳制
    this.localX = Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, this.localX))
    this.localY = Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, this.localY))
  }

  setPosition(x: number, y: number) {
    this.localX = x
    this.localY = y
  }

  getPosition(): { x: number; y: number } {
    return { x: this.localX, y: this.localY }
  }
}
