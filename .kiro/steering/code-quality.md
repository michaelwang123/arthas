# Arthas Code Quality Guidelines

## Core Principles

1. **Stability** — Code must be robust and handle edge cases gracefully. Use fail-fast for configuration errors, graceful degradation for runtime errors.
2. **Robustness** — All error paths must have clear user feedback. Never swallow errors silently in production code.
3. **Extensibility** — Design for change. Use interfaces, dependency injection, and single responsibility principle.
4. **Best Practices** — Follow language-specific conventions (Effective Go, strict TypeScript, secure coding patterns).

## Engineering Standards

- Follow language-specific idioms: Effective Go, strict TypeScript (no `any`), secure coding patterns
- Fail-fast principle with descriptive error messages and fix suggestions
- Single source of truth for state, avoid inconsistency
- Single responsibility: each file/module does one thing
- Prefer standard library and existing dependencies over new ones
- New feature modules in separate directories, isolated from existing logic
