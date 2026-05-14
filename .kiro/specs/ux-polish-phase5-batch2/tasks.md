# Implementation Plan: Phase 5 体验打磨（第二批）

## Overview

实现 PWA 可安装、Emoji 选择器、链接自动识别、消息复制，以及 P2 级别的时间分组、发送动画、加入/离开音效。所有改动限于前端，不引入新依赖。

## Tasks

- [x] 1. PWA 支持
  - [x] 1.1 创建 PWA 静态资源
    - `public/manifest.json`：name="Arthas Chat", short_name="Arthas", display="standalone", theme_color="#111827", start_url="/"
    - `public/offline.html`：纯 HTML + 内联 CSS 暗色主题离线提示页（📡 图标 + "网络连接已断开" + 刷新按钮）
    - `public/icon-192.png` 和 `public/icon-512.png`：暗色背景 + 🔒 图标占位
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.3_

  - [x] 1.2 创建 `public/sw.js`
    - install：缓存 offline.html 到 `arthas-offline-v1`，调用 `skipWaiting()`
    - activate：清理旧版本 cache，调用 `clients.claim()`
    - fetch：仅拦截 `event.request.mode === 'navigate'`，network-first，失败返回 cached offline.html
    - _Requirements: 1.5, 1.6, 1.10, 8.8_

  - [x] 1.3 修改 `index.html`
    - `<link rel="manifest" href="/manifest.json">`
    - `<meta name="theme-color" content="#111827">`
    - `<meta name="apple-mobile-web-app-capable" content="yes">`
    - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
    - `<link rel="apple-touch-icon" href="/icon-192.png">`
    - _Requirements: 1.7, 1.8_

  - [x] 1.4 修改 `src/main.tsx` 注册 Service Worker
    - 在 `createRoot().render()` 之后
    - `navigator.serviceWorker.register('/sw.js').catch(() => {})`
    - _Requirements: 1.9, 8.8_

- [x] 2. Emoji 选择器
  - [x] 2.1 创建 `src/utils/emojiData.ts`
    - `EmojiCategory` 接口 + 8 个分类（~200 个 emoji）
    - `getRecentEmojis()` / `addRecentEmoji(emoji)` — localStorage 持久化，最多 16 个
    - _Requirements: 2.3, 2.8, 8.4_

  - [x] 2.2 创建 `src/components/EmojiPicker.tsx`
    - Props: `onSelect(emoji)`, `onClose()`, `excludeRef`（emoji 按钮 ref，排除在外部点击之外）
    - 顶部分类 Tab 栏（横向滚动，每个 tab 显示分类 icon）
    - 中间 emoji 网格（grid-cols-8，每个 emoji 为最小化 button + 文本节点，无复杂子元素）
    - "最近使用"作为第一个分类（动态填充）
    - 点击 emoji → `onSelect(emoji)` + `addRecentEmoji(emoji)`（不关闭面板）
    - 外部点击关闭：`mousedown` listener，排除 pickerRef 和 excludeRef
    - 定位：移动端 `fixed bottom-0 inset-x-0 z-30`，桌面端 `absolute bottom-full mb-2`
    - `role="dialog"` + `aria-label="选择表情"`
    - 性能：每个 emoji 为 `<button class="w-8 h-8 text-xl hover:bg-gray-700 rounded">{emoji}</button>`，无 img/svg/tooltip
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 8.6, 8.10_

  - [x] 2.3 修改 `src/components/MessageInput.tsx`
    - 添加 `inputRef` 绑定到 `<input>`
    - 添加 `cursorPosRef` 用于光标恢复
    - 添加 `useEffect([text])` 恢复光标位置
    - 添加 `emojiOpen` state + `emojiBtnRef`
    - 输入框左侧添加 emoji 按钮（😊，44px 触摸区域）
    - 按钮 onClick toggle `emojiOpen`
    - 渲染 `<EmojiPicker>` 当 emojiOpen 为 true
    - `insertEmoji(emoji)` 函数：光标位置插入 + 设置 cursorPosRef
    - _Requirements: 2.1, 2.4, 2.6, 2.9_

- [x] 3. 链接识别 + 复制 + 时间分组
  - [x] 3.1 创建 `src/utils/linkify.ts`
    - URL 正则：`/https?:\/\/[^\s<>"\u3000-\u303F\uFF00-\uFFEF]+/g`
    - 处理顺序（重要）：先 `balanceParentheses()` → 再剥离尾部标点
    - 括号平衡：剥离多余的尾部 `)` 和 `]` 直到与 `(` `[` 数量平衡
    - 尾部标点剥离：`/[.,;:!?>'"。，；：！？】》]+$/`（不含 `)` `]`，已由括号平衡处理）
    - `linkify(text): TextSegment[]` — 拆分为 text/link 片段
    - `truncateUrl(url, maxLen=50): string` — 超长 URL 截断 + "…"
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.8, 3.9, 8.5_

  - [x] 3.2 创建 `src/components/MessageBubble.tsx`
    - Props: `text`, `isOwn`, `canCopy`, `isDecryptFailed`
    - 内部 `<RichText>` 组件：使用 linkify 渲染链接（蓝色下划线，target=_blank）
    - 桌面复制按钮：`hidden md:flex`，`opacity-0 group-hover:opacity-100`
    - 复制使用 `navigator.clipboard.writeText(text)`
    - "已复制" toast（2s 后消失）
    - 解密失败：红色斜体，canCopy=false
    - 不添加 user-select:none（保持移动端原生复制可用）
    - _Requirements: 3.1, 3.2, 3.3, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 8.9_

  - [x] 3.3 修改 `src/components/MessageList.tsx`
    - 将消息气泡内容替换为 `<MessageBubble>` 组件
    - 添加时间分组：`shouldShowTimeSeparator(prev, curr)` — 间隔 > 5 分钟
    - 分隔线：居中文字 + 两侧 `h-px bg-gray-700`
    - 格式：当天 "HH:mm"，非当天 "MM-DD HH:mm"
    - 系统消息传 `canCopy={false}`
    - _Requirements: 3.7, 5.1, 5.2, 5.3_

- [x] 4. 发送动画 + 加入/离开音效
  - [x] 4.1 在 `tailwind.config.js` 添加 `slide-in-msg` 动画
    - keyframes: `{ from: { opacity: 0, transform: 'translateX(8px)' }, to: { opacity: 1, transform: 'translateX(0)' } }`
    - animation: `'slide-in-msg 0.2s ease-out'`
    - _Requirements: 6.1, 6.3, 6.4_

  - [x] 4.2 在 `MessageList.tsx` 中为新增的自己的消息添加动画
    - 使用 `prevCountRef = useRef(messages.length)` 追踪消息数量变化
    - `isNewBatch = messages.length > prevCountRef.current`
    - 仅最后一条 + isMine + isNewBatch 时添加 `animate-slide-in-msg motion-reduce:animate-none`
    - `useEffect([messages.length])` 更新 prevCountRef
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.7_

  - [x] 4.3 修改 `src/utils/notification.ts` 添加 join/leave 音效
    - `playJoinSound()`: 上升音调 660→830Hz, 120ms, 音量 0.1
    - `playLeaveSound()`: 下降音调 830→660Hz, 120ms, 音量 0.1
    - _Requirements: 7.1, 7.2, 7.4_

  - [x] 4.4 修改 `chatStore.ts` 在 member join/leave 时播放音效
    - `MSG_MEMBER_JOINED` handler：`if (!get().muted) playJoinSound()`
    - `MSG_MEMBER_LEFT` handler：`if (!get().muted) playLeaveSound()`
    - _Requirements: 7.3_

- [x] 5. 集成验证
  - [x] 5.1 验证 PWA
    - Chrome DevTools → Application → Manifest 无错误
    - 断网后刷新显示 offline.html
    - Android Chrome 显示"添加到主屏幕"提示
    - 从桌面图标启动无浏览器 UI
    - _Requirements: 1.1-1.10_

  - [x] 5.2 验证 Emoji
    - 面板正常弹出/关闭（按钮 toggle + 外部点击关闭）
    - 选择 emoji 插入到光标位置（光标在中间时也正确）
    - 连续选择多个 emoji 面板不关闭
    - 最近使用 emoji 持久化（刷新后保留）
    - 移动端面板底部全宽显示
    - _Requirements: 2.1-2.9_

  - [x] 5.3 验证链接 + 复制
    - "https://example.com" 变为可点击蓝色链接
    - "看看 https://example.com。" 不包含尾部句号
    - "https://en.wikipedia.org/wiki/Foo_(bar)" 完整保留（括号平衡）
    - "https://example.com)" 剥离尾部多余括号
    - 超长 URL 截断显示，hover 显示完整 URL（title 属性）
    - 桌面 hover 消息显示复制按钮
    - 点击复制后显示"已复制"
    - 移动端可通过原生长按复制文本
    - _Requirements: 3.1-3.9, 4.1-4.6, 8.9_

  - [x] 5.4 验证时间分组 + 动画 + 音效
    - 间隔 > 5 分钟的消息之间有时间分隔线
    - 发送消息有轻微滑入动画（历史消息无动画）
    - 成员加入/离开有不同音调
    - 静音时所有音效不播放
    - prefers-reduced-motion 时动画禁用
    - _Requirements: 5.1-5.3, 6.1-6.4, 7.1-7.4, 8.7_

  - [x] 5.5 构建验证
    - `npm run build` 无错误
    - 构建产物中 emojiData 贡献 < 20KB gzip
    - public/ 下的 PWA 文件正确复制到 dist/
    - _Requirements: 8.1, 8.4_

## Notes

- 所有改动限于 `arthas-client/` 目录
- 不引入新的 npm 依赖
- Emoji 数据精选 ~200 个（8 分类），控制在 < 20KB
- Emoji 每个为最小化 DOM（button + 文本节点），200 个对现代设备无性能问题
- Service Worker 极简：仅离线导航回退，不缓存应用资源
- SW 更新无需额外通知：network-first 策略 + skipWaiting 确保用户始终获取最新代码
- 链接识别包含尾部标点剥离 + 括号平衡（处理 Wikipedia 风格 URL）
- 移动端复制依赖浏览器原生行为（不自定义 long-press）
- 消息文本保持 user-select 可用
- PWA 图标先用占位，后续替换设计稿
- 发送动画仅对新增的自己的消息生效（prevCountRef 检测）
- 如果未来 emoji 扩展到 3000+，需引入虚拟滚动（当前 200 个不需要）

## Task Dependency Graph

```
Task 1.1 (PWA assets) → 1.2 (SW) → 1.3 (html) → 1.4 (register) ──┐
                                                                     │
Task 2.1 (emojiData) → Task 2.2 (Picker) → Task 2.3 (Input) ──────┤
                                                                     │
Task 3.1 (linkify) → Task 3.2 (Bubble) → Task 3.3 (List) ─────────┼──→ Task 5 (验证)
                                                                     │
Task 4.1 (tailwind) → Task 4.2 (animation in List) ────────────────┤
Task 4.3 (sounds) → Task 4.4 (store) ──────────────────────────────┘
```

**并行策略：**
- Wave 1（并行）：Task 1.1 + 2.1 + 3.1 + 4.1 + 4.3
- Wave 2（并行）：Task 1.2 + 1.3 + 2.2 + 3.2
- Wave 3（串行，修改共享文件）：Task 1.4 → 2.3 → 3.3 + 4.2 → 4.4
- Wave 4：Task 5（验证）

**MessageList.tsx 修改顺序：**
Task 3.3（结构性改动：MessageBubble + 时间分组）先于 Task 4.2（添加动画 class）。
