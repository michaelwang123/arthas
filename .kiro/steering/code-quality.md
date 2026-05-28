# Arthas Code Quality Guidelines

## Core Principles

1. **Stability** — Code must be robust and handle edge cases gracefully. Use fail-fast for configuration errors, graceful degradation for runtime errors.
2. **Robustness** — All error paths must have clear user feedback. Never swallow errors silently in production code.
3. **Extensibility** — Design for change. Use interfaces, dependency injection, and single responsibility principle.
4. **Best Practices** — Follow language-specific conventions (Effective Go, strict TypeScript, secure coding patterns).

## Engineering Standards

- **Go**: Follow Effective Go and Go Code Review Comments (naming, error handling, package organization)
- **TypeScript**: Strict types (no `any`), discriminated unions, exhaustive checks
- **Error handling**: Fail-fast principle, descriptive error messages with fix suggestions
- **State management**: Single source of truth, avoid state inconsistency
- **Single responsibility**: Each file/module does one thing (SRP)
- **Dependencies**: Prefer standard library and existing dependencies over new ones

## Code Organization

- New feature modules in separate directories, isolated from existing logic
- Protocol types centralized in protocol files, separated from implementation
- Crypto operations reuse existing `src/crypto/` patterns
- Match project style: Tailwind dark theme, Chinese UI text, msgpack binary protocol

## Known Pitfalls

1. **msgpack type assertion**: `vmihailenco/msgpack/v5` decodes small positive integers as `int8`/`uint8` (not `int64`). Use `toInt()` helper for number extraction from `map[string]interface{}`
2. **WebSocket message size**: Current `maxMessageSize = 4096`. Adjust if larger messages needed (e.g., file chunks)
3. **CSS animations**: Use `overflow-hidden` with `max-h-0` for content hiding, otherwise content remains visible
