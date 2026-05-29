# TODO — 手动操作清单

> 更新：2026-05-29

## 社区推广 Launch（手动操作）

### 1. 录制 Demo GIF

- [ ] 安装 ScreenToGif（Windows 免费工具）
- [ ] 准备录制环境：暗色主题、窗口 1280x720、清空标签
- [ ] 打开 https://arthas-chat.vercel.app（展示真实 URL）
- [ ] 录制流程：创建房间 → 复制分享码 → 新标签加入 → 发消息 → 收消息（20-25s）
- [ ] 导出：800px 宽、15fps、< 5MB
- [ ] 保存到 `docs/show/demo.gif`
- [ ] 提交并推送，确认 GitHub 上 GIF 正常渲染

### 2. 制作 Social Preview 图片

- [ ] 打开 Canva，创建 1280×640 画布
- [ ] 参考 `docs/show/social-preview-text.md` 中的方案（推荐 Option C）
- [ ] 设计要点：暗色背景 (#0f172a)、绿色强调 (#10b981)、Inter 字体
- [ ] 导出 PNG，上传到 GitHub Settings → Social Preview

### 3. GitHub 仓库设置

- [ ] Settings → About → Description: `E2EE ephemeral chat – create a room, share the key, chat securely, everything disappears. AES-256-GCM + Ed25519, encrypted file/voice sharing, AI agent channel plugin, CLI client, self-hostable single binary. No signup, no message history, server sees only ciphertext.`
- [ ] Settings → About → Website: `https://michaelwang123.github.io/arthas/`
- [ ] Settings → Topics: `end-to-end-encryption, e2ee, ephemeral-chat, self-hosted, privacy, websocket, go, react, typescript, encrypted-messaging, ai-agent, zero-knowledge, real-time-chat, docker, cli`
- [ ] 上传 Social Preview 图片

### 4. 合并 PR 到 main

- [ ] 去 GitHub 合并 `feat/openclaw-docs` PR
- [ ] 等待 GitHub Actions 部署官网（2-3 分钟）
- [ ] 验证官网更新：https://michaelwang123.github.io/arthas/openclaw-channel/

### 5. 发布 Show HN

- [ ] 确认 HN 账号有足够 karma（如果新账号需要先评论几天）
- [ ] 发布时间：美西周二-周四 8:00-10:00 AM（北京时间 23:00-01:00）
- [ ] 发布前 30 分钟 ping demo URL 确保在线
- [ ] 帖子内容在 `docs/show/posts/show-hn.md`
- [ ] 发布后 2-3 小时内持续回复评论
- [ ] FAQ 回复模板在 show-hn.md 底部

### 6. 发布 Reddit（HN 发布后第二天）

- [ ] r/selfhosted — 帖子在 `docs/show/posts/reddit-selfhosted.md`
- [ ] 等 2-4 小时观察反馈
- [ ] r/privacy — 帖子在 `docs/show/posts/reddit-privacy.md`
- [ ] r/opensource — 帖子在 `docs/show/posts/reddit-opensource.md`

### 7. 提交 awesome-selfhosted PR（≥10 stars 后）

- [ ] Fork awesome-selfhosted 仓库
- [ ] 在 `Communication - Custom Communication Systems` 分类按字母顺序插入
- [ ] 帖子模板在 `docs/show/posts/awesome-selfhosted-pr.md`
- [ ] 提交 PR

---

## 其他待办

- [ ] 确认 cron-job 保活 HF Spaces 服务器正常运行
- [ ] 发布后一周复盘（填写 `.kiro/specs/launch-promotion/tasks.md` 底部的复盘模板）
