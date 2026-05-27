# Design Document: Open Source Polish

## Architecture Overview

This feature produces static documentation and configuration files that improve the project's open-source community readiness. There is no runtime code change — all deliverables are Markdown, YAML, or configuration files consumed by GitHub's platform features or by human readers.

### Component Map

```
arthas/
├── docs/show/posts/
│   └── devto-e2ee-tutorial.md        # Blog post (Req 1)
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml            # Bug report form (Req 2)
│   │   ├── feature_request.yml       # Feature request form (Req 2)
│   │   └── config.yml                # Template chooser config (Req 2)
│   └── PULL_REQUEST_TEMPLATE.md      # PR template (Req 3)
├── SECURITY.md                        # Security policy (Req 4)
└── official_doc/
    ├── self-hosting.en.md             # English translations (Req 6)
    ├── cli-guide.en.md
    ├── development.en.md
    ├── getting-started.en.md
    ├── architecture.en.md
    ├── configuration.en.md
    └── protocol.en.md
```

---

## Component 1: Blog Post (`docs/show/posts/devto-e2ee-tutorial.md`)

### Structure

The blog post uses dev.to front matter format and follows a tutorial narrative arc.

```markdown
---
title: "How I built an E2EE chat in Go + React"
published: false
description: "A step-by-step tutorial on building end-to-end encrypted ephemeral chat with AES-256-GCM, WebSocket relay, and zero-knowledge server design."
tags: go, react, encryption, webdev
cover_image: ""
---

## Motivation

[Why this project exists — sharing secrets securely without accounts]

## Architecture Overview

[Diagram: Browser ↔ Go Relay ↔ Browser, server sees only ciphertext]

## E2EE Implementation

### Key Generation

```go
// Generate a 256-bit AES key
key := make([]byte, 32)
if _, err := rand.Read(key); err != nil {
    return nil, fmt.Errorf("key generation failed: %w", err)
}
```

```typescript
// Web Crypto API equivalent
const key = await crypto.subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"]
);
```

### AES-256-GCM Encryption

```go
block, _ := aes.NewCipher(key)
gcm, _ := cipher.NewGCM(block)
nonce := make([]byte, gcm.NonceSize()) // 12 bytes
rand.Read(nonce)
ciphertext := gcm.Seal(nil, nonce, plaintext, nil)
```

```typescript
const iv = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  key,
  new TextEncoder().encode(plaintext)
);
```

## WebSocket Relay Design

[Go Hub pattern — goroutine-per-connection, channel-based routing, zero parsing of message content]

```go
// Server only forwards ciphertext — zero knowledge
func (h *Hub) handleSendMessage(client *Client, data interface{}) {
    room := h.roomManager.GetRoom(client.RoomID)
    room.Broadcast(client.ID, rawCiphertext) // forward as-is
}
```

## Frontend Integration

[React + Zustand store, MessagePack binary protocol, share code = roomId:base64url(key)]

## Deployment

[Single binary with embedded frontend, or Docker Compose + Caddy auto-HTTPS]

---

**GitHub**: https://github.com/michaelwang123/arthas
**Live Demo**: https://arthas-chat.vercel.app
```

### Key Design Decisions

- **Tutorial tone**: Written as a narrative "how I built this" rather than dry documentation, matching dev.to community expectations
- **Dual code snippets**: Show both Go (server/CLI) and TypeScript (browser) implementations side-by-side for the same crypto operations
- **Progressive disclosure**: Start with motivation, build up to crypto details, end with deployment — readers can stop at any point and still get value

---

## Component 2: GitHub Issue Templates

### Bug Report (`bug_report.yml`)

```yaml
name: 🐛 Bug Report
description: Report a bug or unexpected behavior
title: "[Bug]: "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for reporting! Please fill in the details below.

  - type: textarea
    id: description
    attributes:
      label: Description
      description: A clear description of the bug
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to Reproduce
      description: Step-by-step instructions to reproduce the issue
      placeholder: |
        1. Go to '...'
        2. Click on '...'
        3. See error
    validations:
      required: true

  - type: textarea
    id: expected
    attributes:
      label: Expected Behavior
      description: What you expected to happen
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: Actual Behavior
      description: What actually happened
    validations:
      required: true

  - type: dropdown
    id: component
    attributes:
      label: Component
      description: Which part of Arthas is affected?
      options:
        - Web Client (arthas-client)
        - Server (arthas-server)
        - CLI Client (arthas-cli)
        - Self-Hosting / Docker
        - Documentation
    validations:
      required: true

  - type: textarea
    id: environment
    attributes:
      label: Environment
      description: OS, browser version, Go version, etc.
      placeholder: |
        - OS: Windows 11 / macOS 14 / Ubuntu 22.04
        - Browser: Chrome 120 / Firefox 121
        - Go version: 1.23 (if applicable)
        - Node.js version: 20 (if applicable)
    validations:
      required: true

  - type: textarea
    id: screenshots
    attributes:
      label: Screenshots
      description: If applicable, add screenshots to help explain the problem
    validations:
      required: false

  - type: textarea
    id: context
    attributes:
      label: Additional Context
      description: Any other context about the problem
    validations:
      required: false
```

### Feature Request (`feature_request.yml`)

```yaml
name: ✨ Feature Request
description: Suggest a new feature or improvement
title: "[Feature]: "
labels: ["enhancement"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for suggesting an improvement! Please describe your idea below.

  - type: textarea
    id: problem
    attributes:
      label: Problem Description
      description: What problem does this feature solve? What's the use case?
      placeholder: "I'm always frustrated when..."
    validations:
      required: true

  - type: textarea
    id: solution
    attributes:
      label: Proposed Solution
      description: Describe the solution you'd like
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives Considered
      description: Any alternative solutions or features you've considered
    validations:
      required: true

  - type: textarea
    id: context
    attributes:
      label: Additional Context
      description: Any other context, mockups, or references
    validations:
      required: false
```

### Template Chooser Config (`config.yml`)

```yaml
blank_issues_enabled: false
contact_links:
  - name: 📖 Documentation
    url: https://github.com/michaelwang123/arthas/tree/main/official_doc
    about: Check the documentation before opening an issue
```

> Note: GitHub Discussions link omitted — enable Discussions in repo Settings first if you want to add it later.

### Design Decisions

- **YAML form format** (not Markdown templates): GitHub Issue Forms provide structured input with validation, dropdowns, and required fields — reducing incomplete bug reports
- **Component dropdown**: Helps maintainers triage quickly across the three main components (web, server, CLI)
- **blank_issues_enabled: false**: Forces contributors to use templates, ensuring consistent information
- **No Discussions link**: Only add after enabling GitHub Discussions in repo settings

---

## Component 3: PR Template (`.github/PULL_REQUEST_TEMPLATE.md`)

```markdown
## Description

<!-- Describe your changes in detail -->

## Type of Change

<!-- Check the relevant option -->

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 📝 Documentation (changes to docs only)
- [ ] ♻️ Refactor (code change that neither fixes a bug nor adds a feature)
- [ ] ⚡ Performance (code change that improves performance)
- [ ] 🧪 Test (adding or updating tests)

## Testing Performed

<!-- Describe the tests you ran to verify your changes -->

## Checklist

- [ ] Code compiles without errors (`go build ./...` / `npm run build`)
- [ ] Tests pass (`go test ./...` / `npm test`)
- [ ] Documentation updated (if applicable)
- [ ] No unrelated changes included
- [ ] Commit messages follow project conventions
```

### Design Decisions

- **Concise**: Keeps the template short enough that contributors actually fill it in
- **Emoji prefixes**: Visual scanning aid for maintainers reviewing PR lists
- **Actionable checklist**: Each item maps to a verifiable action, not subjective judgment

---

## Component 4: Security Policy (`SECURITY.md`)

```markdown
# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | ✅ Security updates |
| < 1.0   | ❌ No longer supported |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

### Private Reporting

**Preferred:** Use GitHub's built-in [Private Vulnerability Reporting](https://github.com/michaelwang123/arthas/security/advisories/new) to submit reports directly on GitHub.

**Fallback:** If GitHub private reporting is unavailable, email the maintainer at the address listed in the GitHub profile.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

### Response Timeline

| Step | Timeframe |
|------|-----------|
| Acknowledgment | Within 72 hours |
| Initial assessment | Within 1 week |
| Fix development | Depends on severity |
| Coordinated disclosure | After fix is released |

### Scope

The following areas are in scope for security reports:

- **E2EE implementation** — Key generation, AES-256-GCM encryption/decryption, IV handling
- **WebSocket protocol** — Message injection, replay attacks, protocol downgrade
- **Server relay logic** — Information leakage, unauthorized room access, denial of service
- **Authentication bypass** — Room password bypass, share code prediction
- **Client-side crypto** — Key exposure, side-channel attacks, weak randomness

Out of scope:
- Social engineering attacks
- Denial of service via resource exhaustion (known limitation of free-tier hosting)
- Issues in third-party dependencies (report upstream)

### Disclosure Policy

We follow coordinated disclosure:
1. Reporter submits vulnerability privately
2. We acknowledge and assess
3. We develop and test a fix
4. We release the fix and publish a security advisory
5. Reporter receives credit in the advisory (unless anonymity is requested)

### Credit

We believe in recognizing security researchers. Unless you request anonymity, you will be credited in:
- The GitHub Security Advisory
- The release notes for the fixing version
- The project's SECURITY.md acknowledgments section

## Acknowledgments

<!-- Security researchers who have responsibly disclosed vulnerabilities -->

*No vulnerabilities reported yet. Be the first responsible disclosure!*
```

### Design Decisions

- **GitHub Private Vulnerability Reporting**: No need to maintain a separate email; GitHub handles the private channel natively. Enable in Settings → Security → Private vulnerability reporting.
- **72-hour acknowledgment**: Realistic for a solo maintainer; sets clear expectations
- **Explicit scope**: Lists the security-relevant areas of Arthas specifically, helping researchers focus
- **Credit by default**: Incentivizes responsible disclosure

---

## Component 5: TODO/FIXME Conversion Strategy

### Current TODO Comments Found

| # | File | Line | Content |
|---|------|------|---------|
| 1 | `arthas-client/src/file-transfer/sender.ts` | 339 | `TODO: 实现 60s 离线超时判断（记录离线开始时间）` |
| 2 | `arthas-client/src/file-transfer/sender.ts` | 350 | `TODO: 实现 60s 离线超时判断（重置在线时间）` |
| 3 | `arthas-client/src/file-transfer/fileTransferStore.ts` | 807 | `TODO: task 4.3 — 触发 sender.ts 的实际发送逻辑` |

### Conversion Process

For each TODO comment:

1. **Create GitHub Issue** with:
   - Title: Brief description of the deferred work
   - Body: File path, line number, surrounding code context (5-10 lines), and explanation of what needs to be done
   - Labels: `tech-debt`
   - (Optional) Labels: `frontend`, `file-transfer` for categorization

2. **Remove the TODO comment** from source code after issue creation

3. **Commit** the removal with message: `chore: convert TODO comments to tracked issues (#XX, #YY, #ZZ)`

### Issue Templates for TODO Conversion

**Issue 1 & 2** (related, can be combined into one issue):
```markdown
Title: [Tech Debt] Implement 60s offline timeout for file transfer pause/resume

**Context:**
In `arthas-client/src/file-transfer/sender.ts`, the offline/online event handlers
pause and resume file transfers but lack a 60-second timeout that would cancel
the transfer if the user stays offline too long.

**File:** `arthas-client/src/file-transfer/sender.ts`
**Lines:** 339, 350

**Code context:**
```typescript
window.addEventListener('offline', () => {
  isPaused = true;
  // Need: record offline start time, set 60s timer to cancel transfer
});

window.addEventListener('online', () => {
  isPaused = false;
  // Need: check if offline duration exceeded 60s, if so cancel instead of resume
});
```

**What needs to be done:**
- Record `Date.now()` when going offline
- Start a 60-second `setTimeout` that calls the cancel logic
- On `online` event, clear the timeout and check elapsed time
- If > 60s elapsed, cancel the active transfer instead of resuming

**Labels:** `tech-debt`, `frontend`, `file-transfer`
```

**Issue 3:**
```markdown
Title: [Tech Debt] Wire up file send queue to actual sender logic

**Context:**
In `arthas-client/src/file-transfer/fileTransferStore.ts`, the send queue
management is implemented but the actual call to `sender.ts` send logic
is stubbed out.

**File:** `arthas-client/src/file-transfer/fileTransferStore.ts`
**Line:** 807

**Code context:**
```typescript
// TODO: task 4.3 — 触发 sender.ts 的实际发送逻辑
// sender.sendFile(file, roomKey) 将在 task 4.3 中实现
// 发送完成后，sender.ts 会调用 completeActiveSend() 或 failActiveSend()
```

**What needs to be done:**
- Call `sender.sendFile(file, roomKey)` when a queued file becomes active
- Handle completion callback → `completeActiveSend()`
- Handle failure callback → `failActiveSend(error)`

**Labels:** `tech-debt`, `frontend`, `file-transfer`
```

---

## Component 6: English Documentation Translation

### Translation Approach

Each Chinese document in `official_doc/` gets a parallel English file with `.en.md` extension in the same directory.

> **Naming convention note**: The README uses English as default (`README.md` = English, `README.zh.md` = Chinese), but `official_doc/` uses Chinese as default (`.md` = Chinese, `.en.md` = English). This inconsistency is a pragmatic choice — renaming all existing Chinese docs to `.zh.md` would break many internal links. Can be unified in a future refactor.

### File Naming Convention

| Chinese Original | English Translation |
|-----------------|-------------------|
| `official_doc/self-hosting.md` | `official_doc/self-hosting.en.md` |
| `official_doc/cli-guide.md` | `official_doc/cli-guide.en.md` |
| `official_doc/development.md` | `official_doc/development.en.md` |
| `official_doc/getting-started.md` | `official_doc/getting-started.en.md` |
| `official_doc/architecture.md` | `official_doc/architecture.en.md` |
| `official_doc/configuration.md` | `official_doc/configuration.en.md` |
| `official_doc/protocol.md` | `official_doc/protocol.en.md` |

### Translation Rules

1. **Language navigation header** — Every English doc starts with:
   ```markdown
   [中文](filename.md) | English
   ```

2. **Heading structure preserved** — Same `#`, `##`, `###` hierarchy; translate heading text but keep the same nesting

3. **Code blocks unchanged** — All `bash`, `go`, `typescript`, `json` code blocks are copied verbatim. Only Chinese comments within code blocks are translated.

4. **Tables** — Column headers and descriptive cells translated; values (port numbers, file paths, variable names) unchanged

5. **Links** — Internal links updated to point to `.en.md` counterparts where they exist; external URLs unchanged

6. **Placeholders** — Chinese placeholder text in examples (e.g., `你的用户名`) translated to English equivalents (e.g., `your-username`)

### Example Translation Pattern

**Chinese original (`getting-started.md`):**
```markdown
# 快速开始 (Getting Started)

本指南帮助你在 5 分钟内本地运行 Arthas 项目。

## 环境要求

| 工具 | 最低版本 | 说明 |
|------|----------|------|
| Go | 1.22+ | 后端编译运行 |
```

**English translation (`getting-started.en.md`):**
```markdown
[中文](getting-started.md) | English

# Getting Started

This guide helps you run Arthas locally in 5 minutes.

## Prerequisites

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Go | 1.22+ | Backend compilation and runtime |
```

---

## Error Handling

This feature consists entirely of static files. There are no runtime error conditions. Validation is limited to:

- **YAML syntax**: Issue templates must be valid YAML parseable by GitHub
- **Markdown rendering**: All files must render correctly on GitHub's Markdown renderer
- **Front matter**: Blog post front matter must follow dev.to's expected format

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: English doc exists for every Chinese doc

*For any* Chinese documentation file (`*.md`, excluding `*.en.md`) in the `official_doc/` directory, there SHALL exist a corresponding English file with the same base name and `.en.md` extension in the same directory.

**Validates: Requirements 6.1, 6.2**

### Property 2: Heading structure preservation

*For any* pair of Chinese original and English translation in `official_doc/`, the sequence of Markdown heading levels (extracted as lines matching `^#{1,6}\s`) SHALL have the same count and the same level hierarchy (i.e., `#` count per heading line matches positionally).

**Validates: Requirements 6.3**

### Property 3: Code block preservation

*For any* pair of Chinese original and English translation in `official_doc/`, the content of fenced code blocks (excluding inline comments) SHALL preserve all command strings, file paths, variable names, and non-comment code lines unchanged.

**Validates: Requirements 6.5**

### Property 4: Language navigation link presence

*For any* English translation file (`*.en.md`) in `official_doc/`, the file SHALL contain a language navigation link within the first 3 lines matching the pattern `[中文](<basename>.md) | English` where `<basename>` is the file's base name without the `.en.md` extension.

**Validates: Requirements 6.6**

### Property 5: English doc contains no untranslated Chinese prose

*For any* English translation file (`*.en.md`) in `official_doc/`, all text outside of fenced code blocks SHALL contain no Chinese characters (Unicode range `\u4e00-\u9fff`), confirming that prose content has been translated.

**Validates: Requirements 6.4**
