# Implementation Plan: 文档功能更新（docs-feature-update）

## Overview

为 Arthas 项目的 Room Activity Ranking 和 Random Match 两个新功能创建完整的文档产出物。任务按依赖关系排序：SVG 图表 → 官方文档 → README 更新 → Demo 演示页面 → 验证脚本。

## Tasks

- [x] 1. 创建 SVG 流程图
  - [x] 1.1 创建 `docs/diagrams/activity-ranking-flow.svg`
    - 遵循现有 SVG 视觉规范（暗色渐变背景 `#0f172a` → `#1e293b`、科技感配色）
    - viewBox 设为 `0 0 900 520`，使用 `system-ui` 字体
    - 描绘：四种排序模式 Tab（🔥 Active / 👥 People / 🆕 Newest / All）、Hub API + ActivityTracker（5-min window）服务器处理区、排序后房间卡片列表、底部在线人数指示器
    - 使用英文标签，所有样式/渐变内联，不引入外部依赖
    - 包含 `@media (prefers-reduced-motion: reduce)` 禁用动画
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6_

  - [x] 1.2 创建 `docs/diagrams/random-match-flow.svg`
    - 沿用相同视觉规范和画布尺寸
    - 描绘：左右对称三列布局（Client A / Server / Client B）、MatchReq → Queue → Pairing Algorithm → Key Exchange（Client A 生成 AES → Server Relay → Client B 接收）→ Match Room（E2EE Chat, 30min expiry）
    - 底部功能徽章：🏷️ Interest Tags / ⏱️ 60s Timeout / 🔗 Invite Link / 🔄 Next
    - 使用英文标签，SVG 自包含无外部引用
    - 包含 `@media (prefers-reduced-motion: reduce)` 禁用动画
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.7_

- [x] 2. 创建官方文档（Activity Ranking）
  - [x] 2.1 创建 `official_doc/activity-ranking.md`（中文版）
    - 顶部添加语言切换链接 `[English](activity-ranking.en.md)`
    - 章节结构：功能概述 → 排序模式（4 种）→ 全局在线人数 → 技术说明（5 分钟滑动窗口）→ 使用指南（步骤 1-4）→ 流程图引用
    - 引用 `../docs/diagrams/activity-ranking-flow.svg`
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6_

  - [x] 2.2 创建 `official_doc/activity-ranking.en.md`（英文版）
    - 顶部添加语言切换链接 `[中文](activity-ranking.md)`
    - 与中文版保持相同章节结构、相同数量的 H2 小节、引用相同 SVG 路径
    - 内容为对应英文翻译
    - _Requirements: 3.2, 3.4, 3.5, 3.6, 9.2_

- [x] 3. 创建官方文档（Random Match）
  - [x] 3.1 创建 `official_doc/random-match.md`（中文版）
    - 顶部添加语言切换链接 `[English](random-match.en.md)`
    - 章节结构：功能概述（加密版 Omegle 定位）→ 配对流程 → 兴趣标签系统 → 邀请链接冷启动 → "Next" 连续会话 → 房间延时（双方同意）→ 举报与拉黑 → 安全模型（E2EE 密钥交换）→ 服务器配置参数表 → 流程图引用
    - 引用 `../docs/diagrams/random-match-flow.svg`
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 3.2 创建 `official_doc/random-match.en.md`（英文版）
    - 顶部添加语言切换链接 `[中文](random-match.md)`
    - 与中文版保持相同章节结构、相同数量的 H2 小节、引用相同 SVG 路径
    - 包含安全章节（E2EE key exchange model）和配置参数表
    - _Requirements: 4.2, 4.4, 4.5, 4.6, 4.7, 9.2_

- [x] 4. Checkpoint — 确认图表与文档
  - 确保所有 SVG 文件自包含无外部引用，确保官方文档中英文版章节结构对等。如有疑问请询问用户。

- [x] 5. 更新 README.md（英文版）
  - [x] 5.1 在 README.md Features 列表中新增条目
    - 在 `🌐 Arthas Hub` 条目之后插入 Activity Ranking 和 Random Match 两个条目
    - 格式：`- 🔥 **Room Activity Ranking** – Sort Hub rooms by activity, members, or recency; 5-minute sliding window tracking with global online count`
    - 格式：`- 🎲 **Random Match** – Encrypted Omegle-style random pairing with interest tags, session loop, invite link cold-start, and mutual room extension`
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [x] 5.2 在 README.md 中新增独立功能章节
    - 在 "Arthas Hub (Public Room Directory)" 章节之后新增 "Activity Ranking" 章节和 "Random Match (Encrypted Omegle)" 章节
    - 每个章节包含：居中 SVG 图表引用（`<p align="center"><img src="docs/diagrams/..." width="900"/></p>`）、功能说明、使用步骤
    - Activity Ranking 章节：排序模式说明 + 在线人数 + 使用步骤
    - Random Match 章节：加密配对定位 + 使用步骤 + 冷启动机制 + 安全说明
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7_

  - [x] 5.3 更新 README.md Documentation 表格
    - 新增行：`| [Activity Ranking](official_doc/activity-ranking.en.md) | Hub room sort modes and activity tracking |`
    - 新增行：`| [Random Match](official_doc/random-match.en.md) | Encrypted random pairing (Omegle-style) |`
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

  - [x] 5.4 更新 README.md Status 章节
    - 在功能列表摘要中追加 "Activity Ranking" 和 "Random Match"
    - 更新功能数量描述以反映新增两个功能
    - _Requirements: 10.1, 10.3_

- [x] 6. 更新 README.zh.md（中文版）
  - [x] 6.1 在 README.zh.md Features 列表中新增条目
    - 与英文版保持相同位置（`🌐 Arthas Hub` 之后）
    - 格式：`- 🔥 **房间活跃度排序** – 按活跃度、人数、最新排序 Hub 房间；5 分钟滑动窗口追踪 + 全局在线人数`
    - 格式：`- 🎲 **随机配对** – 加密版 Omegle 随机配对，支持兴趣标签、连续会话、邀请链接冷启动、双方同意延时`
    - _Requirements: 1.3, 1.4, 1.5, 1.6_

  - [x] 6.2 在 README.zh.md 中新增独立功能章节
    - 与英文版结构完全对应：相同章节标题层级、相同图表引用路径、相同步骤编号
    - Activity Ranking 章节内容为中文
    - Random Match 章节内容为中文
    - _Requirements: 2.3, 2.4, 2.5, 2.8_

  - [x] 6.3 更新 README.zh.md 文档表格
    - 新增行：`| [活跃度排序](official_doc/activity-ranking.md) | Hub 房间排序模式与活跃度追踪 |`
    - 新增行：`| [随机配对](official_doc/random-match.md) | 加密随机配对聊天（Omegle 风格） |`
    - _Requirements: 8.2, 8.3, 8.4, 8.5_

  - [x] 6.4 更新 README.zh.md Status 章节
    - 在功能列表摘要中追加"活跃度排序"和"随机配对"
    - 更新功能数量描述
    - _Requirements: 10.2, 10.3_

- [x] 7. Checkpoint — 确认 README 双语一致性
  - 确保 README.md 和 README.zh.md 的 Features 列表条目数相同、章节结构对称、图表引用路径一致。如有疑问请询问用户。

- [x] 8. 创建动画演示页面（Activity Ranking）
  - [x] 8.1 创建 `website/src/pages/demo/activity-ranking.astro`（英文版）
    - 使用 `Landing.astro` 布局 + `Footer.astro` 组件
    - 页面区块：Header → 排序模式交互区（4 个 Tab）→ 房间卡片区（模拟卡片重排）→ 活跃指示器（脉冲）→ 在线人数（shimmer）
    - CSS 动画：`fade-in-up`（卡片出现）、`pulse-glow`（活跃指示器）、`shimmer`（数字光效）
    - 包含 `@media (prefers-reduced-motion: reduce)` 禁用所有动画
    - 响应式设计（min-width 320px）
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 8.2 创建 `website/src/pages/zh/demo/activity-ranking.astro`（中文版）
    - 与英文版完全相同的 HTML 结构、CSS 动画、class 名称
    - 仅文本标签替换为中文（title/description prop + 页面内文案）
    - _Requirements: 5.2, 5.5, 9.3_

- [x] 9. 创建动画演示页面（Random Match）
  - [x] 9.1 创建 `website/src/pages/demo/random-match.astro`（英文版）
    - 使用 `Landing.astro` 布局 + `Footer.astro` 组件
    - 页面区块：Header → 等待配对区（dot-move 粒子 + pulse-glow）→ 配对成功区（fade-in-up）→ 加密通信区（dash-flow SVG 虚线）→ 功能循环区（Next 按钮）
    - CSS 动画：`dot-move`（轨道粒子）、`pulse-glow`（等待发光）、`dash-flow`（虚线流动）、`fade-in-up`（成功提示）
    - 包含 `@media (prefers-reduced-motion: reduce)` 禁用所有动画
    - 响应式设计（min-width 320px）
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 9.2 创建 `website/src/pages/zh/demo/random-match.astro`（中文版）
    - 与英文版完全相同的 HTML 结构、CSS 动画、class 名称
    - 仅文本标签替换为中文（title/description prop + 页面内文案）
    - _Requirements: 6.2, 6.5, 9.3_

- [x] 10. 创建双语一致性验证脚本
  - [x] 10.1 创建 `scripts/validate-docs-structure.py`
    - 验证 Property 1：解析 README.md 和 README.zh.md 的 Features 列表，比较 emoji 序列和条目数是否一致
    - 验证 Property 2：提取两份 README 的 H2/H3 标题和 `<img src>` 引用，比较序列是否对等
    - 验证 Property 3：解析 `official_doc/activity-ranking.md` 与 `.en.md`、`random-match.md` 与 `.en.md`，验证 H2 数量一致、SVG 引用一致、语言切换链接存在
    - 验证 Property 4：解析 Demo Astro 文件对（EN/ZH），验证 `@keyframes` 定义和 HTML 标签结构一致
    - 验证 Property 5：解析 `docs/diagrams/*.svg`，确认无外部资源引用（无 `xlink:href` 外链、无 `<image href="http...">`）
    - 输出格式参照现有 `scripts/validate-translations.py`（Property 编号 + ✅/❌ + 详细错误信息）
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 11. Final Checkpoint — 运行验证脚本确认全部通过
  - 运行 `python scripts/validate-docs-structure.py` 确保所有 5 个 Property 通过。如有疑问请询问用户。

## Notes

- 本项目为纯文档更新，不涉及运行时代码变更
- SVG 图表使用英文标签，中英文文档共享引用同一 SVG 文件
- Demo 页面复用 `docs/beta/css-animation-guide.md` 中的动效原语，不引入 JS 动画库
- 验证脚本使用 Python 编写，与现有 `scripts/validate-translations.py` 风格一致
- Tasks 标记说明：无 `*` 标记的子任务均为必须实现项

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "3.2"] },
    { "id": 2, "tasks": ["5.1", "5.2", "5.3", "5.4", "6.1", "6.2", "6.3", "6.4"] },
    { "id": 3, "tasks": ["8.1", "8.2", "9.1", "9.2"] },
    { "id": 4, "tasks": ["10.1"] }
  ]
}
```
