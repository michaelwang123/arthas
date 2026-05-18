# Design: 国际化 (i18n)

## Architecture Overview

```
src/i18n/
├── index.ts              # 导出 useTranslation hook + translate 函数（公共 API）
├── store.ts              # Zustand store（当前语言 + 切换逻辑 + 副作用）
├── translate.ts          # 纯翻译函数（插值 + fallback）
├── types.ts              # TranslationKey / Locale / TranslationParams 类型
├── locales/
│   ├── index.ts          # Barrel 文件：导入 JSON + 编译时完整性检查
│   ├── zh.json           # 中文翻译（基准文件，类型来源）
│   ├── en.json           # 英文翻译
│   └── ja.json           # 日文翻译
└── components/
    └── LanguageSwitcher.tsx  # 语言切换 UI 组件
```

## Design Decisions

### 1. 为什么不用 i18next / react-intl？

📚 学习要点: 依赖选择的权衡

| 方案 | 优点 | 缺点 |
|------|------|------|
| i18next (~40KB) | 功能全面、生态成熟 | 违反"不引入新依赖"原则，对 85 个字符串过重 |
| react-intl (~30KB) | ICU 格式、复数支持 | 同上，且 API 较复杂 |
| **自建轻量方案 (~2KB)** | 零依赖、完全可控、学习价值高 | 需自己实现插值，无复数规则 |

选择自建方案：85 个字符串 + 3 种语言 + 简单插值需求，不需要 ICU 复数规则或嵌套翻译。自建方案代码量极小（~100 行），且作为学习项目更有教育价值。

### 2. 状态管理：Zustand store

```typescript
// src/i18n/store.ts
interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}
```

📚 学习要点: 为什么用 Zustand 而非 React Context？

- 项目已使用 Zustand（chatStore），保持一致性
- Zustand 的 selector 机制避免不必要的重渲染
- 可在 React 组件外访问（如 chatStore 中生成系统消息时需要当前 locale）
- 无需 Provider 包裹，减少组件树嵌套

### 3. 翻译函数设计

```typescript
// src/i18n/translate.ts
type TranslationParams = Record<string, string | number>;

/**
 * 📚 学习要点: 翻译函数的 fallback 链
 * 1. 当前 locale 的翻译 → 2. 英文翻译（通用回退）→ 3. 原始 key（开发时易发现遗漏）
 * 为什么回退到英文而非中文？因为英文是国际通用语言，
 * 即使日文翻译缺失，显示英文比显示中文对日文用户更友好。
 */
export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const template = locales[locale][key] ?? locales['en'][key] ?? key;
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k] ?? ''));
}
```

插值语法：`{{name}}` — 简单、直观、与 Mustache/Handlebars 一致。

### 4. 类型安全实现（关键设计）

📚 学习要点: JSON 文件的类型安全

TypeScript 不能在 `.json` 文件中使用 `satisfies` 语法。正确的做法是通过 barrel 文件进行编译时检查：

```typescript
// src/i18n/locales/index.ts
import zh from './zh.json';
import en from './en.json';
import ja from './ja.json';

/**
 * 📚 学习要点: 编译时翻译完整性检查
 * 利用 TypeScript 的类型系统，在编译时（而非运行时）检测翻译缺失。
 * 如果 en.json 或 ja.json 缺少 zh.json 中的任何 key，
 * 下面的类型注解会产生编译错误，CI 会阻止合并。
 *
 * 为什么以 zh.json 为基准？因为中文是原始语言，新功能开发时
 * 先写中文文案，再补充其他语言翻译。
 *
 * 📚 学习要点: 为什么不用 `const _check: Record<Key, string> = en` 模式？
 * 因为 tsconfig 启用了 noUnusedLocals: true，未使用的局部变量会报错。
 * 改为通过类型注解约束 locales 对象的值类型，变量被导出使用，不会触发 TS6133。
 */
export type TranslationKey = keyof typeof zh;
type Translations = Record<TranslationKey, string>;

// 类型注解强制完整性 — 如果 en/ja 缺少任何 key，此处编译报错
const zhTranslations: Translations = zh;
const enTranslations: Translations = en;
const jaTranslations: Translations = ja;

export const locales = {
  zh: zhTranslations,
  en: enTranslations,
  ja: jaTranslations,
};

export type Locale = keyof typeof locales;
```

**前置条件：** tsconfig.json 必须启用 `resolveJsonModule: true`，否则 TypeScript 无法从 JSON 导入中推导 key 类型。

**注意：** 项目 tsconfig 启用了 `noUnusedLocals: true`，因此不能使用 `const _check = ...` 模式（会触发 TS6133）。上述方案通过类型注解 + 导出使用来规避此限制。

### 5. 翻译 Key 命名规范

```
{namespace}.{context}.{descriptor}

示例：
home.title              → "Arthas Chat"
home.subtitle           → "端到端加密 · 临时聊天室"
home.nickname           → "昵称"
home.ephemeral.10s      → "10秒"
home.ephemeral.5min     → "5分钟"
chat.header.room        → "房间"
chat.header.leave       → "离开房间"
chat.input.placeholder  → "输入消息..."
error.E001              → "房间不存在或已关闭"
file.status.sending     → "发送中..."
emoji.category.recent   → "最近"
common.copied           → "已复制"
connection.reconnecting → "连接中断，正在重连..."
```

命名空间划分：
- `home` — 首页（含时间单位标签）
- `chat` — 聊天室
- `share` — 分享码相关
- `error` — 错误消息
- `file` — 文件传输
- `emoji` — Emoji 选择器
- `common` — 通用（如"已复制"、"取消"）
- `connection` — 连接状态
- `member` — 成员列表
- `app` — 应用级（标题、错误边界）

### 6. 语言检测逻辑

```typescript
/**
 * 📚 学习要点: 语言检测的优先级链
 * 为什么 localStorage 优先于浏览器偏好？
 * 因为用户可能在公共电脑上使用（浏览器语言是英文），
 * 但手动切换到中文后，期望下次打开仍是中文。
 * 用户的显式选择应该覆盖环境推断。
 */
function detectLocale(): Locale {
  // 1. localStorage 缓存（用户手动选择过）
  const saved = localStorage.getItem('arthas-locale');
  if (saved && isValidLocale(saved)) return saved;

  // 2. 浏览器偏好（navigator.languages 比 navigator.language 更精确）
  const browserLangs = navigator.languages ?? [navigator.language];
  for (const lang of browserLangs) {
    const prefix = lang.split('-')[0].toLowerCase();
    if (prefix === 'zh') return 'zh';
    if (prefix === 'ja') return 'ja';
    if (prefix === 'en') return 'en';
  }

  // 3. 默认英文（国际通用回退）
  return 'en';
}
```

### 7. 文档元数据副作用

📚 学习要点: 为什么在 store 中处理 DOM 副作用？

语言切换时需要更新两个 DOM 属性：
- `<html lang="xx">` — 影响屏幕阅读器语音选择、浏览器拼写检查
- `<title>` — 浏览器标签页显示

这些是"全局副作用"，不属于任何单一组件。放在 Zustand store 的 `setLocale` action 中是最自然的位置：

```typescript
setLocale: (locale: Locale) => {
  set({ locale });
  localStorage.setItem('arthas-locale', locale);
  // DOM 副作用
  document.documentElement.lang = locale;
  // 📚 学习要点: 延迟导入避免循环依赖
  // store.ts 在模块加载时创建，此时 translate() 可能尚未就绪。
  // 但 setLocale 是用户触发的 action（运行时调用），此时所有模块已加载完毕。
  // 因此这里直接调用 translate() 是安全的。
  document.title = translate(locale, 'app.title');
},
```

📚 学习要点: 初始化时的 document.title 设置

store 创建时（`detectLocale()` 阶段），translate 函数和 locales 可能尚未完全加载（模块初始化顺序不确定）。解决方案：
- 初始化时仅设置 `document.documentElement.lang`（不依赖 translate）
- `document.title` 在应用首次渲染后由 `useEffect` 设置，或在 `setLocale` action 中设置（此时模块已全部加载）

### 8. 组件集成模式

```tsx
// 使用方式
function MyComponent() {
  const { t } = useTranslation();
  return <button>{t('chat.header.leave')}</button>;
}

// useTranslation hook 实现
export function useTranslation() {
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    [locale]
  );
  return { t, locale, setLocale };
}
```

### 9. Store 中的翻译（非 React 环境）

chatStore 中生成系统消息时需要翻译，但不在 React 组件内：

```typescript
// 直接从 i18n store 获取当前 locale（Zustand 支持组件外访问）
import { useI18nStore } from '../i18n/store';
import { translate } from '../i18n';

// 在 chatStore action 中：
const locale = useI18nStore.getState().locale;
const text = translate(locale, 'system.userJoined', { name });
```

📚 学习要点: Zustand 的 `getState()` 是同步的，不会触发订阅/重渲染。适合在事件处理器和非 React 代码中获取当前状态快照。

### 10. emojiData.ts 迁移方案

📚 学习要点: 静态数据 → locale-aware 数据的模式

当前 emojiData.ts 导出静态数组，分类名是中文字符串：
```typescript
// 当前（硬编码中文）
export const categories = [{ name: '最近', icon: '🕐', emojis: [] }, ...]
```

迁移后改为存储翻译 key，在渲染时解析：
```typescript
// 迁移后（存储 key，类型为 TranslationKey 确保编译时安全）
import type { TranslationKey } from '../i18n';

interface EmojiCategory {
  nameKey: TranslationKey;  // 不是 string — 确保只能使用有效的翻译 key
  icon: string;
  emojis: string[];
}

export const categories: EmojiCategory[] = [
  { nameKey: 'emoji.category.recent', icon: '🕐', emojis: [] },
  // ...
];

// EmojiPicker.tsx 渲染时翻译
const { t } = useTranslation();
// ...
<span>{t(category.nameKey)}</span>
```

为什么不在 emojiData 中直接调用 `t()`？因为 emojiData 是模块级常量（在模块加载时执行），此时 i18n store 可能尚未初始化。将翻译延迟到渲染时（组件内调用 `t()`）确保 locale 已就绪。

### 11. 语言切换 UI

**桌面端布局：**
```
┌─────────────────────────────────────────────┐
│  首页右上角:                                   │
│  [🌐 中] ← 点击展开                           │
│    ┌──────────┐                              │
│    │ ✓ 中文   │                              │
│    │   English │                              │
│    │   日本語  │                              │
│    └──────────┘                              │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  聊天室 header (桌面端):                       │
│  房间 abc123 🔒  [🌐] 🔔 👥 离开              │
│                   ↑ 语言按钮                   │
└─────────────────────────────────────────────┘
```

**移动端布局：**
```
┌─────────────────────────────────────────────┐
│  聊天室 header (移动端):                       │
│  房间 abc123 🔒      🔔 👥2 离开              │
│  （无语言按钮 — 空间不足）                      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  成员抽屉底部:                                 │
│  ┌─────────────────────────────────────┐    │
│  │ 在线成员                              │    │
│  │ • Alice (你)                         │    │
│  │ • Bob                                │    │
│  │                                      │    │
│  │ ─────────────────────────────────── │    │
│  │ 🌐 语言: 中文 ▾                      │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

📚 学习要点: 为什么移动端不放在 header？

ChatRoom header 已有 4 个交互元素（🔒状态 + 🔔静音 + 👥成员 + 离开按钮）。在 375px 宽度的手机上再加一个按钮会导致溢出或触摸目标过小（< 44px）。将低频操作（语言切换）放在成员抽屉底部，既不占用宝贵的 header 空间，又保持可发现性。

### 12. 翻译文件示例

```json
// zh.json (基准 — 约 85 个 key)
{
  "app.title": "Arthas Chat",
  "app.error.title": "出错了",
  "app.error.unknown": "发生了未知错误",
  "app.error.refresh": "刷新页面",

  "home.subtitle": "端到端加密 · 临时聊天室",
  "home.status.connected": "已连接",
  "home.status.disconnected": "未连接",
  "home.nickname": "昵称",
  "home.nickname.placeholder": "输入昵称（1-20 字符）",
  "home.nickname.error": "昵称需要 1-20 个字符",
  "home.password.set": "🔐 设置密码",
  "home.password.placeholder": "房间密码（4-20字符）",
  "home.password.error": "密码需要 4-20 个字符",
  "home.ephemeral": "⏱️ 阅后即焚",
  "home.ephemeral.10s": "10秒",
  "home.ephemeral.30s": "30秒",
  "home.ephemeral.60s": "60秒",
  "home.ephemeral.5min": "5分钟",
  "home.ephemeral.hint": "⏱️ 此房间为阅后即焚模式（{{seconds}}秒）",
  "home.create": "创建房间",
  "home.divider": "或",
  "home.join.label": "加入房间",
  "home.join.placeholder": "输入分享码",
  "home.join.password": "房间密码（如有）",
  "home.join.button": "加入",

  "chat.header.room": "房间",
  "chat.header.leave": "离开房间",
  "chat.mute": "静音",
  "chat.unmute": "取消静音",
  "chat.input.placeholder": "输入消息...",
  "chat.input.replyPlaceholder": "输入回复...",
  "chat.input.send": "发送",

  "connection.reconnecting": "连接中断，正在重连...",
  "connection.reconnected": "✓ 已重连",

  "member.title": "在线成员",
  "member.open": "打开成员列表",
  "member.close": "关闭成员列表",
  "member.drawer.title": "成员列表",
  "member.you": "(你)",

  "share.label": "分享码:",
  "share.generating": "生成中...",
  "share.copy": "复制",
  "share.copyMobile": "📋 复制分享码",
  "share.copied": "已复制",
  "share.copiedMobile": "✓ 已复制",
  "share.copyAriaLabel": "复制分享码",

  "message.reply": "回复",
  "message.cancelReply": "取消回复",
  "message.addReaction": "添加反应",
  "message.copy": "复制消息",
  "message.copied": "已复制",
  "message.jumpTo": "跳转到 {{name}} 的消息",

  "emoji.select": "选择表情",
  "emoji.noRecent": "暂无最近使用",
  "emoji.category.recent": "最近",
  "emoji.category.smileys": "表情",
  "emoji.category.gestures": "手势",
  "emoji.category.hearts": "心形",
  "emoji.category.animals": "动物",
  "emoji.category.food": "食物",
  "emoji.category.activities": "活动",
  "emoji.category.travel": "旅行",
  "emoji.category.symbols": "符号",

  "typing.indicator": "正在输入...",

  "file.loading": "文件信息加载中...",
  "file.cancel": "取消文件传输",
  "file.download": "下载文件",
  "file.clickDownload": "点击下载",
  "file.clickDownloadImage": "点击下载完整图片",
  "file.status.pending.send": "等待发送...",
  "file.status.pending.receive": "准备接收...",
  "file.status.sending": "发送中...",
  "file.status.receiving": "接收中...",
  "file.status.complete": "传输完成",
  "file.status.failed": "传输失败",
  "file.status.cancelled": "已取消",
  "file.status.senderCancelled": "发送方已取消",
  "file.delivered": "已送达 {{count}}/{{total}}",
  "file.attach": "添加附件",
  "file.send": "发送文件",
  "file.drop.title": "拖放文件到此处上传",
  "file.drop.subtitle": "支持所有文件类型，单文件最大 5MB",

  "system.userJoined": "{{name}} 加入了房间",
  "system.userLeft": "{{name}} 离开了房间",
  "system.roomClosed": "房间已关闭",
  "system.decryptFailed": "无法解密此消息",
  "system.invalidShareCode": "分享码无效",
  "system.rateLimited": "发送过快，请稍后再试",

  "error.E001": "房间不存在或已关闭",
  "error.E002": "房间已满，无法加入",
  "error.E003": "请先加入房间",
  "error.E004": "发送过快，请稍后再试",
  "error.E005": "消息格式无效",
  "error.E006": "房间密码错误",

  "notification.newMessage": "{{name}} 发来了新消息",

  "language.switch": "切换语言",
  "language.zh": "中文",
  "language.en": "English",
  "language.ja": "日本語"
}
```

```json
// en.json
{
  "app.title": "Arthas Chat",
  "app.error.title": "Something went wrong",
  "app.error.unknown": "An unknown error occurred",
  "app.error.refresh": "Refresh Page",

  "home.subtitle": "End-to-End Encrypted · Ephemeral Chat",
  "home.status.connected": "Connected",
  "home.status.disconnected": "Disconnected",
  "home.nickname": "Nickname",
  "home.nickname.placeholder": "Enter nickname (1-20 chars)",
  "home.nickname.error": "Nickname must be 1-20 characters",
  "home.password.set": "🔐 Set Password",
  "home.password.placeholder": "Room password (4-20 chars)",
  "home.password.error": "Password must be 4-20 characters",
  "home.ephemeral": "⏱️ Ephemeral Mode",
  "home.ephemeral.10s": "10s",
  "home.ephemeral.30s": "30s",
  "home.ephemeral.60s": "60s",
  "home.ephemeral.5min": "5min",
  "home.ephemeral.hint": "⏱️ This room is in ephemeral mode ({{seconds}}s)",
  "home.create": "Create Room",
  "home.divider": "or",
  "home.join.label": "Join Room",
  "home.join.placeholder": "Enter share code",
  "home.join.password": "Room password (if any)",
  "home.join.button": "Join",

  "chat.header.room": "Room",
  "chat.header.leave": "Leave Room",
  "chat.mute": "Mute",
  "chat.unmute": "Unmute",
  "chat.input.placeholder": "Type a message...",
  "chat.input.replyPlaceholder": "Type a reply...",
  "chat.input.send": "Send",

  "connection.reconnecting": "Connection lost, reconnecting...",
  "connection.reconnected": "✓ Reconnected",

  "..."
}
```

### 13. Data Flow

```
用户切换语言 → useI18nStore.setLocale('en')
  → localStorage.setItem('arthas-locale', 'en')
  → document.documentElement.lang = 'en'
  → document.title = 'Arthas Chat'
  → Zustand 通知订阅者
  → 所有使用 useTranslation() 的组件重新渲染
  → t('key') 从 en.json 查找翻译
  → UI 更新为英文
```

### 14. Migration Strategy

📚 学习要点: 增量迁移 vs 大爆炸迁移

选择增量迁移（pilot → batch）而非一次性替换所有文件：

1. **Pilot 阶段** — 先迁移 `Home.tsx`（字符串最多，覆盖场景最全）
   - 验证 hook 用法、插值、类型推导是否正常
   - 发现系统性问题的成本最低（只改了 1 个文件）
2. **Batch 阶段** — pilot 验证通过后，批量迁移其余 16 个文件
   - 此时已确认模式正确，可以放心并行迁移
3. **UI 阶段** — 最后添加 LanguageSwitcher 组件

这样每一步都保持应用可运行，且风险可控。
