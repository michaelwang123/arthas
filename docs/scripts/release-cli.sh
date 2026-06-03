#!/bin/bash
# Release script for Arthas binaries (arthas-cli + arthas-server)
# Builds cross-platform binaries and creates/updates a GitHub Release.
#
# Usage:
#   ./docs/scripts/release-cli.sh [version]
#   Example: ./docs/scripts/release-cli.sh v1.2.3
#
# Prerequisites:
#   - Go 1.23+
#   - GitHub CLI (gh) authenticated
#   - Run from repository root

set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  echo "Example: $0 v1.2.3"
  exit 1
fi

CLI_DIR="arthas-cli"
SERVER_DIR="arthas-server"
BUILD_DIR="build"

echo "=== Building Arthas $VERSION ==="

# Clean
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ============================================================================
# Build arthas-cli
# ============================================================================
echo ""
echo "--- arthas-cli ---"

echo "[1/5] linux/amd64..."
GOOS=linux GOARCH=amd64 go build -C "$CLI_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "../$BUILD_DIR/arthas-cli-linux-amd64" ./cmd/arthas-cli

echo "[2/5] linux/arm64..."
GOOS=linux GOARCH=arm64 go build -C "$CLI_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "../$BUILD_DIR/arthas-cli-linux-arm64" ./cmd/arthas-cli

echo "[3/5] darwin/amd64..."
GOOS=darwin GOARCH=amd64 go build -C "$CLI_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "../$BUILD_DIR/arthas-cli-darwin-amd64" ./cmd/arthas-cli

echo "[4/5] darwin/arm64..."
GOOS=darwin GOARCH=arm64 go build -C "$CLI_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "../$BUILD_DIR/arthas-cli-darwin-arm64" ./cmd/arthas-cli

echo "[5/5] windows/amd64..."
GOOS=windows GOARCH=amd64 go build -C "$CLI_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "../$BUILD_DIR/arthas-cli-windows-amd64.exe" ./cmd/arthas-cli

# Generic name for simple curl download (linux amd64)
cp "$BUILD_DIR/arthas-cli-linux-amd64" "$BUILD_DIR/arthas-cli"

# ============================================================================
# Build arthas-server
# ============================================================================
echo ""
echo "--- arthas-server ---"

echo "[1/5] linux/amd64..."
GOOS=linux GOARCH=amd64 go build -C "$SERVER_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "../$BUILD_DIR/arthas-server-linux-amd64" ./cmd/server

echo "[2/5] linux/arm64..."
GOOS=linux GOARCH=arm64 go build -C "$SERVER_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "../$BUILD_DIR/arthas-server-linux-arm64" ./cmd/server

echo "[3/5] darwin/amd64..."
GOOS=darwin GOARCH=amd64 go build -C "$SERVER_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "../$BUILD_DIR/arthas-server-darwin-amd64" ./cmd/server

echo "[4/5] darwin/arm64..."
GOOS=darwin GOARCH=arm64 go build -C "$SERVER_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "../$BUILD_DIR/arthas-server-darwin-arm64" ./cmd/server

echo "[5/5] windows/amd64..."
GOOS=windows GOARCH=amd64 go build -C "$SERVER_DIR" -ldflags "-s -w -X main.version=$VERSION" -o "../$BUILD_DIR/arthas-server-windows-amd64.exe" ./cmd/server

# ============================================================================
# List artifacts
# ============================================================================
echo ""
echo "=== Build artifacts ==="
ls -lh "$BUILD_DIR"

# ============================================================================
# Create GitHub Release
# ============================================================================
echo ""
echo "=== Creating GitHub Release $VERSION ==="

gh release create "$VERSION" \
  "$BUILD_DIR/arthas-cli" \
  "$BUILD_DIR/arthas-cli-linux-amd64" \
  "$BUILD_DIR/arthas-cli-linux-arm64" \
  "$BUILD_DIR/arthas-cli-darwin-amd64" \
  "$BUILD_DIR/arthas-cli-darwin-arm64" \
  "$BUILD_DIR/arthas-cli-windows-amd64.exe" \
  "$BUILD_DIR/arthas-server-linux-amd64" \
  "$BUILD_DIR/arthas-server-linux-arm64" \
  "$BUILD_DIR/arthas-server-darwin-amd64" \
  "$BUILD_DIR/arthas-server-darwin-arm64" \
  "$BUILD_DIR/arthas-server-windows-amd64.exe" \
  --title "$VERSION" \
  --notes "## Arthas $VERSION

### Downloads

| Platform | arthas-cli | arthas-server |
|----------|-----------|--------------|
| Linux x86_64 | arthas-cli-linux-amd64 | arthas-server-linux-amd64 |
| Linux ARM64 | arthas-cli-linux-arm64 | arthas-server-linux-arm64 |
| macOS Intel | arthas-cli-darwin-amd64 | arthas-server-darwin-amd64 |
| macOS Apple Silicon | arthas-cli-darwin-arm64 | arthas-server-darwin-arm64 |
| Windows x86_64 | arthas-cli-windows-amd64.exe | arthas-server-windows-amd64.exe |

### Quick install (Linux/macOS)

\`\`\`bash
# CLI client
curl -L https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli -o arthas-cli
chmod +x arthas-cli

# Server
curl -L https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-linux-amd64 -o arthas-server
chmod +x arthas-server
\`\`\`
"

echo ""
echo "=== Done! Release $VERSION published ==="
echo "https://github.com/michaelwang123/arthas/releases/tag/$VERSION"
