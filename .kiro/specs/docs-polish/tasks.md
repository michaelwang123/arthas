# Implementation Plan: Documentation Polish

## Overview

Polish the Arthas project documentation by fixing broken assets, synchronizing the Chinese README, correcting stale references, creating a social preview SVG, adding a contributors section, and inserting i18n notices. Execution follows the 5-phase dependency order from the design: English README first, then Chinese sync, then link sweep, then new assets, then i18n.

## Tasks

- [x] 1. Phase 1 — Fix English README (REQ-1 + REQ-7)
  - [x] 1.1 Remove broken demo.gif reference from README.md
    - Delete the `![Arthas Demo](docs/show/demo.gif)` line from the Demo section
    - Preserve the blockquote tagline, Live Demo link, and Project Website link
    - _Requirements: REQ-1_

  - [x] 1.2 Add Contributors section to README.md
    - Insert a `## Contributors` section after the Contributing section, before License
    - Use `contrib.rocks/image?repo=michaelwang123/arthas` for auto-generated avatar grid
    - Wrap image in link to `https://github.com/michaelwang123/arthas/graphs/contributors`
    - _Requirements: REQ-7_

- [x] 2. Phase 2 — Sync Chinese README (REQ-2)
  - [x] 2.1 Rewrite README.zh.md — Header and intro sections
    - **Read README.md first as the authoritative template; translate each section sequentially**
    - Create: Title + language switcher (`中文 | [English](README.md)`) + badges (identical to English)
    - Create: Tagline + description paragraph (translate to Chinese)
    - Create: Demo section (text + links, no GIF — matching post-REQ-1 English)
    - Create: How It Works section (SVG diagram reference `docs/diagrams/how-it-works.svg`, same as English)
    - Remove all stale Chinese-only sections that don't exist in English (网络策略, 使用流程 flow chart, ASCII 架构图, 部署方案表格, 保活/Cron-job.org)
    - Remove references to non-existent `docs/backlog.md`
    - _Requirements: REQ-2_

  - [x] 2.2 Rewrite README.zh.md — Core content sections
    - Create: Features section (translate feature list from English, keep all emoji + descriptions)
    - Create: Architecture section (SVG `docs/diagrams/architecture.svg` + design principles translated)
    - Create: Encryption section (SVG `docs/diagrams/encryption-flow.svg` + table translated)
    - Create: Tech Stack table — use correct values: Vite 6, Go 1.23, no Cron-job.org row
    - _Requirements: REQ-2_

  - [x] 2.3 Rewrite README.zh.md — Deployment and usage sections
    - Create: Self-Hosting section (SVG `docs/diagrams/self-hosting-tiers.svg` + 3 tiers + code block)
    - Create: Quick Start section (backend port 8080, frontend port 5173, CLI build commands)
    - Create: Project Structure section (simplified tree, matching English)
    - _Requirements: REQ-2_

  - [x] 2.4 Rewrite README.zh.md — Tail sections
    - Create: Documentation table (link to Chinese `.md` files; where no Chinese version exists, add `(English)` suffix)
    - Create: Status section — use same version and date as English README Status section (do NOT hardcode; read from English README)
    - Create: Contributing section (link to `official_doc/contributing.md`)
    - Create: Contributors section (贡献者) — identical `contrib.rocks` HTML as English
    - Create: License section (AGPL-3.0)
    - _Requirements: REQ-2, REQ-7_

  - [x] 2.5 Fix port reference in official_doc/development.md
    - Change "前端使用 Vite dev server（端口 3000）独立运行" to "前端使用 Vite dev server（端口 5173）独立运行"
    - _Requirements: REQ-2_

- [x] 3. Checkpoint — Verify README consistency
  - Run these verification commands and confirm zero matches:
    ```bash
    grep -rn "demo\.gif" README.md README.zh.md
    grep -rn "localhost:3000" README.zh.md
    grep -rn "Vite 5\|Go 1\.22\|v1\.0" README.zh.md
    grep -rn "backlog\.md" README.zh.md
    ```
  - Visually compare README.md and README.zh.md section headings to confirm 1:1 structural match
  - Confirm both files have Contributors section with `contrib.rocks` reference

- [x] 4. Phase 3 — Link Sweep and Fact Corrections (REQ-3, REQ-4, REQ-5)
  - [x] 4.1 Add deprecation notice to official_doc/deployment.md
    - Insert bilingual deprecation banner at the top (⚠️ 本文档已废弃 / This document is deprecated)
    - Include redirect link to `self-hosting.md`
    - Do not delete existing content (preserve git history)
    - _Requirements: REQ-3_

  - [x] 4.2 Fix deployment.md links in Chinese documentation files (excluding faq.md)
    - Update `official_doc/index.md`: change `[部署指南](deployment.md) | 生产环境部署方案` to `[自托管部署](self-hosting.md) | 自托管部署方案（单二进制 / Docker / Docker Compose）`
    - Update `official_doc/architecture.md`: change `[部署指南](deployment.md) — 生产环境部署` to `[自托管部署](self-hosting.md) — 生产环境部署`
    - Update `official_doc/configuration.md`: change `[部署指南](deployment.md) — 生产环境部署` to `[自托管部署](self-hosting.md) — 生产环境部署`
    - Update `official_doc/getting-started.md`: change `[部署指南](deployment.md) — 部署到生产环境` to `[自托管部署](self-hosting.md) — 部署到生产环境`
    - _Requirements: REQ-3_

  - [x] 4.3 Fix deployment.md links in English documentation files
    - Update `official_doc/architecture.en.md`: change `[Deployment Guide](deployment.md)` to `[Self-Hosting Guide](self-hosting.en.md)`
    - Update `official_doc/configuration.en.md`: change `[Deployment Guide](deployment.md)` to `[Self-Hosting Guide](self-hosting.en.md)`
    - Update `official_doc/getting-started.en.md`: change `[Deployment Guide](deployment.md)` to `[Self-Hosting Guide](self-hosting.en.md)`
    - _Requirements: REQ-3_

  - [x] 4.4 Fix ALL faq.md content (links + facts + deployment options)
    - **Deployment links**: Change both `[部署指南](deployment.md)` occurrences to `[自托管部署指南](self-hosting.md)` (部署问题 section + 下一步 section)
    - **Message length**: Change "单条消息最多 500 字符" to "单条消息最多 4000 字符"
    - **Deployment options list**: Replace the entire "如何自己部署？" answer block:
      - OLD: `参考 [部署指南](deployment.md)，支持多种方案：\n- Vercel + Docker（推荐）\n- Docker Compose（自建 VPS）\n- Railway / Fly.io`
      - NEW: `参考 [自托管部署指南](self-hosting.md)，支持三种方案：\n- 单二进制（零依赖，推荐开发/内网使用）\n- Docker 单容器（一条命令快速部署）\n- Docker Compose + Caddy（公网自动 HTTPS）`
    - _Requirements: REQ-3, REQ-4_

  - [x] 4.5 Fix port and version references across all affected files
    - `official_doc/index.md`: change `http://localhost:3000` → `http://localhost:5173`, change `Vite 5` → `Vite 6`
    - `official_doc/getting-started.md`: change `VITE v5.x.x` → `VITE v6.x.x`, `localhost:3000` → `localhost:5173` (3 occurrences: output example, URL in output, verification step)
    - `official_doc/getting-started.en.md`: change `VITE v5.x.x` → `VITE v6.x.x`, `localhost:3000` → `localhost:5173` (3 occurrences: output example, URL in output, verification step)
    - _Requirements: REQ-5_

- [x] 5. Phase 4 — Create Social Preview SVG (REQ-6)
  - [x] 5.1 Create docs/social-preview.svg
    - Dimensions: 1280×640 (GitHub social preview standard)
    - Dark background `#0d0d1a`, gold accent `#ffd700`
    - Center: gold lock/shield icon SVG path
    - Title: "Arthas" in white 48px text (`#ffffff`)
    - Tagline: "E2EE Ephemeral Chat" in muted gray 24px (`#888888`)
    - Bottom row: three keyword pills ("End-to-End Encrypted" · "Zero Knowledge" · "Self-Hostable") with rounded rect `#1a1a2e` fill, `#ffd700` 1px border, white text 16px
    - Font: system-ui sans-serif for cross-platform rendering
    - After creation, open SVG in browser to verify visual rendering
    - _Requirements: REQ-6_

- [x] 6. Phase 5 — Add i18n Notices (REQ-8)
  - [x] 6.1 Add language notice to official_doc/faq.md
    - Insert `> 🌐 English translation coming soon. Contributions welcome!` as first line after the title (`# 常见问题 (FAQ)`)
    - _Requirements: REQ-8_

  - [x] 6.2 Add language notice to official_doc/contributing.md
    - Insert `> 🌐 English translation coming soon. Contributions welcome!` as first line after the title (`# 贡献指南 (Contributing Guide)`)
    - _Requirements: REQ-8_

- [x] 7. Final Checkpoint — Run validation and verify build
  - Execute the following validation checks:
    ```bash
    # === Stale reference checks (all must return zero matches) ===
    grep -rn "demo\.gif" README.md README.zh.md
    grep -rn "localhost:3000" official_doc/ README.zh.md
    grep -rn "Vite 5\|VITE v5" official_doc/
    grep -rn "backlog\.md" README.zh.md
    grep -rn "Go 1\.22" README.zh.md
    # deployment.md links outside deployment.md itself:
    grep -rn "](deployment\.md)" official_doc/ | grep -v "deployment.md:"

    # === Required content checks ===
    head -5 official_doc/deployment.md | grep -q "废弃\|Deprecated"
    head -5 official_doc/faq.md | grep -q "English translation"
    head -5 official_doc/contributing.md | grep -q "English translation"
    grep -q "contrib.rocks" README.md
    grep -q "contrib.rocks" README.zh.md
    test -f docs/social-preview.svg

    # === Build verification ===
    cd website && npm run build
    ```
  - All stale reference greps must return zero matches
  - All required content checks must pass
  - Website build must exit with code 0

## Notes

- No property-based tests or unit tests are applicable — this feature modifies static documentation files only
- The design explicitly states no runtime code changes are involved
- Each task references specific requirements for traceability
- Checkpoints (tasks 3 and 7) are included as explicit synchronization barriers in the dependency graph (waves 5 and 9)
- Task 4.4 consolidates ALL faq.md modifications to avoid file-level conflicts with task 4.2
- Tasks 2.1→2.2→2.3→2.4 are strictly sequential (same file: README.zh.md builds up section by section); the dependency graph enforces this via separate waves
- Users should manually export `docs/social-preview.svg` to PNG and upload at GitHub → Settings → Social Preview
- **Commit strategy**: Recommend one git commit per Phase for easy incremental rollback (`git revert` per phase if issues found)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"], "description": "Fix English README (parallel)" },
    { "id": 1, "tasks": ["2.1"], "description": "README.zh.md — header + intro sections" },
    { "id": 2, "tasks": ["2.2"], "description": "README.zh.md — core content sections" },
    { "id": 3, "tasks": ["2.3"], "description": "README.zh.md — deployment + usage sections" },
    { "id": 4, "tasks": ["2.4", "2.5"], "description": "README.zh.md tail + development.md port fix (parallel: different files)" },
    { "id": 5, "tasks": ["checkpoint-3"], "description": "Verification barrier: README consistency" },
    { "id": 6, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"], "description": "Link sweep + fact corrections (parallel: no file conflicts)" },
    { "id": 7, "tasks": ["5.1"], "description": "Create social preview SVG (independent)" },
    { "id": 8, "tasks": ["6.1", "6.2"], "description": "i18n notices (parallel)" },
    { "id": 9, "tasks": ["checkpoint-7"], "description": "Final validation barrier: grep checks + website build" }
  ]
}
```
