#!/usr/bin/env bash
# scripts/validate-openclaw-docs.sh
#
# 📚 学习要点: 为什么需要文档验证脚本？
# 文档是静态 Markdown 文件，容易与代码实现产生不一致（版本号、URL、配置项等）。
# 此脚本在 CI 或本地运行，自动检测常见的文档质量问题，确保文档始终与代码同步。
#
# 验证项：
# 1. 文档文件存在性
# 2. 无 Starlight frontmatter（sync-docs.mjs 自动注入）
# 3. GitHub URL 正确性（无旧 URL 残留）
# 4. i18n 键完整性
# 5. package.json license 一致性
# 6. 版本号一致性
# 7. 文档结构完整性（"下一步" / "Next Steps" section）
# 8. Section 分隔线数量
# 9. 架构图存在性
# 10. sync-docs.mjs 同步 + 网站构建

set -e

echo "🔍 Validating OpenClaw Channel documentation..."
echo ""

# 1. 检查文档文件存在
echo "  [1/10] Checking doc files exist..."
test -f official_doc/openclaw-channel.md || { echo "❌ Missing Chinese doc: official_doc/openclaw-channel.md"; exit 1; }
test -f official_doc/openclaw-channel.en.md || { echo "❌ Missing English doc: official_doc/openclaw-channel.en.md"; exit 1; }
echo "  ✓ Both doc files exist"

# 2. 检查不包含 frontmatter（文件第一行不能是 ---）
echo "  [2/10] Checking no frontmatter at line 1..."
if head -1 official_doc/openclaw-channel.md | grep -q "^---$"; then
  echo "❌ Chinese doc has frontmatter at line 1 (sync-docs.mjs injects it automatically)"
  exit 1
fi
if head -1 official_doc/openclaw-channel.en.md | grep -q "^---$"; then
  echo "❌ English doc has frontmatter at line 1 (sync-docs.mjs injects it automatically)"
  exit 1
fi
echo "  ✓ No frontmatter detected"

# 3. 检查 GitHub URL 已修正（不应有旧的 nicepkg/arthas URL）
echo "  [3/10] Checking GitHub URL corrected..."
if grep -r "nicepkg/arthas" packages/openclaw-channel/ 2>/dev/null; then
  echo "❌ Old GitHub URL (nicepkg/arthas) still found in packages/openclaw-channel/"
  exit 1
fi
if grep -r "nicepkg/arthas" official_doc/openclaw-channel*.md 2>/dev/null; then
  echo "❌ Old GitHub URL (nicepkg/arthas) still found in official_doc/"
  exit 1
fi
echo "  ✓ GitHub URL corrected"

# 4. 检查 i18n 键存在
echo "  [4/10] Checking i18n keys..."
grep -q "features.openclaw.title" website/src/i18n/en.json || { echo "❌ Missing i18n key 'features.openclaw.title' in en.json"; exit 1; }
grep -q "features.openclaw.description" website/src/i18n/en.json || { echo "❌ Missing i18n key 'features.openclaw.description' in en.json"; exit 1; }
grep -q "features.openclaw.title" website/src/i18n/zh.json || { echo "❌ Missing i18n key 'features.openclaw.title' in zh.json"; exit 1; }
grep -q "features.openclaw.description" website/src/i18n/zh.json || { echo "❌ Missing i18n key 'features.openclaw.description' in zh.json"; exit 1; }
echo "  ✓ All i18n keys present"

# 5. 检查 package.json license 为 AGPL-3.0
echo "  [5/10] Checking package.json license..."
grep -q '"AGPL-3.0"' packages/openclaw-channel/package.json || { echo "❌ Package license is not AGPL-3.0 in packages/openclaw-channel/package.json"; exit 1; }
echo "  ✓ License is AGPL-3.0"

# 6. 检查版本号一致（文档中引用的版本必须与 package.json 一致）
echo "  [6/10] Checking version number consistency..."
PKG_VERSION=$(node -p "require('./packages/openclaw-channel/package.json').version")
grep -q "$PKG_VERSION" official_doc/openclaw-channel.md || { echo "❌ Chinese doc version mismatch (expected $PKG_VERSION)"; exit 1; }
grep -q "$PKG_VERSION" official_doc/openclaw-channel.en.md || { echo "❌ English doc version mismatch (expected $PKG_VERSION)"; exit 1; }
echo "  ✓ Version $PKG_VERSION found in both docs"

# 7. 检查文档包含"下一步" / "Next Steps" section
echo "  [7/10] Checking Next Steps sections..."
grep -q "## 下一步" official_doc/openclaw-channel.md || { echo "❌ Chinese doc missing '## 下一步' section"; exit 1; }
grep -q "## Next Steps" official_doc/openclaw-channel.en.md || { echo "❌ English doc missing '## Next Steps' section"; exit 1; }
echo "  ✓ Next Steps sections present"

# 8. 检查水平分隔线存在（至少 5 个 section 分隔符）
echo "  [8/10] Checking section separators..."
ZH_SEPARATORS=$(grep -c "^---$" official_doc/openclaw-channel.md || true)
EN_SEPARATORS=$(grep -c "^---$" official_doc/openclaw-channel.en.md || true)
if [ "$ZH_SEPARATORS" -lt 5 ]; then
  echo "❌ Chinese doc has fewer than 5 section separators (found $ZH_SEPARATORS)"
  exit 1
fi
if [ "$EN_SEPARATORS" -lt 5 ]; then
  echo "❌ English doc has fewer than 5 section separators (found $EN_SEPARATORS)"
  exit 1
fi
echo "  ✓ Chinese doc: $ZH_SEPARATORS separators, English doc: $EN_SEPARATORS separators"

# 9. 检查架构图存在
echo "  [9/10] Checking architecture diagram present..."
grep -q "Arthas Server (blind relay" official_doc/openclaw-channel.md || { echo "❌ Chinese doc missing architecture diagram"; exit 1; }
grep -q "Arthas Server (blind relay" official_doc/openclaw-channel.en.md || { echo "❌ English doc missing architecture diagram"; exit 1; }
echo "  ✓ Architecture diagram present in both docs"

# 10. 运行 sync-docs.mjs 并构建网站
echo "  [10/10] Running sync-docs.mjs and website build..."
cd website
node scripts/sync-docs.mjs
pnpm build
cd ..
echo "  ✓ Sync and build successful"

echo ""
echo "✅ All OpenClaw documentation checks passed"
