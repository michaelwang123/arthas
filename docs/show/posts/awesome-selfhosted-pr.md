# awesome-selfhosted PR（终稿）

## 在哪个文件修改

文件：`README.md`（awesome-selfhosted 仓库根目录）

找到 `### Communication - Custom Communication Systems` 分类，按字母顺序插入。

## 插入内容

```markdown
- [Arthas](https://github.com/michaelwang123/arthas) - End-to-end encrypted ephemeral chat with no registration. Features include file sharing, voice messages, reply & reactions, self-destruct messages, and CLI client. ([Demo](https://arthas-blush.vercel.app/), [Source Code](https://github.com/michaelwang123/arthas)) `AGPL-3.0` `Go/Docker`
```

## PR 标题

```
Add Arthas - E2EE ephemeral chat
```

## PR 描述

```
**Description:**

Arthas is a self-hosted end-to-end encrypted ephemeral chat application.

**Features:**
- AES-256-GCM + Ed25519 end-to-end encryption
- No registration required
- Encrypted file sharing and voice messages
- Reply & emoji reactions (all encrypted)
- Self-destruct messages
- Room passwords and QR code sharing
- Room expiry timers (1h/24h/7d)
- CLI client (Go binary, cross-platform)
- AI Agent Channel plugin (E2EE for AI agent communication)
- i18n (EN/ZH/JA)

**Self-hosting:**
- Single Go binary (~15MB, embeds frontend via Go embed)
- Docker image < 30MB (Alpine-based, amd64 + arm64)
- Docker Compose with Caddy for automatic HTTPS
- No database required

**Links:**
- Demo: https://arthas-blush.vercel.app/
- Self-hosting docs: https://github.com/michaelwang123/arthas/blob/main/official_doc/self-hosting.en.md

**Checklist:**
- [x] Self-hosted / can be hosted on own infrastructure
- [x] Open source with AGPL-3.0 license
- [x] Working demo available
- [x] Installation documentation provided
- [x] Project is actively maintained
```

## 提交前检查

- [ ] 确认仓库已有 10+ stars
- [ ] 确认 awesome-selfhosted 的 CONTRIBUTING.md 格式要求
- [ ] 确认条目按字母顺序正确插入
- [ ] 确认所有链接可访问
- [ ] 本地运行 lint（如果仓库有）
