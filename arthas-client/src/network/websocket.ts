import { encode, decode } from '@msgpack/msgpack'
import { MSG_PING, MSG_PONG, type Message } from './protocol'

// ===== 配置 =====

const DEFAULT_WS_URL = 'ws://localhost:8080/ws'
const BACKOFF_INITIAL_MS = 1000
const BACKOFF_MAX_MS = 30000

// ===== 状态 =====

let ws: WebSocket | null = null
let connected = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let backoff = BACKOFF_INITIAL_MS
let messageHandler: ((msg: Message) => void) | null = null
let shouldReconnect = true

// ===== 公开 API =====

/**
 * 发起 WebSocket 连接。
 * @param url 可选，覆盖默认 URL
 */
export function connect(url?: string): void {
  const wsUrl = url ?? import.meta.env.VITE_WS_URL ?? DEFAULT_WS_URL
  shouldReconnect = true

  try {
    ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      console.log('[WS] Connected')
      connected = true
      backoff = BACKOFF_INITIAL_MS // 重置退避
    }

    ws.onmessage = (event: MessageEvent) => {
      handleRawMessage(event.data)
    }

    ws.onclose = () => {
      console.log('[WS] Disconnected')
      connected = false
      ws = null
      if (shouldReconnect) {
        scheduleReconnect(wsUrl)
      }
    }

    ws.onerror = (err) => {
      console.error('[WS] Error:', err)
    }
  } catch (err) {
    console.error('[WS] Connection failed:', err)
    connected = false
    ws = null
    if (shouldReconnect) {
      scheduleReconnect(url ?? import.meta.env.VITE_WS_URL ?? DEFAULT_WS_URL)
    }
  }
}

/**
 * 主动关闭连接，不再自动重连。
 */
export function disconnect(): void {
  shouldReconnect = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.close()
    ws = null
  }
  connected = false
}

/**
 * 发送消息。将 {type, data} 信封用 MessagePack 编码后以二进制发送。
 */
export function send(type: number, data: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const msg: Message = { type, data }
  const encoded = encode(msg)
  ws.send(encoded)
}

/**
 * 注册消息处理回调。收到服务器消息后会调用此 handler。
 */
export function onMessage(handler: (msg: Message) => void): void {
  messageHandler = handler
}

/**
 * 返回当前连接状态。
 */
export function isConnected(): boolean {
  return connected
}

/**
 * 返回底层 WebSocket 实例（调试/高级用途）。
 */
export function getWs(): WebSocket | null {
  return ws
}

// ===== 内部逻辑 =====

/**
 * 处理收到的原始二进制消息：解码 → 处理 Ping → 分发给 handler。
 */
function handleRawMessage(raw: ArrayBuffer): void {
  try {
    const msg = decode(new Uint8Array(raw)) as Message

    // 自动回复 Ping
    if (msg.type === MSG_PING) {
      const pingData = msg.data as { t: number }
      send(MSG_PONG, { t: pingData.t })
      return
    }

    // 分发给注册的 handler
    if (messageHandler) {
      messageHandler(msg)
    }
  } catch (err) {
    console.error('[WS] Failed to decode message:', err)
  }
}

/**
 * 指数退避重连调度。
 * 退避序列：1s → 2s → 4s → 8s → 16s → 30s (max)
 */
function scheduleReconnect(url: string): void {
  if (reconnectTimer) return

  console.log(`[WS] Reconnecting in ${backoff / 1000}s...`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    // 增长退避时间（下次使用）
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
    connect(url)
  }, backoff)
}
