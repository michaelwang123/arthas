# 设计：首发推广三板斧

## 概述

本 spec 覆盖 Arthas v1.0 首发推广的核心动作，目标是用最小投入获得第一波技术社区关注。

---

## 0. 开源前置条件

### LICENSE 文件

在仓库根目录添加 MIT License：

```
MIT License

Copyright (c) 2026 michaelwang123

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 英文 README 策略

- 当前 `README.md`（中文）重命名为 `README.zh.md`
- 新建英文 `README.md`，结构与中文版一致但内容为英文
- 在英文 README 顶部添加语言切换链接：`[中文](README.zh.md) | English`
- 在中文 README 顶部添加语言切换链接：`中文 | [English](README.md)`

**工作量预估**：2-3 小时（200+ 行翻译 + 调整措辞使其地道）

**精简策略**：如果时间紧张，英文 README 可以先只包含核心部分：
1. 标题 + tagline + GIF
2. Features 列表（bullet points）
3. Quick Start（后端 + 前端 + CLI）
4. Architecture 图（ASCII art 不需要翻译）
5. Self-hosting 一句话 + 链接到文档
6. 省略：详细部署方案表格、竞品分析、风险评估等（这些留在中文版）

精简版预估：1-1.5 小时

### 项目名冲突应对

准备好的 FAQ 回复模板：

```
Q: Is this related to Alibaba's Arthas (Java diagnostic tool)?
A: No relation. Same name, completely different domain. This Arthas is an 
   E2EE ephemeral chat app. I chose the name before discovering the conflict 
   and decided to keep it since the domains don't overlap (chat vs Java diagnostics).
```

### Demo 稳定性检查清单

发布前执行：
1. 访问 demo URL，确认页面加载 < 3s
2. 创建房间 → 获得分享码
3. 新标签页加入房间 → 发送消息 → 确认加密正常
4. 测试文件分享（发送一张图片）
5. 测试 QR 码生成

---

## 1. README GIF 演示

### 录制方案

- **工具**: ScreenToGif（Windows 原生，直接输出 GIF）
- **分辨率**: 1280x720，录制后缩放到 800px 宽
- **帧率**: 15fps（平衡质量和文件大小）
- **时长**: 20-25 秒
- **如果 > 5MB**: 降低帧率到 10fps 或裁剪非关键帧

### 录制脚本

```
场景 1 (0-5s):  首页 → 点击"创建房间" → 输入昵称 "Alice" → 创建
场景 2 (5-10s): 房间创建成功 → 显示分享码 → 点击复制
场景 3 (10-15s): 新标签页 → 粘贴分享码 → 输入昵称 "Bob" → 加入房间
场景 4 (15-25s): Alice 发送 "Hey, this is encrypted!" → Bob 回复 → 🔒 图标可见
```

### 文件存放

```
docs/show/
├── demo.gif              # README 引用的 GIF
├── demo-full.mp4         # 原始录制视频（加入 .gitignore）
└── screenshots/          # 静态截图（用于 Reddit/HN 帖子）
    ├── chat-room.png     # 聊天界面（双方对话）
    ├── create-room.png   # 创建房间页面
    └── share-code.png    # 分享码 + QR 码
```

在 `.gitignore` 中添加：
```
docs/show/demo-full.mp4
```

### README 嵌入位置

```markdown
# Arthas

> E2EE ephemeral chat – create a room, share the key, chat securely, everything disappears.

[中文](README.zh.md) | English

<p align="center">
  <img src="docs/show/demo.gif" alt="Arthas Demo – create room, share code, encrypted chat" width="800">
</p>
```

---

## 2. Show HN 帖子

### 帖子模板

**标题**: `Show HN: Arthas – E2EE ephemeral chat, no signup, self-hostable`

**正文**:

```
Hi HN,

I built Arthas, an end-to-end encrypted ephemeral chat app. The idea is simple: 
create a room, share the key, chat securely, and everything disappears when you leave.

Live demo: https://arthas-blush.vercel.app/
GitHub: https://github.com/michaelwang123/arthas

Why I built this:
- I needed to share API keys and credentials with teammates securely
- Existing tools (PrivNote, Yopass) are one-shot – no real-time conversation
- I wanted something I could self-host with zero dependencies

Technical highlights:
- AES-256-GCM encryption (Web Crypto API), keys never leave the browser
- Ed25519 message signatures (tamper detection)
- Go relay server (~30MB Docker image), zero knowledge of message content
- CLI client in Go (interoperates with web client, same E2EE protocol)
- One-command self-hosting (single binary or Docker Compose + auto HTTPS)

What it's NOT:
- Not a Signal replacement (Signal is for long-term communication)
- No accounts, no message history, no social features
- Not audited by a third party (yet) – I welcome security review

Built as a learning project over ~2 weeks. The codebase is heavily commented 
explaining design decisions if you're interested in the crypto implementation.

I'd love feedback on the crypto design and UX. Happy to answer questions!
```

### 发布策略

- **前置条件**：确认 HN 账号可以发帖（新账号需要先评论积累 karma，通常 2-3 天活跃即可）
- **时间**：美西时间周二/周三/周四 8:00-10:00 AM（UTC-7）
- **发布前**：30 分钟前 ping demo URL 唤醒 HF Spaces
- **发布后**：2-3 小时内积极回复每条评论（这是 HN 排名的关键因素）
- **Day 3 全天只做 HN**：不要同时发 Reddit，集中精力回复 HN 评论
- **如果沉底**：不要删帖重发（HN 会检测），等 2-3 天后可以在相关讨论中自然提及

### 准备好的 FAQ

| 问题 | 回复要点 |
|------|----------|
| vs Signal? | Signal 做长期通信，Arthas 做临时交换。不同场景。 |
| 安全审计? | 未经第三方审计。代码开源，欢迎 review。使用标准算法（AES-256-GCM, Ed25519）。 |
| 为什么不用 Matrix? | Matrix 是联邦协议，复杂度高。Arthas 追求极简：无注册、无持久化、用完即走。 |
| 与 alibaba/arthas? | 无关。同名不同领域（chat vs Java diagnostics）。 |
| 为什么不用密码管理器分享? | 密码管理器适合静态密钥。Arthas 适合需要实时讨论的场景。 |
| 性能/规模? | 设计为小型临时房间（2-10 人）。服务器是纯中转，无状态，水平扩展简单。 |

---

## 3. Reddit 帖子

### r/selfhosted 帖子模板

**标题**: `I built a self-hosted E2EE chat – single binary, zero config, auto HTTPS`

**正文**:

```
Hey r/selfhosted,

I've been working on Arthas, an end-to-end encrypted ephemeral chat app 
that you can self-host with a single command.

**Quick start:**

    # Option 1: Single binary (zero dependencies)
    ./arthas-server --port 8080

    # Option 2: Docker Compose (auto HTTPS via Caddy)
    git clone https://github.com/michaelwang123/arthas
    cd arthas/deploy && ./deploy.sh

**Features:**
- E2EE (AES-256-GCM + Ed25519 signatures)
- No registration needed
- Encrypted file sharing, voice messages
- Self-destruct messages (10s/30s/60s/5min)
- Room passwords, QR code sharing
- CLI client (Go binary, cross-platform)
- i18n (EN/ZH/JA)

**Self-hosting details:**
- Single Go binary (~15MB), embeds the frontend
- Docker image < 30MB (Alpine-based)
- Docker Compose with Caddy = automatic Let's Encrypt HTTPS
- Supports amd64 + arm64

GitHub: https://github.com/michaelwang123/arthas
Demo: https://arthas-blush.vercel.app/
Self-hosting docs: https://github.com/michaelwang123/arthas/blob/main/official_doc/self-hosting.md

Built with Go + React + WebSocket + MessagePack. 
Server is a pure relay – it never sees plaintext.

Happy to answer any questions about the architecture or deployment!
```

注意：Reddit markdown 用 4 空格缩进表示代码块（不用三反引号），避免渲染问题。

### Reddit 账号前置条件

- 确认账号年龄 > 7 天（部分子版块有限制）
- 确认账号有一定 karma（建议 > 10，可以先在相关帖子下评论积累）
- 如果是新账号，先花几天在 r/selfhosted 下回复别人的帖子建立存在感

### r/privacy 标题变体

`I built an E2EE ephemeral chat – no signup, no message history, server sees only ciphertext`

### r/opensource 标题变体

`Show r/opensource: Arthas – E2EE chat built with Go + React, heavily commented codebase for learning`

---

## 4. awesome-selfhosted PR

### PR 内容

在 `Communication - Custom Communication Systems` 分类下，按字母顺序插入：

```markdown
- [Arthas](https://github.com/michaelwang123/arthas) - End-to-end encrypted ephemeral chat with no registration. Features include file sharing, voice messages, self-destruct messages, and CLI client. ([Demo](https://arthas-blush.vercel.app/)) `MIT` `Go/Docker`
```

### 收录前置条件检查

- [x] 开源（MIT License）
- [x] 可自托管（单二进制 + Docker Compose）
- [x] 有安装文档（official_doc/self-hosting.md）
- [x] 有在线 demo
- [x] 项目活跃（最近有 commit）
- [ ] 至少 10+ stars（部分 awesome 列表有要求，发布后再提交）

### PR 描述模板

```
Add Arthas - E2EE ephemeral chat

Arthas is a self-hosted end-to-end encrypted ephemeral chat application.
- No registration required
- AES-256-GCM + Ed25519 signatures
- Single binary (~15MB) or Docker Compose deployment
- Auto HTTPS via Caddy
- MIT licensed

Demo: https://arthas-blush.vercel.app/
Docs: https://github.com/michaelwang123/arthas/blob/main/official_doc/self-hosting.md
```

---

## 5. GitHub 仓库优化

### Topics

```
e2ee, encryption, chat, self-hosted, privacy, ephemeral, 
websocket, go, react, typescript, end-to-end-encryption
```

### Badges（英文 README 顶部）

```markdown
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.23-00ADD8.svg)](https://go.dev)
[![Docker](https://img.shields.io/badge/Docker-<30MB-2496ED.svg)](https://github.com/michaelwang123/arthas/pkgs/container/arthas)
[![Demo](https://img.shields.io/badge/Demo-Live-green.svg)](https://arthas-blush.vercel.app/)
```

> 注意：项目使用 GitHub Container Registry (ghcr.io)，不是 Docker Hub。
> Docker badge 使用静态 badge 显示镜像大小（< 30MB），链接指向 ghcr.io packages 页面。

### Social Preview

- **尺寸**：1280x640px
- **工具**：Canva（免费模板）或 Figma
- **内容**：左侧产品截图（聊天界面暗色主题），右侧白色文字：
  - 标题：Arthas
  - 副标题：E2EE Ephemeral Chat
  - 三个图标+文字：🔒 Zero Knowledge · ⚡ No Signup · 🏠 Self-Hostable
- **风格**：暗色渐变背景（#1a1a2e → #16213e），与产品 UI 一致

### About 描述

```
E2EE ephemeral chat – no signup, self-hostable, zero knowledge
```

---

## 时间线

| 天数 | 任务 | 产出 | 预估耗时 |
|------|------|------|----------|
| Day 0 | 前置条件：LICENSE + 英文 README + Public + demo 验证 | 仓库可公开访问 | 3-4h（英文 README 翻译占大头） |
| Day 1 | 录制 GIF + 截图，优化 README（badges, topics, GIF, Social Preview） | 仓库"门面"完成 | 2-3h |
| Day 2 | 撰写 HN/Reddit 帖子草稿，准备 FAQ，自我 review | 帖子定稿 | 1-2h |
| Day 3 | 发布 Show HN（上午 8AM PST），**全力回复评论** | HN 首波曝光 | 半天（持续关注） |
| Day 4 | 发布 Reddit r/selfhosted + r/privacy + r/opensource | Reddit 曝光 | 2h + 持续回复 |
| Day 5 | 提交 awesome-selfhosted PR（如 ≥10 stars），复盘数据 | 长尾引流 + 数据 | 1h |

> **关键决策**：Day 3 只发 HN，不同时发 Reddit。HN 算法权重与早期评论互动强相关，
> 分散精力会降低帖子排名。Reddit 放到 Day 4，此时 HN 热度已过峰值。

---

## 失败应对

| 场景 | 应对 |
|------|------|
| HN 帖子沉底（< 5 points） | 不删帖。分析标题是否有问题，2 周后可在相关讨论中自然提及 |
| Reddit 无人回复 | 检查发布时间（美东下午最活跃），尝试其他子版块（r/commandline, r/homelab） |
| awesome-selfhosted PR 被拒 | 查看拒绝原因，可能需要更多 stars 或更完善的文档 |
| Demo 访问时崩溃 | 立即检查 HF Spaces 状态，必要时切换到备用部署（Railway） |
