# AI Agent / Bot 融合方案

## 现状

项目已有 `packages/openclaw-channel/` 实现了 OpenClaw AI Agent 通道插件，让 AI 对话走 E2EE 加密通道。这是 AI 融合的基础。

---

## 融合方向

### 方向 1：AI Bot 作为房间成员（最自然的融合）

让 AI Bot 像普通用户一样加入聊天室，复用现有协议：

```
用户 Alice ──加密消息──→ Arthas Server ──转发密文──→ AI Bot Client
                                                        │
                                                   解密 → 调用 LLM → 加密回复
                                                        │
用户 Alice ←──加密消息──← Arthas Server ←──密文──────────┘
```

**实现方式：** 基于 `arthas-cli` 的 Go 代码封装一个 Bot SDK，Bot 持有 roomKey 就能解密消息、调用 LLM API、加密回复发回房间。

**优势：**
- 零服务器改动（Bot 就是一个 WebSocket 客户端）
- 保持 E2EE 特性（服务器仍然看不到明文）
- Bot 和人类用户在同一房间自然交互

---

### 方向 2：私密 AI 助手（隐私场景）

用户创建一个只有自己和 AI Bot 的房间，实现"私密 AI 对话"：

- 对话内容端到端加密，服务器无法窥探
- 比直接调 OpenAI API 多了一层传输加密
- 适合处理敏感信息（代码审查、医疗咨询、法律问题）

**差异化卖点：** 市面上几乎没有 E2EE 的 AI 聊天产品。

---

### 方向 3：群组 AI 助手（协作场景）

多人房间里 @Bot 触发 AI 回复：

- 团队讨论时随时召唤 AI 参与
- AI 能看到上下文（房间内的历史消息）
- 翻译助手、代码助手、会议总结等

---

### 方向 4：MCP Server 集成

把 Arthas 房间暴露为 MCP (Model Context Protocol) 工具：

- AI Agent 通过 MCP 工具发送/接收加密消息
- 让任何支持 MCP 的 AI（Claude、GPT）都能接入 Arthas 房间
- 实现 AI-to-AI 的加密通信通道

---

## 技术可行性评估

| 方向 | 改动量 | 复杂度 | 价值 |
|------|--------|--------|------|
| Bot SDK (基于 CLI) | 小 | 低 | 高 — 最快落地 |
| 私密 AI 助手 | 中 | 中 | 高 — 差异化卖点 |
| @Bot 群组助手 | 中 | 中 | 中 — 常见功能 |
| MCP Server | 中 | 中 | 高 — 生态融合 |
| OpenClaw 增强 | 已有 | 低 | 中 — 已实现基础版 |

---

## 推荐切入点：Bot SDK + 私密 AI 助手

**理由：**

1. CLI 客户端已经实现了完整的 E2EE 协议（Go），稍加封装就是 Bot SDK
2. "加密 AI 对话"是一个独特卖点——市面上几乎没有 E2EE 的 AI 聊天产品
3. 不需要改服务器，Bot 就是一个特殊的客户端
4. 可以对接任何 LLM（OpenAI、Claude、本地模型）

---

---

## 市场现实分析

### 核心问题：谁会用？

普通用户直接用 ChatGPT/Claude 就行了，为什么要多一层加密？

### 有明确需求的用户群体

| 用户群体 | 场景 | 痛点 |
|----------|------|------|
| 律师/法务 | 用 AI 分析合同、案件材料 | 客户资料不能泄露给 OpenAI |
| 医疗从业者 | 用 AI 辅助诊断、分析病历 | 患者隐私受 HIPAA/GDPR 约束 |
| 企业内部 | 用 AI 处理商业机密、代码 | 公司政策禁止数据外传 |
| 记者/活动人士 | 用 AI 翻译/分析敏感文档 | 担心被监控 |
| 安全研究员 | 用 AI 分析漏洞/恶意代码 | 不想让 AI 厂商知道在研究什么 |

### 现实竞争

这些用户大多数已经有解决方案：
- 企业用 Azure OpenAI（私有部署，数据不出企业）
- 隐私敏感用户跑本地模型（Ollama + Llama）
- 合规场景用专门的合规 AI 产品

### 诚实判断

- **Bot SDK** 作为开源工具有价值——让开发者能快速搭建加密 Bot，这是技术基础设施
- **私密 AI 助手作为产品**，市场很窄：
  - 真正在意隐私的人会跑本地模型（零网络传输）
  - 不在意隐私的人直接用 ChatGPT（体验更好）
  - 中间地带的人用 Azure Private Endpoint

---

## 更务实的方向建议

| 方向 | 定位 | 理由 |
|------|------|------|
| Bot SDK 作为开发者工具 | 纯技术价值 | 让别人基于协议构建各种 Bot，扩大生态 |
| 团队协作 AI（群组场景） | 产品价值 | 多人讨论时 @AI 参与，加密有意义（团队内部讨论不想被第三方看到） |
| MCP 集成（生态卡位） | 基础设施 | 让 Arthas 成为 AI Agent 之间的加密通信管道 |

**最有差异化的定位不是"加密的 ChatGPT 替代品"，而是 "AI Agent 之间的加密通信协议"**——当多个 AI Agent 需要协作时，它们之间的通信也需要加密，这是一个新兴需求。

---

## Bot SDK 初步设计

```go
// arthas-bot-sdk 核心接口
type Bot struct {
    Name      string
    ServerURL string
    OnMessage func(msg Message) string  // 收到消息 → 返回回复
}

// 使用示例
bot := arthasbot.New(arthasbot.Config{
    Name:      "AI Assistant",
    ServerURL: "wss://your-server/ws",
    LLM:       openai.NewClient(apiKey),
})

// 创建房间并等待用户加入
shareCode := bot.CreateRoom()
fmt.Println("Share this code:", shareCode)

// 或加入已有房间
bot.JoinRoom(shareCode)

// 自动处理：解密消息 → 调用 LLM → 加密回复 → 发送
bot.Run(context.Background())
```

---

## 实施路线

1. **Phase 1 — Bot SDK** (1-2 周)
   - 从 arthas-cli 提取核心加密/协议/网络代码为 SDK
   - 提供 `OnMessage` 回调接口
   - 示例：echo bot、翻译 bot

2. **Phase 2 — LLM 集成** (1 周)
   - 对接 OpenAI/Claude API
   - 流式回复支持
   - 上下文窗口管理（保留最近 N 条消息）

3. **Phase 3 — 私密 AI 助手产品化** (2 周)
   - Web UI 一键创建 AI 房间
   - 预置多种 AI 角色（翻译、代码、写作）
   - 自托管 LLM 支持（Ollama）

4. **Phase 4 — MCP Server** (1-2 周)
   - 实现 MCP 工具：send_message、read_messages、create_room、join_room
   - 让 Claude/GPT 等 AI 通过 MCP 接入加密房间
