import { INTERPOLATION_DELAY } from '../constants'

interface Snapshot {
  x: number
  y: number
  dir: number
  timestamp: number
}

/**
 * 实体插值系统
 * 对其他玩家的位置做平滑插值，消除网络抖动
 */
export class InterpolationSystem {
  private buffers: Map<string, Snapshot[]> = new Map()

  /**
   * 添加新的位置快照
   */
  addSnapshot(entityId: string, x: number, y: number, dir: number) {
    if (!this.buffers.has(entityId)) {
      this.buffers.set(entityId, [])
    }

    const buffer = this.buffers.get(entityId)!
    buffer.push({ x, y, dir, timestamp: Date.now() })

    // 只保留最近 1 秒的快照
    const cutoff = Date.now() - 1000
    while (buffer.length > 0 && buffer[0].timestamp < cutoff) {
      buffer.shift()
    }
  }

  /**
   * 获取插值后的位置
   */
  getInterpolatedPosition(entityId: string): { x: number; y: number; dir: number } | null {
    const buffer = this.buffers.get(entityId)
    if (!buffer || buffer.length < 2) {
      // 数据不足，返回最新位置
      if (buffer && buffer.length === 1) {
        return { x: buffer[0].x, y: buffer[0].y, dir: buffer[0].dir }
      }
      return null
    }

    // 渲染时间 = 当前时间 - 插值延迟
    const renderTime = Date.now() - INTERPOLATION_DELAY

    // 找到 renderTime 前后的两个快照
    let prev: Snapshot | null = null
    let next: Snapshot | null = null

    for (let i = 0; i < buffer.length - 1; i++) {
      if (buffer[i].timestamp <= renderTime && buffer[i + 1].timestamp >= renderTime) {
        prev = buffer[i]
        next = buffer[i + 1]
        break
      }
    }

    // 如果没找到合适的区间，使用最新数据
    if (!prev || !next) {
      const latest = buffer[buffer.length - 1]
      return { x: latest.x, y: latest.y, dir: latest.dir }
    }

    // 线性插值
    const total = next.timestamp - prev.timestamp
    const progress = total > 0 ? (renderTime - prev.timestamp) / total : 0
    const t = Math.max(0, Math.min(1, progress))

    return {
      x: prev.x + (next.x - prev.x) * t,
      y: prev.y + (next.y - prev.y) * t,
      dir: this.lerpAngle(prev.dir, next.dir, t),
    }
  }

  /**
   * 移除实体
   */
  removeEntity(entityId: string) {
    this.buffers.delete(entityId)
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    return a + diff * t
  }
}
