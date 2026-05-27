# Requirements Document

## Introduction

This feature covers open-source community readiness polish for the Arthas project (michaelwang123/arthas). The scope includes: a tutorial blog post for dev.to, GitHub Issue and PR templates, a SECURITY.md vulnerability reporting policy, converting existing TODO/FIXME code comments into tracked GitHub Issues, and creating English (.en.md) translations of all official documentation alongside the Chinese originals.

## Glossary

- **Blog_Post**: A tutorial-style article published on dev.to explaining how Arthas was built
- **Issue_Template**: A structured YAML-based GitHub Issue form located in `.github/ISSUE_TEMPLATE/`
- **PR_Template**: A Markdown pull request template located at `.github/PULL_REQUEST_TEMPLATE.md`
- **Security_Policy**: A SECURITY.md file in the repository root describing the vulnerability reporting process
- **TODO_Comment**: An inline code comment prefixed with `TODO:` or `FIXME:` indicating deferred work
- **English_Doc**: A `.en.md` file placed alongside its Chinese `.md` counterpart in `official_doc/`
- **Repository**: The GitHub repository at michaelwang123/arthas
- **Official_Doc_Directory**: The `official_doc/` folder containing user-facing documentation

## Requirements

### Requirement 1: Blog Post Creation

**User Story:** As a maintainer, I want a tutorial-style blog post for dev.to, so that developers can discover Arthas and learn from its E2EE implementation.

#### Acceptance Criteria

1.1 THE Blog_Post SHALL be written in English as a step-by-step tutorial titled "How I built an E2EE chat in Go + React".

1.2 THE Blog_Post SHALL include code snippets demonstrating the core encryption flow (key generation, AES-256-GCM encryption, WebSocket relay).

1.3 THE Blog_Post SHALL cover the following sections in order: motivation, architecture overview, E2EE implementation, WebSocket relay design, frontend integration, and deployment.

1.4 THE Blog_Post SHALL include dev.to front matter with appropriate tags (go, react, encryption, webdev).

1.5 THE Blog_Post SHALL reference the GitHub repository URL (https://github.com/michaelwang123/arthas) and link to the live demo.

1.6 THE Blog_Post SHALL be saved as `docs/show/posts/devto-e2ee-tutorial.md` in the Repository.

### Requirement 2: GitHub Issue Templates

**User Story:** As a contributor, I want structured issue templates, so that bug reports and feature requests contain the information maintainers need to act on them.

#### Acceptance Criteria

2.1 THE Repository SHALL contain a bug report issue template at `.github/ISSUE_TEMPLATE/bug_report.yml`.

2.2 THE bug report issue template SHALL include required fields for: description, steps to reproduce, expected behavior, actual behavior, and environment (OS, browser/Go version).

2.3 THE bug report issue template SHALL include optional fields for: screenshots and additional context.

2.4 THE Repository SHALL contain a feature request issue template at `.github/ISSUE_TEMPLATE/feature_request.yml`.

2.5 THE feature request issue template SHALL include required fields for: problem description, proposed solution, and alternatives considered.

2.6 THE feature request issue template SHALL include an optional field for additional context.

2.7 THE Repository SHALL contain a template chooser config at `.github/ISSUE_TEMPLATE/config.yml` that disables blank issues and links to existing documentation for questions.

### Requirement 3: GitHub PR Template

**User Story:** As a maintainer, I want a PR template, so that contributors provide consistent context about their changes.

#### Acceptance Criteria

3.1 THE Repository SHALL contain a pull request template at `.github/PULL_REQUEST_TEMPLATE.md`.

3.2 THE PR template SHALL include sections for: description of changes, type of change (bug fix, feature, docs, refactor), testing performed, and checklist items.

3.3 THE PR template checklist SHALL include items for: code compiles without errors, tests pass, documentation updated if needed, and no unrelated changes included.

### Requirement 4: Security Policy

**User Story:** As a security researcher, I want a clear vulnerability reporting process, so that I can responsibly disclose security issues.

#### Acceptance Criteria

4.1 THE Repository SHALL contain a security policy at `SECURITY.md` in the repository root.

4.2 THE Security_Policy SHALL specify the supported versions eligible for security updates.

4.3 THE Security_Policy SHALL provide a private reporting channel via GitHub's built-in Private Vulnerability Reporting feature (or maintainer's personal email as fallback) for vulnerability disclosure.

4.4 THE Security_Policy SHALL state the expected response time for acknowledging a vulnerability report (within 72 hours).

4.5 THE Security_Policy SHALL describe the disclosure timeline (coordinated disclosure after fix is available).

4.6 THE Security_Policy SHALL list the scope of security concerns relevant to Arthas (E2EE implementation, WebSocket protocol, server relay logic, authentication bypass).

4.7 THE Security_Policy SHALL state that reporters will receive credit in the security advisory unless they request anonymity.

### Requirement 5: TODO/FIXME Conversion to GitHub Issues

**User Story:** As a maintainer, I want all deferred work tracked as GitHub Issues, so that nothing is lost and contributors can pick up tasks.

#### Acceptance Criteria

5.1 WHEN a TODO_Comment exists in the codebase, THE maintainer SHALL create a corresponding tracking entry in `docs/tech-debt-issues.md` documenting the deferred work with file path, line reference, and context.

5.2 WHEN a GitHub Issue has been created for a TODO_Comment, THE TODO_Comment SHALL be removed from the source code.

5.3 THE created GitHub Issues SHALL include a label "tech-debt" to distinguish them from user-reported issues.

5.4 THE created GitHub Issues SHALL reference the original file path and surrounding code context in the issue body.

### Requirement 6: English Documentation Translations

**User Story:** As an international contributor, I want English versions of all official documentation, so that I can understand the project without reading Chinese.

#### Acceptance Criteria

6.1 THE Official_Doc_Directory SHALL contain an English translation file with `.en.md` extension for each of the following documents: self-hosting.md, cli-guide.md, development.md, getting-started.md, architecture.md, configuration.md, protocol.md.

6.2 WHEN an English_Doc is created, THE English_Doc SHALL be placed in the same directory as its Chinese counterpart (official_doc/).

6.3 THE English_Doc SHALL preserve the same heading structure and section organization as the Chinese original.

6.4 THE English_Doc SHALL translate all prose content, code comments within code blocks, and table descriptions into English.

6.5 THE English_Doc SHALL retain all code snippets, command examples, and file paths unchanged from the Chinese original.

6.6 THE English_Doc SHALL include a language navigation link at the top referencing the Chinese original (e.g., `[中文](filename.md) | English`).
