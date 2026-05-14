# Design: 消息回复与反应 (Phase 6.3 + 6.5)

## Architecture Overview

回复功能纯前端实现（引用数据嵌入加密载荷），反应功能需要前后端协同（新增协议消息类型）。

```
┌─────────────────────────────────────────────────────────────┐
│ 稳定消息 ID（跨客户端一致）                                    │
│                                                             │
│ stableId = `${senderId}:${timestamp}`                       │
│ - 发送方: myId + Date.now()                                  │
│ - 接收方: data.senderId + data.t                             │
│ - 用于: 回复引用定位 + 反应目标定位                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 加密载荷结构变更                                              │
│                                                             │
│ 旧格式: plaintext = "消息文本"                               │
│ 新格式: plaintext = JSON.stringify({                         │
│           text: "消息文本",                                   │
│           reply?: { stableId, senderName, preview }          │
│         })                                                   │
│                                                             │
│ 向后兼容: 如果 plaintext 不是 JSON 或无 text 字段，           │
│           则整个 plaintext 作为消息文本（旧格式）              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 反应协议                                                     │
│                                                             │
│ Client → Server: MSG_SEND_REACTION (0x07)                   │
│   { iv, ciphertext }                                        │
│   解密后: { stableId, emoji, action: 'add'|'remove' }       │
│                                                             │
│ Server → Client: MSG_RELAY_REACTION (0x19)                  │
│   { senderId, senderName, iv, ciphertext, t }               │
│   解密后: { stableId, emoji, action: 'add'|'remove' }       │
└─────────────────────────────────────────────────────────────┘
```

---

## Design Decisions

### D0. 稳定消息 ID — `senderId:timestamp` 模式

**问题：** 当前 `generateMessageId()` 生成的 ID 是客户端本地的，不同客户端对同一条消息有不同的 ID。回复和反应需要一个跨客户端一致的标识符。

**决策：** 使用 `${senderId}:${timestamp}` 作为稳定 ID。

**理由：**
- 不需要后端改动（纯前端计算）
- 实际上不可能冲突（同一用户同一毫秒发两条消息需要绕过网络延迟）
- 发送方和接收方都能独立计算出相同的值

**实现：**
```typescript
function makeStableId(senderId: string, timestamp: number): string {
  return `${senderId}:${timestamp}`
}

// ChatMessage 扩展
interface ChatMessage {
  id: string          // 本地唯一 ID（React key 用）
  stableId: string    // 跨客户端稳定 ID（回复/反应引用用）
  // ...
}

// 发送时（optimistic render）
const timestamp = Date.now()
const stableId = makeStableId(myId, timestamp)

// 接收时
const stableId = makeStableId(data.senderId, data.t)
```

**替代方案（已否决）：**
- 服务器分配 ID — 需要后端改动 + 发送方无法立即获得 ID（影响乐观渲染）
- 内容 hash — 相同内容的消息会冲突

**精度说明：** Firefox 将 `Date.now()` 精度降至 1ms（Spectre 缓解措施）。对本方案无影响：同一用户在 1ms 内发送两条消息在物理上不可能（网络往返 > 50ms，UI 交互 > 100ms）。即使极端情况下时间戳相同，也仅影响该用户自己的两条消息互相引用的场景（概率趋近于零）。

---

### D1. 加密载荷格式 — JSON 包装 + 向后兼容

**决策：** 将明文从纯字符串改为 JSON 结构。

**payload.ts：**
```typescript
export interface ReplyData {
  stableId: string    // 被引用消息的稳定 ID
  senderName: string  // 被引用消息的发送者名称
  preview: string     // 被引用消息的文本摘要（最多 50 字符）
}

interface MessagePayload {
  text: string
  reply?: ReplyData
}

export function buildPayload(text: string, reply?: ReplyData): string {
  const payload: MessagePayload = { text }
  if (reply) payload.reply = reply
  return JSON.stringify(payload)
}

export function parsePayload(plaintext: string): { text: string; reply?: ReplyData } {
  try {
    const parsed = JSON.parse(plaintext)
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.text === 'string') {
      return { text: parsed.text, reply: parsed.reply }
    }
  } catch {}
  // 向后兼容：旧格式纯文本
  return { text: plaintext }
}

export function truncatePreview(text: string, maxLen = 50): string {
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}
```

---

### D2. 消息回复 UI

**回复预览条（输入框上方）：**
```tsx
{replyTo && (
  <div className="flex items-center gap-2 px-3 py-2 bg-gray-700/50 border-l-2 border-indigo-500 rounded-t-lg">
    <div className="flex-1 min-w-0">
      <span className="text-xs text-indigo-400 font-medium">{replyTo.senderName}</span>
      <p className="text-xs text-gray-400 truncate">{replyTo.preview}</p>
    </div>
    <button onClick={clearReply} aria-label="取消回复" className="text-gray-500 hover:text-white">✕</button>
  </div>
)}
```

**消息气泡中的引用块：**
```tsx
{msg.reply && (
  <div
    onClick={() => scrollToMessage(msg.reply.stableId)}
    className="mb-1 px-2 py-1 bg-black/20 border-l-2 border-gray-500 rounded text-xs cursor-pointer hover:bg-black/30"
    role="button"
    aria-label={`跳转到 ${msg.reply.senderName} 的消息`}
  >
    <span className="text-gray-400 font-medium">{msg.reply.senderName}</span>
    <p className="text-gray-500 truncate">{msg.reply.preview}</p>
  </div>
)}
```

**滑动回复（移动端）：**
```typescript
const SWIPE_THRESHOLD = 60
const SWIPE_MAX = 80

// 在 MessageBubble 外层 wrapper 上
// 仅水平右滑触发，垂直滑动 > 10px 时取消（避免与页面滚动冲突）
function useSwipeToReply(onReply: () => void) {
  const startX = useRef(0)
  const startY = useRef(0)
  const deltaX = useRef(0)
  const active = useRef(false)
  const elRef = useRef<HTMLDivElement>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    active.current = true
    deltaX.current = 0
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!active.current) return
    const dx = e.touches[0].clientX - startX.current
    const dy = Math.abs(e.touches[0].clientY - startY.current)
    
    // 垂直滑动 > 10px → 取消（让浏览器处理滚动）
    if (dy > 10 && Math.abs(dx) < dy) {
      active.current = false
      if (elRef.current) elRef.current.style.transform = ''
      return
    }
    
    // 仅向右
    if (dx < 0) { deltaX.current = 0; return }
    deltaX.current = Math.min(dx, SWIPE_MAX)
    if (elRef.current) {
      elRef.current.style.transform = `translateX(${deltaX.current}px)`
    }
  }

  const handleTouchEnd = () => {
    if (active.current && deltaX.current >= SWIPE_THRESHOLD) {
      onReply()
    }
    active.current = false
    deltaX.current = 0
    if (elRef.current) {
      elRef.current.style.transform = ''
      elRef.current.style.transition = 'transform 0.2s ease-out'
      setTimeout(() => {
        if (elRef.current) elRef.current.style.transition = ''
      }, 200)
    }
  }

  return { elRef, handleTouchStart, handleTouchMove, handleTouchEnd }
}
```

---

### D3. 反应系统 — 一人一反应 + 自动替换

**客户端状态：**
```typescript
// chatStore 新增
reactions: Map<string, Reaction[]>  // stableId → reactions

interface Reaction {
  emoji: string
  userIds: string[]
}
```

**发送反应逻辑（处理一人一反应约束）：**
```typescript
sendReaction(stableId: string, emoji: string) {
  const { myId, roomKey, reactions } = get()
  if (!myId || !roomKey) return

  const msgReactions = reactions.get(stableId) || []
  const myExisting = msgReactions.find(r => r.userIds.includes(myId))

  if (myExisting) {
    if (myExisting.emoji === emoji) {
      // 同一 emoji → 取消（toggle off）
      encryptAndSendReaction(roomKey, { stableId, emoji, action: 'remove' })
      updateLocalReaction(stableId, myId, emoji, 'remove')
    } else {
      // 不同 emoji → 替换（remove old + add new）
      encryptAndSendReaction(roomKey, { stableId, emoji: myExisting.emoji, action: 'remove' })
      encryptAndSendReaction(roomKey, { stableId, emoji, action: 'add' })
      updateLocalReaction(stableId, myId, myExisting.emoji, 'remove')
      updateLocalReaction(stableId, myId, emoji, 'add')
    }
  } else {
    // 无现有反应 → 添加
    encryptAndSendReaction(roomKey, { stableId, emoji, action: 'add' })
    updateLocalReaction(stableId, myId, emoji, 'add')
  }
}
```

**快速反应面板：**
```tsx
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉']

interface ReactionPanelProps {
  onReact: (emoji: string) => void
  onClose: () => void
  triggerRef: RefObject<HTMLElement | null>  // 触发按钮 ref，排除在外部点击之外
  position: 'above' | 'below'               // 动态定位
}

function ReactionPanel({ onReact, onClose, triggerRef, position }: ReactionPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // 外部点击关闭（排除触发按钮）
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose, triggerRef])

  const posClass = position === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'

  return (
    <div ref={panelRef} role="menu" aria-label="添加反应"
      className={`absolute ${posClass} left-0 flex gap-1 p-1.5 bg-gray-700 rounded-full shadow-lg border border-gray-600 z-50`}>
      {QUICK_REACTIONS.map((emoji) => (
        <button key={emoji} onClick={() => { onReact(emoji); onClose() }}
          role="menuitem" aria-label={emoji}
          className="w-9 h-9 flex items-center justify-center text-lg rounded-full hover:bg-gray-600 hover:scale-110 transition-transform motion-reduce:hover:scale-100">
          {emoji}
        </button>
      ))}
    </div>
  )
}
```

**动态定位逻辑（在 MessageBubble 中）：**
```typescript
function getReactionPanelPosition(triggerEl: HTMLElement): 'above' | 'below' {
  const rect = triggerEl.getBoundingClientRect()
  const panelHeight = 48 // 面板近似高度
  return rect.top > panelHeight + 16 ? 'above' : 'below'
}
```

**反应汇总显示：**
```tsx
function ReactionSummary({ reactions, myId, onToggle }: Props) {
  if (!reactions || reactions.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map((r) => {
        const isMine = r.userIds.includes(myId)
        return (
          <button key={r.emoji} onClick={() => onToggle(r.emoji)}
            aria-label={`${r.emoji} ${r.userIds.length}人`}
            className={`px-1.5 py-0.5 rounded-full text-xs flex items-center gap-0.5 transition-colors
              ${isMine ? 'bg-indigo-600/30 border border-indigo-500' : 'bg-gray-700/50 border border-gray-600 hover:border-gray-500'}`}>
            <span>{r.emoji}</span>
            <span className="text-gray-400">{r.userIds.length}</span>
          </button>
        )
      })}
    </div>
  )
}
```

---

### D4. 后端协议扩展

**protocol.go 新增：**
```go
const (
    MsgSendReaction  uint8 = 0x07  // Client → Server
    MsgRelayReaction uint8 = 0x19  // Server → Client
)

type RelayReactionData struct {
    SenderID   string `msgpack:"senderId"`
    SenderName string `msgpack:"senderName"`
    IV         string `msgpack:"iv"`
    Ciphertext string `msgpack:"ciphertext"`
    T          int64  `msgpack:"t"`
}
```

**hub.go 新增：**
```go
case MsgSendReaction:
    h.handleSendReaction(client, msg.Data)

func (h *Hub) handleSendReaction(client *Client, data interface{}) {
    // 1. 检查客户端在房间中
    if client.RoomID == "" {
        h.sendError(client, ErrCodeNotInRoom, "not in a room")
        return
    }

    // 2. 解析 iv + ciphertext
    dataMap, ok := data.(map[string]interface{})
    if !ok {
        h.sendError(client, ErrCodeInvalidMessage, "invalid reaction data")
        return
    }
    iv, _ := dataMap["iv"].(string)
    ciphertext, _ := dataMap["ciphertext"].(string)
    if iv == "" || ciphertext == "" {
        h.sendError(client, ErrCodeInvalidMessage, "iv and ciphertext required")
        return
    }

    // 3. 不做频率限制（反应是轻量交互）

    // 4. 查找房间并广播
    r := h.roomManager.GetRoom(client.RoomID)
    if r == nil {
        client.RoomID = ""
        h.sendError(client, ErrCodeNotInRoom, "room no longer exists")
        return
    }

    now := time.Now().UnixMilli()
    relayMsg := Message{
        Type: MsgRelayReaction,
        Data: RelayReactionData{
            SenderID:   client.ID,
            SenderName: client.Name,
            IV:         iv,
            Ciphertext: ciphertext,
            T:          now,
        },
    }
    broadcastData, err := msgpack.Marshal(relayMsg)
    if err != nil {
        logger.Error("Hub", "failed to marshal RelayReaction: %v", err)
        return
    }
    r.Broadcast(client.ID, broadcastData)
}
```

---

### D5. 滚动到原消息 + 高亮

```typescript
function scrollToMessage(stableId: string) {
  const el = document.querySelector(`[data-stable-id="${stableId}"]`) as HTMLElement
  if (!el) return // 消息已不在 DOM 中（超出 200 条缓冲区）
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // 高亮闪烁
  el.classList.add('ring-2', 'ring-indigo-500/50')
  setTimeout(() => el.classList.remove('ring-2', 'ring-indigo-500/50'), 1500)
}
```

每条消息容器添加 `data-stable-id={msg.stableId}`。

---

### D6. 双击反应（移动端）

```typescript
// 使用 touch-action: manipulation 禁用浏览器双击缩放
// 在消息气泡 wrapper 上添加此 CSS

function useDoubleTap(onDoubleTap: () => void, delay = 300) {
  const lastTap = useRef(0)

  const handleTap = () => {
    const now = Date.now()
    if (now - lastTap.current < delay) {
      onDoubleTap()
      lastTap.current = 0 // 重置防止三击
    } else {
      lastTap.current = now
    }
  }

  return handleTap
}

// 使用：
<div className="touch-action-manipulation" onClick={handleDoubleTap}>
  <MessageBubble ... />
</div>
```

注意：`touch-action: manipulation` 是标准 CSS 属性，Tailwind 没有内置 utility，需要用 arbitrary value `[touch-action:manipulation]` 或在组件中内联。

---

### D7. 未来增强：反应添加动画（V2）

当前版本不实现反应动画。记录设计思路供后续参考：

**方案：** 添加 `bounce-in` keyframe（scale 0→1.2→1, 200ms），当用户添加反应时对新出现的 badge 应用动画。

**实现思路：** 在 ReactionSummary 中追踪 `justAdded` 状态（300ms 内为 true），对应 badge 添加 `animate-bounce-in`。

**不在 V1 实现的理由：** 需要额外的状态追踪逻辑（区分"新增"和"已存在"），增加复杂度但不影响功能。待核心功能稳定后再添加。

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| **后端** | | |
| `internal/network/protocol.go` | 修改 | +MsgSendReaction(0x07) +MsgRelayReaction(0x19) +RelayReactionData |
| `internal/network/hub.go` | 修改 | +handleSendReaction +HandleMessage case |
| **前端** | | |
| `src/network/protocol.ts` | 修改 | +MSG_SEND_REACTION +MSG_RELAY_REACTION +RelayReactionData |
| `src/utils/payload.ts` | 新建 | buildPayload/parsePayload/ReplyData/truncatePreview |
| `src/stores/chatStore.ts` | 修改 | +stableId +replyTo +reactions +sendReaction +MSG_RELAY_REACTION handler |
| `src/components/MessageBubble.tsx` | 修改 | +引用块 +反应按钮 +反应汇总 +滑动回复 +双击反应 |
| `src/components/MessageList.tsx` | 修改 | +data-stable-id +scrollToMessage +传递 reactions |
| `src/components/MessageInput.tsx` | 修改 | +回复预览条 +replyTo state |
| `src/components/ReactionPanel.tsx` | 新建 | 快速反应面板（6 emoji） |

## 不做的事

- 不做反应的持久化（房间销毁后消失）
- 不做反应动画（emoji 飞入效果）
- 不做自定义反应（仅 6 个快速反应）
- 不做引用嵌套（不能引用一条已经是引用的消息的引用部分）
- 不做消息编辑/撤回
- 不修改加密算法
- 不做服务端消息 ID 分配（使用客户端计算的 stableId）
