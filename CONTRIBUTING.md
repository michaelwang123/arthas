# Contributing to Arthas

Thanks for your interest in contributing! Arthas is a learning project, and contributions of all kinds are welcome.

## Getting Started

### Prerequisites

- Go 1.23+
- Node.js 20+
- npm 9+

### Development Setup

```bash
# Clone the repo
git clone https://github.com/michaelwang123/arthas.git
cd arthas

# Start the backend
cd arthas-server
go mod tidy
go run cmd/server/main.go

# In another terminal, start the frontend
cd arthas-client
npm install
npm run dev
```

The frontend runs at `http://localhost:3000` and connects to the backend at `ws://localhost:8080/ws`.

### CLI Client

```bash
cd arthas-cli
go build -o arthas-cli ./cmd/arthas-cli/
./arthas-cli create --server ws://localhost:8080/ws --name Alice
```

## How to Contribute

### Bug Reports

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Browser/OS/Go version

### Feature Requests

Open an issue describing:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### Pull Requests

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes
4. Run tests:
   ```bash
   # Backend tests
   cd arthas-server && go test ./...
   
   # CLI tests
   cd arthas-cli && go test ./...
   
   # Frontend tests
   cd arthas-client && npm test
   ```
5. Commit with a descriptive message
6. Push and open a PR

### Code Style

- **Go**: Follow [Effective Go](https://go.dev/doc/effective_go) and standard `gofmt` formatting
- **TypeScript**: Strict types (no `any`), follow existing patterns in the codebase
- **Comments**: This is a learning project – please add comments explaining *why*, not just *what*

## Project Structure

```
arthas/
├── arthas-client/    # React + TypeScript frontend
├── arthas-server/    # Go WebSocket relay server
├── arthas-cli/       # Go CLI client
├── deploy/           # Docker + Caddy self-hosting
└── official_doc/     # User documentation
```

## Areas Where Help is Appreciated

- Security review of the crypto implementation
- Accessibility improvements
- Performance optimization suggestions
- Documentation improvements
- Translations (currently EN/ZH/JA)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
