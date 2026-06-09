# Requirements Document

## Introduction

本规格描述 Arthas 项目针对 **room-activity-ranking**（房间活跃度排序）和 **random-match**（随机配对聊天）两个新功能的文档更新工作。更新范围涵盖四个层面：

1. **README 更新** — 在双语 README（`README.md` 英文 / `README.zh.md` 中文）的 Features 列表新增条目，并在 Arthas Hub 章节后新增独立小节描述功能用法
2. **官方文档新增** — 在 `official_doc/` 中为每个功能创建中英双语文档页（共 4 个文件）
3. **动画演示页面** — 在 `website/src/pages/` 中创建 Astro 页面，使用 `docs/beta/css-animation-guide.md` 中的 CSS 动画技术生成交互式动图演示
4. **SVG 图表** — 在 `docs/diagrams/` 中创建功能流程图，供 README 和官方文档引用

所有文档更新需保持中英文结构一致、术语统一。

## Glossary

- **README_EN**: 英文版 README 文件 (`README.md`)，面向 GitHub 首页访客
- **README_ZH**: 中文版 README 文件 (`README.zh.md`)，面向中文用户
- **Official_Doc**: 位于 `official_doc/` 目录的用户文档，遵循 `.md`（中文）和 `.en.md`（英文）命名约定
- **Demo_Page**: 位于 `website/src/pages/` 的 Astro 页面，使用 CSS 动画技术展示功能流程的交互式动图
- **SVG_Diagram**: 位于 `docs/diagrams/` 的矢量流程图，用于 README 和文档中嵌入展示
- **CSS_Animation_Guide**: 位于 `docs/beta/css-animation-guide.md` 的动画技术参考，提供 Tailwind + @keyframes 动效原语
- **Features_List**: README 中的功能特性列表（当前 18 项），使用 emoji + 粗体标题 + 短描述格式
- **Feature_Section**: README 中 Arthas Hub 章节后新增的独立小节，包含功能说明、流程图和使用步骤
- **Landing_Layout**: 网站使用的 Astro 布局组件 (`src/layouts/Landing.astro`)，用于包裹页面内容
- **Activity_Ranking**: 房间活跃度排序功能，包含排序模式（🔥最活跃/👥最多人/🆕最新/全部）、全局在线人数、5分钟滑动窗口活跃追踪
- **Random_Match**: 随机配对聊天功能，定位为"加密版 Omegle"，包含随机配对、兴趣标签、邀请链接冷启动、"Next"按钮连续会话、双方同意延时、举报拉黑系统

## Requirements

### Requirement 1: README Features 列表更新

**User Story:** 作为 GitHub 访客，我希望在 README Features 列表中看到新功能条目，以便快速了解项目的完整功能集。

#### Acceptance Criteria

1. THE README_EN SHALL include a new feature entry for Activity_Ranking in the Features list with emoji icon, bold title, and a concise English description (following existing format: `- 🔥 **Room Activity Ranking** – ...`).
2. THE README_EN SHALL include a new feature entry for Random_Match in the Features list with emoji icon, bold title, and a concise English description (following existing format: `- 🎲 **Random Match** – ...`).
3. THE README_ZH SHALL include corresponding feature entries for Activity_Ranking and Random_Match in Chinese, using identical emoji icons and structurally equivalent descriptions.
4. THE Features_List entries for Activity_Ranking SHALL mention sort modes and activity tracking as key capabilities.
5. THE Features_List entries for Random_Match SHALL mention encrypted random pairing and Omegle-style experience as key capabilities.
6. WHEN the Features_List is updated, THE README_EN and README_ZH SHALL maintain identical entry count and ordering.

### Requirement 2: README 独立功能章节

**User Story:** 作为项目使用者，我希望在 README 中找到独立的功能说明章节，以便了解新功能的具体用法和工作流程。

#### Acceptance Criteria

1. THE README_EN SHALL include an "Activity Ranking" section placed after the existing "Arthas Hub (Public Room Directory)" section, following the same structural pattern as the "Chrome Extension" section (title, diagram, description, usage steps).
2. THE README_EN SHALL include a "Random Match" section placed after the "Activity Ranking" section, following the same structural pattern.
3. THE README_ZH SHALL include corresponding Chinese versions of both sections with structurally equivalent content.
4. THE Activity_Ranking section SHALL include an embedded SVG_Diagram reference showing the sort mode workflow.
5. THE Random_Match section SHALL include an embedded SVG_Diagram reference showing the match flow.
6. THE Activity_Ranking section SHALL describe: how to switch sort modes, what each mode shows, and the online count indicator.
7. THE Random_Match section SHALL describe: how to enter matching, interest tag selection, the match-chat-next loop, invite link for cold start, and room extension.
8. WHEN both README versions are updated, THE section headings, diagram references, and step numbering SHALL be structurally identical between README_EN and README_ZH.

### Requirement 3: 官方文档 — Activity Ranking

**User Story:** 作为用户，我希望有详尽的活跃度排序文档，以便深入理解功能原理和使用细节。

#### Acceptance Criteria

1. THE Official_Doc SHALL include a new file `official_doc/activity-ranking.md` written in Chinese, containing the complete Activity_Ranking feature documentation.
2. THE Official_Doc SHALL include a new file `official_doc/activity-ranking.en.md` written in English, containing the same content translated to English.
3. THE activity-ranking documentation SHALL include: feature overview, sort mode descriptions (🔥最活跃/👥最多人/🆕最新/全部), global online count explanation, and technical notes on the 5-minute sliding window.
4. THE activity-ranking documentation SHALL include a language toggle link at the top (Chinese version links to `.en.md`, English version links to `.md`), following the pattern used in existing Official_Doc files.
5. THE activity-ranking documentation SHALL reference the SVG_Diagram for the activity ranking flow.
6. THE activity-ranking documentation SHALL include a usage guide section with step-by-step instructions for using sort modes on the Hub page.

### Requirement 4: 官方文档 — Random Match

**User Story:** 作为用户，我希望有详尽的随机配对文档，以便了解功能的完整使用方法和安全保障。

#### Acceptance Criteria

1. THE Official_Doc SHALL include a new file `official_doc/random-match.md` written in Chinese, containing the complete Random_Match feature documentation.
2. THE Official_Doc SHALL include a new file `official_doc/random-match.en.md` written in English, containing the same content translated to English.
3. THE random-match documentation SHALL include: feature overview (加密版 Omegle 定位), matching flow, interest tag system, invite link cold-start mechanism, "Next" button session loop, room extension by mutual consent, and report/block system.
4. THE random-match documentation SHALL include a language toggle link at the top, following the pattern used in existing Official_Doc files.
5. THE random-match documentation SHALL reference the SVG_Diagram for the random match flow.
6. THE random-match documentation SHALL include a security section explaining the E2EE key exchange model (Client A generates key, server relays without persisting).
7. THE random-match documentation SHALL include a configuration section listing server-side parameters (match timeout, room expiry, cooldown, rate limits).

### Requirement 5: 动画演示页面 — Activity Ranking

**User Story:** 作为官网访客，我希望看到活跃度排序的交互式动画演示，以便直观理解功能的视觉效果和交互流程。

#### Acceptance Criteria

1. THE Demo_Page SHALL include a new Astro page at `website/src/pages/demo/activity-ranking.astro` (English version) accessible via the project website.
2. THE Demo_Page SHALL include a corresponding Chinese version at `website/src/pages/zh/demo/activity-ranking.astro`.
3. THE Demo_Page for Activity_Ranking SHALL use CSS animations from the CSS_Animation_Guide (pulse-glow, fade-in-up, shimmer effects) to demonstrate sort mode switching visually.
4. THE Demo_Page SHALL show animated representations of: room cards reordering when sort mode changes, activity indicators pulsing on active rooms, and the online count display.
5. THE Demo_Page SHALL use the Landing_Layout and follow existing website page patterns (locale prop, Footer component).
6. THE Demo_Page SHALL include `prefers-reduced-motion` media query support to disable animations for accessibility.
7. THE Demo_Page SHALL be responsive and display correctly on mobile viewports (min-width 320px).

### Requirement 6: 动画演示页面 — Random Match

**User Story:** 作为官网访客，我希望看到随机配对的交互式动画演示，以便直观理解配对流程和聊天体验。

#### Acceptance Criteria

1. THE Demo_Page SHALL include a new Astro page at `website/src/pages/demo/random-match.astro` (English version) accessible via the project website.
2. THE Demo_Page SHALL include a corresponding Chinese version at `website/src/pages/zh/demo/random-match.astro`.
3. THE Demo_Page for Random_Match SHALL use CSS animations from the CSS_Animation_Guide (dot-move for matching animation, pulse-glow for waiting state, dash-flow for connection lines) to demonstrate the pairing process.
4. THE Demo_Page SHALL show animated representations of: waiting state with orbiting indicator, match-found success animation, encrypted message flow between two parties, and the "Next" button loop.
5. THE Demo_Page SHALL use the Landing_Layout and follow existing website page patterns (locale prop, Footer component).
6. THE Demo_Page SHALL include `prefers-reduced-motion` media query support to disable animations for accessibility.
7. THE Demo_Page SHALL be responsive and display correctly on mobile viewports (min-width 320px).

### Requirement 7: SVG 流程图

**User Story:** 作为文档读者，我希望看到清晰的流程图，以便一目了然地理解功能的工作流程。

#### Acceptance Criteria

1. THE SVG_Diagram SHALL include a new file `docs/diagrams/activity-ranking-flow.svg` illustrating the activity ranking workflow (user selects sort mode → Hub API responds with sorted rooms → frontend displays reordered room cards).
2. THE SVG_Diagram SHALL include a new file `docs/diagrams/random-match-flow.svg` illustrating the random match workflow (user clicks match → enters queue → paired → key exchange → encrypted chat room created).
3. THE SVG diagrams SHALL follow the visual style of existing diagrams in `docs/diagrams/` (consistent color palette, layout conventions, font choices).
4. THE SVG diagrams SHALL be self-contained (no external dependencies) and render correctly in GitHub markdown preview.
5. THE SVG diagrams SHALL include English text labels (matching the existing English-labeled SVG convention in the repository).
6. THE activity-ranking-flow.svg SHALL depict: the four sort modes as tab options, the server-side sliding window concept, and the sorted room list output.
7. THE random-match-flow.svg SHALL depict: queue entry, pairing logic, key exchange (Client A → Server relay → Client B), and room creation.

### Requirement 8: 文档表格更新

**User Story:** 作为用户，我希望在 README 的 Documentation 表格中找到新文档的链接，以便快速导航到详细文档。

#### Acceptance Criteria

1. THE README_EN SHALL add entries to the Documentation table for Activity_Ranking and Random_Match, linking to their respective `.en.md` files with English descriptions.
2. THE README_ZH SHALL add entries to the Documentation table (文档表格) for Activity_Ranking and Random_Match, linking to their respective `.md` files with Chinese descriptions.
3. WHEN the Documentation table is updated, THE new entries SHALL follow the existing format: `| [Title](path) | Description |`.
4. THE Activity_Ranking documentation link SHALL use the title "Activity Ranking" (EN) / "活跃度排序" (ZH).
5. THE Random_Match documentation link SHALL use the title "Random Match" (EN) / "随机配对" (ZH).

### Requirement 9: 双语一致性

**User Story:** 作为项目维护者，我希望所有中英文文档在结构和内容上保持同步，以便两种语言的读者获得同等质量的信息。

#### Acceptance Criteria

1. THE README_EN and README_ZH SHALL have identical section structure, heading hierarchy, and diagram references after the update.
2. THE Official_Doc Chinese and English versions SHALL cover the same topics, contain the same number of sections, and reference the same diagrams.
3. THE Demo_Page English and Chinese versions SHALL use identical animations, layout structure, and interactive elements, differing only in text labels.
4. WHEN a new feature entry is added to the Features_List, THE entry SHALL appear at the same list position in both README_EN and README_ZH.
5. THE SVG_Diagram files SHALL be shared between Chinese and English documentation (single SVG file referenced by both language versions).

### Requirement 10: Status 章节更新

**User Story:** 作为 GitHub 访客，我希望 README 的 Status 章节反映新功能的加入，以便了解项目当前的功能完成度。

#### Acceptance Criteria

1. WHEN the README is updated, THE Status section in README_EN SHALL include "Activity Ranking" and "Random Match" in the feature list summary.
2. WHEN the README is updated, THE Status section in README_ZH SHALL include "活跃度排序" and "随机配对" in the feature list summary.
3. THE Status section SHALL update the feature count or description to reflect the addition of two new features.
