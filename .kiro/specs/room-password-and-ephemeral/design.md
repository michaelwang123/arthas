# Design: 房间密码保护 + 阅后即焚 (Phase 6.2 + 6.4)

## Architecture Overview

密码保护需要前后端协同（服务端验证），阅后即焚纯前端实现（客户端定时删除）。

```
┌─────────────────────────────────────────────────────────────┐
│ 密码保护流程                                                  │
│                                                             │
│ 创建: Client sends { name, password: sha256(pwd) }          │
│       Server stores hash in Room.PasswordHash               │
│                                                             │
│ 加入: Client sends { roomId, name, password: sha256(pwd) }  │
│       Server compares hash → match: join / mismatch: E006   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 阅后即焚流程                                                  │
│                                                             │
│ 创建: Client sends { name, ephemeral: 30 }                  │
│       Server stores in Room.Ephemeral                       │
│       RoomJoined response includes ephemeral: 30            │
│                                                             │
│ 客户端: 收到/发送消息 → setTimeout(removeMsg, ephemeral*1000)│
│         消息下方显示倒计时进度条                               │
│         时间到 → 淡出动画 → 从 messages 数组移除              │
└─────────────────────────────────────────────────────────────┘
```

---

## Design Decisions

### D1. 密码传输 — SHA-256 Hash

**决策：** 客户端发送密码的 SHA-256 hash，服务端存储和比较 hash。

**理由：**
- 防止中间人（如代理服务器日志）看到明文密码
- 服务端不存储明文，即使内存被 dump 也只有 hash
- Web Crypto API 和 Go crypto/sha256 都是标准库，无需新依赖

**客户端 hash 计算：**
```typescript
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
```

**服务端验证：**
```go
import "crypto/sha256"
import "encoding/hex"

func verifyPassword(room *Room, clientHash string) bool {
    if room.PasswordHash == "" {
        return true // 无密码房间，任何人可加入
    }
    return room.PasswordHash == clientHash
}
```

### D2. Room 结构扩展

```go
// room.go
type Room struct {
    ID           string
    PasswordHash string // SHA-256 hash，空字符串表示无密码
    Ephemeral    int    // 阅后即焚秒数，0 表示关闭
    mu           sync.RWMutex
    members      map[string]*Member
}
```

`CreateRoom` 方法签名变更：
```go
func (rm *RoomManager) CreateRoom(roomId string, passwordHash string, ephemeral int) *Room
```

**msgpack 类型注意：** Go 的 msgpack 反序列化将数字解析为 `int64` 或 `uint64`（取决于正负）。从 `map[string]interface{}` 提取 `ephemeral` 时需要处理两种类型：
```go
var ephemeral int
if v, ok := dataMap["ephemeral"].(int64); ok {
    ephemeral = int(v)
} else if v, ok := dataMap["ephemeral"].(uint64); ok {
    ephemeral = int(v)
}
```

### D3. 协议变更

**CreateRoomData 扩展：**
```go
type CreateRoomData struct {
    Name     string `msgpack:"name"`
    Password string `msgpack:"password"` // SHA-256 hash，空字符串=无密码
    Ephemeral int   `msgpack:"ephemeral"` // 0=关闭，>0=秒数
}
```

**JoinRoomData 扩展：**
```go
type JoinRoomData struct {
    RoomID   string `msgpack:"roomId"`
    Name     string `msgpack:"name"`
    Password string `msgpack:"password"` // SHA-256 hash
}
```

**RoomJoinedData 扩展：**
```go
type RoomJoinedData struct {
    RoomID      string       `msgpack:"roomId"`
    Members     []MemberInfo `msgpack:"members"`
    HasPassword bool         `msgpack:"hasPassword"`
    Ephemeral   int          `msgpack:"ephemeral"`
}
```

**新增错误码：**
```go
ErrCodeWrongPassword = "E006"
```

### D4. 分享码格式扩展

当前分享码格式：`roomId:base64(roomKey)`

新格式（向后兼容）：`roomId:base64(roomKey):ephemeral`
- 如果 ephemeral=0，省略第三段（与旧格式相同）
- 解析时：split(':')，如果有第三段则解析为 ephemeral 秒数

```typescript
// shareKey.ts 修改
export async function encodeShareKey(roomId: string, key: CryptoKey, ephemeral?: number): Promise<string> {
  const keyEncoded = await exportRoomKey(key)
  const base = `${roomId}:${keyEncoded}`
  return ephemeral && ephemeral > 0 ? `${base}:${ephemeral}` : base
}

export function decodeShareKey(code: string): { roomId: string; keyEncoded: string; ephemeral: number } | null {
  const parts = code.split(':')
  if (parts.length < 2) return null
  return {
    roomId: parts[0],
    keyEncoded: parts[1],
    ephemeral: parts.length >= 3 ? parseInt(parts[2], 10) || 0 : 0,
  }
}
```

### D5. 阅后即焚 — 客户端实现

**消息生命周期：**
```typescript
// 在 chatStore 中，消息添加到 messages 数组后
if (ephemeral > 0 && !msg.isSystem) {
  setTimeout(() => {
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== msg.id)
    }))
  }, ephemeral * 1000)
}
```

**倒计时进度条 — CSS animation 方案（GPU 加速）：**
```tsx
function EphemeralTimer({ duration }: { duration: number }) {
  // 纯 CSS 动画，不需要 JS 驱动更新
  return (
    <div className="h-0.5 bg-gray-700 rounded-full mt-1 overflow-hidden">
      <div
        className="h-full bg-amber-500 rounded-full motion-reduce:hidden"
        style={{
          animation: `shrink-bar ${duration}s linear forwards`,
        }}
      />
    </div>
  )
}
```

**tailwind.config.js 新增 keyframes：**
```javascript
'shrink-bar': {
  from: { width: '100%' },
  to: { width: '0%' },
}
```

优势：CSS animation 由浏览器合成器线程执行（GPU 加速），不阻塞主线程，即使有 50 条消息同时倒计时也不会卡顿。

**消失动画：** 消息即将被 setTimeout 移除前 200ms，添加 `opacity-0 max-h-0 transition-all duration-200` class。实现方式：setTimeout 分两步：
1. `setTimeout(addFadeClass, (ephemeral * 1000) - 200)` — 开始淡出
2. `setTimeout(removeFromArray, ephemeral * 1000)` — 从数组移除

选择 200ms 而非 300ms 的理由：对于 10 秒阅后即焚模式，300ms 占比 3% 会让用户感觉"还没看完就开始消失"。200ms 更短促，视觉上更像"瞬间消失"而非"缓慢褪去"。

### D6. Home 页面 UI 扩展

**创建房间区域新增（密码默认隐藏，保持界面简洁）：**
```tsx
{/* 密码设置 — 默认隐藏，点击链接展开 */}
{!showPassword ? (
  <button onClick={() => setShowPassword(true)} className="text-xs text-gray-400 hover:text-indigo-400">
    🔐 设置房间密码（可选）
  </button>
) : (
  <input type="password" placeholder="房间密码（4-20字符）" maxLength={20} ... />
)}

{/* 阅后即焚 */}
<div className="flex items-center gap-2">
  <input type="checkbox" id="ephemeral" ... />
  <label htmlFor="ephemeral" className="text-sm text-gray-300">⏱️ 阅后即焚</label>
  {ephemeralEnabled && (
    <select value={ephemeralTime} onChange={...} className="...">
      <option value="10">10秒</option>
      <option value="30">30秒</option>
      <option value="60">1分钟</option>
      <option value="300">5分钟</option>
    </select>
  )}
</div>
```

**加入房间区域新增：**
```tsx
<input type="password" placeholder="房间密码（如有）" ... />

{/* 阅后即焚提示（解析分享码后显示） */}
{ephemeralHint > 0 && (
  <p className="text-xs text-amber-400">⏱️ 此房间为阅后即焚模式（{ephemeralHint}秒）</p>
)}
```

### D7. ChatRoom Header 图标

```tsx
// 根据房间属性显示不同图标
{hasPassword ? '🔐' : '🔒'}
{ephemeral > 0 && <span title={`消息 ${ephemeral}秒后消失`}>⏱️</span>}
```

### D8. 加入前阅后即焚提示

当用户输入分享码时，前端立即解析分享码。如果包含 ephemeral 信息，在加入按钮旁显示提示：

```tsx
// Home.tsx 中
const parsedCode = shareCode ? decodeShareKey(shareCode.trim()) : null
const ephemeralHint = parsedCode?.ephemeral

{ephemeralHint && ephemeralHint > 0 && (
  <p className="text-xs text-amber-400 flex items-center gap-1">
    ⏱️ 此房间为阅后即焚模式（{ephemeralHint}秒）
  </p>
)}
```

这让用户在加入前就知道房间的特殊模式，避免意外。

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| **后端** | | |
| `internal/room/room.go` | 修改 | Room 新增 PasswordHash + Ephemeral 字段 |
| `internal/room/manager.go` | 修改 | CreateRoom 签名变更 |
| `internal/network/protocol.go` | 修改 | 扩展 CreateRoomData/JoinRoomData/RoomJoinedData + E006 |
| `internal/network/hub.go` | 修改 | handleCreateRoom/handleJoinRoom 添加密码逻辑 |
| **前端** | | |
| `src/network/protocol.ts` | 修改 | 扩展接口 + E006 |
| `src/crypto/shareKey.ts` | 修改 | 分享码格式扩展（ephemeral 段） |
| `src/stores/chatStore.ts` | 修改 | 密码 hash + ephemeral 状态 + 消息自动删除 |
| `src/pages/Home.tsx` | 修改 | 密码输入框 + 阅后即焚选项 |
| `src/pages/ChatRoom.tsx` | 修改 | Header 图标 + ephemeral 倒计时 |
| `src/components/MessageList.tsx` | 修改 | 倒计时进度条 + 消失动画 |
| `src/utils/crypto.ts` | 新建 | hashPassword 工具函数 |

## 不做的事

- 不做密码修改（创建后不可改）
- 不做密码提示/找回
- 不做服务端密码持久化（房间销毁即消失）
- 不做阅后即焚的服务端强制（纯客户端信任模型）
- 不做消息消失前的"保存"功能
- 不做自定义消失时间输入（仅预设 4 个选项）
