# GitHub Pages 网站优化清单

> 审查日期: 2026-05-27
> 审查页面: https://michaelwang123.github.io/arthas/

---

## 内容问题（影响用户体验）

### 1. 文档页顶部的语言切换行多余
- **位置**: 每个英文文档页面顶部
- **问题**: 显示 `[中文](/arthas/zh/...) | English` 手动链接，但 Starlight 已在页面头部提供语言选择器
- **影响**: 视觉冗余，不专业
- **修复方案**: 从 `official_doc/*.en.md` 源文件中移除语言切换行，同时更新 `sync-docs.mjs` 脚本在同步时自动剥离
- **优先级**: 高

### 2. Getting Started 中的 git clone URL 错误
- **位置**: `official_doc/getting-started.en.md` 和 `official_doc/getting-started.md`
- **问题**: 文档中写的是 `git clone https://github.com/arthas/arthas.git`，实际仓库地址是 `https://github.com/michaelwang123/arthas.git`
- **影响**: 用户按文档操作会失败
- **修复方案**: 更新所有文档中的仓库 URL
- **优先级**: 高

### 3. Download 页面版本号硬编码
- **位置**: `website/src/pages/download.astro` 和 `website/src/data/release.json`
- **问题**: 版本号 "v1.0" 硬编码，新版本发布后不会自动更新
- **影响**: 用户可能下载到旧版本
- **修复方案**: 使用 GitHub API 在 build 时动态获取最新 release 版本（已有 `fetch-release.mjs` 脚本框架）
- **优先级**: 中

### 4. Trust Section 图示未国际化
- **位置**: `website/src/components/TrustSection.astro`
- **问题**: 中文页面中加密流程图仍显示英文 "Client → 🔒 Encrypt → Server (blind relay) → 🔓 Decrypt → Client"
- **影响**: 中文用户体验不一致
- **修复方案**: 将图示文本加入 i18n 翻译文件，根据 locale 动态渲染
- **优先级**: 中

---

## 技术/SEO 优化

### 5. 生产 HTML 中包含大量学习注释
- **位置**: 所有页面的 HTML 输出
- **问题**: `📚 学习要点:` 等 HTML 注释被输出到生产页面，增加约 5-10KB 传输体积
- **影响**: 页面加载速度略有影响，暴露内部文档
- **修复方案**: 添加 Astro 插件或 postbuild 脚本，在 production build 时移除 HTML 注释
- **优先级**: 中

### 6. og:image 使用 SVG 格式
- **位置**: `website/src/layouts/Landing.astro` 和 `astro.config.mjs` head 配置
- **问题**: Facebook 不支持 SVG 格式的 Open Graph 图片
- **影响**: Facebook 分享时无法显示预览图
- **修复方案**: 导出 1200×630 PNG 版本，更新 og:image URL（可用 `@resvg/resvg-js` 在 build 时自动转换）
- **优先级**: 低

### 7. "Launch App" 链接指向临时部署
- **位置**: Hero 组件、Footer 组件
- **问题**: 链接指向 `arthas-blush.vercel.app`，看起来像临时/测试部署
- **影响**: 用户可能对链接的可靠性产生疑虑
- **修复方案**: 确认是否为正式生产 URL；如果是，考虑使用自定义域名
- **优先级**: 低

---

## 修复状态追踪

| # | 问题 | 优先级 | 状态 |
|---|------|--------|------|
| 1 | 语言切换行多余 | 高 | ✅ 已修复 — sync-docs.mjs 添加 stripLanguageSwitcher 函数 |
| 2 | git clone URL 错误 | 高 | ✅ 已修复 — 更新为 michaelwang123/arthas.git |
| 3 | 版本号硬编码 | 中 | ⬜ 延后 — 需要 GitHub API 集成 |
| 4 | Trust Section 未国际化 | 中 | ✅ 已修复 — 添加 trust.diagram.* i18n keys |
| 5 | 生产 HTML 含学习注释 | 中 | ⬜ 延后 — compressHTML 与 Starlight 不兼容，需自定义 postbuild 脚本 |
| 6 | og:image SVG 兼容性 | 低 | ⬜ 待修复 |
| 7 | Launch App URL | 低 | ⬜ 待确认 |

---

## 修复记录

### 2026-05-27 — 第一批修复

**修改文件：**
- `website/scripts/sync-docs.mjs` — 添加 `stripLanguageSwitcher()` 函数，移除文档中的手动语言切换行；修复 CRLF 兼容性
- `official_doc/getting-started.en.md` — 修正 git clone URL
- `official_doc/getting-started.md` — 修正 git clone URL
- `official_doc/index.md` — 修正 git clone URL
- `website/src/i18n/en.json` — 添加 `trust.diagram.*` 翻译 keys
- `website/src/i18n/zh.json` — 添加 `trust.diagram.*` 中文翻译
- `website/src/components/TrustSection.astro` — 架构图使用 i18n 动态渲染

**验证：** `npm run build` 成功，25 页面正常生成。
