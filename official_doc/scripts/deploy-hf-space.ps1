# ============================================================================
# deploy-hf-space.ps1 — 部署 arthas-server 到 Hugging Face Spaces
# ============================================================================
#
# 用法：
#   .\official_doc\scripts\deploy-hf-space.ps1
#
# 前置条件：
#   1. 已创建 HF Space（Docker SDK, Public, CPU Basic）
#      https://huggingface.co/new-space
#   2. 已创建 HF Access Token（Write 权限）
#      https://huggingface.co/settings/tokens
#   3. Git 已安装
#
# 推送时会提示输入：
#   - Username: 你的 HF 用户名
#   - Password: 你的 HF Access Token
# ============================================================================

param(
    [string]$HfUsername = "arthas100",
    [string]$SpaceName = "arthas-server"
)

$ErrorActionPreference = "Stop"

# 项目根目录
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ServerDir = Join-Path $ProjectRoot "arthas-server"
$TmpDir = Join-Path $env:TEMP "hf-deploy"

Write-Host "=== Arthas Server -> HF Spaces Deploy ===" -ForegroundColor Cyan
Write-Host "Source: $ServerDir"
Write-Host "Target: https://huggingface.co/spaces/$HfUsername/$SpaceName"
Write-Host ""

# 1. 清理临时目录
if (Test-Path $TmpDir) {
    Write-Host "[1/5] Cleaning temp directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $TmpDir
}

# 2. 复制 arthas-server 到临时目录
Write-Host "[2/5] Copying server files..." -ForegroundColor Yellow
Copy-Item -Recurse $ServerDir $TmpDir

# 3. 清理编译产物和不需要的文件
Write-Host "[3/5] Removing build artifacts..." -ForegroundColor Yellow
Push-Location $TmpDir
# 删除所有编译产物（跨平台 build 目录、可执行文件、测试二进制）
if (Test-Path "build") { Remove-Item -Recurse -Force "build" }
Remove-Item -Force -ErrorAction SilentlyContinue `
    server, server.exe, `
    arthas-server.exe, `
    network.test, network.test.exe, `
    *.test, *.test.exe
# 清理误创建的 dev/null 目录（Windows 上 2>$null 可能产生）
if (Test-Path "dev") { Remove-Item -Recurse -Force "dev" }
Pop-Location

# 4. 初始化 Git 并提交
Write-Host "[4/5] Creating git commit..." -ForegroundColor Yellow
Push-Location $TmpDir
git init --quiet
git add -A
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
git commit --quiet -m "deploy: arthas server @ $timestamp"

# 5. 推送到 HF Space
Write-Host "[5/5] Pushing to HF Space..." -ForegroundColor Yellow
$RemoteUrl = "https://huggingface.co/spaces/$HfUsername/$SpaceName"
git remote add space $RemoteUrl

# 获取本地分支名（可能是 master 或 main）
$LocalBranch = git branch --show-current
git push space "${LocalBranch}:main" --force

Pop-Location

# 6. 清理
Write-Host ""
Write-Host "Cleaning up temp directory..." -ForegroundColor Yellow
Remove-Item -Recurse -Force $TmpDir

Write-Host ""
Write-Host "=== Deploy Complete ===" -ForegroundColor Green
Write-Host "Space URL: https://$HfUsername-$SpaceName.hf.space"
Write-Host "Health check: https://$HfUsername-$SpaceName.hf.space/ping"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Wait 2-3 minutes for build to complete"
Write-Host "  2. Visit /ping to verify server is running"
Write-Host "  3. Set ALLOWED_ORIGINS in Space Settings after frontend deploy"
