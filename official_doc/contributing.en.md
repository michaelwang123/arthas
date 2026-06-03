[中文](contributing.md) | English

# Contributing Guide

Thank you for your interest in the Arthas project! This document explains how to contribute.

---

## Ways to Contribute

### Reporting Bugs

1. Search GitHub Issues to check if the problem already exists
2. If not, create a new Issue including:
   - Problem description
   - Steps to reproduce
   - Expected behavior vs actual behavior
   - Browser/OS version
   - Relevant screenshots or logs

### Feature Requests

1. Create a Feature Request on GitHub Issues
2. Describe the use case and expected behavior
3. Explain why this feature would be valuable to the project

### Submitting Code

1. Fork the project
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Write code and tests
4. Ensure all checks pass:
   ```bash
   # Backend
   cd arthas-server
   go build ./...
   go test ./...
   go vet ./...

   # Frontend
   cd arthas-client
   npx tsc --noEmit
   npm run build
   ```
5. Commit: `git commit -m "feat: your feature description"`
6. Push: `git push origin feature/your-feature`
7. Create a Pull Request

---

## Development Workflow

### Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable releases |
| `develop` | Development branch |
| `feature/*` | Feature development |
| `fix/*` | Bug fixes |

### Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add message recall feature
fix: fix message loss after reconnection
docs: update deployment documentation
refactor: refactor room management logic
test: add encryption layer unit tests
chore: update dependency versions
```

---

## Code Standards

### Go Code

- Format with `gofmt`
- Check with `go vet`
- Exported functions must have comments
- Error handling uses `error` returns, not panic
- Concurrency safety uses `sync.RWMutex`

### TypeScript Code

- Strict mode (`strict: true`)
- Use functional components + React Hooks
- Define Props with interfaces
- Avoid `any` types
- Use Tailwind CSS, no custom CSS

### Security Guidelines

- **Never log message content on the server**
- **Never store roomKey on the server**
- **Crypto-related code changes require extra review**
- **New server logs must not contain user messages**

---

## Pull Request Checklist

- [ ] Code passes `go build ./...` and `npm run build`
- [ ] Backend tests pass `go test ./...`
- [ ] Frontend type checking passes `npx tsc --noEmit`
- [ ] New features have corresponding tests
- [ ] Documentation updated (if applicable)
- [ ] No new security risks introduced
- [ ] Commit messages follow convention

---

## Architecture Decisions

Before contributing, please understand these design decisions:

1. **Server Zero-Knowledge** — No modification may give the server decryption capability
2. **No Persistence** — No database, pure in-memory design
3. **No Third-Party Crypto Libraries** — Frontend uses only Web Crypto API
4. **Binary Protocol** — Uses MessagePack, not JSON
5. **No Router Library** — Frontend uses hash routing, no react-router

---

## Getting Help

- Read the [Development Guide](development.en.md) to understand the code structure
- Read the [Architecture Document](architecture.en.md) to understand design decisions
- Ask questions in Issues

---

## Code of Conduct

- Respect all contributors
- Discuss technical approaches constructively
- Accept code review feedback
- Be friendly and professional
