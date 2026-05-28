---
inclusion: manual
---

# Arthas 发布工作流指南

本文件描述 Arthas 项目的版本发布流程。当用户提到"发布"、"release"、"打 tag"、"版本"时参考此指南。

## 版本号规范（SemVer）

- **Major (X.0.0)**: 破坏性变更（API 不兼容）
- **Minor (0.X.0)**: 新功能（向后兼容）
- **Patch (0.0.X)**: Bug 修复

## 发布流程

### 1. 准备阶段

```bash
# 确认当前分支状态干净
git status

# 确认所有测试通过（如果有）
cd packages/openclaw-channel && npm test
cd arthas-cli && go test ./...
```

### 2. 创建功能分支并提交

```bash
# 从 main 创建功能分支
git checkout -b feat/<feature-name>

# 暂存相关文件（精确选择，避免无关文件）
git add <specific-files>

# 提交（遵循 Conventional Commits）
git commit -m "feat(<scope>): <简短描述>

<详细说明>

Closes: <spec-name>"
```

### 3. 打 Tag

```bash
# 创建带注释的 tag
git tag -a v<X.Y.Z> -m "v<X.Y.Z>: <发布标题>"
```

### 4. 推送

```bash
# 推送分支（首次推送用 -u 设置 tracking）
git push -u origin feat/<feature-name>

# 推送 tag
git push origin v<X.Y.Z>
```

### 5. 创建 GitHub Release

```bash
gh release create v<X.Y.Z> \
  --title "v<X.Y.Z>: <发布标题>" \
  --notes "## What's New

### <功能名称>

<功能描述>

**Key Features:**
- <特性 1>
- <特性 2>

**Install/Usage:**
\`\`\`bash
<安装命令>
\`\`\`

See \`<README 路径>\` for documentation."
```

### 6. （可选）创建 PR 合并到 main

```bash
gh pr create \
  --title "feat(<scope>): <标题>" \
  --body "## Summary
<变更摘要>

## Changes
- <变更列表>

## Testing
- <测试说明>"
```

## Commit Message 规范

格式: `<type>(<scope>): <subject>`

| Type | 用途 |
|------|------|
| feat | 新功能 |
| fix | Bug 修复 |
| docs | 文档变更 |
| refactor | 重构（不改变行为） |
| test | 测试相关 |
| chore | 构建/工具变更 |

Scope 示例: `openclaw-channel`, `cli`, `server`, `client`, `website`

## 项目特定注意事项

### Monorepo 结构

```
arthas/
├── arthas-server/     → Go 服务器
├── arthas-client/     → Web 前端 (Vite + React)
├── arthas-cli/        → Go CLI 客户端
├── packages/
│   └── openclaw-channel/  → npm 包 (@arthas/openclaw-channel)
└── website/           → 项目官网 (Astro)
```

### npm 包发布（packages/ 下的包）

```bash
cd packages/<package-name>
npm run build          # tsc 编译
npm publish --access public  # 发布到 npm（需要 npm 登录）
```

### 发布前检查清单

- [ ] TypeScript 编译零错误 (`tsc --noEmit`)
- [ ] 测试全部通过 (`npm test`)
- [ ] package.json version 已更新
- [ ] README.md 是最新的
- [ ] CHANGELOG 或 issue 文档已更新
- [ ] .npmignore 排除了源码和测试文件
- [ ] `files` 字段只包含 dist/ 和 README.md

## 回滚

如果发布有问题：

```bash
# 删除本地 tag
git tag -d v<X.Y.Z>

# 删除远程 tag
git push origin :refs/tags/v<X.Y.Z>

# 删除 GitHub Release（通过 gh CLI）
gh release delete v<X.Y.Z> --yes

# npm 包回滚（72 小时内）
npm unpublish @arthas/<package>@<version>
```
