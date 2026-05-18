# Requirements: 国际化 (i18n)

## Overview

为 Arthas 前端添加多语言支持，让非中文用户也能无障碍使用。当前所有 UI 文案为硬编码中文（约 85 个可翻译字符串，分布在 17 个文件中）。目标是建立轻量级 i18n 基础设施，支持中文（当前基准语言）、英文、日文三种语言，并根据浏览器语言自动切换。未知浏览器语言回退到英文。

## Functional Requirements

### 1. 语言检测与切换

- **1.1** 应用启动时自动检测浏览器语言偏好（`navigator.language` / `navigator.languages`）
  - AC1: 浏览器语言为 `zh`/`zh-CN`/`zh-TW` 时显示中文界面
  - AC2: 浏览器语言为 `en`/`en-US`/`en-GB` 等时显示英文界面
  - AC3: 浏览器语言为 `ja`/`ja-JP` 时显示日文界面
  - AC4: 不支持的语言回退到英文（英文作为国际通用回退语言）

- **1.2** 用户可手动切换语言
  - AC1: 首页和聊天室页面提供语言切换入口
  - AC2: 切换后立即生效，无需刷新页面
  - AC3: 用户选择持久化到 localStorage，下次访问保持选择
  - AC4: 切换语言时同步更新 `<html lang="xx">` 属性（影响屏幕阅读器语音选择和浏览器拼写检查）

- **1.3** 语言优先级：用户手动选择 > localStorage 缓存 > 浏览器偏好 > 默认英文

### 2. 翻译基础设施

- **2.1** 建立轻量级翻译系统（不引入第三方 i18n 库）
  - AC1: 提供 `t(key)` 翻译函数，支持字符串插值（如 `t('user.joined', { name: 'Alice' })` → "Alice 加入了房间"）
  - AC2: 提供 React Hook `useTranslation()` 返回 `t` 函数和当前语言
  - AC3: 语言切换时所有使用 `t()` 的组件自动重新渲染

- **2.2** 翻译文件组织
  - AC1: 每种语言一个 JSON 文件（`zh.json`, `en.json`, `ja.json`）
  - AC2: 使用扁平化 key 命名空间（如 `home.title`, `chat.leave`, `error.E001`）
  - AC3: 翻译文件位于 `src/i18n/locales/` 目录

- **2.3** 类型安全
  - AC1: 翻译 key 有 TypeScript 类型提示（基于中文翻译文件的 key 集合生成类型）
  - AC2: 使用不存在的 key 时 TypeScript 编译报错
  - AC3: 通过 barrel 文件（`locales/index.ts`）的 `Record<Keys, string>` 赋值检查，确保 en.json 和 ja.json 包含所有 key（编译时报错而非运行时）
  - AC4: tsconfig.json 启用 `resolveJsonModule: true` 以支持 JSON 导入类型推导

### 3. 翻译覆盖范围

- **3.1** 所有用户可见的 UI 文本必须通过翻译系统
  - AC1: 页面标题、按钮文本、标签、占位符
  - AC2: 系统消息（加入/离开/错误）
  - AC3: aria-label 无障碍标签
  - AC4: 表单验证提示
  - AC5: 文件传输状态文本
  - AC6: Emoji 分类名称（使用 nameKey 模式，渲染时解析）
  - AC7: 时间单位标签（"10秒"/"30秒"/"60秒"/"5分钟" → "10s"/"30s"/"60s"/"5min"）

- **3.2** 不翻译的内容
  - AC1: 代码注释保持中文（项目约定）
  - AC2: 用户输入的消息内容
  - AC3: 房间 ID、分享码等技术标识符
  - AC4: Emoji 字符本身

### 4. 语言切换 UI

- **4.1** 首页语言切换
  - AC1: 在首页右上角显示语言切换按钮（🌐 + 当前语言简称）
  - AC2: 点击展开语言选择列表（中文 / English / 日本語）
  - AC3: 点击外部区域关闭下拉菜单

- **4.2** 聊天室内语言切换
  - AC1: 桌面端在 header 区域提供语言切换入口（不干扰主要操作）
  - AC2: 移动端将语言切换放在成员抽屉底部（header 空间有限，已有 🔔 👥 离开 等按钮）
  - AC3: 切换语言不影响当前聊天状态

### 5. 文档元数据

- **5.1** 语言切换时更新 HTML 文档元数据
  - AC1: 更新 `<html lang="xx">` 属性
  - AC2: 更新 `<title>` 为对应语言的应用名称

## Non-Functional Requirements

- **NFR-1** 性能：语言切换延迟 < 50ms（所有翻译文件打包在 bundle 中，无网络请求）
- **NFR-2** 包体积：三种语言的翻译文件总增量 < 10KB gzip
- **NFR-3** 零新依赖：使用 Zustand 实现，不引入 i18next 等第三方库
- **NFR-4** 向后兼容：现有功能行为不变，中文用户体验无差异
- **NFR-5** 可扩展：添加新语言只需新增一个 JSON 文件并在 barrel 文件中注册
- **NFR-6** 构建兼容：tsconfig.json 需启用 `resolveJsonModule: true`，确保 JSON 导入的类型推导正常工作

## Out of Scope

- 服务端国际化（Go 后端错误消息保持英文，前端根据错误码映射翻译）
- RTL（从右到左）布局支持（中/英/日均为 LTR）
- ICU 复数规则（三种目标语言中，仅英文有简单复数，但本应用无需复数场景）
- 翻译管理平台集成
- 日期/数字格式本地化（Intl API）— 当前无复杂日期显示需求
