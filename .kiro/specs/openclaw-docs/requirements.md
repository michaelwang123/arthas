# Requirements Document: OpenClaw Channel Plugin Documentation

## Introduction

This spec covers the creation of official documentation for the `@arthas/openclaw-channel` plugin — a code-complete TypeScript package (171 tests, 79% coverage) that enables AI agents to communicate with users through Arthas E2EE chat rooms. The documentation will be published on the Arthas project website (Astro + Starlight) in both English and Chinese, integrated into the sidebar navigation, and referenced from the main project README.

## Glossary

- **Official_Doc** — The `official_doc/` directory containing source Markdown files for the project website
- **Sync_Script** — The `website/scripts/sync-docs.mjs` script that copies official docs into Starlight content directories, automatically injecting frontmatter and stripping language switcher lines
- **Starlight_Sidebar** — The sidebar navigation configuration in `website/astro.config.mjs`
- **Feature_Cards** — The feature showcase section on the website homepage (`FeatureCards.astro` + i18n strings)
- **OpenClaw_Plugin** — The `@arthas/openclaw-channel` npm package in `packages/openclaw-channel/`
- **Share_Code** — Arthas room share code containing roomId + encryption key + configuration (format: `roomId:base64Key:ephemeralFlag:expiresAt`)
- **README** — The root `README.md` file serving as the project's GitHub landing page
- **Package_README** — The `packages/openclaw-channel/README.md` file included in the npm package

## Requirements

### Requirement 1: Chinese Documentation Page

**User Story:** As a Chinese-speaking developer, I want official documentation for the OpenClaw plugin in Chinese so that I can understand how to integrate AI agents with Arthas encrypted rooms.

#### Acceptance Criteria

1. THE Official_Doc SHALL contain a file `openclaw-channel.md` written in Chinese
2. THE `openclaw-channel.md` MAY include a language switcher link to the English version at the top (format: `[English](openclaw-channel.en.md) | 中文`) for standalone reading on GitHub; this line will be automatically stripped by the Sync_Script during website sync
3. THE `openclaw-channel.md` SHALL contain the following sections in order: quick start (5-line minimal example to get running), introduction (what it is and why it exists), installation guide, configuration reference, usage examples (programmatic integration), security model explanation, troubleshooting guide, and API reference
4. THE introduction section SHALL explain the E2EE value proposition — that Arthas is the only AI agent channel providing end-to-end encryption where the server cannot observe prompts or responses
5. THE configuration reference SHALL document all environment variables (`ARTHAS_SERVER_URL`, `ARTHAS_SHARE_CODE`, `ARTHAS_DISPLAY_NAME`, `ARTHAS_SIGNING_ENABLED`, `ARTHAS_ROOM_PASSWORD`) with descriptions, required/optional status, and examples
6. THE usage examples SHALL include at minimum: basic adapter setup, message handling callback, file transfer receiving, and connection status monitoring
7. THE security model section SHALL explain AES-256-GCM encryption, IV generation, GCM authentication tags, optional Ed25519 signing, and key lifecycle (memory-only, zeroed on disconnect)
8. THE troubleshooting section SHALL cover common error messages with their causes and fixes
9. THE installation section SHALL include a note about package availability status and provide alternative installation instructions (git clone + local link) if the package is not yet published on npm

### Requirement 2: English Documentation Page

**User Story:** As an English-speaking developer, I want official documentation for the OpenClaw plugin in English so that I can integrate AI agents with Arthas encrypted rooms.

#### Acceptance Criteria

1. THE Official_Doc SHALL contain a file `openclaw-channel.en.md` written in English
2. THE `openclaw-channel.en.md` MAY include a language switcher link to the Chinese version at the top (format: `[中文](openclaw-channel.md) | English`) for standalone reading on GitHub; this line will be automatically stripped by the Sync_Script during website sync
3. THE `openclaw-channel.en.md` SHALL contain the same sections and equivalent content as the Chinese version, including the quick start section at the top
4. THE English documentation SHALL use consistent terminology matching the existing English docs (e.g., "share code" not "sharing code", "blind relay" not "dumb relay")
5. THE English documentation SHALL be a complete translation — not a summary or abbreviated version of the Chinese documentation

### Requirement 3: Website Sidebar Integration

**User Story:** As a website visitor, I want to find the OpenClaw plugin documentation in the sidebar navigation so that I can discover it while browsing other docs.

#### Acceptance Criteria

1. THE Starlight_Sidebar SHALL include the OpenClaw plugin documentation page in a navigation group
2. THE sidebar entry SHALL be placed in a new "Integrations" group positioned after the existing "Tools" group in `website/astro.config.mjs`
3. THE sidebar entry SHALL use the slug `openclaw-channel` matching the filename convention used by the Sync_Script
4. WHEN the Sync_Script runs, THE `openclaw-channel.en.md` SHALL be copied to `website/src/content/docs/openclaw-channel.md` (English root) and `openclaw-channel.md` SHALL be copied to `website/src/content/docs/zh/openclaw-channel.md` (Chinese locale)

### Requirement 4: Main README Update

**User Story:** As a GitHub visitor, I want to see the OpenClaw plugin mentioned in the project README so that I know Arthas supports AI agent integration.

#### Acceptance Criteria

1. THE README SHALL include a feature bullet point for the OpenClaw plugin in the Features section
2. THE feature bullet point SHALL mention E2EE AI agent communication as the key capability
3. THE README SHALL include a link to the OpenClaw plugin documentation in the Documentation section
4. THE README Project Structure section SHALL include `packages/openclaw-channel/` with a brief description

### Requirement 5: Website Feature Visibility

**User Story:** As a website visitor, I want to see AI agent integration highlighted on the homepage so that I understand Arthas supports this use case.

#### Acceptance Criteria

1. THE Feature_Cards section SHALL include an entry for the OpenClaw AI agent channel by extending the grid layout to accommodate 7 items (preferred) or using a responsive layout; the existing CLI Client card SHALL NOT be removed
2. THE feature entry SHALL have both English and Chinese i18n strings in the respective JSON files (`en.json` and `zh.json`)
3. THE feature entry SHALL communicate the unique value: E2EE AI conversations where the server cannot observe prompts or responses
4. THE feature entry SHALL use the 🤖 emoji to differentiate it from other features
5. THE grid layout SHALL gracefully handle 7 items (e.g., 3+4 row pattern on desktop, single column on mobile)

### Requirement 6: Documentation Content Accuracy

**User Story:** As a developer following the documentation, I want all code examples and configuration references to be accurate so that I can successfully integrate the plugin without trial and error.

#### Acceptance Criteria

1. THE documentation code examples SHALL be syntactically valid TypeScript that compiles without errors
2. THE configuration reference SHALL match the actual environment variables and defaults implemented in `packages/openclaw-channel/src/config.ts`
3. THE share code format documentation SHALL match the format parsed by the plugin (segments: `roomId:base64Key:ephemeralFlag:expiresAt`)
4. THE architecture diagram SHALL accurately represent the data flow: User → Arthas Server (blind relay) → Plugin → OpenClaw Gateway → AI Agent (and reverse)
5. THE troubleshooting section SHALL include the actual error messages produced by the plugin (Chinese error strings as they appear in the source code)
6. IF the plugin API changes after documentation is written, THEN THE documentation SHALL be updated to reflect the current API
7. THE documentation and Package_README SHALL reference the correct GitHub repository URL (`https://github.com/michaelwang123/arthas`); specifically, the existing `packages/openclaw-channel/README.md` reference to `nicepkg/arthas` SHALL be corrected
8. THE version number referenced in documentation examples SHALL match the current version in `packages/openclaw-channel/package.json`

### Requirement 7: Documentation Style Consistency

**User Story:** As a documentation reader, I want the OpenClaw plugin docs to feel consistent with the rest of the Arthas documentation so that the reading experience is cohesive.

#### Acceptance Criteria

1. THE documentation SHALL follow the same Markdown structure as existing official docs (headings, code blocks, tables, horizontal rules)
2. THE Chinese documentation SHALL use the same writing style as `cli-guide.md` (technical Chinese with English terms for proper nouns)
3. THE English documentation SHALL use the same writing style as `cli-guide.en.md` (concise technical English)
4. THE documentation SHALL include the `📚 学习要点:` annotation pattern in code examples where design decisions are explained, consistent with the project's learning-oriented approach
5. THE documentation SHALL NOT include Starlight frontmatter — the Sync_Script injects frontmatter automatically during the sync process
