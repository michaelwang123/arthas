# ============================================================================
# Release script for Arthas binaries (arthas-cli + arthas-server)
# Builds cross-platform binaries and creates/updates a GitHub Release.
#
# Usage:
#   .\docs\scripts\release-cli.ps1 <version>
#   Example: .\docs\scripts\release-cli.ps1 v1.3.0
#
# Prerequisites:
#   - Go 1.23+
#   - GitHub CLI (gh) authenticated
#   - npm (for frontend build)
#   - Run from repository root
# ============================================================================

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

$CLI_DIR = "arthas-cli"
$SERVER_DIR = "arthas-server"
$BUILD_DIR = "build"

Write-Host "=== Building Arthas $Version ===" -ForegroundColor Green

# Clean
if (Test-Path $BUILD_DIR) { Remove-Item -Recurse -Force $BUILD_DIR }
New-Item -ItemType Directory -Path $BUILD_DIR -Force | Out-Null

# ============================================================================
# Build arthas-cli
# ============================================================================
Write-Host "`n--- arthas-cli ---" -ForegroundColor Yellow

$platforms = @(
    @{ GOOS="linux";  GOARCH="amd64"; Suffix="linux-amd64"; Ext="" },
    @{ GOOS="linux";  GOARCH="arm64"; Suffix="linux-arm64"; Ext="" },
    @{ GOOS="darwin"; GOARCH="amd64"; Suffix="darwin-amd64"; Ext="" },
    @{ GOOS="darwin"; GOARCH="arm64"; Suffix="darwin-arm64"; Ext="" },
    @{ GOOS="windows"; GOARCH="amd64"; Suffix="windows-amd64"; Ext=".exe" }
)

$i = 1
foreach ($p in $platforms) {
    Write-Host "[$i/5] $($p.GOOS)/$($p.GOARCH)..."
    $env:GOOS = $p.GOOS; $env:GOARCH = $p.GOARCH; $env:CGO_ENABLED = "0"
    $out = "$BUILD_DIR/arthas-cli-$($p.Suffix)$($p.Ext)"
    go build -C $CLI_DIR -ldflags "-s -w -X main.version=$Version" -o "../$out" ./cmd/arthas-cli
    if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }
    $i++
}

# Generic name for simple download
Copy-Item "$BUILD_DIR/arthas-cli-linux-amd64" "$BUILD_DIR/arthas-cli"

# ============================================================================
# Build arthas-server (backend only)
# ============================================================================
Write-Host "`n--- arthas-server ---" -ForegroundColor Yellow

$i = 1
foreach ($p in $platforms) {
    Write-Host "[$i/5] $($p.GOOS)/$($p.GOARCH)..."
    $env:GOOS = $p.GOOS; $env:GOARCH = $p.GOARCH; $env:CGO_ENABLED = "0"
    $out = "$BUILD_DIR/arthas-server-$($p.Suffix)$($p.Ext)"
    go build -C $SERVER_DIR -ldflags "-s -w -X main.Version=$Version" -o "../$out" ./cmd/server
    if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }
    $i++
}

# ============================================================================
# Build arthas-server-all (server + embedded frontend)
# ============================================================================
Write-Host "`n--- arthas-server-all (with embedded frontend) ---" -ForegroundColor Yellow

Write-Host "[0] Building frontend..."
Push-Location $CLI_DIR/../arthas-client
npm run build
Pop-Location
if ($LASTEXITCODE -ne 0) { Write-Host "Frontend build failed!" -ForegroundColor Red; exit 1 }

# Sync dist to embed dir
$embedDir = "$SERVER_DIR/internal/static/dist"
if (Test-Path $embedDir) { Remove-Item -Recurse -Force $embedDir }
Copy-Item -Recurse "arthas-client/dist" $embedDir

$i = 1
foreach ($p in $platforms) {
    Write-Host "[$i/5] $($p.GOOS)/$($p.GOARCH)..."
    $env:GOOS = $p.GOOS; $env:GOARCH = $p.GOARCH; $env:CGO_ENABLED = "0"
    $out = "$BUILD_DIR/arthas-server-all-$($p.Suffix)$($p.Ext)"
    go build -C $SERVER_DIR -ldflags "-s -w -X main.Version=$Version" -o "../$out" ./cmd/server
    if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }
    $i++
}

# Reset env vars
Remove-Item Env:\GOOS -ErrorAction SilentlyContinue
Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue
Remove-Item Env:\CGO_ENABLED -ErrorAction SilentlyContinue

# ============================================================================
# List artifacts
# ============================================================================
Write-Host "`n=== Build artifacts ===" -ForegroundColor Green
Get-ChildItem $BUILD_DIR | ForEach-Object { 
    $sizeMB = [math]::Round($_.Length / 1MB, 1)
    Write-Host "  $($_.Name) (${sizeMB}MB)"
}

# ============================================================================
# Create GitHub Release
# ============================================================================
Write-Host "`n=== Creating GitHub Release $Version ===" -ForegroundColor Green

$artifacts = Get-ChildItem "$BUILD_DIR/*" | ForEach-Object { $_.FullName }

$releaseNotes = @"
## Arthas $Version

### What's New

- **Arthas Hub** — Public room directory. Create rooms, list them publicly, let anyone browse and join without share codes.

### Downloads

| Platform | arthas-cli | arthas-server | arthas-server-all |
|----------|-----------|--------------|-------------------|
| Linux x86_64 | arthas-cli-linux-amd64 | arthas-server-linux-amd64 | arthas-server-all-linux-amd64 |
| Linux ARM64 | arthas-cli-linux-arm64 | arthas-server-linux-arm64 | arthas-server-all-linux-arm64 |
| macOS Intel | arthas-cli-darwin-amd64 | arthas-server-darwin-amd64 | arthas-server-all-darwin-amd64 |
| macOS Apple Silicon | arthas-cli-darwin-arm64 | arthas-server-darwin-arm64 | arthas-server-all-darwin-arm64 |
| Windows x86_64 | arthas-cli-windows-amd64.exe | arthas-server-windows-amd64.exe | arthas-server-all-windows-amd64.exe |

### Quick install (Linux/macOS)

``````bash
curl -L https://github.com/michaelwang123/arthas/releases/latest/download/arthas-server-all-linux-amd64 -o arthas-server-all
chmod +x arthas-server-all
./arthas-server-all
``````
"@

gh release create $Version @artifacts --title $Version --notes $releaseNotes

if ($LASTEXITCODE -ne 0) { 
    Write-Host "Release creation failed!" -ForegroundColor Red
    exit 1 
}

Write-Host "`n=== Done! Release $Version published ===" -ForegroundColor Green
Write-Host "https://github.com/michaelwang123/arthas/releases/tag/$Version"
