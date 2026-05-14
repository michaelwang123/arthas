# Implementation Plan: Phase 5 体验打磨（第一批）

## Overview

实现三个高 ROI 的 UX 改进：连接状态横幅、响应式移动端适配、消息通知。所有改动限于前端，不引入新依赖。

## Tasks

- [x] 1. 连接状态横幅
  - [x] 1.1 在 `tailwind.config.js` 中添加自定义动画
    - 添加 `pulse-banner` keyframes（opacity 1 → 0.7 → 1 循环）
    - 添加 `slide-in-right` keyframes（translateX 100% → 0）
    - 在 `animation` 中注册 `pulse-banner`（2s infinite）和 `slide-in-right`（0.2s）
    - _Requirements: 1.2, 4.4, 4.9_

  - [x] 1.2 创建 `src/components/ConnectionBanner.tsx`
    - 实现四态状态机：grace / hidden / disconnected / reconnected
    - **宽限期逻辑（Req 1.6, 1.7）：**
      - mount 时进入 `grace` 状态
      - 如果 mount 时已 connected，直接进入 `hidden`
      - 1.5s 后如果仍未 connected，进入 `disconnected`
      - 1.5s 内 connected 变为 true，进入 `hidden`（从未显示横幅）
    - **后续状态变化：**
      - connected false→true：进入 `reconnected`，2s 后 `hidden`
      - connected true→false：进入 `disconnected`
      - 快速切换时 clearTimeout 前一个定时器（Req 1.8）
    - **渲染：** 容器始终挂载，使用 `max-h-10`/`max-h-0` + `overflow-hidden` + `transition-all duration-300` 控制可见性
    - 添加 `role="alert"` + `aria-live="polite"`
    - disconnected：`bg-amber-600` + `animate-pulse-banner motion-reduce:animate-none`
    - reconnected：`bg-green-600` + "✓ 已重连"
    - 过渡动画在 reduced-motion 下缩短为 `duration-100`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 4.5, 4.7, 4.10_

  - [x] 1.3 在 `ChatRoom.tsx` 中集成 `ConnectionBanner`
    - 在 flex 容器最顶部（header 之前）渲染 `<ConnectionBanner />`
    - 容器使用 `shrink-0` 防止被 flex 压缩
    - _Requirements: 1.4, 1.5_

- [x] 2. 响应式/移动端适配
  - [x] 2.1 创建 `src/components/MemberDrawer.tsx`
    - Props: `open`, `onClose`, `members`, `triggerRef`
    - 遮罩层：`fixed inset-0 bg-black/50 z-40`，点击关闭，`aria-hidden="true"`
    - 面板：`fixed top-0 right-0 h-full w-64 bg-gray-800 z-50 animate-slide-in-right motion-reduce:animate-none`
    - 关闭按钮：`aria-label="关闭成员列表"`，ref 用于初始聚焦
    - 容器：`role="dialog"` + `aria-modal="true"` + `aria-label="成员列表"`
    - **焦点陷阱（Tab 循环）：**
      - 实现 `useFocusTrap(containerRef, active)` hook
      - 获取所有 focusable 元素，Tab 在末尾循环到首部，Shift+Tab 在首部循环到末尾
    - **Escape 关闭：** keydown 监听器
    - **Body scroll lock：** 打开时 `overflow: hidden`，关闭时恢复原值
    - **焦点回归：** 关闭时 `triggerRef.current?.focus()`
    - 内部复用 `MemberList` 组件
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 4.5, 4.6_

  - [x] 2.2 修改 `ChatRoom.tsx` 实现移动端适配（⚠️ ChatRoom 第一次修改）
    - 添加 `const [drawerOpen, setDrawerOpen] = useState(false)`
    - 添加 `const memberBtnRef = useRef<HTMLButtonElement>(null)`
    - Header 中添加成员按钮（`md:hidden`）：`👥 {members.length}`，绑定 memberBtnRef
    - 将外层 `h-screen` 改为 `h-screen supports-[height:100dvh]:h-[100dvh]`
    - 底部渲染 `<MemberDrawer open={drawerOpen} onClose={...} members={members} triggerRef={memberBtnRef} />`
    - Header 房间 ID：`truncate max-w-[120px] sm:max-w-none`
    - _Requirements: 2.1, 2.2, 2.7, 2.9, 4.8_

  - [x] 2.3 优化触摸区域
    - Header 所有按钮：`min-h-[44px] min-w-[44px]` + 适当 padding
    - MessageInput 发送按钮：确保 44px 最小触摸区域
    - _Requirements: 2.8_

  - [x] 2.4 修改 `src/components/ShareKey.tsx` 移动端紧凑布局
    - 移动端（< md）：隐藏分享码文本，仅显示"📋 复制分享码"按钮
    - 桌面端（≥ md）：保持现有布局
    - 复制成功后短暂显示"已复制" toast（2s 后消失）
    - 按钮确保 44px 触摸区域
    - _Requirements: 2.10, 2.8_

- [x] 3. 消息通知
  - [x] 3.1 创建 `src/utils/notification.ts`
    - `initAudio()`: 创建 AudioContext（幂等，多次调用安全）
    - `playNotificationSound()`: 660Hz 正弦波，80ms，音量 0.15，指数淡出。suspended 时先 resume 再播放
    - `requestNotificationPermission()`: 仅在 `permission === 'default'` 时请求
    - `showDesktopNotification(senderName)`: 仅在 `document.hidden` + `permission === 'granted'` 时显示，`tag: 'arthas-msg'` 合并同类
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.8, 4.2_

  - [x] 3.2 修改 `chatStore.ts` 添加静音状态和通知触发
    - 添加 `muted: boolean`，初始值 `localStorage.getItem('arthas_muted') === 'true'`
    - 添加 `toggleMute()`: 切换 muted + 写入 localStorage
    - 在 `MSG_RELAY_MESSAGE` 解密成功后：
      - `if (!muted)` → `playNotificationSound()`
      - `if (document.hidden)` → `showDesktopNotification(senderName)`（不受 muted 控制）
    - _Requirements: 3.1, 3.2, 3.3, 3.7_

  - [x] 3.3 在 `ChatRoom.tsx` 中添加通知初始化和静音按钮（⚠️ ChatRoom 第三次修改）
    - 添加 `useEffect` + 一次性 click/keydown handler 调用 `initAudio()` + `requestNotificationPermission()`
    - Header 中添加静音按钮：🔔/🔕 切换，`aria-label="切换静音"`
    - 按钮确保 44px 触摸区域
    - _Requirements: 3.2, 3.6, 3.8, 4.6_

- [ ] 4. 集成验证
  - [ ] 4.1 验证桌面端布局
    - ≥ 768px 侧边栏正常显示
    - 横幅展开/收起平滑无跳动
    - 静音按钮位置合理
    - `npm run build` 无编译错误
    - _Requirements: 4.3, 4.10_

  - [ ] 4.2 验证移动端体验
    - Chrome DevTools 模拟 iPhone 14 (390×844)
    - 成员抽屉滑入/滑出正常
    - Tab 键在抽屉内循环（不跳出）
    - Escape 关闭抽屉
    - 抽屉打开时背景不可滚动
    - 虚拟键盘弹出时输入框可见
    - 所有按钮触摸区域 ≥ 44px
    - 分享码区域仅显示复制按钮
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8, 2.10_

  - [ ] 4.3 验证通知功能
    - 静音切换 + localStorage 持久化（刷新后保持）
    - 切换标签页后收到桌面通知
    - 静音时无声音但仍有桌面通知
    - 自己发送的消息不触发任何通知
    - 首次点击后 AudioContext 初始化（console 无警告）
    - _Requirements: 3.1, 3.2, 3.3, 3.7, 3.8_

  - [ ] 4.4 验证无障碍和动画
    - 连接横幅有 `role="alert"` + `aria-live="polite"`
    - 抽屉有 `role="dialog"` + `aria-modal="true"`
    - 所有按钮有 aria-label
    - 开启 `prefers-reduced-motion: reduce` 后动画禁用
    - 横幅过渡在 reduced-motion 下缩短但仍有功能性过渡
    - _Requirements: 4.5, 4.6, 4.7_

  - [ ] 4.5 验证首次加载体验
    - 快速网络：页面加载后不闪烁黄色横幅（宽限期生效）
    - 慢速网络（DevTools throttle Slow 3G）：1.5s 后显示横幅，连接后平滑收起
    - _Requirements: 1.6, 1.7_

## Notes

- 所有改动限于 `arthas-client/src/` 和 `tailwind.config.js`
- 不引入新的 npm 依赖
- 动画定义在 `tailwind.config.js`（不在 index.css 中添加自定义 CSS）
- 音效使用 Web Audio API 合成（660Hz, 80ms, 音量 0.15）
- 移动端适配使用 Tailwind 响应式前缀（`md:` = 768px）
- dvh fallback：`h-screen supports-[height:100dvh]:h-[100dvh]`（需 Tailwind ≥ 3.4）
- 桌面通知不受静音控制（静音 = 仅静音声音）
- 多标签页各自独立（V1 不做跨标签页去重）
- 宽限期 1.5s 仅影响首次加载，后续断线立即显示横幅

## ChatRoom.tsx 修改顺序

三个任务都修改 `ChatRoom.tsx`，按以下顺序串行执行避免冲突：

1. **Task 2.2**（结构性改动最大：dvh、drawer state、member button）
2. **Task 1.3**（顶部添加 ConnectionBanner）
3. **Task 3.3**（Header 添加静音按钮 + useEffect 初始化）

## Task Dependency Graph

```
Task 1.1 (tailwind) ──→ Task 1.2 (Banner) ──→ Task 1.3 (集成 ChatRoom ②)
                                                         │
Task 2.1 (Drawer) ──→ Task 2.2 (ChatRoom ①) ──→ Task 2.3 ──→ Task 2.4
                                                         │
Task 3.1 (notification.ts) ──→ Task 3.2 (store) ──→ Task 3.3 (ChatRoom ③)
                                                         │
                                                         ▼
                                                Task 4 (集成验证)
```

**并行策略：**
- Wave 1（并行）：Task 1.1 + Task 2.1 + Task 3.1
- Wave 2（并行）：Task 1.2 + Task 2.2（ChatRoom ①）+ Task 3.2
- Wave 3（串行）：Task 2.3 → Task 2.4
- Wave 4（串行）：Task 1.3（ChatRoom ②）→ Task 3.3（ChatRoom ③）
- Wave 5：Task 4（验证）
