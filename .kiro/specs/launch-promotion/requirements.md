# 需求：首发推广三板斧

## 背景

Arthas 功能已完整（v1.0），下一步是推广获客。根据产品定位（加密临时聊天、开源、无注册），目标用户集中在技术社区（HN / Reddit / GitHub）。

## 目标

用最小投入获得第一波用户和 GitHub stars，验证产品市场匹配度。

## 已知风险

- **项目名冲突**：阿里巴巴 `alibaba/arthas`（Java 诊断工具）有 35k+ stars，搜索 "arthas github" 会被淹没。应对策略：在 tagline 中明确定位（"E2EE ephemeral chat"），准备 FAQ 回复。
- **首次 launch 不确定性**：HN/Reddit 帖子可能无人关注。应对：如果 Day 3 效果不佳，Day 4 调整标题/时间重发 Reddit 到其他子版块。
- **Demo 不稳定**：HF Spaces 可能休眠导致首次访问慢。应对：发布前 30 分钟手动 ping 唤醒。

---

## 需求列表

### REQ-0: 开源前置条件

**优先级**: P0（阻塞所有其他任务）

**描述**: 完成开源发布的所有前置准备工作。

**验收标准**:
- [ ] 添加 MIT LICENSE 文件到仓库根目录
- [ ] 创建英文 README.md（当前中文版移至 README.zh.md）
- [ ] 仓库设为 Public
- [ ] 确认在线 demo 可访问且稳定（测试创建房间 → 加入 → 聊天 → 文件分享）
- [ ] 准备"项目名冲突"FAQ 回复（与 alibaba/arthas 的区别）
- [ ] 确认 .gitignore 排除了 scripts/ 目录（含公司邮箱的 mailmap）
- [ ] 确认 HN 账号有足够 karma 可以发 Show HN（新账号需提前 2-3 天评论积累）
- [ ] 确认 Reddit 账号年龄 > 7 天且有基础 karma

---

### REQ-1: README GIF 演示

**优先级**: P0（所有推广的前置条件）

**描述**: 在英文 README 顶部添加一个 GIF 动图，让访客在前几秒内理解产品是什么。

**验收标准**:
- [ ] GIF 展示完整流程：创建房间 → 分享码 → 加入 → 加密聊天
- [ ] 时长 15-30 秒，循环播放
- [ ] 文件大小 < 5MB（GitHub 渲染友好）
- [ ] 放在 README 标题下方、技术栈表格上方
- [ ] 暗色主题录制（与产品 UI 一致）

---

### REQ-2: Show HN 帖子

**优先级**: P0

**描述**: 在 Hacker News 发布 Show HN 帖子，讲述项目故事和技术选型。

**验收标准**:
- [ ] 标题格式：`Show HN: Arthas – E2EE ephemeral chat, no signup, self-hostable`
- [ ] 帖子内容包含：一句话描述、为什么做、技术亮点（3-5 个）、在线 demo 链接、GitHub 链接
- [ ] 准备好回复常见问题（vs Signal? vs PrivNote? 安全审计? 与 alibaba/arthas 的关系? 为什么不用 Matrix?）
- [ ] 选择发布时间：美西时间周二-周四上午 8-10 点（HN 活跃高峰）
- [ ] 发布前 30 分钟 ping demo 确保 HF Spaces 已唤醒

---

### REQ-3: Reddit r/selfhosted 帖子

**优先级**: P0

**描述**: 在 Reddit r/selfhosted 发布介绍帖，突出自托管能力。

**验收标准**:
- [ ] 标题突出自托管：如 "I built a self-hosted E2EE chat with one-command deploy"
- [ ] 内容包含：Docker Compose 一键部署命令、功能列表、截图/GIF、GitHub 链接
- [ ] 语气真诚（不像广告），讲个人动机和学习过程
- [ ] 同步发到 r/privacy、r/opensource（调整标题侧重点）

---

### REQ-4: awesome-selfhosted PR

**优先级**: P1

**描述**: 向 awesome-selfhosted 仓库提交 PR，将 Arthas 加入列表。

**验收标准**:
- [ ] 确认符合 awesome-selfhosted 的收录标准（开源、可自托管、有文档、有 LICENSE）
- [ ] PR 描述清晰：一句话说明 + 技术栈 + demo 链接
- [ ] 分类放在 Communication - Custom Communication Systems
- [ ] 格式符合仓库规范（按字母排序、正确的 markdown 格式）
- [ ] 仓库至少有 10+ stars 再提交（部分 awesome 列表有最低 star 要求）

---

### REQ-5: GitHub 仓库优化

**优先级**: P1

**描述**: 优化 GitHub 仓库的"门面"，提高访客转化率。

**验收标准**:
- [ ] 添加 GitHub Topics：e2ee, chat, self-hosted, privacy, ephemeral, encryption, websocket, go, react, end-to-end-encryption, typescript
- [ ] 添加 badges：License、Go version（1.23）、Docker image size（静态 badge，链接 ghcr.io）、Demo link
- [ ] 添加 Social Preview 图片（1280x640，使用 Canva 或 Figma 制作）
- [ ] 确认 About 描述简洁有力（< 100 字符）：`E2EE ephemeral chat – no signup, self-hostable, zero knowledge`
- [ ] 添加 Website 链接（指向在线 demo）

---

## 非功能需求

- 所有英文内容需要语法正确、地道（目标受众是英文技术社区）
- GIF/截图使用真实数据演示（不要 lorem ipsum）
- 不夸大功能，诚实描述当前状态和限制
- 主动声明未经第三方安全审计（建立信任）
