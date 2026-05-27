# Requirements Document

## Introduction

Arthas 项目官网是一个独立于应用本身的静态营销/文档站点，部署在 GitHub Pages。官网的目标是向潜在用户和开发者展示 Arthas 的核心价值（加密版 AirDrop + 临时聊天），提供完整的中英文文档，并引导用户快速上手（Launch App / CLI 下载 / 自托管部署）。

官网采用 Astro + @astrojs/starlight 构建，支持暗色主题、响应式设计、SEO 优化和中英文双语。

## Implementation Phases

本需求分两阶段交付，确保快速上线：

- **Phase A（MVP，3 天）**：首页（Hero + 特性卡片 + 信任区）+ 文档页整合 + 基础 SEO + GitHub Pages 部署
- **Phase B（完整版，+5 天）**：下载页（GitHub Release 集成）+ 路线图可视化 + 滚动动画 + 完整 i18n 切换

Phase A 的目标是让官网可访问、可索引、有基本内容。Phase B 在此基础上增强交互和功能。

## Technical Constraints

1. **子目录部署**：站点部署在 `michaelwang123.github.io/arthas`（非根路径），所有资源引用、路由和链接必须使用 base path `/arthas/` 前缀
2. **文档源文件在 website/ 外部**：`official_doc/` 位于仓库根目录，build 脚本需通过 symlink 或 copy 将其映射到 `website/src/content/docs/`
3. **框架选型已确定**：使用 Astro + @astrojs/starlight（营销首页自由度高 + 文档开箱即用 + 内置 Pagefind 搜索）
4. **静态站点约束**：无服务端运行时，所有动态数据（如 GitHub Release 版本号）必须在 build-time 获取或通过客户端 fetch 实现

## Phase A Navigation Strategy

Phase A 期间，导航栏仅显示已实现的页面：Home、Docs、GitHub。Download 和 Roadmap 链接在 Phase B 上线后才加入导航。这避免了死链接或占位页面带来的不专业感。

## Glossary

- **Website**: Arthas 项目官网静态站点，部署在 GitHub Pages
- **Astro**: 静态站点生成器框架，支持 island architecture 和内容集合
- **Starlight**: Astro 官方文档主题插件，内置侧边栏、搜索、i18n
- **Hero_Section**: 首页顶部的大型视觉展示区域，包含标题、副标题和行动按钮
- **Feature_Card**: 展示单个核心特性的卡片组件，包含图标、标题和描述
- **Trust_Section**: 首页安全/信任展示区域，展示零知识架构、开源徽章、AGPL 许可证
- **Doc_Page**: 文档页面，整合 official_doc/ 目录中的中英文 Markdown 文档
- **Download_Page**: 下载/部署页面，提供 CLI 二进制下载链接和 Docker 自托管指引
- **Roadmap_Page**: 路线图页面，可视化展示项目各阶段进展
- **i18n_Router**: 国际化路由系统，根据用户语言偏好切换中英文内容
- **Launch_App_Button**: 链接到 Vercel 应用（arthas-blush.vercel.app）的醒目行动按钮
- **Pagefind**: Starlight 内置的静态全文搜索引擎，build 时生成索引，零运行时 JS 依赖
- **Dark_Theme**: 暗色主题视觉设计，与 Arthas 应用风格一致
- **GitHub_Pages**: GitHub 提供的静态站点托管服务，通过 GitHub Actions 自动部署

## Requirements

### Requirement 1: 静态站点基础架构 [Phase A]

**User Story:** As a developer, I want the website built with Astro + Starlight, so that it can be deployed as a static site on GitHub Pages with fast load times, built-in docs support, and good developer experience.

#### Acceptance Criteria

1. THE Website SHALL use Astro with @astrojs/starlight to generate static HTML/CSS/JS files that can be served without a server-side runtime
2. THE Website SHALL include a GitHub Actions workflow file that builds the static site and deploys the output to GitHub Pages without manual intervention
3. WHEN a commit is pushed to the `main` branch, THE GitHub_Actions workflow SHALL build and deploy the Website to GitHub Pages automatically within 5 minutes
4. IF the build step fails during the GitHub Actions workflow, THEN THE GitHub_Actions workflow SHALL report the failure status and stop deployment without modifying the currently published site
5. THE Website SHALL achieve a Lighthouse performance score of 95 or above on desktop when measured against the homepage using a default Lighthouse configuration with no extensions
6. THE Website SHALL load the homepage with a First Contentful Paint of 1 second or less when tested using Chrome DevTools throttled to a "Fast 4G" network profile
7. THE Website SHALL be served from the path `michaelwang123.github.io/arthas` with all internal links and asset references correctly resolving under the `/arthas/` base path
8. THE Website SHALL ship less than 50KB of JavaScript on non-interactive pages (documentation pages)
9. THE Website SHALL include a branded 404 page with the Arthas logo, a friendly error message, and a link back to the homepage; Starlight's 404 configuration SHALL be used
10. THE Website SHALL include a favicon (SVG format preferred for scalability) and appropriate meta tags for browser tab identification

### Requirement 2: 首页产品展示 [Phase A]

**User Story:** As a visitor, I want to see a compelling product introduction on the homepage, so that I can quickly understand what Arthas does and why I should use it.

#### Acceptance Criteria

1. THE Hero_Section SHALL display the product name "Arthas", a tagline describing the core value proposition (加密版 AirDrop + 临时聊天), and a Launch_App_Button that is visually distinct from surrounding elements with a minimum tap target size of 44x44 pixels
2. WHEN a visitor clicks the Launch_App_Button, THE Website SHALL open the Vercel application at `https://arthas-blush.vercel.app` in a new browser tab
3. THE Website SHALL display at least 6 Feature_Card components showcasing core features (E2EE, no signup, self-destruct, file sharing, voice messages, CLI client), where each Feature_Card contains an icon, a title (maximum 30 characters), and a description (maximum 120 characters)
4. THE Hero_Section SHALL include a looping animation that begins playback within 1 second of page load and respects the user's prefers-reduced-motion setting by pausing when reduced motion is preferred [Phase B]
5. WHEN a Feature_Card enters the viewport during scroll, THE Feature_Card SHALL animate into view with a fade-and-translate entrance effect, with a stagger delay of 100-150ms between consecutive cards [Phase B]
6. THE Website SHALL include a "How It Works" section displaying 4-5 sequential steps corresponding to the create-share-chat-destroy lifecycle (e.g., Create → Share → Chat → Gone), each step containing an icon and a descriptive label
7. THE Website SHALL include a Trust_Section displaying: open-source badge (GitHub stars count), zero-knowledge architecture diagram (simplified), AGPL-3.0 license badge, and a "server sees nothing" explanation

### Requirement 3: 暗色主题与视觉设计 [Phase A]

**User Story:** As a visitor, I want the website to have a polished dark theme consistent with the Arthas brand, so that the visual experience feels professional and cohesive.

#### Acceptance Criteria

1. THE Website SHALL use a dark color scheme as the default and only theme, with page background color no lighter than luminance value 15 (e.g., #0d0d1a or equivalent)
2. THE Dark_Theme SHALL use the Arthas application color palette: dark background (#0d0d1a), void purple (#1a0a2e) for surfaces, dawn gold (#ffd700) for accent/interactive elements, and ash (#8b4513) for secondary accents
3. THE Website SHALL apply CSS transitions with duration between 150ms and 400ms using ease-out or ease-in-out timing functions for interactive elements (hover states, scroll reveals, page transitions)
4. THE Website SHALL display the Arthas logo (SVG lock icon + "Arthas" text, with 🔒 emoji as initial placeholder) in the header of every page and maintain consistent use of the brand color palette and typography across all pages
5. THE Website SHALL use Inter as the primary font, with a fallback stack of -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif, and CJK fallbacks of "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei" for Chinese
6. THE Website SHALL maintain a minimum text-to-background contrast ratio of 4.5:1 for body text and 3:1 for large text (18px or above) to meet WCAG 2.1 AA compliance

### Requirement 4: 响应式设计 [Phase A]

**User Story:** As a mobile user, I want the website to be fully usable on my phone, so that I can browse documentation and access download links on any device.

#### Acceptance Criteria

1. THE Website SHALL render without layout overflow, overlapping elements, or truncated content on viewport widths from 320px to 2560px
2. WHILE the viewport width is less than 768px, THE Website SHALL display a hamburger menu for navigation; WHILE the viewport width is 768px or greater, THE Website SHALL display a horizontal navigation bar
3. WHILE the viewport width is less than 768px, THE Website SHALL stack content vertically and use a minimum body font size of 16px
4. WHILE the viewport width is less than 768px, THE Website SHALL ensure all interactive elements have a minimum touch target size of 44x44 pixels
5. THE Website SHALL not require horizontal scrolling on any supported viewport width
6. THE Website SHALL constrain images and media elements to a maximum width of 100% of their containing element to prevent overflow

### Requirement 5: 中英文双语支持 [Phase A partial, Phase B full]

**User Story:** As an international user, I want to browse the website in my preferred language (Chinese or English), so that I can understand the content without language barriers.

#### Acceptance Criteria

1. THE i18n_Router SHALL support Chinese (zh) and English (en) as available languages, with English as the default fallback language
2. WHEN a visitor first accesses the Website, THE i18n_Router SHALL detect the browser's preferred language via `navigator.language` and display content in Chinese if the language tag starts with "zh", or in English for all other language tags
3. THE Website SHALL provide a language switcher component in the page header, visible without scrolling on all pages, allowing the visitor to select Chinese or English
4. WHEN a visitor switches language via the language switcher, THE i18n_Router SHALL navigate to the corresponding language route (e.g., `/arthas/zh/docs/` ↔ `/arthas/en/docs/`) preserving the current page context [Phase B for non-doc pages]
5. THE Website SHALL persist the selected language preference in localStorage so that the preference is maintained across subsequent visits until the visitor explicitly changes it
6. THE Website SHALL include both Chinese and English versions of all static content (homepage, download page, roadmap page) such that every user-visible text element has a translation in both languages [Phase B for download/roadmap pages]
7. IF the visitor's browser preferred language is not Chinese (zh), THEN THE i18n_Router SHALL default to displaying content in English

### Requirement 6: 文档页面整合 [Phase A]

**User Story:** As a developer, I want to read comprehensive documentation on the website, so that I can understand the architecture, set up the project, and contribute.

#### Acceptance Criteria

1. THE Doc_Page SHALL render all Markdown files from the `official_doc/` directory as navigable HTML pages, where each `.md` file corresponds to one documentation page accessible via a unique URL path; THE build process SHALL symlink or copy `official_doc/` content into the Astro content collection at build time
2. THE Doc_Page SHALL provide a sidebar navigation listing all available documentation files, ordered according to the sequence defined in a Starlight sidebar configuration, with the currently viewed page visually highlighted
3. THE Doc_Page SHALL support both Chinese and English documentation (files with `.en.md` suffix for English, `.md` for Chinese) and provide a language toggle that switches between versions when available
4. WHEN a visitor navigates between documentation pages, THE Doc_Page SHALL preserve the sidebar scroll position and highlight the active page entry in the sidebar within 200ms of navigation completing
5. THE Doc_Page SHALL render fenced code blocks with language-specific syntax highlighting (supporting at minimum: go, typescript, bash, json, yaml) and a copy-to-clipboard button that copies the code block content to the system clipboard
6. THE Doc_Page SHALL resolve internal cross-reference links between documentation pages (relative Markdown links such as `[text](other-doc.md)`) to their corresponding rendered HTML routes; IF a cross-reference target file does not exist, THEN THE Doc_Page SHALL render the link as visually distinct non-clickable text
7. THE Doc_Page SHALL generate a table of contents for each documentation page based on h2 and h3 headings (Markdown `##` and `###`), displayed as a scrollable outline with indentation distinguishing heading levels
8. THE Doc_Page SHALL provide full-text search across all documentation pages via Starlight's built-in Pagefind integration, with results displayed in a modal overlay
9. IF a Markdown file in `official_doc/` fails to parse or is empty, THEN THE Doc_Page SHALL display a notice indicating the documentation page is unavailable instead of rendering a blank page

### Requirement 7: 下载与部署页面 [Phase B]

**User Story:** As a user, I want to find CLI download links and self-hosting instructions in one place, so that I can quickly set up Arthas on my preferred platform.

#### Acceptance Criteria

1. THE Download_Page SHALL display download links for both the server binary (arthas-server) and the CLI binary (arthas-cli) for all supported platforms: Linux amd64, Linux arm64, macOS amd64, macOS arm64, and Windows amd64
2. THE Download_Page SHALL construct download URLs pointing directly to the latest GitHub Release assets; version number and URLs SHALL be fetched from the GitHub Releases API at build time and baked into the static HTML
3. THE Download_Page SHALL display Docker self-hosting instructions as preformatted command blocks, each with a copy-to-clipboard button that copies the block content on click
4. THE Download_Page SHALL include a quick-start section containing no more than 3 numbered steps per deployment tier (Tier 1: Single Binary, Tier 2: Docker Compose) sufficient to go from download to a running instance
5. THE Download_Page SHALL present deployment tiers in separate labeled sections, each with a distinct heading identifying the tier name and use case (Tier 1: Single Binary — local/intranet, Tier 2: Docker Compose — production with auto-HTTPS)
6. IF the GitHub Releases API is unreachable at build time, THEN THE build process SHALL use a hardcoded fallback version and log a warning, and THE Download_Page SHALL include a direct link to the GitHub Releases page as fallback
7. THE Download_Page SHALL display the current version number prominently near the download buttons

### Requirement 8: 路线图可视化页面 [Phase B]

**User Story:** As a contributor or user, I want to see the project roadmap visually, so that I can understand what has been completed and what is planned.

#### Acceptance Criteria

1. THE Roadmap_Page SHALL display all project phases (Phase 1 through Phase 11) with each phase showing its name, completion percentage as an integer from 0 to 100, and one of three status labels: "completed", "in-progress", or "planned"
2. THE Roadmap_Page SHALL render a progress bar for each phase that fills proportionally to the phase's completion percentage (0-100%), where completed phases display a full bar, in-progress phases display a partially filled bar, and planned phases display an empty bar
3. THE Roadmap_Page SHALL visually distinguish between completed phases, in-progress phases, and planned phases using both a distinct status icon (✅, ⏳, 📋 respectively) and a distinct color for each status category
4. THE Roadmap_Page SHALL list up to 10 features per phase, each showing a feature name (maximum 80 characters) and a checked or unchecked indicator representing its completion state
5. THE Roadmap_Page SHALL be maintainable by editing a single JSON data file (`website/src/data/roadmap.json`), such that adding a new phase or updating a feature's completion status requires changes to only that one file and no code modifications
6. IF the data source file is missing or contains unparseable content, THEN THE Roadmap_Page SHALL display an error message indicating the data source could not be loaded, instead of rendering a blank or broken page
7. THE Roadmap_Page SHALL be navigable via keyboard and provide accessible labels for all status indicators so that screen readers can convey phase names, completion percentages, and status to assistive technology users

### Requirement 9: SEO 优化 [Phase A basic, Phase B full]

**User Story:** As a project maintainer, I want the website to be well-indexed by search engines, so that potential users can discover Arthas through organic search.

#### Acceptance Criteria

1. THE Website SHALL generate unique meta title (30–60 characters) and meta description (50–160 characters) tags for each page
2. THE Website SHALL generate Open Graph (og:title, og:description, og:image) and Twitter Card meta tags for social media sharing, where og:image references an image of at least 1200×630 pixels [Phase B]
3. THE Website SHALL generate a sitemap.xml file listing all public pages and serve it at the root path (/arthas/sitemap.xml), and THE Website SHALL include a robots.txt referencing the sitemap location
4. THE Website SHALL include structured data (JSON-LD) using the schema.org/SoftwareApplication type on the homepage [Phase B]
5. THE Website SHALL use semantic HTML elements (header, nav, main, article, footer) for content structure
6. THE Website SHALL generate a canonical URL via a `<link rel="canonical">` tag on every page to prevent duplicate content issues
7. WHEN the Website supports multiple languages, THE Website SHALL include hreflang tags on each page indicating all available language alternatives (zh, en) and a default (x-default) fallback

### Requirement 10: 导航与页面结构 [Phase A]

**User Story:** As a visitor, I want clear navigation between all sections of the website, so that I can find information quickly.

#### Acceptance Criteria

1. THE Website SHALL include a fixed-position header navigation that remains visible at the top of the viewport during scrolling; in Phase A, navigation links SHALL include: Home, Docs, and GitHub repository; in Phase B, Download and Roadmap links SHALL be added
2. THE Website SHALL include a footer with links to: GitHub repository, License (AGPL-3.0), and the Launch_App_Button
3. THE Website SHALL visually distinguish the currently active navigation item from inactive items using a different color, underline, or font weight so that the active state is unambiguous
4. WHEN a visitor clicks the Launch_App_Button in the header or footer, THE Website SHALL open the Vercel application in a new browser tab
5. THE Website SHALL include a GitHub star button or link in the header that navigates to the Arthas GitHub repository page
6. WHEN the user scrolls past the first viewport height, THE Website SHALL display a "Back to top" button [Phase B]
7. WHEN the user clicks the "Back to top" button, THE Website SHALL scroll the page to the top and hide the "Back to top" button once the page reaches the top [Phase B]

### Requirement 11: 构建与开发体验 [Phase A]

**User Story:** As a developer contributing to the website, I want a smooth local development experience, so that I can preview changes quickly and deploy with confidence.

#### Acceptance Criteria

1. THE Website project SHALL be located in a `website/` directory at the repository root
2. THE Website SHALL support local development with hot-reload where source code file changes are reflected in the browser within 1 second without a manual page refresh
3. THE Website SHALL include a README.md file in the `website/` directory containing at minimum: prerequisites (Node.js 18+, pnpm), dependency installation command, dev server start command, production build command, and documentation symlink setup
4. THE Website build process SHALL complete within 60 seconds on a GitHub Actions `ubuntu-latest` runner
5. THE Website SHALL produce zero warnings when built using the production build command (`pnpm build`)
6. IF a build error occurs during CI/CD deployment, THEN THE GitHub_Actions workflow SHALL fail the pipeline with a non-zero exit code and include the build tool's error output in the job logs
7. THE build script SHALL include a step to symlink or copy `../official_doc/` into the Starlight content directory before building, ensuring documentation is always up-to-date with the source
