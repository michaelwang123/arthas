# Design Document: 文档功能更新（docs-feature-update）

## 概述

本设计文档描述 Arthas 项目为 **Room Activity Ranking**（房间活跃度排序）和 **Random Match**（随机配对聊天）两个新功能所需的文档更新方案。涵盖四大产出物：

1. **README 双语更新** — Features 列表条目 + 独立功能章节 + 文档表格 + Status 更新
2. **官方文档 4 文件** — `activity-ranking.md` / `.en.md` + `random-match.md` / `.en.md`
3. **动画演示页面 4 文件** — Astro 页面展示功能流程的 CSS 交互动图
4. **SVG 流程图 2 文件** — `activity-ranking-flow.svg` + `random-match-flow.svg`

### 设计原则

- **结构对等** — 中英文文档保持相同的章节结构、标题层级、图表引用
- **SVG 共享** — 流程图使用英文标签，中英文版本引用同一 SVG 文件
- **动画复用** — Demo 页面复用 `css-animation-guide.md` 中定义的动效原语，不引入新的 JS 动画库
- **风格一致** — SVG 图表沿用 `docs/diagrams/` 现有的暗色渐变 + 科技感配色
- **布局统一** — Demo 页面使用 `Landing.astro` 布局，遵循现有页面模式

---

## 架构

```
产出物层次：

┌─────────────────────────────────────────────────────────────┐
│  README.md / README.zh.md                                    │
│  • Features 列表新增 2 条目                                  │
│  • 独立功能章节（Activity Ranking / Random Match）            │
│  • Documentation 表格新增 2 行                               │
│  • Status 章节更新                                           │
└──────────────────────────────┬──────────────────────────────┘
                               │ 引用
┌──────────────────────────────▼──────────────────────────────┐
│  docs/diagrams/                                              │
│  • activity-ranking-flow.svg                                 │
│  • random-match-flow.svg                                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ 引用
┌──────────────────────────────▼──────────────────────────────┐
│  official_doc/                                               │
│  • activity-ranking.md / activity-ranking.en.md              │
│  • random-match.md / random-match.en.md                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  website/src/pages/                                          │
│  • demo/activity-ranking.astro                               │
│  • demo/random-match.astro                                   │
│  • zh/demo/activity-ranking.astro                            │
│  • zh/demo/random-match.astro                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 组件与接口

### 1. README Features 列表格式

遵循现有格式：`- {emoji} **{标题}** – {描述}`

**Activity Ranking 条目：**

```markdown
<!-- EN -->
- 🔥 **Room Activity Ranking** – Sort Hub rooms by activity, members, or recency; 5-minute sliding window tracking with global online count

<!-- ZH -->
- 🔥 **房间活跃度排序** – 按活跃度、人数、最新排序 Hub 房间；5 分钟滑动窗口追踪 + 全局在线人数
```

**Random Match 条目：**

```markdown
<!-- EN -->
- 🎲 **Random Match** – Encrypted Omegle-style random pairing with interest tags, session loop, invite link cold-start, and mutual room extension

<!-- ZH -->
- 🎲 **随机配对** – 加密版 Omegle 随机配对，支持兴趣标签、连续会话、邀请链接冷启动、双方同意延时
```

**插入位置：** 在现有 Features 列表中 `🌐 Arthas Hub` 条目之后。

### 2. README 独立功能章节结构

章节放置于现有 "Arthas Hub (Public Room Directory)" 章节之后，遵循相同的结构模式：

```markdown
### Activity Ranking

<p align="center">
  <img src="docs/diagrams/activity-ranking-flow.svg" alt="Activity Ranking Flow" width="900"/>
</p>

{功能说明 + 使用步骤}

### Random Match (Encrypted Omegle)

<p align="center">
  <img src="docs/diagrams/random-match-flow.svg" alt="Random Match Flow" width="900"/>
</p>

{功能说明 + 使用步骤}
```

**Activity Ranking 章节内容要点：**
- 四种排序模式介绍（🔥 Most Active / 👥 Most People / 🆕 Newest / All）
- 全局在线人数指示器
- 使用步骤（1. 进入 Hub → 2. 切换排序模式 → 3. 查看排序结果）

**Random Match 章节内容要点：**
- 加密版 Omegle 定位说明
- 使用步骤（1. 选兴趣标签 → 2. 点击配对 → 3. 等待匹配 → 4. 加密聊天 → 5. Next/延时）
- 冷启动邀请链接机制
- 安全说明（E2EE + 服务器零知识）

### 3. SVG 流程图设计

#### 3.1 视觉规范（沿用现有风格）

基于 `arthas-hub-flow.svg` 的分析，SVG 图表统一遵循：

| 属性 | 值 |
|------|-----|
| 画布尺寸 | `viewBox="0 0 900 520"` |
| 背景渐变 | `#1a1b2e` → `#0f1019` (纵向) |
| 卡片背景 | `#2d2f45` → `#1e2035` (纵向渐变) |
| 主色（强调） | `#6366f1` (indigo) / `#8b5cf6` (violet) |
| 成功色 | `#22c55e` (green) |
| 边框常态 | `#374151` (gray-700) |
| 文字标题 | `#e2e8f0` (gray-200) |
| 文字辅助 | `#94a3b8` (gray-400) |
| 徽章背景 | `#1e293b` |
| 徽章文字 | `#a5b4fc` (indigo-300) / `#86efac` (green-300) |
| 字体 | `system-ui, -apple-system, sans-serif` |
| 圆角 | `rx="12"` (卡片) / `rx="13"` (徽章) |
| 箭头 | marker-end + 动画 `arrow-flow` |
| 无障碍 | `@media (prefers-reduced-motion: reduce)` 禁用动画 |

#### 3.2 activity-ranking-flow.svg 布局

```
┌───────────────────────────────────────────────────────────────┐
│  Title: "Activity Ranking — Hub Room Sort Flow"               │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  [用户操作区]                                                  │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐                     │
│  │🔥 Active│→│👥 People│→│🆕 Newest│→│All    │  ← 排序模式 Tabs │
│  └──────┘  └──────┘  └──────┘  └──────┘                     │
│       │                                                       │
│       ▼                                                       │
│  [服务器处理区]                                                │
│  ┌────────────────────────────────────────┐                   │
│  │  Hub API  (/api/hub?sort=active)       │                   │
│  │  ┌───────────────┐  ┌──────────────┐  │                   │
│  │  │ActivityTracker │  │ Sort & Page  │  │                   │
│  │  │(5-min window)  │  │              │  │                   │
│  │  └───────────────┘  └──────────────┘  │                   │
│  └────────────────────────────────────────┘                   │
│       │                                                       │
│       ▼                                                       │
│  [结果展示区]                                                  │
│  ┌───────┐ ┌───────┐ ┌───────┐                               │
│  │Room A  │ │Room B  │ │Room C  │  ← 排序后的房间卡片          │
│  │🔥 45   │ │🔥 32   │ │🔥 12   │     (含活跃计数)            │
│  └───────┘ └───────┘ └───────┘                               │
│                                                               │
│  [底部信息栏]                                                  │
│  🟢 N people online   │  5-min sliding window                 │
└───────────────────────────────────────────────────────────────┘
```

**关键元素：**
- 4 个排序模式 Tab 用徽章样式
- 中间服务器处理区用虚线流动动画 (`dash-flow`)
- 排序后房间卡片用 `pulse-glow` 强调活跃度
- 在线人数用绿色圆点 + 脉冲动画

#### 3.3 random-match-flow.svg 布局

```
┌───────────────────────────────────────────────────────────────┐
│  Title: "Random Match — Encrypted Pairing Flow"               │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  [用户A]              [Server]              [用户B]            │
│  ┌─────┐              ┌─────┐              ┌─────┐           │
│  │Click│──MatchReq───▶│Queue│◀──MatchReq──│Click│            │
│  │Match│              │     │              │Match│            │
│  └─────┘              └─────┘              └─────┘           │
│     │                    │                    │               │
│     │                    ▼                    │               │
│     │              ┌──────────┐               │               │
│     │              │ Pairing  │               │               │
│     │              │Algorithm │               │               │
│     │              └────┬─────┘               │               │
│     │                   │                     │               │
│     ▼                   ▼                     ▼               │
│  ┌─────┐         ┌──────────┐          ┌─────┐              │
│  │Gen  │──Key───▶│  Relay   │───Key───▶│Recv │              │
│  │AES  │         │(no store)│          │Key  │              │
│  └─────┘         └──────────┘          └─────┘              │
│     │                   │                     │               │
│     └───────────────────┼─────────────────────┘              │
│                         ▼                                     │
│                  ┌─────────────┐                              │
│                  │ Match Room  │                              │
│                  │ E2EE Chat   │                              │
│                  │ 30min expiry│                              │
│                  └─────────────┘                              │
│                                                               │
│  [底部功能栏]                                                  │
│  🏷️ Interest Tags │ ⏱️ 60s Timeout │ 🔗 Invite Link │ 🔄 Next │
└───────────────────────────────────────────────────────────────┘
```

**关键元素：**
- 左右对称布局（Client A / Server / Client B 三列）
- 匹配请求线用 `dot-move` 粒子动画
- 密钥中转线用 `dash-flow` 虚线流动
- Match Room 卡片用 `pulse-glow` 发光效果
- 底部功能徽章与 `arthas-hub-flow.svg` 风格一致

### 4. 官方文档结构设计

#### 4.1 文件命名与语言切换

| 文件路径 | 语言 | 顶部切换链接 |
|----------|------|-------------|
| `official_doc/activity-ranking.md` | 中文 | `[English](activity-ranking.en.md)` |
| `official_doc/activity-ranking.en.md` | 英文 | `[中文](activity-ranking.md)` |
| `official_doc/random-match.md` | 中文 | `[English](random-match.en.md)` |
| `official_doc/random-match.en.md` | 英文 | `[中文](random-match.md)` |

#### 4.2 activity-ranking 文档章节大纲

```markdown
# 房间活跃度排序 / Activity Ranking

[English](activity-ranking.en.md) ← 语言切换

## 功能概述
- 定位：Hub 页面的发现增强
- 核心能力：排序模式 + 在线人数 + 活跃追踪

## 排序模式
- 🔥 最活跃 — 按 5 分钟内消息数降序
- 👥 最多人 — 按当前成员数降序
- 🆕 最新 — 按创建时间降序
- 全部 — 默认排序（人数优先）

## 全局在线人数
- 显示位置（Hub 页头）
- 实时性说明（30 秒轮询更新）

## 技术说明
- 5 分钟滑动窗口原理
- 隐私保护（仅计数中转事件，不检查内容）
- 内存限制（每房间最多 10,000 条记录）

## 使用指南
1. 进入 Hub 页面
2. 点击排序模式 Tab
3. 查看排序结果
4. 观察在线人数指示器

## 流程图
<img src="../docs/diagrams/activity-ranking-flow.svg" />
```

#### 4.3 random-match 文档章节大纲

```markdown
# 随机配对 / Random Match

[English](random-match.en.md) ← 语言切换

## 功能概述
- 定位：加密版 Omegle
- 核心体验：无注册 + E2EE + 阅后即焚的随机聊天

## 配对流程
- 进入匹配队列
- 兴趣标签优先匹配
- 60 秒超时 + 冷启动降级

## 兴趣标签系统
- 预定义标签：#tech #music #gaming #random #language #movies
- 最多选 3 个
- 标签优先 + 10 秒后降级为 FIFO

## 邀请链接（冷启动）
- 生成机制
- 链接格式：{baseUrl}/match/{token}
- 5 分钟有效期 / 单次使用

## "Next" 连续会话
- 不离开流程直接进入下一次配对
- 排除刚配对过的对象
- 10 秒冷却期

## 房间延时（双方同意）
- 剩余 5 分钟时触发
- 双方点击 Extend
- 最多延长 3 次（总时长 2 小时）

## 举报与拉黑
- 举报分类
- IP 级 24 小时封禁
- 3 次举报阈值

## 安全模型
- Client A 生成 AES-256 密钥
- 服务器仅中转，不存储密钥
- Zero-knowledge 保证不因配对功能降级
- Match_Room 不注册到 HubRegistry

## 服务器配置
| 参数 | 默认值 | 说明 |
|------|--------|------|
| match timeout | 60s | 队列等待超时 |
| room expiry | 30min | 房间有效期 |
| cooldown | 10s | 请求冷却期 |
| rate limit | 20/h | 每 IP 小时限制 |
| max queue | 100 | 最大队列长度 |
| block duration | 24h | 封禁时长 |
| max extensions | 3 | 最大延时次数 |
| --disable-random-match | false | 禁用功能 |

## 流程图
<img src="../docs/diagrams/random-match-flow.svg" />
```

### 5. 动画演示页面架构

#### 5.1 组件结构

```
website/src/pages/demo/activity-ranking.astro
  └── imports:
      ├── Landing.astro (布局)
      ├── Footer.astro
      └── 内联 CSS 动画 (Tailwind + @keyframes)

website/src/pages/demo/random-match.astro
  └── imports:
      ├── Landing.astro (布局)
      ├── Footer.astro
      └── 内联 CSS 动画 (Tailwind + @keyframes)
```

#### 5.2 Activity Ranking Demo 页面设计

**页面区块：**

1. **Header 区** — 标题 + 简介
2. **排序模式交互区** — 4 个 Tab 按钮，点击触发卡片重排动画
3. **房间卡片区** — 模拟房间卡片，使用 `fade-in-up` 依次出现
4. **活跃指示器区** — 使用 `pulse-glow` 展示活跃房间脉冲效果
5. **在线人数区** — 使用 `shimmer` 展示数字闪光效果

**使用的 CSS 动画映射：**

| 页面元素 | 动画名称 | 效果 |
|----------|----------|------|
| 排序模式切换后的卡片 | `fade-in-up` | 卡片依次淡入上浮 |
| 活跃房间指示器 | `pulse-glow` | 呼吸式发光边框 |
| 在线人数数字 | `shimmer` | 光线扫过效果 |
| 排序模式 Tab 激活态 | `pulse-glow` (弱化) | 选中态微发光 |

**Astro 页面模板骨架：**

```astro
---
import Landing from '../../layouts/Landing.astro';
import Footer from '../../components/Footer.astro';
---

<Landing
  title="Activity Ranking Demo"
  description="Interactive demo of Arthas Hub room activity ranking feature"
>
  <section class="demo-container">
    <!-- 排序模式 Tab -->
    <!-- 房间卡片列表 -->
    <!-- 在线人数指示器 -->
  </section>

  <Footer slot="footer" />
</Landing>

<style>
  /* @keyframes 动画定义 — 从 css-animation-guide.md 复用 */
  @keyframes fade-in-up { ... }
  @keyframes pulse-glow { ... }
  @keyframes shimmer { ... }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
</style>
```

#### 5.3 Random Match Demo 页面设计

**页面区块：**

1. **Header 区** — 标题 + "加密版 Omegle" 简介
2. **等待配对区** — 使用 `dot-move` 粒子 + `pulse-glow` 展示等待状态
3. **配对成功区** — 使用 `fade-in-up` 展示 "Match Found!" 成功动画
4. **加密通信区** — 使用 `dash-flow` SVG 虚线展示密文传输
5. **功能循环区** — 展示 "Next → 重新配对" 的循环流程

**使用的 CSS 动画映射：**

| 页面元素 | 动画名称 | 效果 |
|----------|----------|------|
| 等待中的轨道粒子 | `dot-move` | 小点沿路径移动 |
| 等待状态容器 | `pulse-glow` | 呼吸式发光 |
| 连接线（密文传输） | `dash-flow` | SVG 虚线流动 |
| 配对成功提示 | `fade-in-up` | 淡入上浮出现 |
| "Next" 按钮 hover | Tailwind `transition` | 悬停上浮 + 边框变亮 |
| 兴趣标签选中态 | `shimmer` | 光线扫过 |

**Astro 页面模板骨架：**

```astro
---
import Landing from '../../layouts/Landing.astro';
import Footer from '../../components/Footer.astro';
---

<Landing
  title="Random Match Demo"
  description="Interactive demo of Arthas encrypted random pairing feature"
>
  <section class="demo-container">
    <!-- 等待配对动画 -->
    <!-- 配对成功展示 -->
    <!-- 加密通信流 -->
    <!-- Next 按钮循环 -->
  </section>

  <Footer slot="footer" />
</Landing>

<style>
  @keyframes dot-move { ... }
  @keyframes pulse-glow { ... }
  @keyframes dash-flow { ... }
  @keyframes fade-in-up { ... }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
</style>
```

#### 5.4 中文版本差异

中文版页面（`zh/demo/*.astro`）与英文版结构完全相同，仅以下差异：

- `title` / `description` prop 使用中文
- 页面内所有文本标签使用中文
- 动画、布局、CSS 完全一致

### 6. Documentation 表格更新

在 README 的 Documentation 表格中新增行：

```markdown
<!-- EN (README.md) -->
| [Activity Ranking](official_doc/activity-ranking.en.md) | Hub room sort modes and activity tracking |
| [Random Match](official_doc/random-match.en.md) | Encrypted random pairing (Omegle-style) |

<!-- ZH (README.zh.md) -->
| [活跃度排序](official_doc/activity-ranking.md) | Hub 房间排序模式与活跃度追踪 |
| [随机配对](official_doc/random-match.md) | 加密随机配对聊天（Omegle 风格） |
```

### 7. Status 章节更新

在 Status 章节的功能列表摘要中追加新功能名称：

```markdown
<!-- EN -->
All planned features implemented: E2EE chat • encrypted file sharing • ... • Activity Ranking • Random Match • ...

<!-- ZH -->
所有计划功能已实现：E2EE 聊天 • 加密文件共享 • ... • 活跃度排序 • 随机配对 • ...
```

---

## 数据模型

本规格为纯文档更新，不涉及运行时数据模型。产出物均为静态文件：

| 产出物 | 格式 | 存储路径 |
|--------|------|----------|
| README 更新 | Markdown | `README.md` / `README.zh.md` |
| 官方文档 | Markdown | `official_doc/activity-ranking.md` 等 |
| SVG 流程图 | SVG (XML) | `docs/diagrams/*.svg` |
| Demo 页面 | Astro (HTML+CSS) | `website/src/pages/demo/*.astro` |

---

## 文件命名与交叉引用策略

### 命名规则

| 类型 | 命名规则 | 示例 |
|------|----------|------|
| SVG 图表 | `{feature}-flow.svg` | `activity-ranking-flow.svg` |
| 官方文档 (ZH) | `{feature}.md` | `activity-ranking.md` |
| 官方文档 (EN) | `{feature}.en.md` | `activity-ranking.en.md` |
| Demo 页面 (EN) | `demo/{feature}.astro` | `demo/activity-ranking.astro` |
| Demo 页面 (ZH) | `zh/demo/{feature}.astro` | `zh/demo/activity-ranking.astro` |

### 交叉引用关系

```
README.md ──引用──▶ docs/diagrams/activity-ranking-flow.svg
README.md ──链接──▶ official_doc/activity-ranking.en.md
README.zh.md ──引用──▶ docs/diagrams/activity-ranking-flow.svg (同一文件)
README.zh.md ──链接──▶ official_doc/activity-ranking.md
official_doc/activity-ranking.en.md ──引用──▶ docs/diagrams/activity-ranking-flow.svg
official_doc/activity-ranking.md ──引用──▶ docs/diagrams/activity-ranking-flow.svg
```

Random Match 同理，图表文件被中英文文档共享引用。

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| SVG 在 GitHub 渲染不正确 | 确保不使用外部依赖、不用 `xlink:href`，使用内联 `<style>` |
| Demo 页面在低端设备卡顿 | `prefers-reduced-motion` 媒体查询禁用所有动画 |
| 中英文版本结构不同步 | 通过结构一致性检查脚本验证（property test） |
| 文档链接 404 | 确保 Documentation 表格中的路径与实际文件路径完全匹配 |
| SVG 中文字符在 GitHub 显示异常 | 使用英文标签避免编码问题 |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: 双语 README Features 列表结构对等

*For any* valid state of the README files after update, the Features list in `README.md` and `README.zh.md` SHALL have identical entry count, identical emoji icon ordering, and each entry at position N in one file SHALL correspond to the entry at position N in the other file (same emoji prefix).

**Validates: Requirements 1.6, 9.1, 9.4**

### Property 2: 双语 README 章节结构对等

*For any* valid state of the README files after update, the set of H2/H3 section headings in `README.md` SHALL have a one-to-one correspondence with the set of H2/H3 headings in `README.zh.md`, appearing in identical order. Diagram references (`<img src="..."`) SHALL use identical `src` paths in both files.

**Validates: Requirements 2.8, 9.1**

### Property 3: 官方文档双语内容对等

*For any* pair of official documentation files (`{feature}.md` and `{feature}.en.md`), both files SHALL contain the same number of H2 sections, reference the same SVG diagram paths, and contain a language toggle link pointing to the other version at the document top.

**Validates: Requirements 9.2**

### Property 4: Demo 页面双语结构对等

*For any* pair of demo pages (EN version at `demo/{feature}.astro` and ZH version at `zh/demo/{feature}.astro`), both files SHALL use the same `@keyframes` animation definitions, the same HTML element structure (identical tag nesting and class names), and differ only in text content strings.

**Validates: Requirements 9.3**

### Property 5: SVG 自包含性

*For any* SVG file in `docs/diagrams/`, the file SHALL NOT contain any external resource references (no `xlink:href` to external URLs, no `<image href="http...">`, no external font imports). All styles, gradients, and definitions SHALL be inlined within the SVG.

**Validates: Requirements 7.4**

---

## 测试策略

### 属性测试（Property-Based — Python/Shell 脚本）

本规格的属性测试适用于验证文档结构一致性，可通过解析 Markdown/Astro 文件进行：

**测试文件：** `scripts/validate-docs-structure.py`（或集成到现有 `scripts/validate-translations.py`）

| Property | 验证方法 |
|----------|----------|
| Property 1 | 解析两个 README 的 Features 列表，比较 emoji 序列和条目数 |
| Property 2 | 提取 H2/H3 标题和 `<img src>` 引用，比较序列 |
| Property 3 | 解析官方文档对，验证 H2 数量、SVG 引用、语言切换链接 |
| Property 4 | 解析 Astro 文件，提取 `@keyframes` 定义和 HTML 结构 |
| Property 5 | 解析 SVG 文件，搜索外部引用模式 |

### 示例测试（手动 / CI）

| 检查项 | 方法 |
|--------|------|
| SVG 在 GitHub 正确渲染 | 推送后在 GitHub web 界面验证 |
| Demo 页面正确加载 | 本地 `npm run dev` 打开 /demo/activity-ranking |
| 动画在 reduced-motion 下禁用 | 浏览器设置 prefers-reduced-motion: reduce |
| 移动端响应式 | Chrome DevTools 320px 视口 |
| Documentation 表格链接有效 | 检查所有链接指向存在的文件 |
| Features 列表条目格式正确 | 正则匹配 `^- .+ \*\*.*\*\* – .+$` |
