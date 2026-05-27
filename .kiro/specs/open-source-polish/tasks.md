# Implementation Plan: Open Source Polish

## Overview

This plan covers creating static documentation and configuration files to improve Arthas's open-source community readiness. All deliverables are Markdown or YAML files — no runtime code changes except removing 3 TODO comments after converting them to tracked issues.

**Total estimated time: 7-9 hours**

## Tasks

- [x] 1. Create GitHub community templates (~30 min)
  - [x] 1.1 Create bug report issue template at `.github/ISSUE_TEMPLATE/bug_report.yml`
    - Use YAML form format with required fields: description, steps to reproduce, expected behavior, actual behavior, component dropdown, environment
    - Include optional fields: screenshots, additional context
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 1.2 Create feature request issue template at `.github/ISSUE_TEMPLATE/feature_request.yml`
    - Use YAML form format with required fields: problem description, proposed solution, alternatives considered
    - Include optional field: additional context
    - _Requirements: 2.4, 2.5, 2.6_

  - [x] 1.3 Create template chooser config at `.github/ISSUE_TEMPLATE/config.yml`
    - Set `blank_issues_enabled: false`
    - Add contact links to documentation and discussions
    - _Requirements: 2.7_

  - [x] 1.4 Create PR template at `.github/PULL_REQUEST_TEMPLATE.md`
    - Include sections: description, type of change (checkboxes), testing performed, checklist
    - Checklist items: code compiles, tests pass, docs updated, no unrelated changes, commit conventions
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 2. Create security policy and blog post (~3h)
  - [x] 2.1 Create `SECURITY.md` in repository root (~15 min)
    - Include supported versions table, GitHub Private Vulnerability Reporting as primary channel, 72-hour acknowledgment timeline
    - Define scope: E2EE implementation, WebSocket protocol, server relay logic, authentication bypass, client-side crypto
    - Include coordinated disclosure process and credit policy
    - **Pre-requisite**: Enable Private Vulnerability Reporting in GitHub Settings → Security
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 2.2 Create blog post at `docs/show/posts/devto-e2ee-tutorial.md` (~2-3h)
    - Write tutorial-style article titled "How I built an E2EE chat in Go + React"
    - Include dev.to front matter with tags: go, react, encryption, webdev
    - Cover sections in order: motivation, architecture overview, E2EE implementation (key gen + AES-256-GCM), WebSocket relay design, frontend integration, deployment
    - Include dual Go + TypeScript code snippets for crypto operations
    - Reference GitHub repo URL and live demo link
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 3. Checkpoint - Verify templates and policy
  - Ensure all YAML files are valid syntax, all Markdown renders correctly. Ask the user if questions arise.

- [x] 4. Convert TODO comments to tracked issues
  - [x] 4.1 Create tech debt tracking file at `docs/tech-debt-issues.md`
    - Document the 3 TODO items as issue entries (do NOT modify existing `arthas-client/issue.md`):
      - Issue 1+2 (combined): 60s offline timeout for file transfer pause/resume (`sender.ts`)
      - Issue 3: Wire up file send queue to actual sender logic (`fileTransferStore.ts`)
    - Include file paths, code context, labels (`tech-debt`, `frontend`, `file-transfer`)
    - **Note**: Search for TODO text content rather than relying on line numbers (they may have shifted)
    - _Requirements: 5.1, 5.3, 5.4_

  - [x] 4.2 Remove TODO comments from source code
    - Search for and remove comments containing `TODO: 实现 60s 离线超时判断` in `arthas-client/src/file-transfer/sender.ts`
    - Search for and remove comments containing `TODO: task 4.3` in `arthas-client/src/file-transfer/fileTransferStore.ts`
    - **Important**: Search by content, not line number — lines may have shifted since design was written
    - _Requirements: 5.2_

- [x] 5. Translate official documentation to English (batch 1, ~2-3h)
  - [x] 5.1 Create `official_doc/getting-started.en.md`
    - Translate all prose content to English, preserve heading structure and code blocks
    - Add language navigation header: `[中文](getting-started.md) | English`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.2 Create `official_doc/architecture.en.md`
    - Translate all prose content to English, preserve heading structure and code blocks
    - Add language navigation header: `[中文](architecture.md) | English`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.3 Create `official_doc/configuration.en.md`
    - Translate all prose content to English, preserve heading structure and code blocks
    - Add language navigation header: `[中文](configuration.md) | English`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.4 Create `official_doc/protocol.en.md`
    - Translate all prose content to English, preserve heading structure and code blocks
    - Add language navigation header: `[中文](protocol.md) | English`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 6. Checkpoint - Verify batch 1 translations
  - Ensure all English docs have correct language navigation headers, matching heading structure, and no untranslated Chinese prose outside code blocks. Ask the user if questions arise.

- [x] 7. Translate official documentation to English (batch 2, ~1.5-2h)
  - [x] 7.1 Create `official_doc/self-hosting.en.md`
    - Translate all prose content to English, preserve heading structure and code blocks
    - Add language navigation header: `[中文](self-hosting.md) | English`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.2 Create `official_doc/cli-guide.en.md`
    - Translate all prose content to English, preserve heading structure and code blocks
    - Add language navigation header: `[中文](cli-guide.md) | English`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 7.3 Create `official_doc/development.en.md`
    - Translate all prose content to English, preserve heading structure and code blocks
    - Add language navigation header: `[中文](development.md) | English`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 7.4 Write validation script for English translation correctness properties
    - **Property 1: English doc exists for every Chinese doc** — verify `.en.md` counterpart exists for each target doc
    - **Property 2: Heading structure preservation** — verify heading level sequence matches between Chinese and English
    - **Property 3: Code block preservation** — verify fenced code block content is identical (excluding comments)
    - **Property 4: Language navigation link presence** — verify first 3 lines contain `[中文](<basename>.md) | English`
    - **Property 5: No untranslated Chinese prose** — verify no Chinese characters outside code blocks
    - **Validates: Requirements 6.3, 6.4, 6.5, 6.6**

- [x] 8. Final checkpoint - Ensure all deliverables are complete
  - Verify all files exist at correct paths: blog post, 3 issue templates, PR template, SECURITY.md, 7 English translations
  - Ensure TODO comments are removed from source
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All tasks produce static files (Markdown/YAML) — no build step required
- The blog post is saved locally as a draft (`published: false` in front matter); actual publishing to dev.to is manual
- TODO removal should be committed together with a message referencing the created issues
- English translations preserve code blocks verbatim; only prose and Chinese comments within code blocks are translated
- Property tests validate structural correctness of translations (heading counts, code preservation, navigation links)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "2.1", "2.2"] },
    { "id": 1, "tasks": ["4.1", "5.1", "5.2", "5.3", "5.4"] },
    { "id": 2, "tasks": ["4.2", "7.1", "7.2", "7.3"] },
    { "id": 3, "tasks": ["7.4"] }
  ]
}
```
