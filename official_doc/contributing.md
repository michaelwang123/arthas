# 贡献指南 (Contributing Guide)

感谢你对 Arthas 项目的关注！本文档说明如何参与贡献。

---

## 贡献方式

### 报告 Bug

1. 在 GitHub Issues 中搜索是否已有相同问题
2. 如果没有，创建新 Issue，包含：
   - 问题描述
   - 复现步骤
   - 期望行为 vs 实际行为
   - 浏览器/操作系统版本
   - 相关截图或日志

### 功能建议

1. 在 GitHub Issues 中创建 Feature Request
2. 描述使用场景和期望行为
3. 说明为什么这个功能对项目有价值

### 提交代码

1. Fork 项目
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 编写代码和测试
4. 确保通过所有检查：
   ```bash
   # 后端
   cd arthas-server
   go build ./...
   go test ./...
   go vet ./...

   # 前端
   cd arthas-client
   npx tsc --noEmit
   npm run build
   ```
5. 提交：`git commit -m "feat: your feature description"`
6. 推送：`git push origin feature/your-feature`
7. 创建 Pull Request

---

## 开发流程

### 分支策略

| 分支 | 用途 |
|------|------|
| `main` | 稳定版本 |
| `develop` | 开发分支 |
| `feature/*` | 功能开发 |
| `fix/*` | Bug 修复 |

### Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 添加消息撤回功能
fix: 修复断线重连后消息丢失
docs: 更新部署文档
refactor: 重构房间管理逻辑
test: 添加加密层单元测试
chore: 更新依赖版本
```

---

## 代码规范

### Go 代码

- 使用 `gofmt` 格式化
- 使用 `go vet` 检查
- 导出函数必须有注释
- 错误处理使用 `error` 返回，不使用 panic
- 并发安全使用 `sync.RWMutex`

### TypeScript 代码

- 严格模式 (`strict: true`)
- 使用函数组件 + React Hooks
- Props 使用 interface 定义
- 避免 `any` 类型
- 使用 Tailwind CSS，不写自定义 CSS

### 安全规范

- **绝不在服务器端记录消息内容**
- **绝不在服务器端存储 roomKey**
- **加密相关代码修改需要额外审查**
- **新增的服务器日志不得包含用户消息**

---

## Pull Request 检查清单

- [ ] 代码通过 `go build ./...` 和 `npm run build`
- [ ] 后端测试通过 `go test ./...`
- [ ] 前端类型检查通过 `npx tsc --noEmit`
- [ ] 新功能有对应测试
- [ ] 文档已更新（如有必要）
- [ ] 不引入新的安全风险
- [ ] Commit message 符合规范

---

## 项目架构决策

在贡献前，请了解以下设计决策：

1. **服务器零知识** — 任何修改不得让服务器获得解密能力
2. **无持久化** — 不引入数据库，保持纯内存设计
3. **无第三方加密库** — 前端仅使用 Web Crypto API
4. **二进制协议** — 使用 MessagePack，不使用 JSON
5. **无路由库** — 前端使用 hash routing，不引入 react-router

---

## 获取帮助

- 阅读 [开发指南](development.md) 了解代码结构
- 阅读 [架构文档](architecture.md) 了解设计决策
- 在 Issue 中提问

---

## 行为准则

- 尊重所有贡献者
- 建设性地讨论技术方案
- 接受代码审查意见
- 保持友善和专业
