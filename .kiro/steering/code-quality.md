# Arthas 开发准则 — 代码质量与学习项目规范

> **项目定位：** Arthas 是一个学习项目。代码本身应作为学习材料，在遵循最佳工程实践的同时，所有代码必须带有详细的描述性注释，解释设计决策、算法原理和架构模式。

---

## 注释规范

1. **文件级注释：** 每个新文件顶部必须包含文件级注释，说明该文件在整体架构中的角色、职责边界和与其他模块的关系
2. **函数文档：** 每个导出函数/方法必须包含 JSDoc (TypeScript) 或 GoDoc (Go) 注释，说明：功能描述、参数含义、返回值、可能的错误
3. **学习要点：** 关键算法和设计决策处使用 `📚 学习要点:` 前缀的注释块，解释**为什么**选择这种方案（而非仅描述做了什么）
4. **安全注释：** 涉及加密、安全、并发的代码段必须包含详细注释，解释安全属性和潜在风险
5. **类型说明：** 复杂的类型定义和接口必须包含每个字段的用途说明

## 工程实践

1. **Go 代码：** 遵循 Effective Go 和 Go Code Review Comments 规范（命名、错误处理、包组织）
2. **TypeScript 代码：** 使用严格类型（no any），优先使用 discriminated unions 和 exhaustive checks
3. **错误处理：** 遵循 fail-fast 原则，所有错误路径都有明确的用户反馈
4. **状态管理：** 遵循单一数据源原则，避免状态不一致
5. **单一职责：** 每个文件/模块只做一件事（SRP）
6. **不引入新依赖：** 优先使用标准库和已有依赖（Web Crypto API、Canvas API、MessagePack）

## 代码组织

1. 新功能模块应组织在独立的目录中，与现有逻辑分离
2. 协议相关的类型定义集中在 protocol 文件中，与实现逻辑分离
3. 加密操作复用现有 `src/crypto/` 模块的模式，保持一致的代码风格
4. 保持与项目现有代码风格一致（Tailwind 暗色主题、中文 UI 文案、msgpack 二进制协议）

## 已知陷阱

1. **msgpack 类型断言：** `vmihailenco/msgpack/v5` 将小正整数解码为 `int8`/`uint8`（不是 `int64`/`uint64`）。所有从 `map[string]interface{}` 提取数字的代码必须使用 `toInt()` 辅助函数
2. **WebSocket 消息大小：** 当前 `maxMessageSize = 4096`，如果需要传输大消息（如文件分片），需要调整此限制
3. **CSS 动画：** 使用 `max-h-0` 隐藏内容时必须配合 `overflow-hidden`，否则内容仍然可见

## 注释示例

### Go 示例
```go
// 📚 学习要点: CSP 并发模型
// Hub 采用 CSP（Communicating Sequential Processes）模型：
// - clients map 只在 Run() goroutine 中被修改（单一写者）
// - 其他 goroutine 通过 channel 请求修改
// 这避免了锁竞争，代码更容易推理正确性。

// handleFileChunk 处理客户端发送的加密文件分片。
// 服务器不解密、不存储，仅转发给房间内其他在线成员（零知识中转）。
func (h *Hub) handleFileChunk(client *Client, data interface{}) {
    // ...
}
```

### TypeScript 示例
```typescript
/**
 * 📚 学习要点: 分片加密策略
 * 为什么每个 Chunk 使用独立的 IV（初始化向量）？
 * - AES-GCM 要求同一密钥下 IV 绝不重复（重复会泄露明文 XOR）
 * - 每个 Chunk 独立加密，允许流式处理（不需要等待整个文件）
 * - 单个 Chunk 损坏不影响其他 Chunk 的解密
 */
export async function encryptChunk(
  key: CryptoKey,
  chunk: ArrayBuffer
): Promise<EncryptedChunk> {
  // ...
}
```
