/**
 * 消息通知工具模块 — 音效 + 桌面通知。
 *
 * 设计要点：
 * - AudioContext 必须在用户手势事件中初始化（iOS Safari 要求）
 * - 使用 Web Audio API 合成提示音，无需外部音频文件
 * - 桌面通知使用 tag 合并同类，避免通知堆积
 */

let audioCtx: AudioContext | null = null
let initialized = false

/**
 * 初始化 AudioContext。必须在用户交互事件（click/keydown）中调用。
 * 幂等：多次调用安全。
 */
export function initAudio(): void {
  if (initialized) return
  initialized = true
  try {
    audioCtx = new AudioContext()
  } catch (e) {
    console.warn('[Notification] AudioContext not available:', e)
  }
}

/**
 * 播放短促提示音（660Hz C5, 80ms, 音量 0.15）。
 * 如果 AudioContext 未初始化或被浏览器挂起，静默跳过。
 */
export function playNotificationSound(): void {
  if (!audioCtx) return

  // 恢复可能被浏览器挂起的 context
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }

  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain)
  gain.connect(audioCtx.destination)

  osc.frequency.value = 660 // C5 — 比 A4(440Hz) 更清脆
  osc.type = 'sine'
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08)

  osc.start()
  osc.stop(audioCtx.currentTime + 0.08)
}

/**
 * 请求桌面通知权限。仅在权限为 'default'（未决定）时请求。
 * 用户已拒绝或已授权时不做任何操作。
 */
export function requestNotificationPermission(): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

/**
 * 显示桌面通知。仅在页面不可见且权限已授权时触发。
 * 使用 tag 合并同类通知，避免多条消息产生通知堆积。
 */
export function showDesktopNotification(senderName: string): void {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (!document.hidden) return

  new Notification('Arthas Chat', {
    body: `${senderName} 发来了新消息`,
    icon: '/favicon.ico',
    tag: 'arthas-msg',
  })
}

/**
 * 播放成员加入音效（上升音调 C5→E5, 120ms）。
 * 受静音按钮控制，由 chatStore 调用。
 */
export function playJoinSound(): void {
  if (!audioCtx) return
  if (audioCtx.state === 'suspended') audioCtx.resume()
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.frequency.setValueAtTime(660, audioCtx.currentTime)
  osc.frequency.linearRampToValueAtTime(830, audioCtx.currentTime + 0.1)
  osc.type = 'sine'
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12)
  osc.start()
  osc.stop(audioCtx.currentTime + 0.12)
}

/**
 * 播放成员离开音效（下降音调 E5→C5, 120ms）。
 * 受静音按钮控制，由 chatStore 调用。
 */
export function playLeaveSound(): void {
  if (!audioCtx) return
  if (audioCtx.state === 'suspended') audioCtx.resume()
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.frequency.setValueAtTime(830, audioCtx.currentTime)
  osc.frequency.linearRampToValueAtTime(660, audioCtx.currentTime + 0.1)
  osc.type = 'sine'
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12)
  osc.start()
  osc.stop(audioCtx.currentTime + 0.12)
}
