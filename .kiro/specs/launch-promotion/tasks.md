# 任务：首发推广三板斧

## 任务列表

### Task 0: 开源前置条件
- **状态**: [ ] 未开始
- **对应需求**: REQ-0
- **预估耗时**: 3-4 小时（英文 README 翻译占大头）
- **步骤**:
  1. 创建 `LICENSE` 文件（MIT License，copyright michaelwang123）
  2. 将当前 `README.md` 重命名为 `README.zh.md`
  3. 创建英文 `README.md`（可先用精简版：标题+GIF+Features+QuickStart+Architecture，约 1.5h）
  4. 确认 `.gitignore` 包含 `scripts/` 和 `docs/show/demo-full.mp4`
  5. 在 GitHub Settings 将仓库设为 Public
  6. 执行 demo 稳定性检查清单（design.md §0）
  7. commit + push
  8. 确认 HN 账号可以发帖（如果是新账号，需要先花 2-3 天评论积累 karma）
  9. 确认 Reddit 账号年龄 > 7 天且有基础 karma

### Task 1: 录制产品 Demo GIF
- **状态**: [ ] 未开始
- **对应需求**: REQ-1
- **步骤**:
  1. 安装 ScreenToGif（Windows 原生，免费）
  2. 准备录制环境：清空浏览器标签、使用暗色主题、窗口 1280x720
  3. 打开 demo 站点（非 localhost，展示真实 URL）
  4. 按脚本录制：创建房间 → 分享码 → 加入 → 聊天（20-25s）
  5. 导出 GIF：800px 宽、15fps、确认 < 5MB
  6. 保存到 `docs/show/demo.gif`
  7. 同时截取 3 张静态截图保存到 `docs/show/screenshots/`
  8. commit + push，确认 GitHub 上 GIF 正常渲染

### Task 2: 优化 README 门面
- **状态**: [ ] 未开始
- **对应需求**: REQ-5, REQ-1
- **步骤**:
  1. 在英文 README 标题下方插入 GIF 演示（居中，带 alt 文本）
  2. 添加 badges 行（License、Go 1.23、Docker、Demo）
  3. 在 GitHub 仓库 Settings → About 设置描述：`E2EE ephemeral chat – no signup, self-hostable, zero knowledge`
  4. 在 GitHub 仓库 Settings → About 添加 Website 链接
  5. 在 GitHub 仓库 Settings 添加 Topics（11 个标签）
  6. 使用 Canva 制作 Social Preview 图片（1280x640，暗色主题）
  7. 上传 Social Preview 到 GitHub Settings → Social Preview
  8. commit + push

### Task 3: 撰写并发布 Show HN 帖子
- **状态**: [ ] 未开始
- **对应需求**: REQ-2
- **前置条件**: HN 账号有足够 karma 可以发帖
- **步骤**:
  1. 按 design.md §2 模板撰写帖子正文
  2. 替换所有 URL 占位符为真实链接
  3. 准备 FAQ 回复文档（design.md §2 FAQ 表格）
  4. 检查所有链接可访问（demo、GitHub、文档）
  5. 选择发布时间（美西周二-周四 8-10AM）
  6. 发布前 30 分钟 ping demo URL
  7. 发布帖子
  8. **Day 3 全天只做 HN**：发布后 2-3 小时内持续回复每条评论
  9. 不要同时发 Reddit（集中精力在 HN 评论互动上）

### Task 4: 撰写并发布 Reddit 帖子
- **状态**: [ ] 未开始
- **对应需求**: REQ-3
- **前置条件**: Reddit 账号年龄 > 7 天，有基础 karma；HN 发布后第二天执行
- **步骤**:
  1. 按 design.md §3 模板撰写 r/selfhosted 帖子
  2. 使用 4 空格缩进代码块（Reddit markdown 规范）
  3. 附带截图（从 docs/show/screenshots/ 上传）
  4. 发布到 r/selfhosted（主帖）
  5. 等待 2-4 小时观察反馈
  6. 交叉发布到 r/privacy（调整标题强调隐私）
  7. 交叉发布到 r/opensource（调整标题强调学习/代码质量）

### Task 5: 提交 awesome-selfhosted PR
- **状态**: [ ] 未开始
- **对应需求**: REQ-4
- **前置条件**: 仓库至少 10+ stars
- **判断标准**: Day 5 复盘时如果 < 10 stars，推迟此任务，先写技术博客引流再回来提交
- **步骤**:
  1. Fork awesome-selfhosted 仓库
  2. 阅读 CONTRIBUTING.md 确认格式要求
  3. 找到 `Communication - Custom Communication Systems` 分类
  4. 按字母顺序插入 Arthas 条目（格式参考 design.md §4）
  5. 本地运行 lint 检查（如果仓库有的话）
  6. 确认所有链接有效（demo、GitHub、docs）
  7. 提交 PR，使用 design.md §4 的 PR 描述模板

---

## 执行顺序

```
Day 0: Task 0 (前置条件) — LICENSE + 英文 README + Public + demo 验证 + 确认账号状态
Day 1: Task 1 (GIF) → Task 2 (README 优化)
Day 2: Task 3 草稿 + Task 4 草稿 — 只写不发，自我 review
Day 3: 发布 Task 3 (HN, 上午) — 全天只做 HN，集中回复评论
Day 4: 发布 Task 4 (Reddit r/selfhosted + r/privacy + r/opensource)
Day 5: 复盘 + Task 5 (awesome-selfhosted PR，仅当 ≥10 stars 时)
```

> **注意**：Day 0 的账号检查可能需要提前几天准备。如果 HN/Reddit 账号是新的，
> 需要先花 2-3 天在社区评论互动积累 karma，再开始 Day 0。

---

## 成功指标（分层）

| 指标 | 底线 | 目标 | 惊喜 |
|------|------|------|------|
| GitHub Stars | +50 | +200 | +500 |
| HN 帖子分数 | > 10 points | > 50 points | > 100 points |
| Reddit upvotes | > 30 | > 100 | > 300 |
| awesome-selfhosted PR | 已提交 | 被合并 | — |
| Demo 访问量 (一周) | > 100 UV | > 500 UV | > 2000 UV |

---

## 复盘模板（Day 5 填写）

```
### 数据
- GitHub Stars: ___
- HN points: ___ | comments: ___
- Reddit upvotes: ___ | comments: ___
- Demo UV: ___
- awesome-selfhosted PR 状态: ___

### 反馈汇总
- 正面反馈: 
- 负面反馈/建议: 
- 最常见问题: 

### 下一步
- [ ] 根据反馈调整产品
- [ ] 是否需要第二波推广
- [ ] 是否需要写技术博客引流
```
