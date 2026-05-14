# Design: Phase 5 体验打磨（第一批）

## Architecture Overview

所有改动限于前端（`arthas-client/src/`），不涉及后端。采用纯组件化方案，利用现有 Zustand store 的 `connected` 状态驱动 UI。

```
┌─────────────────────────────────────────────────┐
│ ChatRoom.tsx                                     │
│ ┌─────────────────────────────────────────────┐ │
│ │ ConnectionBanner (smooth height transition)  │ │ ← 新增
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ Header (+ 成员按钮 + 静音按钮)              │ │ ← 修改
│ └─────────────────────────────────────────────┘ │
│ ┌──────────────────────┐ ┌──────────────────┐   │
│ │ MessageList          │ │ MemberDrawer     │   │ ← 新增（移动端 overlay）
│ │                      │ │ (fixed overlay)  │   │
│ └──────────────────────┘ └──────────────────┘   │
│ ┌─────────────────────────────────────────────┐ │
│ │ MessageInput                                │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Design Decisions

### D1. 连接状态横幅 — max-height 动画 + 宽限期

**决策：** 横幅容器始终挂载在 DOM 中（aria-live 区域），通过 `max-height` + `overflow-hidden` 控制可见性。首次加载有 1.5s 宽限期。

**理由：**
- `max-height` 过渡实现零 CLS（Cumulative Layout Shift）的平滑展开/收起
- 容器始终挂载确保 `aria-live` 区域能正确播报状态变化
- 宽限期避免快速网络下的横幅闪烁（每次加载都闪一下黄色横幅体验很差）

**替代方案（已否决）：**
- `position: fixed` — 覆盖内容，需要动态 padding 补偿
- 条件渲染（`{state !== 'hidden' && <Banner />}`）— 产生布局跳动

**状态机：**
```
mount ──→ grace (1.5s 宽限期)
              │
              ├── 1.5s 内 connected=true ──→ hidden（从未显示）
              │
              └── 1.5s 后仍 connected=false ──→ disconnected（显示横幅）
                                                      │
                                    connected=true ───┘──→ reconnected (2s) ──→ hidden
                                                                                   │
                                    connected=false ──────────────────────────────┘──→ disconnected
```

**组件实现：**
```typescript
const GRACE_MS = 1500
const RECONNECTED_MS = 2000

type BannerState = 'grace' | 'hidden' | 'disconnected' | 'reconnected'

function ConnectionBanner() {
  const connected = useChatStore((s) => s.connected)
  const [state, setState] = useState<BannerState>('grace')
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const graceOverRef = useRef(false)

  // 始终同步追踪最新 connected 值（ref 赋值是同步的，无闭包陈旧问题）
  const connectedRef = useRef(connected)
  connectedRef.current = connected

  // 宽限期逻辑（仅 mount 时执行一次）
  useEffect(() => {
    if (connected) {
      // mount 时已连接 → 跳过宽限期
      setState('hidden')
      graceOverRef.current = true
      return
    }
    // mount 时未连接 → 启动 1.5s 宽限期
    const graceTimer = setTimeout(() => {
      graceOverRef.current = true
      // 通过 ref 读取当前最新值（避免闭包捕获旧值）
      if (!connectedRef.current) {
        setState('disconnected')
      } else {
        setState('hidden')
      }
    }, GRACE_MS)
    return () => clearTimeout(graceTimer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 宽限期结束后的状态变化
  useEffect(() => {
    if (!graceOverRef.current) return // 宽限期内忽略变化
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!connected) {
      setState('disconnected')
    } else {
      setState('reconnected')
      timerRef.current = setTimeout(() => setState('hidden'), RECONNECTED_MS)
    }
  }, [connected])

  const isVisible = state === 'disconnected' || state === 'reconnected'

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`overflow-hidden transition-all duration-300 motion-reduce:duration-100 ease-in-out shrink-0
        ${isVisible ? 'max-h-10' : 'max-h-0'}`}
    >
      {state === 'disconnected' && (
        <div className="h-10 flex items-center justify-center bg-amber-600 text-white text-sm font-medium animate-pulse-banner motion-reduce:animate-none">
          连接中断，正在重连...
        </div>
      )}
      {state === 'reconnected' && (
        <div className="h-10 flex items-center justify-center bg-green-600 text-white text-sm font-medium">
          ✓ 已重连
        </div>
      )}
    </div>
  )
}
```

---

### D2. 响应式适配 — MemberDrawer + 完整焦点陷阱

**决策：** 新建独立 `MemberDrawer.tsx` 组件，包含完整的 WAI-ARIA 对话框模式。

**实现细节：**
- 桌面端（≥ 768px）：保持现有 `<aside>` 侧边栏（`hidden md:block`）
- 移动端（< 768px）：header 显示成员按钮（`md:hidden`），点击打开 MemberDrawer
- 抽屉使用 `fixed inset-0 z-40` 全屏覆盖，内部分为遮罩层和面板

**焦点陷阱（Tab 循环）：**
```typescript
function useFocusTrap(containerRef: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active || !containerRef.current) return

    const container = containerRef.current
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const focusables = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
      if (focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [active, containerRef])
}
```

**MemberDrawer 完整行为：**
```typescript
function MemberDrawer({ open, onClose, members, triggerRef }: MemberDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useFocusTrap(drawerRef, open)

  useEffect(() => {
    if (!open) return

    // 打开时聚焦关闭按钮
    closeBtnRef.current?.focus()

    // Escape 关闭
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)

    // Body scroll lock
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = prevOverflow
      // 关闭后焦点回到触发按钮
      triggerRef.current?.focus()
    }
  }, [open, onClose, triggerRef])

  if (!open) return null

  return (
    <div ref={drawerRef} role="dialog" aria-modal="true" aria-label="成员列表">
      {/* 遮罩 */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} aria-hidden="true" />
      {/* 面板 */}
      <div className="fixed top-0 right-0 h-full w-64 bg-gray-800 z-50 animate-slide-in-right motion-reduce:animate-none">
        <button ref={closeBtnRef} onClick={onClose} aria-label="关闭成员列表" className="...">✕</button>
        <MemberList members={members} />
      </div>
    </div>
  )
}
```

**虚拟键盘适配：**
```html
<!-- Tailwind: vh fallback + dvh override -->
<div class="h-screen supports-[height:100dvh]:h-[100dvh]">
```

---

### D3. 消息通知 — AudioContext 延迟初始化

**决策：** AudioContext 在用户首次交互时初始化，而非页面加载时。

**理由：** iOS Safari 要求 AudioContext 必须在用户手势事件（click/touch/keydown）中创建，否则静默失败且无错误提示。

**实现方案：**
```typescript
// notification.ts
let audioCtx: AudioContext | null = null
let initialized = false

export function initAudio(): void {
  if (initialized) return
  initialized = true
  try {
    audioCtx = new AudioContext()
  } catch (e) {
    console.warn('[Notification] AudioContext not available:', e)
  }
}

export function playNotificationSound(): void {
  if (!audioCtx) return
  // 恢复挂起的 context（浏览器可能在后台挂起）
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain)
  gain.connect(audioCtx.destination)
  osc.frequency.value = 660  // C5 音高，比 440Hz 更清脆
  osc.type = 'sine'
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08)
  osc.start()
  osc.stop(audioCtx.currentTime + 0.08)
}

export function requestNotificationPermission(): void {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

export function showDesktopNotification(senderName: string): void {
  if (Notification.permission !== 'granted') return
  if (!document.hidden) return
  new Notification('Arthas Chat', {
    body: `${senderName} 发来了新消息`,
    icon: '/favicon.ico',
    tag: 'arthas-msg', // 合并同类通知
  })
}
```

**初始化时机（ChatRoom.tsx）：**
```typescript
useEffect(() => {
  const handler = () => {
    initAudio()
    requestNotificationPermission()
  }
  // 任何用户交互都触发初始化（仅一次）
  document.addEventListener('click', handler, { once: true })
  document.addEventListener('keydown', handler, { once: true })
  return () => {
    document.removeEventListener('click', handler)
    document.removeEventListener('keydown', handler)
  }
}, [])
```

**多标签页行为：** 每个标签页独立。V1 不做跨标签页去重（需要 BroadcastChannel API，复杂度高收益低）。

---

### D4. Store 变更

```typescript
// chatStore.ts 新增
muted: boolean;          // 初始值: localStorage.getItem('arthas_muted') === 'true'
toggleMute: () => void;  // 切换 muted，同步写入 localStorage
```

通知触发点（在 `MSG_RELAY_MESSAGE` 解密成功后）：
```typescript
const { muted } = get()
if (!muted) {
  playNotificationSound()
}
if (document.hidden) {
  showDesktopNotification(data.senderName)  // 不受 muted 控制
}
```

**设计决策：** 桌面通知不受 `muted` 控制。理由：用户静音通常是为了避免声音打扰（开会、公共场所），但仍希望看到视觉提醒。这与 Slack/Discord 的行为一致。

---

### D5. prefers-reduced-motion 支持

在 `tailwind.config.js` 中定义动画：

```javascript
// tailwind.config.js → theme.extend
keyframes: {
  'pulse-banner': {
    '0%, 100%': { opacity: '1' },
    '50%': { opacity: '0.7' },
  },
  'slide-in-right': {
    from: { transform: 'translateX(100%)' },
    to: { transform: 'translateX(0)' },
  },
},
animation: {
  'pulse-banner': 'pulse-banner 2s ease-in-out infinite',
  'slide-in-right': 'slide-in-right 0.2s ease-out',
},
```

使用时配合 `motion-reduce:` 变体：
```html
<div class="animate-pulse-banner motion-reduce:animate-none">...</div>
```

注意：`max-height` 过渡是功能性的（非装饰性），即使在 reduced-motion 下也保留，但可以缩短 duration：
```html
<div class="transition-all duration-300 motion-reduce:duration-100">...</div>
```

---

### D6. ShareKey 移动端布局

移动端 footer 中的 ShareKey 改为紧凑模式：

```tsx
<div className="flex items-center gap-2">
  <span className="hidden md:inline text-sm text-gray-400 truncate max-w-[200px]">
    {shareCode}
  </span>
  <button onClick={handleCopy} className="min-h-[44px] min-w-[44px] ...">
    <span className="md:hidden">📋 复制分享码</span>
    <span className="hidden md:inline">📋</span>
  </button>
  {copied && <span className="text-xs text-green-400">已复制</span>}
</div>
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `tailwind.config.js` | 修改 | 添加 keyframes + animation |
| `src/components/ConnectionBanner.tsx` | 新建 | 连接状态横幅（含宽限期 + max-height 动画） |
| `src/components/MemberDrawer.tsx` | 新建 | 移动端成员抽屉（含焦点陷阱） |
| `src/utils/notification.ts` | 新建 | 音效 + 桌面通知工具 |
| `src/pages/ChatRoom.tsx` | 修改 | 集成横幅、抽屉、通知初始化、静音按钮 |
| `src/stores/chatStore.ts` | 修改 | 添加 muted 状态 + 通知触发 |
| `src/components/ShareKey.tsx` | 修改 | 移动端紧凑布局 |

## 不做的事

- 不引入 framer-motion 或其他动画库
- 不引入音频文件（纯 Web Audio API 合成）
- 不修改后端代码
- 不修改 Home 页面
- 不做 PWA（Phase 5 第二批）
- 不做跨标签页通知去重（V1）
- 不在 `src/styles/index.css` 中添加自定义 CSS
- 不做自定义通知权限 UI（直接使用浏览器原生提示）
