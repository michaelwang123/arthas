# Arthas 推广获客策略

> 产品定位：加密版 AirDrop + 临时聊天 — 安全交换信息，用完即走
> 目标用户：技术敏感型用户（开发者、安全从业者、隐私关注者）

---

## 第一梯队：零成本、高杠杆

### 1. GitHub / 开源社区

- 优化 README：加 GIF 演示（3 秒看懂产品）、badges（stars、license、deploy）
- 提交到 awesome-selfhosted、awesome-privacy、awesome-security 等 awesome 列表
- 在 GitHub Topics 打好标签：`e2ee`, `chat`, `self-hosted`, `privacy`, `ephemeral`
- 写一篇 "How I built an E2EE chat in 2 weeks" 的技术博客，发到 dev.to / Hashnode

### 2. Hacker News / Reddit

- Show HN 帖子：标题突出差异化，如 "Arthas – E2EE ephemeral chat, no signup, self-hostable"
- Reddit 发到 r/selfhosted、r/privacy、r/opensource、r/netsec
- 关键：不要像广告，讲故事（为什么做、学到了什么、技术选型）

### 3. 中文社区

- V2EX 创意工作 / 分享创造节点
- 少数派（sspai.com）投稿：隐私工具推荐类文章
- 即刻 / Twitter 中文技术圈
- 掘金 / 思否：技术实现系列文章（E2EE 原理、WebSocket 架构、Go 并发模型）

---

## 第二梯队：内容营销

### 4. 技术博客系列（SEO 长尾流量）

- "如何实现浏览器端 AES-256-GCM 加密"
- "Go WebSocket 服务器：从零到生产"
- "Ed25519 签名在即时通讯中的应用"
- "一行命令自托管加密聊天室"
- 每篇文末自然引流到 Arthas

### 5. 视频/演示

- 录一个 2 分钟 demo 视频放 YouTube / B站
- 场景化演示：面试分享密码、团队临时讨论、跨境敏感信息交换

---

## 第三梯队：场景渗透

### 6. 找到"不得不用"的场景

| 场景 | 切入点 |
|------|--------|
| 面试/招聘 | 安全分享 offer 薪资、合同细节 |
| 远程团队 | 临时讨论敏感项目，不留痕迹 |
| 记者/吹哨人 | 匿名安全通信（对标 SecureDrop 但更轻量） |
| 开发者 | 分享 API key、密码、私钥（比 Slack DM 安全） |
| 跨境沟通 | 不信任平台审查的用户 |

针对开发者场景，可以写一个 "Stop sharing secrets in Slack" 的短文。

### 7. 产品目录/工具站提交

- Product Hunt launch（准备好 tagline + 截图 + maker comment）
- AlternativeTo（作为 Signal / PrivNote / Yopass 的替代品）
- PrivacyTools.io / privacyguides.org 提交
- 自托管目录：selfh.st、noted.lol

---

## 第四梯队：社区建设

### 8. 让用户帮你传播

- 分享页面加 "Powered by Arthas" 水印链接（可选）
- 房间创建成功后提示 "觉得好用？Star us on GitHub"
- 写贡献指南（CONTRIBUTING.md），降低 PR 门槛

---

## 优先级建议（只做 3 件事）

1. **Show HN + Reddit r/selfhosted 帖子** — 一天搞定，可能带来第一波几百 stars
2. **提交 awesome-selfhosted PR** — 长期稳定引流
3. **录一个 GIF/视频 放 README** — 提高所有渠道的转化率

---

## 核心逻辑

Arthas 的目标用户是**技术敏感型用户**（开发者、安全从业者、隐私关注者），这些人集中在 HN / Reddit / GitHub / V2EX。不需要大众营销，精准触达这几个社区就够了。
