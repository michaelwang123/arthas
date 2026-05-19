# CLI 客户端使用指南 (arthas-cli)

arthas-cli 是 Arthas 的终端客户端，让你无需浏览器即可创建和加入加密聊天室。它实现与 Web 客户端完全相同的 E2EE 协议，两端可互操作。

---

## 安装

### 从源码编译

```bash
cd arthas-cli
go build -o arthas-cli ./cmd/arthas-cli/
```

### 跨平台编译

```bash
# 使用 Makefile 编译所有平台
make build-all

# 产物在 build/ 目录：
# arthas-cli-linux-amd64
# arthas-cli-linux-arm64
# arthas-cli-darwin-amd64
# arthas-cli-darwin-arm64
# arthas-cli-windows-amd64.exe
```

### 验证安装

```bash
arthas-cli --version
# 输出: arthas-cli v1.0.0
```

---

## 基本用法

### 创建房间

```bash
arthas-cli create --name Alice
```

成功后输出分享码：
```
Share this code to invite others:
  X2-KtJ6oRzdxbguxl5DAR:AMVGFZBTFLeed7tVncI1oKoFUdNIv6goGz64x0cuU1M
```

将此分享码通过安全渠道发送给你的伙伴。

### 加入房间

```bash
arthas-cli join <share_code> --name Bob
```

成功后显示成员列表并进入聊天模式：
```
Members in room:
  • Alice
  • Bob
```

### 发送消息

直接输入文本并按回车：
```
Hello, Alice!
[16:08] Bob: Hello, Alice!
```

### 退出

- 输入 `/quit` 或 `/exit`
- 按 `Ctrl+C`
- 按 `Ctrl+D`（Unix）或 `Ctrl+Z+Enter`（Windows）

---

## 命令参考

```
arthas-cli create [--server URL] [--name NAME]
arthas-cli join <share_code> [--server URL] [--name NAME]
arthas-cli --version
arthas-cli --help
```

### 全局选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--server` | WebSocket 服务器 URL | `wss://arthas-chat.onrender.com/ws` |
| `--name` | 显示昵称（1-20 字符） | 交互式提示输入 |
| `--version` | 显示版本号 | — |
| `--help` | 显示帮助信息 | — |

### 环境变量

| 变量 | 说明 | 优先级 |
|------|------|--------|
| `ARTHAS_SERVER` | WebSocket 服务器 URL | 低于 `--server` flag |

配置优先级：`--server` flag > `ARTHAS_SERVER` 环境变量 > 默认值

---

## 连接自托管服务器

```bash
# 方式一：使用 --server flag
arthas-cli create --server wss://chat.example.com/ws --name Alice

# 方式二：使用环境变量（持久配置）
export ARTHAS_SERVER=wss://chat.example.com/ws
arthas-cli create --name Alice
```

**注意**：自托管服务器需要在 `ALLOWED_ORIGINS` 环境变量中添加 `arthas-cli`：

```bash
# 服务器端配置
ALLOWED_ORIGINS=https://your-domain.com,arthas-cli
```

---

## 与 Web 客户端互操作

arthas-cli 和 Web 客户端使用完全相同的协议：
- 相同的 MessagePack 二进制信封格式
- 相同的 AES-256-GCM 加密参数
- 相同的 base64url 编码规则
- 相同的分享码格式

你可以：
- 用 Web 创建房间 → CLI 加入
- 用 CLI 创建房间 → Web 加入
- CLI 和 Web 用户在同一房间聊天

---

## 消息格式

终端中的消息显示格式：

```
[HH:MM] <彩色昵称>: 消息内容        # 他人消息
[HH:MM] <粗体昵称>: 消息内容        # 自己消息
*** Alice joined                    # 系统消息（成员加入）
*** Bob left                        # 系统消息（成员离开）
  ↩ Re: Alice: 被引用的消息...      # 引用回复上下文
```

---

## 限制

当前 MVP 版本不支持以下功能（Web 客户端支持）：

| 功能 | 原因 |
|------|------|
| 文件传输 | 终端环境不适合文件操作 |
| Emoji 反应 | 终端 UX 不适合 |
| 输入状态指示 | 行输入模式无法检测"正在输入" |
| 密码保护房间 | 后续版本添加 |
| 自动重连 | CLI 退出后重新运行即可 |

---

## 故障排除

### 连接失败

```
Error: failed to connect to server: ...
```

检查：
1. 服务器是否在运行
2. URL 是否正确（必须以 `ws://` 或 `wss://` 开头）
3. 网络是否可达

### Origin 被拒绝

```
Error: failed to connect to server: websocket: bad handshake
```

自托管服务器需要将 `arthas-cli` 添加到 `ALLOWED_ORIGINS`。

### 分享码无效

```
Error: invalid share code: expected format {roomId}:{key}[:{ephemeral}]
```

确保完整复制了分享码（21 字符 roomId + 冒号 + 43 字符 key）。

---

## 技术细节

- **语言**: Go 1.22
- **依赖**: gorilla/websocket, vmihailenco/msgpack/v5
- **加密**: Go 标准库 crypto/aes + crypto/cipher (AES-256-GCM)
- **并发模型**: 4 goroutine CSP 模型（main + stdinPump + readPump + writePump）
- **跨平台**: Linux/macOS/Windows，单一静态二进制
- **测试**: 14 个属性测试 + 17 个集成测试 + 单元测试（共 77 个）

---

## 下一步

- [系统架构](architecture.md) — 了解整体设计
- [协议规范](protocol.md) — 消息格式详解
- [自托管部署](self-hosting.md) — 部署自己的服务器
