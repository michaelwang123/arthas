# Requirements: Phase 5 体验打磨（第二批）

## Overview

继续提升 Arthas 的日常可用性。聚焦四个功能：PWA 可安装、Emoji 选择器、链接自动识别、消息复制。以及三个 P2 体验增强。

**Done when：** 手机上体验流畅，有"想用"的感觉。

## Functional Requirements

### 1. PWA 支持

- 1.1 添加 `manifest.json`，包含应用名称、图标、主题色、启动 URL
- 1.2 应用图标提供 192x192 和 512x512 两种尺寸（PNG）
- 1.3 `theme_color` 和 `background_color` 与暗色主题一致（#111827）
- 1.4 `display: "standalone"` 实现全屏体验
- 1.5 添加 Service Worker，拦截离线导航请求时显示友好的"离线提示页"
- 1.6 Service Worker 仅拦截 `navigate` 类型请求，不拦截 API/WebSocket/静态资源
- 1.7 `index.html` 中添加 `<link rel="manifest">` 和 `<meta name="theme-color">`
- 1.8 iOS Safari 支持：添加 `apple-touch-icon` 和 `apple-mobile-web-app-capable` meta 标签
- 1.9 安装后从手机桌面启动时，体验与原生 App 一致（无浏览器 UI）
- 1.10 Service Worker 使用 `skipWaiting()` + `clients.claim()` 确保新版本立即生效

### 2. Emoji 选择器

- 2.1 在消息输入框旁提供 emoji 按钮（😊 图标）
- 2.2 点击按钮弹出 emoji 选择面板（再次点击关闭）
- 2.3 面板包含常用 emoji 分类（表情、手势、心形、动物、食物、活动、旅行、物品、符号）
- 2.4 点击 emoji 后插入到输入框当前光标位置，光标移到 emoji 之后
- 2.5 插入后面板不自动关闭（允许连续选择多个 emoji）
- 2.6 点击面板外部时关闭面板（但点击 emoji 按钮本身视为 toggle，不触发"外部点击"）
- 2.7 面板在移动端底部全宽弹出，在桌面端向上弹出
- 2.8 支持最近使用的 emoji（最多 16 个，存储在 localStorage）
- 2.9 光标位置恢复必须在 React 重新渲染后执行（避免 setState 异步导致光标丢失）

### 3. 链接自动识别

- 3.1 消息文本中的 URL（http/https 开头）自动渲染为可点击链接
- 3.2 链接使用 `target="_blank"` + `rel="noopener noreferrer"` 在新标签页打开
- 3.3 链接样式：蓝色下划线，与普通文本区分
- 3.4 仅识别 http:// 和 https:// 开头的 URL（不识别裸域名如 example.com）
- 3.5 URL 正则不贪婪匹配，遇到空格、换行、中文标点时截断
- 3.6 链接文本过长时截断显示（最多 50 字符 + "..."），完整 URL 通过 title 属性可见
- 3.7 自己发送的消息和他人消息都应用链接识别
- 3.8 URL 匹配后去除尾部标点符号（如 `.` `,` `;` `:` `!` `?` `)` `]`），避免误包含
- 3.9 包含平衡括号的 URL 应完整保留（如 `https://en.wikipedia.org/wiki/Foo_(bar)` 不应在 `)` 处截断）

### 4. 复制消息

- 4.1 桌面端：鼠标悬停消息气泡时显示"复制"图标按钮（hover 时淡入）
- 4.2 移动端：依赖浏览器原生长按复制行为（不实现自定义长按，避免与原生交互冲突）
- 4.3 点击复制按钮后，将消息纯文本内容写入剪贴板
- 4.4 复制成功后短暂显示"已复制"提示（2 秒后消失）
- 4.5 系统消息不可复制
- 4.6 解密失败的消息不可复制

### 5. 消息时间分组（P2）

- 5.1 相邻消息时间间隔超过 5 分钟时，插入时间分隔线
- 5.2 分隔线格式：当天显示"HH:mm"，非当天显示"MM-DD HH:mm"
- 5.3 分隔线样式：居中灰色文字 + 两侧横线

### 6. 发送消息动画（P2）

- 6.1 自己发送的消息出现时有轻微的滑入动画（从右侧淡入）
- 6.2 仅新增的消息有动画，历史消息（已渲染的）不重新动画
- 6.3 动画持续 200ms，不影响滚动行为
- 6.4 尊重 prefers-reduced-motion

### 7. 加入/离开音效（P2）

- 7.1 成员加入房间时播放短促上升音调
- 7.2 成员离开房间时播放短促下降音调
- 7.3 音效受静音按钮控制
- 7.4 使用 Web Audio API 合成（不引入音频文件）

## Non-Functional Requirements

- 8.1 不引入新的 npm 依赖（emoji 数据内联，PWA 手写 Service Worker）
- 8.2 所有新增 UI 使用 Tailwind CSS 暗色主题
- 8.3 PWA 离线页面极简（纯 HTML + 内联 CSS，不依赖构建产物）
- 8.4 Emoji 数据量控制在 < 20KB（精选常用 emoji，非完整 Unicode 列表）
- 8.5 链接识别使用纯正则，不引入 URL 解析库
- 8.6 所有交互元素有 aria-label
- 8.7 动画尊重 prefers-reduced-motion
- 8.8 Service Worker 注册失败时静默降级（不影响核心功能）
- 8.9 消息气泡文本保持可选中（不添加 user-select: none），确保移动端原生复制可用
- 8.10 Emoji 网格渲染高效：每个 emoji 为最小化 DOM（单个 button + 文本节点），无复杂子元素

## Constraints

- 仅修改 `arthas-client/` 目录
- 不修改后端代码
- 不引入新的 npm 依赖
- PWA 图标可使用简单占位图标（后续替换设计稿）
- 需要 Tailwind CSS ≥ 3.4
- Clipboard API 需要 HTTPS 或 localhost（生产环境 Vercel 已满足）
