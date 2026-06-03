# 文档优化美化 — Requirements

## 概述

对 Arthas 项目文档进行全面优化，修复断裂链接、同步中文 README、清理过时文件、补全标注，参考知名开源项目的文档设计标准，提升首次访客信任度。

## 参考项目文档设计

| 项目 | 值得借鉴的特点 |
|------|----------------|
| **Tailwind CSS** | README 极简但信息密集，badges + 一句话定位 + 快速安装 + 链接官网，不放 GIF/截图直接引导体验 |
| **Supabase** | 功能表格带 ✅ 状态标识、清晰的 Getting Started、多语言 README 结构完全对齐 |
| **Signal** | 安全设计文档结构严谨，加密规范单独成文，信任模型可视化 |
| **Minio** | 自托管项目典范：3 条命令快速启动、架构图清晰、多平台下载表格 |
| **Deno** | Contributors 区域使用 GitHub auto-generated avatar grid，社区感强 |

---

## P0 — 阻断性问题（影响访客信任）

### REQ-1: 解决 demo.gif 断图
- **现状**: README.md 引用 `docs/show/demo.gif`，但文件不存在，GitHub 上显示 broken image
- **方案**: 移除 GIF 图片引用，改为纯文字描述 + Live Demo 按钮链接的方式（参考 Tailwind CSS 做法——不放 GIF，直接引导到官网体验）。保留 Demo 章节但不依赖图片文件
- **验收**: GitHub README 不再显示断图，Demo 区域以文字 + 链接呈现

### REQ-2: 同步 README.zh.md 到最新状态
- **现状**: 中文 README 仍显示 v1.0、Go 1.22、Vite 5、端口 3000，无 badges、无 SVG 图表，引用不存在的 `docs/backlog.md`
- **方案**: 重写 README.zh.md，与英文版结构完全一致（badges、SVG 图表、v1.2.2、正确端口 5173/版本号）。同时修正 `official_doc/development.md` 中的端口引用（3000→5173）
- **验收**: 中英文 README 信息一致，所有链接有效，development.md 端口正确

---

## P1 — 信息过时/冲突

### REQ-3: 处理 deployment.md 遗留文件
- **现状**: `official_doc/deployment.md` 已被 `self-hosting.md` 完全取代，但 faq.md 和 index.md 仍引用它
- **方案**: 在 deployment.md 顶部添加废弃说明 + 重定向到 self-hosting.md，修复所有指向它的链接
- **验收**: 读者访问 deployment.md 被明确引导到 self-hosting.md

### REQ-4: 修复 faq.md 过时引用
- **现状**: faq.md 部署问题章节引用 `deployment.md`，"500 字符限制" 已过时（OpenClaw 插件 send 方法分割为 ≤4000 字符片段，前端实际无硬限制）
- **方案**: 更新部署链接指向 self-hosting.md，修正消息长度描述为"单条消息最多 4000 字符"
- **验收**: faq.md 所有链接有效，数据准确

### REQ-5: 修正 index.md 技术信息
- **现状**: index.md 快速体验说"打开 http://localhost:3000"（实际 Vite 6 默认 5173），技术栈表写 "Vite 5"（实际 ^6.0.5）
- **方案**: 修正端口为 5173，Vite 版本为 6
- **验收**: 快速体验步骤实际可用，技术栈信息准确

---

## P2 — 文档美化与丰富

### REQ-6: 创建 GitHub Social Preview SVG
- **现状**: 项目无 social preview image（1280×640），社交分享时无品牌展示
- **方案**: 创建 `docs/social-preview.svg`（暗色背景 + 金色锁图标 + "Arthas" + tagline + E2EE/Zero-Knowledge/Self-Hostable 三个关键词图标），用户可导出 PNG 上传到 GitHub Settings
- **验收**: SVG 文件存在，视觉风格与项目品牌一致（#0d0d1a 背景 + #ffd700 金色）

### REQ-7: README 增加 Contributors 区域
- **现状**: README 无社区贡献者展示
- **方案**: 在 Contributing 章节后添加 Contributors 区域，使用 GitHub 自动生成的 contributors 链接（`https://github.com/michaelwang123/arthas/graphs/contributors`）
- **验收**: README 中有 Contributors 区域链接

---

## P3 — 国际化标记

### REQ-8: faq.md 和 contributing.md 添加语言提示
- **现状**: 仅中文版本，国际用户无法阅读
- **方案**: 在文件顶部添加 `> 🌐 English translation coming soon. Contributions welcome!`
- **验收**: 文件顶部有语言提示

---

## 范围外（不在本 spec 中）

- 录制真实 demo GIF（需要手动操作应用）
- 翻译 contributing.md / security.md / faq.md 完整英文版
- 创建 Chrome 扩展截图
- 文件传输协议流程 SVG（ASCII 在代码块中已够用，引入 SVG 有 Astro 构建兼容性风险）
- Star History 图表（项目早期 stars 少时显得冷清，待积累 100+ 后再加）

---

## 验收标准

1. `README.md` 和 `README.zh.md` 信息完全一致（版本、端口、badges、SVG 图表、链接）
2. GitHub README 无断图（Demo 区域改为纯文字 + Live Demo 链接）
3. 所有 official_doc 文件中无指向不存在文件的死链接
4. `official_doc/index.md` 和 `official_doc/development.md` 端口/版本信息准确
5. 新增 1 个 SVG（social-preview）
6. website 构建 (`npm run build`) 通过
7. faq.md / contributing.md 顶部有英文待翻译提示
