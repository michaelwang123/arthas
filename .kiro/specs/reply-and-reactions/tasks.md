# Implementation Plan: 消息回复与反应 (Phase 6.3 + 6.5)

## Overview

为 Arthas 添加消息回复（引用）和 emoji 反应功能。涉及前后端协议扩展、加密载荷格式变更、稳定消息 ID、UI 组件新增。

## Tasks

- [x] 1. 协议扩展 + 稳定 ID
  - [x] 1.1 修改 `arthas-server/internal/network/protocol.go`
    - 新增 `MsgSendReaction uint8 = 0x07`
    - 新增 `MsgRelayReaction uint8 = 0x19`
    - 新增 `RelayReactionData` 结构体（SenderID, SenderName, IV, Ciphertext, T）
    - _Requirements: 3.1, 3.2_

  - [x] 1.2 修改 `arthas-server/internal/network/hub.go`
    - `HandleMessage` switch 新增 `case MsgSendReaction`
    - 实现 `handleSendReaction`：验证房间 → 解析 iv/ciphertext → 构建 RelayReactionData → 广播
    - 不调用 IsRateLimited（反应不计入频率限制）
    - _Requirements: 3.5_

  - [x] 1.3 修改 `arthas-client/src/network/protocol.ts`
    - 新增 `MSG_SEND_REACTION = 0x07`
    - 新增 `MSG_RELAY_REACTION = 0x19`
    - 新增 `RelayReactionData` 接口
    - _Requirements: 3.1, 3.2_

  - [x] 1.4 扩展 `ChatMessage` 类型添加 `stableId`
    - 在 `chatStore.ts` 中 `ChatMessage` 接口添加 `stableId: string`
    - 添加 `makeStableId(senderId, timestamp): string` 工具函数
    - 发送消息时：`stableId = makeStableId(myId, Date.now())`
    - 接收消息时：`stableId = makeStableId(data.senderId, data.t)`
    - 同时更新 `ChatMessage` 接口添加 `reply?: ReplyData`
    - _Requirements: 1.12, 4.8_

- [x] 2. 加密载荷格式
  - [x] 2.1 创建 `src/utils/payload.ts`
    - `ReplyData` 接口：`{ stableId, senderName, preview }`
    - `buildPayload(text, reply?): string` — JSON.stringify 包装
    - `parsePayload(plaintext): { text, reply? }` — 向后兼容解析（try JSON → fallback 纯文本）
    - `truncatePreview(text, maxLen=50): string`
    - _Requirements: 1.6, 4.1_

  - [x] 2.2 修改 `chatStore.ts` 发送逻辑
    - 新增 `replyTo: ReplyData | null` state
    - 新增 `setReplyTo(reply)` 和 `clearReply()` actions
    - `sendMessage` 中：使用 `buildPayload(text, replyTo)` 替代直接加密 text
    - 发送后自动 `clearReply()`
    - 本地乐观渲染的消息包含 `reply` 字段
    - _Requirements: 1.6_

  - [x] 2.3 修改 `chatStore.ts` 接收逻辑
    - `MSG_RELAY_MESSAGE` 解密后使用 `parsePayload(plaintext)` 解析
    - 将 `reply` 字段存入 `ChatMessage`
    - 确保旧格式消息（纯文本）仍正常工作
    - _Requirements: 1.7_

- [x] 3. 反应系统
  - [x] 3.1 扩展 `chatStore.ts` 反应状态和逻辑
    - 新增 `reactions: Map<string, Reaction[]>` state
    - `Reaction` 接口：`{ emoji: string, userIds: string[] }`
    - 新增 `sendReaction(stableId, emoji)` action：
      - 检查用户是否已有反应 → 同 emoji 则 remove，不同则 remove 旧 + add 新，无则 add
      - 加密 `{ stableId, emoji, action }` 并发送 MSG_SEND_REACTION
      - 乐观更新本地 reactions map
    - 新增 `MSG_RELAY_REACTION` handler：解密后更新 reactions map
    - 房间离开/关闭时清空 reactions
    - _Requirements: 2.1, 2.4, 2.6, 2.9, 2.11_

  - [x] 3.2 创建 `src/components/ReactionPanel.tsx`
    - 6 个快速反应：👍 ❤️ 😂 😮 😢 🎉
    - Props: `onReact(emoji)`, `onClose()`, `triggerRef`, `position: 'above'|'below'`
    - 圆角胶囊样式，hover 放大（motion-reduce 禁用）
    - **动态定位：** 根据 position prop 决定 `bottom-full mb-2` 或 `top-full mt-2`
    - **外部点击关闭：** mousedown listener，排除 panelRef 和 triggerRef
    - `role="menu"` + `aria-label="添加反应"`
    - _Requirements: 2.2, 2.3, 2.13, 2.14, 4.6, 4.7_

- [ ] 4. 回复 + 反应 UI
  - [ ] 4.1 修改 `src/components/MessageInput.tsx`
    - 从 store 读取 `replyTo` 和 `clearReply`
    - 输入框上方条件渲染回复预览条
    - 预览条：左侧 indigo 边框 + 发送者名 + 摘要 + ✕ 取消按钮
    - 发送后自动清除 replyTo
    - _Requirements: 1.4, 1.5_

  - [ ] 4.2 修改 `src/components/MessageBubble.tsx`
    - 新增 Props: `reply?`, `reactions?`, `stableId`, `onReply()`, `onReact(emoji)`
    - 气泡顶部：引用块渲染（msg.reply 存在时），可点击跳转
    - 气泡下方：ReactionSummary 组件（显示反应汇总，点击切换）
    - 桌面 hover 按钮组：复制 + 回复 + 😊+ 反应
    - 回复按钮点击 → 调用 onReply
    - 反应按钮点击 → 计算 `getReactionPanelPosition(triggerEl)` → 弹出 ReactionPanel
    - 系统消息/解密失败消息不显示回复/反应按钮
    - _Requirements: 1.2, 1.7, 1.8, 1.10, 1.11, 2.2, 2.7, 2.8, 2.10, 2.13_

  - [ ] 4.3 修改 `src/components/MessageList.tsx`
    - 每条消息容器添加 `data-stable-id={msg.stableId}`
    - 实现 `scrollToMessage(stableId)` — querySelector + scrollIntoView + ring 高亮 1.5s
    - 从 store 读取 reactions 并传递给 MessageBubble
    - 传递 `onReply` 回调（调用 store.setReplyTo）
    - 传递 `onReact` 回调（调用 store.sendReaction）
    - _Requirements: 1.8, 1.9_

  - [ ] 4.4 实现移动端滑动回复
    - 在消息 wrapper 上添加 touch 事件（touchstart/touchmove/touchend）
    - 水平右滑 ≥ 60px 触发回复，垂直滑动 > 10px 取消
    - 滑动时 translateX 跟随（最大 80px），松手弹回
    - 左右对齐的消息都向右滑
    - _Requirements: 1.3, 4.5_

  - [ ] 4.5 实现移动端双击反应
    - 消息 wrapper 添加 `[touch-action:manipulation]`（禁用浏览器双击缩放）
    - 双击检测：两次 click 间隔 < 300ms
    - 双击后在消息上方弹出 ReactionPanel
    - _Requirements: 2.5, 2.12_

- [ ] 5. 集成验证
  - [ ] 5.1 后端验证
    - `go build ./...` 无错误
    - `go test ./internal/network/... -v` 通过
    - 手动测试：发送反应后其他客户端收到 MsgRelayReaction
    - _Requirements: 3.1-3.5_

  - [ ] 5.2 前端验证
    - `npm run build` 无错误
    - 发送带引用的消息 → 接收方正确显示引用块
    - 点击引用块 → 滚动到原消息 + 高亮
    - 发送反应 → 其他成员看到反应汇总
    - 再次点击同一 emoji → 取消反应
    - 点击不同 emoji → 替换旧反应
    - 旧格式消息（纯文本）仍正常显示（向后兼容）
    - 反应面板在屏幕底部消息上方弹出（动态定位）
    - 反应面板点击外部正确关闭
    - _Requirements: 1.1-1.12, 2.1-2.14_

  - [ ] 5.3 移动端验证
    - 滑动回复手势正常（右滑 60px 触发）
    - 垂直滑动不触发回复（正常滚动）
    - 双击弹出反应面板
    - 双击不触发浏览器缩放
    - _Requirements: 1.3, 2.5, 2.12, 4.5_

## Notes

- 后端改动极小：~50 行 Go 代码（新增一个消息类型 + handler）
- 稳定 ID 使用 `senderId:timestamp` 模式，不需要后端改动
- stableId 精度：Firefox 降至 1ms（Spectre 缓解），对本方案无影响（同用户 1ms 内发两条消息物理不可能）
- 加密载荷格式向后兼容：旧客户端收到新格式仍能正常显示文本
- 反应不计入消息频率限制
- 反应状态仅存在于客户端内存（阅后即焚）
- 一人一反应：切换 emoji 时自动 remove 旧 + add 新
- `touch-action: manipulation` 需要用 Tailwind arbitrary value `[touch-action:manipulation]`
- 引用摘要最多 50 字符
- 反应面板动态定位：getBoundingClientRect 判断上方空间是否足够
- 反应面板外部点击关闭：复用 EmojiPicker 的 excludeRef 模式
- 未来增强（V2）：反应添加时 bounce-in 动画

## Task Dependency Graph

```
Task 1.1 (server proto) ──→ Task 1.2 (server handler) ─────────────────┐
Task 1.3 (client proto) ──→ Task 1.4 (stableId) ──→ Task 2.1 (payload) │
                                                          │              │
                                              Task 2.2 (send) ──────────┤
                                              Task 2.3 (receive) ───────┤
                                                                         │
Task 3.1 (store reactions) ──→ Task 3.2 (ReactionPanel) ────────────────┤
                                                                         │
Task 4.1 (Input reply bar) ─────────────────────────────────────────────┤──→ Task 5
Task 4.2 (Bubble UI) ──────────────────────────────────────────────────┤
Task 4.3 (List scroll) ────────────────────────────────────────────────┤
Task 4.4 (swipe) ──────────────────────────────────────────────────────┤
Task 4.5 (double-tap) ─────────────────────────────────────────────────┘
```

**执行顺序：**
1. Wave 1（并行）：Task 1.1 + 1.3（协议定义，前后端独立）
2. Wave 2（并行）：Task 1.2 + 1.4 + 2.1（handler + stableId + payload 工具）
3. Wave 3（并行）：Task 2.2 + 2.3 + 3.1（store 逻辑）
4. Wave 4（并行）：Task 3.2 + 4.1 + 4.2 + 4.3（UI 组件）
5. Wave 5：Task 4.4 + 4.5（移动端手势）
6. Wave 6：Task 5（验证）
