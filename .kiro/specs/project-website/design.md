# Technical Design: Arthas Project Website

## Overview

本文档描述 Arthas 官网的技术设计，基于 Astro 4.x + @astrojs/starlight 构建，部署在 GitHub Pages（子目录 `/arthas/`）。设计分 Phase A（MVP）和 Phase B（完整版）两阶段。

## Architecture

```
# 仓库根目录新增文件
.github/workflows/deploy-website.yml   # GitHub Pages 部署 workflow（必须在仓库根 .github/ 下）

# website/ 目录结构
website/
├── astro.config.mjs          # Astro + Starlight 配置
├── package.json              # 依赖声明（pnpm）
├── tsconfig.json             # TypeScript 配置
├── README.md                 # 开发说明
├── public/
│   ├── favicon.svg           # SVG favicon
│   ├── og-image.png          # Open Graph 分享图（1200x630）[Phase B]
│   └── robots.txt            # 搜索引擎指令
├── src/
│   ├── assets/
│   │   └── logo.svg          # Arthas SVG logo
│   ├── components/
│   │   ├── Hero.astro        # 首页 Hero 区域
│   │   ├── FeatureCards.astro # 特性卡片网格
│   │   ├── HowItWorks.astro  # 使用流程步骤
│   │   ├── TrustSection.astro # 安全信任展示
│   │   ├── Footer.astro      # 自定义页脚
│   │   └── ThemeSelectOverride.astro # 隐藏主题切换（强制暗色）
│   ├── content/
│   │   └── docs/             # Starlight 文档内容（由 sync-docs.sh 生成 symlink）
│   │       ├── *.md          # 英文文档（默认语言，从 official_doc/*.en.md 映射）
│   │       └── zh/           # 中文文档（从 official_doc/*.md 映射）
│   ├── data/
│   │   └── roadmap.json      # 路线图数据源 [Phase B]
│   ├── i18n/
│   │   ├── zh.json           # 中文 UI 文案
│   │   └── en.json           # 英文 UI 文案
│   ├── layouts/
│   │   └── Landing.astro     # 首页自定义布局（不使用 Starlight 文档布局）
│   ├── pages/
│   │   ├── index.astro       # 英文首页（Landing 布局）
│   │   ├── zh/index.astro    # 中文首页
│   │   ├── 404.astro         # 自定义 404 页面
│   │   ├── download.astro    # 下载页 [Phase B]
│   │   └── roadmap.astro     # 路线图页 [Phase B]
│   └── styles/
│       └── global.css        # 全局样式（暗色主题变量、字体）
└── scripts/
    ├── sync-docs.sh          # 同步 official_doc/ 到 content/docs/
    └── fetch-release.mjs     # 构建时获取 GitHub Release 版本 [Phase B]
```

## Design Decisions

### D1: Astro + Starlight（而非 VitePress）

**选择理由：**
- 首页需要自定义营销布局（Hero、动画、Feature Cards）— VitePress 的自定义布局能力有限
- Starlight 提供开箱即用的文档功能（侧边栏、搜索、i18n、代码高亮）
- Astro island architecture 确保非交互页面零 JS（满足 Req 1.8 <50KB）
- Starlight 内置 Pagefind 全文搜索（满足 Req 6.8）

**权衡：** Astro 学习曲线略高于 VitePress，但项目已有 React/Vite 经验，迁移成本低。

_Requirements: 1.1, 6.8, 1.8_

### D2: 文档同步策略 — symlink + build script

**方案：** `scripts/sync-docs.sh` 在 build 前创建 symlink：

```bash
#!/bin/bash
# scripts/sync-docs.sh
# 将 official_doc/ 中的文档映射到 Starlight content collection
# Starlight defaultLocale='en' → 英文文档在 docs/ 根目录，中文在 docs/zh/

DOCS_SRC="$(cd "$(dirname "$0")/../.." && pwd)/official_doc"
DOCS_DEST="src/content/docs"

# Windows 检测：如果不支持 symlink 则使用 copy
use_copy=false
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
  use_copy=true
fi

link_or_copy() {
  local src="$1" dst="$2"
  if $use_copy; then
    cp "$src" "$dst"
  else
    ln -sf "$src" "$dst"
  fi
}

# 清理旧内容
rm -rf "$DOCS_DEST/zh"
mkdir -p "$DOCS_DEST" "$DOCS_DEST/zh"

# 英文文档（.en.md → 去掉 .en 后缀，放在 docs/ 根目录）
for f in "$DOCS_SRC"/*.en.md; do
  [ -f "$f" ] || continue
  target=$(basename "$f" .en.md).md
  link_or_copy "$f" "$DOCS_DEST/$target"
done

# 中文文档（.md 文件，排除 .en.md，放在 docs/zh/）
for f in "$DOCS_SRC"/*.md; do
  [[ "$f" == *.en.md ]] && continue
  [ -f "$f" ] || continue
  link_or_copy "$f" "$DOCS_DEST/zh/$(basename "$f")"
done

echo "✅ Docs synced: $(ls "$DOCS_DEST"/*.md 2>/dev/null | wc -l) en, $(ls "$DOCS_DEST/zh"/*.md 2>/dev/null | wc -l) zh"
```

**Starlight frontmatter 兼容性：** 现有 `official_doc/*.md` 文件没有 Starlight frontmatter（`title`, `description`）。Starlight 会自动从文件的第一个 H1 标题推断页面标题，无需修改源文件。sidebar 使用 `autogenerate` 模式从目录结构生成。

**为什么不直接引用 `../official_doc/`：** Astro content collections 要求内容在 `src/` 目录内。symlink 是零拷贝方案，保证文档始终与源同步。

_Requirements: 6.1, 11.7_

### D3: 子目录部署 — base path 配置

```javascript
// astro.config.mjs
export default defineConfig({
  site: 'https://michaelwang123.github.io',
  base: '/arthas',
  integrations: [starlight({ /* ... */ })],
});
```

所有内部链接使用相对路径或 Astro 的 `import.meta.env.BASE_URL` 前缀。Starlight 自动处理文档内链接的 base path。

_Requirements: 1.7_

### D4: 暗色主题实现

**强制暗色模式策略：** Starlight 没有直接的 "disable light mode" 配置项。通过以下方式实现：

1. 覆盖 ThemeSelect 组件为空组件（隐藏主题切换按钮）
2. 将 light 和 dark 的 CSS 变量都设为暗色值

```javascript
// astro.config.mjs → starlight config
starlight({
  customCss: ['./src/styles/global.css'],
  components: {
    ThemeSelect: './src/components/ThemeSelectOverride.astro',
  },
})
```

```astro
---
// src/components/ThemeSelectOverride.astro
// 空组件 — 隐藏主题切换按钮，强制暗色模式
---
```

```css
/* src/styles/global.css */
:root {
  --color-bg-primary: #0d0d1a;
  --color-bg-surface: #1a0a2e;
  --color-accent: #ffd700;
  --color-accent-secondary: #8b4513;
  --color-text-primary: #e8e8e8;
  --color-text-secondary: #a0a0b0;
}

/* 强制暗色：light 和 dark 都使用相同的暗色值 */
:root,
:root[data-theme='light'],
:root[data-theme='dark'] {
  --sl-color-bg: var(--color-bg-primary);
  --sl-color-bg-nav: var(--color-bg-surface);
  --sl-color-bg-sidebar: var(--color-bg-surface);
  --sl-color-text: var(--color-text-primary);
  --sl-color-text-accent: var(--color-accent);
  --sl-color-hairline: rgba(255, 255, 255, 0.1);
}
```

_Requirements: 3.1, 3.2_

### D5: i18n 路由策略

Starlight 内置 i18n 支持，配置如下：

```javascript
// astro.config.mjs → starlight config
starlight({
  defaultLocale: 'en',
  locales: {
    en: { label: 'English', lang: 'en' },
    zh: { label: '中文', lang: 'zh-CN' },
  },
  sidebar: [
    {
      label: 'Documentation',
      autogenerate: { directory: 'docs' },
    },
  ],
})
```

**路由结构：**
- `/arthas/` → 英文首页（默认）
- `/arthas/zh/` → 中文首页
- `/arthas/docs/getting-started/` → 英文文档（defaultLocale 无前缀）
- `/arthas/zh/docs/getting-started/` → 中文文档

**Sidebar 配置：** 使用 `autogenerate` 模式从 `src/content/docs/` 目录结构自动生成侧边栏。Starlight 会从每个 `.md` 文件的第一个 H1 标题推断页面标题（无需 frontmatter）。如果需要自定义排序，可在文件中添加可选的 `sidebar: { order: N }` frontmatter。

**语言检测：** 首次访问时通过内联 `<script>`（放在 `<head>` 中，DOM 渲染前执行）检测 `navigator.language`：

```html
<!-- 在 Landing.astro 的 <head> 中 -->
<script is:inline>
  // 仅在根路径触发，避免已选择语言的用户被重定向
  if (window.location.pathname === '/arthas/' || window.location.pathname === '/arthas') {
    const saved = localStorage.getItem('arthas-locale');
    const lang = saved || (navigator.language.startsWith('zh') ? 'zh' : 'en');
    if (lang === 'zh') {
      window.location.replace('/arthas/zh/');
    }
  }
</script>
```

**已知权衡：** 内联 script 在 `<head>` 中执行，在 DOM 渲染前完成 redirect，避免了错误语言内容的闪烁。但如果用户禁用 JS，将始终看到英文版（可接受的降级）。

**自定义页面（首页、下载、路线图）：** 使用 `src/i18n/zh.json` 和 `src/i18n/en.json` 存储 UI 文案，在 `.astro` 组件中通过 helper 函数读取：

```typescript
// src/i18n/utils.ts
import zh from './zh.json';
import en from './en.json';

const translations = { zh, en } as const;
type Locale = keyof typeof translations;

export function t(key: string, locale: Locale = 'en'): string {
  return translations[locale]?.[key] ?? translations['en'][key] ?? key;
}

export function getLocaleFromUrl(url: URL): Locale {
  return url.pathname.startsWith('/arthas/zh') ? 'zh' : 'en';
}
```

_Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7_

### D6: GitHub Release 版本获取 [Phase B]

```javascript
// scripts/fetch-release.mjs
const REPO = 'michaelwang123/arthas';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

async function fetchLatestRelease() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    return {
      version: data.tag_name,
      assets: data.assets.map(a => ({ name: a.name, url: a.browser_download_url })),
      publishedAt: data.published_at,
    };
  } catch (err) {
    console.warn(`⚠️ GitHub API unreachable, using fallback version`);
    return {
      version: 'v1.0.0', // hardcoded fallback
      assets: [],
      publishedAt: null,
      fallback: true,
    };
  }
}

// 写入 src/data/release.json 供页面读取
const release = await fetchLatestRelease();
await fs.writeFile('src/data/release.json', JSON.stringify(release, null, 2));
```

在 `package.json` 的 build script 中调用：`"build": "node scripts/fetch-release.mjs && astro build"`

_Requirements: 7.2, 7.6, 7.7_

### D7: 首页组件设计

#### Hero.astro

```astro
---
import { t, getLocaleFromUrl } from '../i18n/utils';
import logo from '../assets/logo.svg';

const locale = getLocaleFromUrl(Astro.url);
const base = import.meta.env.BASE_URL;
---
<section class="hero">
  <div class="hero-content">
    <img src={logo.src} alt="Arthas" class="hero-logo" width="80" height="80" />
    <h1>{t('hero.title', locale)}</h1>
    <p class="tagline">{t('hero.tagline', locale)}</p>
    <a href="https://arthas-blush.vercel.app" target="_blank" rel="noopener" class="launch-btn">
      {t('hero.launch', locale)} →
    </a>
  </div>
  <div class="hero-animation" aria-hidden="true">
    <!-- CSS-only 加密动画：锁图标 + 粒子效果 -->
  </div>
</section>
```

**路径策略：** 所有资源使用 Astro 的 `import` 导入（自动处理 base path 和 hash），所有内部链接使用 `import.meta.env.BASE_URL` 前缀。绝不硬编码 `/arthas/`。

**动画策略：** 纯 CSS 动画（keyframes），不引入 JS 动画库。通过 `@media (prefers-reduced-motion: reduce)` 暂停动画。

_Requirements: 2.1, 2.2, 2.4_

#### FeatureCards.astro

6 张特性卡片，使用 CSS Grid 布局（桌面 3 列，平板 2 列，手机 1 列）。

滚动动画 [Phase B] 使用 Intersection Observer API（Astro island，仅在首页加载 ~2KB JS）：

```typescript
// 仅 Phase B 加载
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      entry.target.style.transitionDelay = `${i * 120}ms`;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });
```

_Requirements: 2.3, 2.5_

#### TrustSection.astro

展示 4 个信任指标：
1. **开源** — GitHub stars 数量（build-time 获取）+ "View Source" 链接
2. **零知识** — 简化架构图（SVG inline）：Client → 🔒 Encrypt → Server (blind relay) → 🔓 Decrypt → Client
3. **AGPL-3.0** — 许可证徽章 + 一句话解释
4. **审计友好** — "所有加密代码可审计" + 链接到 crypto 源码目录

_Requirements: 2.7_

### D8: 404 页面

```astro
---
// src/pages/404.astro
import Landing from '../layouts/Landing.astro';
import logo from '../assets/logo.svg';

const base = import.meta.env.BASE_URL;
---
<Landing title="Page Not Found">
  <section class="not-found">
    <img src={logo.src} alt="Arthas" width="64" height="64" />
    <h1>404</h1>
    <p>This page doesn't exist or has been moved.</p>
    <a href={base} class="back-home">← Back to Home</a>
  </section>
</Landing>
```

_Requirements: 1.9_

### D9: GitHub Actions 部署 Workflow

```yaml
# .github/workflows/deploy-website.yml
name: Deploy Website to GitHub Pages

on:
  push:
    branches: [main]
    paths: ['website/**', 'official_doc/**']

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: website
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: website/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: bash scripts/sync-docs.sh
      - run: pnpm build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: website/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

**触发条件：** 仅当 `website/` 或 `official_doc/` 目录有变更时触发，避免无关 commit 触发部署。

_Requirements: 1.2, 1.3, 1.4, 11.4, 11.6_

### D10: SEO 实现

Astro 内置 `<head>` 管理，每个页面通过 frontmatter 设置 meta。使用 Astro 的 i18n URL helpers 生成 hreflang：

```astro
---
// 在 Layout 中
import { getRelativeLocaleUrl } from 'astro:i18n';

const { title, description } = Astro.props;
const canonicalURL = new URL(Astro.url.pathname, Astro.site);
const base = import.meta.env.BASE_URL;

// 生成 hreflang URLs
const enUrl = new URL(Astro.url.pathname.replace('/zh/', '/').replace('/zh', '/'), Astro.site);
const zhUrl = new URL(
  Astro.url.pathname.startsWith(`${base}zh/`)
    ? Astro.url.pathname
    : Astro.url.pathname.replace(base, `${base}zh/`),
  Astro.site
);
---
<head>
  <title>{title} | Arthas</title>
  <meta name="description" content={description} />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href={canonicalURL} />
  
  <!-- Open Graph [Phase B: add og:image] -->
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={`${Astro.site}arthas/og-image.png`} />
  <meta property="og:type" content="website" />
  
  <!-- hreflang -->
  <link rel="alternate" hreflang="en" href={enUrl} />
  <link rel="alternate" hreflang="zh" href={zhUrl} />
  <link rel="alternate" hreflang="x-default" href={enUrl} />
</head>
```

**JSON-LD 结构化数据 [Phase B]：**

```astro
<!-- 仅首页 -->
<script type="application/ld+json" set:html={JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Arthas",
  "description": "End-to-end encrypted temporary chat. No signup, zero knowledge, self-destruct.",
  "url": "https://michaelwang123.github.io/arthas",
  "applicationCategory": "CommunicationApplication",
  "operatingSystem": "Web, Linux, macOS, Windows",
  "license": "https://www.gnu.org/licenses/agpl-3.0.html",
  "offers": { "@type": "Offer", "price": "0" }
})} />
```

Sitemap 通过 `@astrojs/sitemap` 集成自动生成。

_Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

### D11: 路线图数据模型 [Phase B]

```json
// src/data/roadmap.json
{
  "phases": [
    {
      "id": 1,
      "name": "核心功能",
      "nameEn": "Core Features",
      "status": "completed",
      "percentage": 100,
      "features": [
        { "name": "WebSocket 连接 + 心跳", "nameEn": "WebSocket + Heartbeat", "done": true },
        { "name": "E2EE 加密层", "nameEn": "E2EE Encryption Layer", "done": true }
      ]
    },
    {
      "id": 11,
      "name": "开源生态 & AI 集成",
      "nameEn": "Open Source Ecosystem & AI",
      "status": "planned",
      "percentage": 0,
      "features": [
        { "name": "项目官网", "nameEn": "Project Website", "done": false },
        { "name": "OpenClaw Channel Plugin", "nameEn": "OpenClaw Channel Plugin", "done": false }
      ]
    }
  ]
}
```

_Requirements: 8.1, 8.4, 8.5_

### D12: 响应式导航

**桌面（≥768px）：** 水平导航栏，固定在顶部，包含 logo + 导航链接 + 语言切换 + GitHub 链接。

**移动（<768px）：** 汉堡菜单按钮，点击展开全屏导航抽屉。使用 Starlight 内置的移动导航组件，无需自定义 JS。

Phase A 导航项：Home | Docs | GitHub  
Phase B 追加：Download | Roadmap

_Requirements: 4.2, 10.1_

## File Modification Summary

### New Files (Phase A)

| 文件 | 用途 |
|------|------|
| `website/astro.config.mjs` | Astro + Starlight 配置 |
| `website/package.json` | 依赖声明 |
| `website/tsconfig.json` | TypeScript 配置 |
| `website/src/styles/global.css` | 暗色主题 CSS 变量 |
| `website/src/layouts/Landing.astro` | 首页布局 |
| `website/src/pages/index.astro` | 首页 |
| `website/src/pages/404.astro` | 404 页面 |
| `website/src/components/Hero.astro` | Hero 组件 |
| `website/src/components/FeatureCards.astro` | 特性卡片 |
| `website/src/components/HowItWorks.astro` | 使用流程 |
| `website/src/components/TrustSection.astro` | 信任展示 |
| `website/src/components/Footer.astro` | 页脚 |
| `website/src/components/ThemeSelectOverride.astro` | 隐藏主题切换（空组件） |
| `website/src/i18n/zh.json` | 中文文案 |
| `website/src/i18n/en.json` | 英文文案 |
| `website/src/i18n/utils.ts` | i18n helper |
| `website/src/assets/logo.svg` | SVG logo |
| `website/public/favicon.svg` | Favicon |
| `website/public/robots.txt` | SEO |
| `website/scripts/sync-docs.sh` | 文档同步脚本 |
| `website/README.md` | 开发说明 |
| `.github/workflows/deploy-website.yml` | 部署 workflow |

### New Files (Phase B)

| 文件 | 用途 |
|------|------|
| `website/src/pages/download.astro` | 下载页 |
| `website/src/pages/roadmap.astro` | 路线图页 |
| `website/src/data/roadmap.json` | 路线图数据 |
| `website/src/data/release.json` | Release 版本缓存（build-time 生成） |
| `website/scripts/fetch-release.mjs` | GitHub API 获取脚本 |
| `website/public/og-image.png` | Open Graph 分享图 |

### Modified Files

| 文件 | 修改 |
|------|------|
| `.gitignore` | 添加 `website/node_modules/`, `website/dist/`, `website/src/content/docs/` (symlink target) |

## Performance Budget

| 指标 | 目标 | 实现方式 |
|------|------|----------|
| FCP | ≤ 1s (Fast 4G) | Astro 静态 HTML，零 JS 阻塞 |
| JS Bundle (docs) | < 50KB | Starlight 默认 ~30KB（Pagefind UI） |
| JS Bundle (homepage) | < 20KB | 纯 CSS 动画，Phase B 加 IntersectionObserver ~2KB |
| Lighthouse | ≥ 95 | 语义 HTML + 图片优化 + 预加载字体 |
| Build time | < 60s | Astro 增量构建 + pnpm 缓存 |

## Accessibility

- 所有图片有 `alt` 属性
- 动画尊重 `prefers-reduced-motion`
- 导航支持键盘（Tab/Enter/Escape）
- 颜色对比度 ≥ 4.5:1（WCAG AA）
- 语义化 HTML（header/nav/main/article/footer）
- 404 页面有明确的返回路径
- 路线图进度条有 `aria-valuenow`/`aria-valuemax` 属性
