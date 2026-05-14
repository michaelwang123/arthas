# Design: Phase 5 体验打磨（第二批）

## Architecture Overview

所有改动限于前端。PWA 涉及根目录静态文件（manifest、SW、图标），其余为组件级改动。

```
arthas-client/
├── public/
│   ├── manifest.json          ← 新增
│   ├── sw.js                  ← 新增（Service Worker）
│   ├── offline.html           ← 新增（离线页面）
│   ├── icon-192.png           ← 新增
│   └── icon-512.png           ← 新增
├── index.html                 ← 修改（manifest link + meta）
└── src/
    ├── components/
    │   ├── MessageList.tsx     ← 修改（时间分组 + MessageBubble + 动画）
    │   ├── MessageInput.tsx    ← 修改（emoji 按钮 + inputRef）
    │   ├── EmojiPicker.tsx     ← 新增
    │   └── MessageBubble.tsx   ← 新增（链接识别 + 桌面复制）
    ├── utils/
    │   ├── linkify.ts          ← 新增（URL 识别）
    │   ├── emojiData.ts        ← 新增（精选 emoji 数据）
    │   └── notification.ts     ← 修改（添加 join/leave 音效）
    ├── stores/chatStore.ts     ← 修改（join/leave 音效触发）
    ├── main.tsx                ← 修改（注册 Service Worker）
    └── tailwind.config.js      ← 修改（slide-in-msg 动画）
```

---

## Design Decisions

### D1. PWA — 最小化 Service Worker（Network-first + Offline Fallback）

**决策：** SW 仅做离线导航回退，不做资源缓存。

**理由：**
- Arthas 核心功能依赖 WebSocket，离线时无法使用
- Vite 构建产物带 content hash，缓存策略复杂且收益低
- 仅需：用户离线打开 App 时看到友好提示而非浏览器错误页

**sw.js：**
```javascript
const CACHE_NAME = 'arthas-offline-v1'
const OFFLINE_PAGE = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_PAGE))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // 清理旧版本 cache
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_PAGE))
  )
})
```

**offline.html（纯 HTML，不依赖构建产物）：**
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arthas - 离线</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
           background:#111827; color:#fff; font-family:system-ui,sans-serif; }
    .card { text-align:center; padding:2rem; }
    .icon { font-size:3rem; margin-bottom:1rem; }
    h1 { font-size:1.25rem; margin:0 0 0.5rem; }
    p { color:#9ca3af; font-size:0.875rem; margin:0 0 1.5rem; }
    button { padding:0.5rem 1.5rem; background:#4f46e5; color:#fff; border:none;
             border-radius:0.5rem; font-size:0.875rem; cursor:pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📡</div>
    <h1>网络连接已断开</h1>
    <p>请检查网络连接后重试</p>
    <button onclick="location.reload()">刷新页面</button>
  </div>
</body>
</html>
```

**SW 注册（main.tsx）：**
```typescript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // 静默降级
  })
}
```

**为什么不需要 SW 更新通知：** 我们的 SW 是 network-first 策略，仅缓存 offline.html。应用本身始终从网络获取最新版本。当新版本部署时，`skipWaiting()` + `clients.claim()` 确保新 SW 立即接管，但由于我们不缓存应用资源，用户下次打开自然获取最新代码。无需额外的"有新版本可用"提示。

---

### D2. Emoji 选择器 — 内联数据 + Toggle Popover + useEffect 光标恢复

**决策：** 精选 ~200 个常用 emoji 内联，使用 toggle 模式控制面板，光标恢复通过 useEffect 实现。

**数据结构（emojiData.ts）：**
```typescript
export interface EmojiCategory {
  name: string
  icon: string
  emojis: string[]
}

export const emojiCategories: EmojiCategory[] = [
  { name: '最近', icon: '🕐', emojis: [] },
  { name: '表情', icon: '😊', emojis: ['😀','😂','🥹','😍','🤔','😅','😭','🥺','😤','🙄','😴','🤗','😎','🥳','😇','🫠','😈','💀','🤡','👻'] },
  { name: '手势', icon: '👋', emojis: ['👍','👎','👋','🙏','💪','✌️','🤝','👏','🫶','🤞','🤙','👌','✋','🫡','🖐️','👊'] },
  { name: '心形', icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❤️‍🔥','💕','💗','💖','💝'] },
  { name: '动物', icon: '🐱', emojis: ['🐱','🐶','🐻','🦊','🐼','🐨','🦁','🐯','🐸','🐵','🐔','🐧','🦄','🐝','🦋','🐙'] },
  { name: '食物', icon: '🍕', emojis: ['🍕','🍔','🍟','🌮','🍣','🍜','🍩','🍪','🎂','🍺','☕','🧋','🍷','🥤','🍉','🍓'] },
  { name: '活动', icon: '⚽', emojis: ['⚽','🏀','🎮','🎯','🎲','🎵','🎸','🎬','📸','🏆','🥇','🎪','🎭','🎨'] },
  { name: '旅行', icon: '✈️', emojis: ['✈️','🚗','🚀','🏠','🏖️','🌍','🗺️','🌅','🌙','⭐','☀️','🌈','⛰️','🏔️'] },
  { name: '符号', icon: '💯', emojis: ['💯','✅','❌','⭕','❗','❓','💡','🔥','⚡','💫','🎉','🎊','✨','💢','💤','🚫'] },
]

const RECENT_KEY = 'arthas_recent_emojis'
const MAX_RECENT = 16

export function getRecentEmojis(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, MAX_RECENT)
  } catch { return [] }
}

export function addRecentEmoji(emoji: string): void {
  const recent = getRecentEmojis().filter((e) => e !== emoji)
  recent.unshift(emoji)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)))
}
```

**EmojiPicker 外部点击处理（排除 emoji 按钮）：**
```typescript
// EmojiPicker.tsx
interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  onClose: () => void
  excludeRef: RefObject<HTMLElement | null>  // emoji 按钮 ref，排除在"外部点击"之外
}

useEffect(() => {
  const handleClick = (e: MouseEvent) => {
    const target = e.target as Node
    if (pickerRef.current?.contains(target)) return      // 点击面板内部
    if (excludeRef.current?.contains(target)) return     // 点击 emoji 按钮
    onClose()
  }
  document.addEventListener('mousedown', handleClick)
  return () => document.removeEventListener('mousedown', handleClick)
}, [onClose, excludeRef])
```

**Emoji 网格性能优化：**
- 每个 emoji 为最小化 DOM：`<button class="w-8 h-8 text-xl hover:bg-gray-700 rounded">{emoji}</button>`
- 不使用 `<img>` 或 SVG（原生 emoji 渲染由系统字体处理，零网络请求）
- 不为每个 emoji 添加 tooltip 或复杂 hover 效果
- 200 个 button 元素在现代设备上无性能问题（Chrome 可轻松处理 1000+ 简单 DOM 节点）
- 如果未来扩展到完整 Unicode 列表（3000+），再考虑虚拟滚动

**光标位置恢复（MessageInput.tsx）— useEffect 模式：**
```typescript
const inputRef = useRef<HTMLInputElement>(null)
const cursorPosRef = useRef<number | null>(null)

// 当 text 变化时，如果有待恢复的光标位置，应用它
useEffect(() => {
  if (cursorPosRef.current !== null && inputRef.current) {
    inputRef.current.setSelectionRange(cursorPosRef.current, cursorPosRef.current)
    inputRef.current.focus()
    cursorPosRef.current = null
  }
}, [text])

function insertEmoji(emoji: string) {
  const input = inputRef.current
  const start = input?.selectionStart ?? text.length
  const end = input?.selectionEnd ?? text.length
  const newText = text.slice(0, start) + emoji + text.slice(end)
  if (newText.length > MAX_LENGTH) return
  cursorPosRef.current = start + emoji.length
  setText(newText)
  addRecentEmoji(emoji)
}
```

---

### D3. 链接自动识别 — 正则 + 尾部标点剥离

**决策：** 使用正则匹配 URL，匹配后剥离尾部标点符号。

**理由：** 用户经常在 URL 后紧跟标点（如"看看 https://example.com。"），不剥离会导致链接包含无效字符。

**linkify.ts：**
```typescript
const URL_REGEX = /https?:\/\/[^\s<>"\u3000-\u303F\uFF00-\uFFEF]+/g
// 注意：不包含 ) 和 ]，这两个由 balanceParentheses 处理
const TRAILING_PUNCT = /[.,;:!?>'"。，；：！？】》]+$/

export interface TextSegment {
  type: 'text' | 'link'
  content: string
}

/**
 * 平衡括号：如果 URL 中 ')' 比 '(' 多，从尾部剥离多余的 ')'。
 * 同时处理 ']' 和 '[' 的平衡。
 *
 * 正确处理两种场景：
 * - https://en.wikipedia.org/wiki/Foo_(bar) → 完整保留（平衡）
 * - visit https://example.com) → 剥离尾部 )（不平衡）
 */
function balanceParentheses(url: string): string {
  let result = url

  // 平衡 ()
  const opens = (result.match(/\(/g) || []).length
  const closes = (result.match(/\)/g) || []).length
  let excess = closes - opens
  while (excess > 0 && result.endsWith(')')) {
    result = result.slice(0, -1)
    excess--
  }

  // 平衡 []
  const openBrackets = (result.match(/\[/g) || []).length
  const closeBrackets = (result.match(/\]/g) || []).length
  let bracketExcess = closeBrackets - openBrackets
  while (bracketExcess > 0 && result.endsWith(']')) {
    result = result.slice(0, -1)
    bracketExcess--
  }

  return result
}

export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let lastIndex = 0

  URL_REGEX.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_REGEX.exec(text)) !== null) {
    let url = match[0]

    // 顺序很重要：
    // 1. 先平衡括号（处理 Wikipedia 风格 URL，也处理多余的尾部括号）
    url = balanceParentheses(url)
    // 2. 再剥离尾部标点（不含括号，括号已由上一步处理）
    const trailingMatch = url.match(TRAILING_PUNCT)
    if (trailingMatch) {
      url = url.slice(0, -trailingMatch[0].length)
    }

    const urlStart = match.index
    const urlEnd = urlStart + url.length
    URL_REGEX.lastIndex = urlEnd

    if (urlStart > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, urlStart) })
    }
    segments.push({ type: 'link', content: url })
    lastIndex = urlEnd
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) })
  }
  return segments
}

export function truncateUrl(url: string, maxLen = 50): string {
  return url.length > maxLen ? url.slice(0, maxLen) + '…' : url
}
```

---

### D4. 复制消息 — 桌面 Hover 按钮（移动端依赖原生行为）

**决策：** 仅在桌面端实现 hover 复制按钮。移动端依赖浏览器原生长按复制。

**理由：**
- 自定义 long-press 与浏览器原生上下文菜单冲突
- 阻止原生行为（`-webkit-touch-callout: none`）会破坏文本选择
- 浏览器原生长按已提供"复制"选项，用户已有此习惯
- 保持消息文本可选中（Req 8.9）

**MessageBubble.tsx：**
```typescript
interface MessageBubbleProps {
  text: string
  isOwn: boolean
  canCopy: boolean
  isDecryptFailed: boolean
}

function MessageBubble({ text, isOwn, canCopy, isDecryptFailed }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!canCopy) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const bgClass = isOwn ? 'bg-indigo-600' : 'bg-gray-700'
  const roundedClass = isOwn ? 'rounded-lg rounded-br-sm' : 'rounded-lg rounded-bl-sm'

  return (
    <div className={`relative group ${bgClass} text-white px-3 py-2 ${roundedClass}`}>
      {isDecryptFailed ? (
        <span className={`italic ${isOwn ? 'text-red-300' : 'text-red-400'}`}>{text}</span>
      ) : (
        <RichText text={text} />
      )}

      {/* Desktop-only copy button (hover reveal) */}
      {canCopy && (
        <button
          onClick={handleCopy}
          aria-label="复制消息"
          className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center
                     bg-gray-600 rounded-full text-xs opacity-0 group-hover:opacity-100
                     transition-opacity duration-150 hover:bg-gray-500
                     hidden md:flex"
        >
          {copied ? '✓' : '📋'}
        </button>
      )}

      {/* Copied toast */}
      {copied && (
        <span className="absolute -top-6 right-0 text-xs text-green-400 bg-gray-900 px-1.5 py-0.5 rounded">
          已复制
        </span>
      )}
    </div>
  )
}
```

---

### D5. 消息时间分组

**决策：** 在 MessageList 渲染时比较相邻消息时间戳，间隔 > 5 分钟时插入分隔线。

```typescript
const FIVE_MINUTES = 5 * 60 * 1000

function shouldShowTimeSeparator(prev: ChatMessage | null, curr: ChatMessage): boolean {
  if (!prev) return true
  return curr.timestamp - prev.timestamp > FIVE_MINUTES
}

function formatSeparatorTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const hh = date.getHours().toString().padStart(2, '0')
  const mm = date.getMinutes().toString().padStart(2, '0')
  if (isToday) return `${hh}:${mm}`
  const MM = (date.getMonth() + 1).toString().padStart(2, '0')
  const dd = date.getDate().toString().padStart(2, '0')
  return `${MM}-${dd} ${hh}:${mm}`
}
```

**分隔线 JSX：**
```tsx
<div className="flex items-center gap-3 py-2">
  <div className="flex-1 h-px bg-gray-700" />
  <span className="text-xs text-gray-500">{formatSeparatorTime(timestamp)}</span>
  <div className="flex-1 h-px bg-gray-700" />
</div>
```

---

### D6. 发送消息动画 — prevCountRef 检测新消息

**决策：** 使用 ref 追踪上一次消息数量，仅对新增的自己的消息应用动画。

```typescript
// MessageList.tsx 内部
const prevCountRef = useRef(messages.length)
const isNewBatch = messages.length > prevCountRef.current

useEffect(() => {
  prevCountRef.current = messages.length
}, [messages.length])

// 渲染时判断
const isNewestOwn = isNewBatch && index === messages.length - 1 && msg.isMine
// 如果 isNewestOwn，添加 animate-slide-in-msg motion-reduce:animate-none
```

**tailwind.config.js 新增：**
```javascript
keyframes: {
  'slide-in-msg': {
    from: { opacity: '0', transform: 'translateX(8px)' },
    to: { opacity: '1', transform: 'translateX(0)' },
  },
},
animation: {
  'slide-in-msg': 'slide-in-msg 0.2s ease-out',
},
```

---

### D7. 加入/离开音效

复用现有 `notification.ts` 的 AudioContext，添加两个新函数：

```typescript
export function playJoinSound(): void {
  if (!audioCtx) return
  if (audioCtx.state === 'suspended') audioCtx.resume()
  // 上升音调 C5→E5 (660→830Hz)，表示"有人来了"
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain); gain.connect(audioCtx.destination)
  osc.frequency.setValueAtTime(660, audioCtx.currentTime)
  osc.frequency.linearRampToValueAtTime(830, audioCtx.currentTime + 0.1)
  osc.type = 'sine'
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12)
  osc.start(); osc.stop(audioCtx.currentTime + 0.12)
}

export function playLeaveSound(): void {
  if (!audioCtx) return
  if (audioCtx.state === 'suspended') audioCtx.resume()
  // 下降音调 E5→C5 (830→660Hz)，表示"有人走了"
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.connect(gain); gain.connect(audioCtx.destination)
  osc.frequency.setValueAtTime(830, audioCtx.currentTime)
  osc.frequency.linearRampToValueAtTime(660, audioCtx.currentTime + 0.1)
  osc.type = 'sine'
  gain.gain.setValueAtTime(0.1, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12)
  osc.start(); osc.stop(audioCtx.currentTime + 0.12)
}
```

在 chatStore 的 `MSG_MEMBER_JOINED` 和 `MSG_MEMBER_LEFT` handler 中：
```typescript
const { muted } = get()
if (!muted) playJoinSound()  // 或 playLeaveSound()
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `public/manifest.json` | 新建 | PWA manifest |
| `public/sw.js` | 新建 | Service Worker |
| `public/offline.html` | 新建 | 离线提示页 |
| `public/icon-192.png` | 新建 | PWA 图标 |
| `public/icon-512.png` | 新建 | PWA 图标 |
| `index.html` | 修改 | manifest + meta tags |
| `src/main.tsx` | 修改 | 注册 SW |
| `src/utils/emojiData.ts` | 新建 | Emoji 分类数据 |
| `src/utils/linkify.ts` | 新建 | URL 识别 + 尾部标点剥离 |
| `src/utils/notification.ts` | 修改 | 添加 join/leave 音效 |
| `src/components/EmojiPicker.tsx` | 新建 | Emoji 选择面板 |
| `src/components/MessageBubble.tsx` | 新建 | 消息气泡（链接 + 桌面复制） |
| `src/components/MessageList.tsx` | 修改 | 时间分组 + MessageBubble + 动画 |
| `src/components/MessageInput.tsx` | 修改 | emoji 按钮 + inputRef + cursorPosRef |
| `src/stores/chatStore.ts` | 修改 | join/leave 音效触发 |
| `tailwind.config.js` | 修改 | slide-in-msg 动画 |

## 不做的事

- 不引入 emoji-mart 或其他 emoji 库
- 不做 URL 预览卡片（Open Graph）
- 不做自定义移动端长按复制（依赖浏览器原生）
- 不做离线消息队列
- 不做 Service Worker 资源预缓存
- 不做亮色主题切换（推迟）
- 不阻止消息文本的原生选择行为
