# Implementation Plan: OpenClaw Channel Plugin Documentation

## Overview

Create official documentation for the `@arthas/openclaw-channel` plugin in both Chinese and English, integrate it into the Arthas project website (Astro + Starlight), update the main README, fix package metadata inconsistencies, and add a feature card to the homepage. All documentation content must be accurate against the actual source code.

## Tasks

- [x] 1. Create Chinese documentation source file
  - [x] 1.1 Create `official_doc/openclaw-channel.md` with complete Chinese documentation
    - Add language switcher link at top: `[English](openclaw-channel.en.md) | 中文`
    - Write sections in order with `---` horizontal rules between each section: quick start (5-line example), introduction (E2EE value proposition), installation, configuration reference, usage examples, security model, troubleshooting, API reference, 下一步
    - Quick start must show a minimal 5-line code example using `ArthasChannelAdapter` with ESM top-level await note
    - Introduction must explain that Arthas is the only AI agent channel providing E2EE where the server cannot observe prompts or responses
    - Installation section must include note about package availability and alternative `git clone + local link` instructions
    - Configuration reference must document all 5 environment variables (`ARTHAS_SERVER_URL`, `ARTHAS_SHARE_CODE`, `ARTHAS_DISPLAY_NAME`, `ARTHAS_SIGNING_ENABLED`, `ARTHAS_ROOM_PASSWORD`) with descriptions, required/optional status, defaults, and examples — matching `config.ts` exactly
    - Usage examples must include: basic adapter setup, message handling callback, file transfer receiving, connection status monitoring
    - Security model must explain AES-256-GCM encryption, IV generation, GCM authentication tags, optional Ed25519 signing, key lifecycle (memory-only, zeroed on disconnect)
    - Troubleshooting must include actual Chinese error messages from `config.ts` (e.g., `[Arthas 配置错误] 缺少必填配置: serverUrl`)
    - API reference must document exported types and public methods from `adapter.ts` and `types.ts`
    - Include ASCII art architecture diagram showing data flow: User → Arthas Server (blind relay) → Plugin → OpenClaw Gateway → AI Agent (and reverse)
    - Include `📚 学习要点:` annotations in code examples where design decisions are explained
    - Add "下一步" section at end with links: `[系统架构](architecture.md)`, `[协议规范](protocol.md)`, `[自托管部署](self-hosting.md)`
    - Must NOT include Starlight frontmatter (no `---` at file start — the section separators are between sections, not at line 1)
    - Follow writing style of `cli-guide.md` (technical Chinese with English terms for proper nouns)
    - Reference version `1.0.0` matching `package.json`
    - Internal links use relative Markdown paths (sync-docs.mjs converts them to Starlight routes)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 7.1, 7.2, 7.4, 7.5_

- [x] 2. Create English documentation source file
  - [x] 2.1 Create `official_doc/openclaw-channel.en.md` with complete English documentation
    - Add language switcher link at top: `[中文](openclaw-channel.md) | English`
    - Write all sections matching the Chinese version structure and content exactly (complete translation, not summary)
    - Include `---` horizontal rules between each section (matching Chinese version)
    - Use consistent terminology: "share code" (not "sharing code"), "blind relay" (not "dumb relay"), "end-to-end encryption" (not "E2E encryption")
    - Include `📚 学习要点:` annotations in code examples (keep annotation prefix in Chinese per project convention, explanation in English)
    - Include ASCII art architecture diagram (same as Chinese version but with English labels)
    - Add "Next Steps" section at end with links: `[Architecture](architecture.en.md)`, `[Protocol](protocol.en.md)`, `[Self-Hosting](self-hosting.en.md)`
    - Must NOT include Starlight frontmatter
    - Follow writing style of `cli-guide.en.md` (concise technical English)
    - All code examples must be syntactically valid TypeScript
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2, 6.3, 6.4, 6.7, 6.8, 7.1, 7.3, 7.4, 7.5_

- [x] 3. Checkpoint - Verify documentation content accuracy
  - Ensure all tests pass, ask the user if questions arise.
  - Verify code examples are valid TypeScript
  - Verify environment variable references match `config.ts`
  - Verify share code format matches `validateShareCode()` logic (minimum 2 segments, each non-empty)
  - Verify error messages match actual strings in source code
  - Verify no frontmatter exists at line 1 of either file
  - Verify `---` separators exist between sections (at least 5)
  - Verify "下一步" / "Next Steps" section exists at end of each file
  - Verify architecture diagram is present in both files

- [x] 4. Website sidebar integration
  - [x] 4.1 Add "Integrations" group to Starlight sidebar in `website/astro.config.mjs`
    - Add new sidebar group after the existing "Tools" group
    - Group label: `'Integrations'` with `translations: { 'zh-CN': '集成' }`
    - Single item: `{ slug: 'openclaw-channel' }`
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 5. Website homepage feature card
  - [x] 5.1 Add OpenClaw feature entry and update grid layout in `website/src/components/FeatureCards.astro`
    - Add 7th item to the `features` array: `{ icon: '🤖', titleKey: 'features.openclaw.title', descKey: 'features.openclaw.description' }`
    - Existing CLI Client card must NOT be removed
    - Change desktop breakpoint from `@media (min-width: 1024px)` with `repeat(3, 1fr)` to `@media (min-width: 1100px)` with `repeat(4, 1fr)` for 4+3 layout pattern
    - Keep tablet breakpoint (768px) at 2 columns unchanged
    - _Requirements: 5.1, 5.4, 5.5_

  - [x] 5.2 Add i18n strings to `website/src/i18n/en.json`
    - Add key `"features.openclaw.title": "AI Agent Channel"`
    - Add key `"features.openclaw.description": "Connect AI agents to encrypted rooms. Zero-knowledge conversations — the server cannot observe prompts or responses."`
    - _Requirements: 5.2, 5.3_

  - [x] 5.3 Add i18n strings to `website/src/i18n/zh.json`
    - Add key `"features.openclaw.title": "AI Agent 通道"`
    - Add key `"features.openclaw.description": "将 AI Agent 接入加密房间。零知识对话 — 服务器无法观察提示词或回复内容。"`
    - _Requirements: 5.2, 5.3_

- [x] 6. Update main README
  - [x] 6.1 Update `README.md` with OpenClaw plugin references
    - Add feature bullet in Features section: `- 🤖 **AI Agent Channel** – OpenClaw plugin for E2EE AI conversations, server sees nothing`
    - Add `packages/openclaw-channel/` entry in Project Structure section with description
    - Add documentation link in Documentation section: `- [OpenClaw Channel Plugin](official_doc/openclaw-channel.en.md)`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 7. Fix Package README and package.json
  - [x] 7.1 Correct GitHub URL in `packages/openclaw-channel/README.md`
    - Replace all occurrences of `https://github.com/nicepkg/arthas` with `https://github.com/michaelwang123/arthas`
    - Fix Contributing section Fork link
    - _Requirements: 6.7_

  - [x] 7.2 Fix license in `packages/openclaw-channel/package.json`
    - Change `"license": "MIT"` to `"license": "AGPL-3.0"`
    - _Requirements: 6.7 (accuracy)_

  - [x] 7.3 Restructure Package README to summary version
    - Add full documentation link at top: `📖 Full documentation: [中文](../../official_doc/openclaw-channel.md) | [English](../../official_doc/openclaw-channel.en.md)`
    - Keep: introduction paragraph, architecture diagram, quick start (5-line example), configuration table, API methods table, Development section
    - Remove detailed sections (replace with links to official_doc): Programmatic Integration examples, File Transfer examples, Security Model details, Troubleshooting details, Share Code Format details
    - Change license reference at bottom from "MIT" to "AGPL-3.0"
    - _Requirements: 6.7, 7.1_

- [x] 8. Create validation script
  - [x] 8.1 Create `scripts/validate-openclaw-docs.sh`
    - Check both doc files exist
    - Check no frontmatter at line 1
    - Check GitHub URL corrected (no `nicepkg/arthas` remaining)
    - Check i18n keys exist in both en.json and zh.json
    - Check package.json license is AGPL-3.0
    - Check version number in docs matches package.json version
    - Check "下一步" / "Next Steps" sections exist
    - Check at least 5 `---` separators in each doc
    - Run sync-docs.mjs and website build
    - _Requirements: 6.6, 6.8_

- [x] 9. Checkpoint - Verify website build and sync
  - Ensure all tests pass, ask the user if questions arise.
  - Run `node website/scripts/sync-docs.mjs` to verify sync handles new files correctly
  - Verify `website/src/content/docs/openclaw-channel.md` is generated (English)
  - Verify `website/src/content/docs/zh/openclaw-channel.md` is generated (Chinese)
  - Verify language switcher lines are stripped during sync
  - Verify frontmatter is injected correctly
  - Run website build (`cd website && pnpm build`) to confirm no errors
  - Verify sidebar slug resolves correctly (no 404)
  - Verify sidebar shows "集成" label in Chinese locale
  - Verify i18n keys are found (no missing key warnings)
  - Verify 4-column grid layout renders correctly at ≥1100px viewport
  - Run `bash scripts/validate-openclaw-docs.sh` to confirm all automated checks pass

## Notes

- No property-based tests apply to this feature (static documentation files, config changes, and i18n strings)
- The sync-docs.mjs script automatically handles: stripping language switcher lines, injecting frontmatter, converting internal links to Starlight routes, normalizing code block language identifiers, removing H1 titles
- sync-docs.mjs **deletes the entire `zh/` directory** before syncing — all Chinese docs must come from `official_doc/`
- Documentation files must NOT start with `---` (frontmatter) — the sync script injects it
- All code examples should use TypeScript with proper syntax highlighting (`typescript` language identifier)
- The architecture diagram uses ASCII art format (not Mermaid), consistent with cli-guide.md and Package README
- Version `1.0.0` must match `packages/openclaw-channel/package.json`
- Project uses AGPL-3.0 license — all sub-packages must be consistent
- Internal links in docs use relative Markdown paths (e.g., `[架构](architecture.md)`) — sync script converts to Starlight routes
- Desktop grid breakpoint is 1100px (not 1024px) to ensure 4-column cards have sufficient width (~262px each)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "7.1", "7.2"] },
    { "id": 1, "tasks": ["7.3", "4.1", "5.1", "5.2", "5.3", "6.1", "8.1"] }
  ]
}
```
