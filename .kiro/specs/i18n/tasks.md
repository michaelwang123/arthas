# Implementation Plan: 国际化 (i18n)

## Overview

为 Arthas 前端添加中/英/日三语支持。采用自建轻量方案（Zustand store + React Hook + JSON 翻译文件），约 85 个可翻译字符串分布在 17 个文件中。实现顺序：基础设施 → 翻译文件 → pilot 验证 → 批量迁移 → UI 组件 → 验证。

## Tasks

- [x] 1. i18n 基础设施
  - [x] 1.1 Update `tsconfig.json` to enable `resolveJsonModule: true`
    - Add `"resolveJsonModule": true` to compilerOptions
    - Verify `npm run build` still passes after change
    - _Requirements: 2.3 AC4, NFR-6_

  - [x] 1.2 Create i18n Zustand store at `src/i18n/store.ts`
    - Define `Locale` type: `'zh' | 'en' | 'ja'`
    - Implement `detectLocale()` function (localStorage > navigator.languages > default 'en')
    - Store state: `locale`, `setLocale` action
    - `setLocale` side effects: persist to localStorage, update `document.documentElement.lang`, update `document.title` via translate()
    - Initialize locale on store creation via `detectLocale()`; set `document.documentElement.lang` immediately
    - Note: `document.title` update in `setLocale` action is safe (called at runtime when all modules loaded); initial title set via useEffect in App or after locales are available
    - Export `useI18nStore` hook
    - _Requirements: 1.1, 1.2, 1.3, 5.1_

  - [x] 1.3 Create translation engine at `src/i18n/translate.ts`
    - Implement `translate(locale, key, params?)` pure function
    - Support `{{name}}` interpolation syntax
    - Fallback chain: current locale → 'en' → raw key
    - _Requirements: 2.1 AC1_

  - [x] 1.4 Create `useTranslation` hook and barrel file at `src/i18n/index.ts`
    - `useTranslation()` returns `{ t, locale, setLocale }`
    - `t` is memoized via `useCallback` on locale change
    - Re-export all public API: `useTranslation`, `useI18nStore`, `translate`, types
    - _Requirements: 2.1 AC2, AC3_

  - [x] 1.5 Create TypeScript types at `src/i18n/types.ts`
    - Re-export `TranslationKey` and `Locale` from `locales/index.ts` (single source of truth)
    - Define and export `TranslationParams = Record<string, string | number>`
    - Do NOT re-derive TranslationKey here — it's defined in locales/index.ts to avoid duplication
    - _Requirements: 2.3 AC1, AC2_

- [x] 2. 翻译文件
  - [x] 2.1 Create Chinese translation file `src/i18n/locales/zh.json`
    - Extract all ~85 hardcoded Chinese strings from the codebase
    - Organize with namespace keys: app, home, chat, share, error, file, emoji, common, connection, member, system, notification, language
    - Include time unit labels: home.ephemeral.10s/30s/60s/5min
    - This is the baseline/source-of-truth file for type generation
    - _Requirements: 2.2, 3.1_

  - [x] 2.2 Create locale barrel file `src/i18n/locales/index.ts`
    - Import all 3 JSON files
    - Define `type Translations = Record<TranslationKey, string>`
    - Assign each JSON to a typed variable (`const enTranslations: Translations = en`) — this enforces completeness at compile time
    - Export `locales` object (consuming the typed variables, avoiding noUnusedLocals error)
    - Export `TranslationKey` and `Locale` types
    - **Important:** Do NOT use `const _check = ...` pattern — it triggers TS6133 with noUnusedLocals: true
    - _Requirements: 2.3 AC3_

  - [x] 2.3 Create English translation file `src/i18n/locales/en.json`
    - Translate all keys from zh.json to English
    - Must have exactly the same key set as zh.json (enforced by barrel file)
    - _Requirements: 2.2, 1.1 AC2_

  - [x] 2.4 Create Japanese translation file `src/i18n/locales/ja.json`
    - Translate all keys from zh.json to Japanese
    - Must have exactly the same key set as zh.json (enforced by barrel file)
    - _Requirements: 2.2, 1.1 AC3_

- [x] 3. Pilot 迁移（验证基础设施）
  - [x] 3.1 Migrate `src/pages/Home.tsx` to use `t()` calls (PILOT)
    - Replace all ~15 hardcoded Chinese strings with `t('home.*')` calls
    - Import and use `useTranslation` hook
    - Include time unit options: `t('home.ephemeral.10s')` etc.
    - Verify: page renders correctly in zh (identical to before)
    - Verify: manually set locale to 'en' in devtools, confirm English renders
    - This is the pilot — if patterns work here, batch migration is safe
    - _Requirements: 3.1 AC1, AC4, AC7_

  - [x] 3.2 Migrate `src/App.tsx` error boundary to use `t()` calls
    - Replace "出错了", "发生了未知错误", "刷新页面"
    - Note: ErrorBoundary is a class component — use `translate()` directly with `useI18nStore.getState().locale`
    - _Requirements: 3.1 AC1_

- [x] 4. Checkpoint - Pilot 验证
  - Run: `npm run build` (TypeScript 编译无错误，类型检查通过)
  - Verify: Home page renders in Chinese (default for zh browser)
  - Verify: Manually test English by setting localStorage `arthas-locale=en`
  - Verify: `<html lang>` attribute updates correctly
  - Verify: No regression in existing functionality
  - Ask the user if questions arise before proceeding with batch migration.

- [x] 5. 批量迁移 — 聊天室和通用组件
  - [x] 5.1 Migrate `src/pages/ChatRoom.tsx` to use `t()` calls
    - Replace ~6 strings: "房间", aria-labels, "离开房间" etc.
    - _Requirements: 3.1 AC1, AC3_

  - [x] 5.2 Migrate `src/components/ConnectionBanner.tsx`
    - Replace "连接中断，正在重连..." and "✓ 已重连"
    - _Requirements: 3.1 AC1_

  - [x] 5.3 Migrate `src/components/MessageInput.tsx`
    - Replace placeholders, aria-labels, button text
    - _Requirements: 3.1 AC1, AC3_

  - [x] 5.4 Migrate `src/components/ShareKey.tsx`
    - Replace "分享码:", "生成中...", "复制分享码", "已复制", "复制"
    - _Requirements: 3.1 AC1_

  - [x] 5.5 Migrate `src/components/MessageBubble.tsx`
    - Replace "回复", "添加反应", "复制消息", "已复制", aria-labels
    - _Requirements: 3.1 AC1, AC3_

  - [x] 5.6 Migrate `src/components/MemberList.tsx` and `MemberDrawer.tsx`
    - Replace "在线成员", "成员列表", "关闭成员列表"
    - _Requirements: 3.1 AC1, AC3_

  - [x] 5.7 Migrate `src/components/EmojiPicker.tsx`
    - Replace "选择表情", "暂无最近使用"
    - _Requirements: 3.1 AC1_

  - [x] 5.8 Migrate `src/components/TypingIndicator.tsx` and `ReactionPanel.tsx`
    - Replace "正在输入...", "添加反应"
    - _Requirements: 3.1 AC1_

- [x] 6. 批量迁移 — 文件传输和非组件代码
  - [x] 6.1 Migrate `src/file-transfer/components/FileMessage.tsx`
    - Replace ~10 status texts, aria-labels, button text
    - _Requirements: 3.1 AC1, AC5_

  - [x] 6.2 Migrate `src/file-transfer/components/DropZone.tsx` and `FileAttachButton.tsx`
    - Replace "拖放文件到此处上传", "添加附件", "发送文件" etc.
    - Also check `getLargeRoomWarning()` — if it returns Chinese text, migrate it too (may be in fileTransferStore or a utility)
    - _Requirements: 3.1 AC1, AC5_

  - [x] 6.3 Migrate `src/stores/chatStore.ts` system messages
    - Replace ~12 hardcoded strings (error messages, join/leave, rate limit)
    - Use `useI18nStore.getState().locale` + `translate()` for non-React context
    - _Requirements: 3.1 AC2_

  - [x] 6.4 Migrate `src/utils/emojiData.ts` category names
    - Change `name: '最近'` to `nameKey: 'emoji.category.recent'` pattern
    - Type `nameKey` as `TranslationKey` (not `string`) for compile-time safety
    - Update EmojiCategory interface to use `nameKey: TranslationKey`
    - Update EmojiPicker to resolve `t(category.nameKey)` at render time
    - _Requirements: 3.1 AC6_

  - [x] 6.5 Migrate `src/utils/notification.ts`
    - Replace notification text template with `translate(locale, 'notification.newMessage', { name })`
    - _Requirements: 3.1 AC2_

- [x] 7. 语言切换 UI
  - [x] 7.1 Create `src/i18n/components/LanguageSwitcher.tsx`
    - Globe icon button (🌐) + dropdown with 3 options: 中文 / English / 日本語
    - Click outside to close dropdown (useEffect + document click listener)
    - Current language highlighted with checkmark
    - Responsive: compact on mobile (icon only), shows label on desktop
    - Accessible: aria-expanded, aria-label, keyboard navigation
    - _Requirements: 4.1, 4.2_

  - [x] 7.2 Integrate LanguageSwitcher into Home page
    - Position: top-right corner of the card (absolute positioned)
    - _Requirements: 4.1_

  - [x] 7.3 Integrate LanguageSwitcher into ChatRoom
    - Desktop: in header area, before mute button
    - Mobile: in MemberDrawer bottom section (below member list, above close area)
    - _Requirements: 4.2_

- [x] 8. Final checkpoint - 全面验证
  - Run: `npm run build` (TypeScript 编译无错误)
  - Run: `npm run test` (现有测试不受影响)
  - Verify: 中文界面 — 所有页面显示正确，与迁移前无差异
  - Verify: 英文界面 — 所有页面无中文残留（grep 检查 JSX 中的中文字符）
  - Verify: 日文界面 — 所有页面无中文残留
  - Verify: localStorage 持久化 — 设置语言后刷新页面保持选择
  - Verify: 浏览器语言检测 — 清除 localStorage 后根据浏览器语言自动选择
  - Verify: `<html lang>` 属性随语言切换更新
  - Verify: 文件传输状态文本正确翻译
  - Verify: Emoji 分类名称正确翻译
  - Verify: 系统消息（加入/离开/错误）正确翻译
  - Ask the user if questions arise.

## Notes

- 约 85 个可翻译字符串，分布在 17 个文件中
- 不引入新依赖（使用 Zustand + React Hook 自建，~100 行代码）
- 翻译文件静态打包（无运行时网络请求），预计增量 < 10KB gzip
- Emoji 字符本身不翻译，只翻译分类名称（nameKey 模式）
- 代码注释保持中文（项目约定）
- Pilot 迁移策略：先迁移 Home.tsx 验证模式正确，再批量迁移其余文件
- tsconfig.json 需要 `resolveJsonModule: true`（Wave 0 首先处理）
- 类型安全通过 barrel 文件的类型注解赋值实现（不能用 `_check` 模式，因 noUnusedLocals: true）
- TranslationKey 定义在 locales/index.ts（单一来源），types.ts 仅 re-export
- 移动端语言切换放在成员抽屉底部（header 空间不足）

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.2", "1.5", "1.4"], "note": "Internal order: 2.3/2.4 → 2.2 → 1.5 → 1.4 (each depends on prior)" },
    { "id": 3, "tasks": ["3.1", "3.2"], "note": "Pilot migration — validate before batch" },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "6.1", "6.2", "6.3", "6.4", "6.5"], "note": "Batch migration — only after pilot passes" },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3"] }
  ]
}
```

## Dependency Rationale

| Dependency | Reason |
|------------|--------|
| 1.1 in Wave 0 | tsconfig change must come first — all subsequent JSON imports depend on resolveJsonModule |
| 1.2, 1.3 in Wave 1 | Store and translate engine are independent foundations; zh.json extraction starts here |
| Wave 2 internal order | 2.3/2.4 (JSON files) → 2.2 (barrel imports JSONs) → 1.5 (types re-exports from barrel) → 1.4 (hook imports types+store+translate) |
| 3.1, 3.2 in Wave 3 | **Pilot migration** — validate the entire pattern works before committing to batch |
| Wave 4 (batch) | Only proceeds after pilot checkpoint passes — all migrations are independent of each other |
| 7.1 in Wave 5 | LanguageSwitcher component depends on i18n hook being available and tested |
| 7.2, 7.3 in Wave 6 | Integration depends on LanguageSwitcher component (7.1) existing |
