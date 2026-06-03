#!/bin/bash
# Release script for arthas-cli
# Builds cross-platform binaries and creates a GitHub Release with gh CLI.
#
# Usage:
#   ./docs/scripts/release-cli.sh [version]
#   Example: ./docs/scripts/release-cli.sh v1.2.2
#
# Prerequisites:
#   - Go 1.23+
#   - GitHub CLI (gh) authenticated
#   - Run from repository root

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 v1.2.2"
  exit 1
fi

CLI_DIR="arthas-cli"
BUILD_DIR="$CLI_DIR/build"
MAIN_PKG="./cmd/arthas-cli"

echo "=== Building arthas-cli $VERSION ==="

# Clean previous build artifacts
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Build for Linux amd64
echo "[1/5] Building linux/amd64..."
GOOS=linux GOARCH=amd64 go build -C "$CLI_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "build/arthas-cli-linux-amd64" "$MAIN_PKG"

# Build for Linux arm64
echo "[2/5] Building linux/arm64..."
GOOS=linux GOARCH=arm64 go build -C "$CLI_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "build/arthas-cli-linux-arm64" "$MAIN_PKG"

# Build for macOS amd64
echo "[3/5] Building darwin/amd64..."
GOOS=darwin GOARCH=amd64 go build -C "$CLI_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "build/arthas-cli-darwin-amd64" "$MAIN_PKG"

# Build for macOS arm64 (Apple Silicon)
echo "[4/5] Building darwin/arm64..."
GOOS=darwin GOARCH=arm64 go build -C "$CLI_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "build/arthas-cli-darwin-arm64" "$MAIN_PKG"

# Build for Windows amd64
echo "[5/5] Building windows/amd64..."
GOOS=windows GOARCH=amd64 go build -C "$CLI_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "build/arthas-cli-windows-amd64.exe" "$MAIN_PKG"

# Also create a generic "arthas-cli" name (linux amd64) for the simple curl download
cp "$BUILD_DIR/arthas-cli-linux-amd64" "$BUILD_DIR/arthas-cli"

echo ""
echo "=== Build artifacts ==="
ls -lh "$BUILD_DIR"

echo ""
echo "=== Creating GitHub Release $VERSION ==="

gh release create "$VERSION" \
  "$BUILD_DIR/arthas-cli" \
  "$BUILD_DIR/arthas-cli-linux-amd64" \
  "$BUILD_DIR/arthas-cli-linux-arm64" \
  "$BUILD_DIR/arthas-cli-darwin-amd64" \
  "$BUILD_DIR/arthas-cli-darwin-arm64" \
  "$BUILD_DIR/arthas-cli-windows-amd64.exe" \
  --title "$VERSION" \
  --notes "## arthas-cli $VERSION

### Downloads

| Platform | Architecture | File |
|----------|-------------|------|
| Linux | x86_64 | \`arthas-cli-linux-amd64\` |
| Linux | ARM64 | \`arthas-cli-linux-arm64\` |
| macOS | x86_64 (Intel) | \`arthas-cli-darwin-amd64\` |
| macOS | ARM64 (Apple Silicon) | \`arthas-cli-darwin-arm64\` |
| Windows | x86_64 | \`arthas-cli-windows-amd64.exe\` |

### Quick install (Linux/macOS)

\`\`\`bash
curl -L https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli -o arthas-cli
chmod +x arthas-cli
\`\`\`
"

echo ""
echo "=== Done! Release $VERSION published ==="
echo "https://github.com/michaelwang123/arthas/releases/tag/$VERSION"
