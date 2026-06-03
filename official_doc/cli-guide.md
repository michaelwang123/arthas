# CLI 客户端使用指南 (arthas-cli)

单文件终端客户端，用于 Arthas 端到端加密聊天。无依赖、无需注册。

## 下载

| 平台 | 命令 |
|------|------|
| **Windows** | `curl.exe -L -o arthas-cli.exe https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli-windows-amd64.exe` |
| **Linux (x86_64)** | `curl -L -o arthas-cli https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli && chmod +x arthas-cli` |
| **Linux (ARM64)** | `curl -L -o arthas-cli https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli-linux-arm64 && chmod +x arthas-cli` |
| **macOS (Intel)** | `curl -L -o arthas-cli https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli-darwin-amd64 && chmod +x arthas-cli` |
| **macOS (Apple Silicon)** | `curl -L -o arthas-cli https://github.com/michaelwang123/arthas/releases/latest/download/arthas-cli-darwin-arm64 && chmod +x arthas-cli` |

也可以直接从 [GitHub Releases](https://github.com/michaelwang123/arthas/releases/latest) 手动下载。

> 免费公共服务器：`wss://arthas100-arthas-server.hf.space/ws`，无需搭建，开箱即用。

---

## 快速上手

### 1. 创建房间

```bash
# Linux/macOS
./arthas-cli create --server wss://arthas100-arthas-server.hf.space/ws --name "Alice"

# Windows
.\arthas-cli.exe create --server wss://arthas100-arthas-server.hf.space/ws --name "Alice"
```

输出：

```
✓ Room created! Share code:
QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM

Share this code with others to join.
```

**保持此终端打开** — 房间仅在至少一个参与者在线时存在。

### 2. 加入房间（在另一个终端）

```bash
# Linux/macOS
./arthas-cli join QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM \
  --server wss://arthas100-arthas-server.hf.space/ws --name "Bob"

# Windows
.\arthas-cli.exe join QYEq9uxfKP9h-KCUsPUay:NlZezXoUErYr92grhif3Y-Hy3FOOK1ocb3WocCJJrQM --server wss://arthas100-arthas-server.hf.space/ws --name "Bob"
```

输入消息并回车 — 消息会经过 AES-256-GCM 加密后发送，服务器只能看到密文。

### 3. 发送消息

直接打字并按 Enter。每条消息使用独立的随机 IV 加密。

### 4. 退出

按 `Ctrl+C` 离开房间。如果你是最后一个参与者，房间会立即销毁。

---

## 命令参考

### create — 创建房间

创建一个新的加密房间并保持连接。

```
arthas-cli create --server <URL> --name <显示名>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--server` | 是 | Arthas 服务器的 WebSocket 地址 |
| `--name` | 是 | 你在房间中的显示名称 |

### join — 加入房间

使用分享码加入已有的房间。

```
arthas-cli join <分享码> --server <URL> --name <显示名>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `<分享码>` | 是 | 房间创建者提供的分享码 |
| `--server` | 是 | WebSocket 地址（必须和创建者使用同一服务器） |
| `--name` | 是 | 你的显示名称 |

---

## 分享码格式

```
roomId:base64Key[:ephemeralFlag[:expiresAt]]
```

| 段 | 长度 | 说明 |
|----|------|------|
| `roomId` | 21 字符 | 房间唯一标识（NanoID） |
| `base64Key` | 43 字符 | AES-256 加密密钥（base64url 编码，无 padding） |
| `ephemeralFlag` | 1 字符 | 可选。`0` = 持久，`1` = 阅后即焚 |
| `expiresAt` | 可变 | 可选。Unix 时间戳（0 = 永不过期） |

加密密钥**永远不会**离开你的设备。它嵌入在分享码中，仅通过你选择的渠道传递（复制粘贴、二维码、当面）。

---

## 重要注意事项

- **房间是临时的** — 所有参与者断开后，房间立即销毁。没有持久化的聊天记录。
- **分享码 = 完全访问权限** — 任何持有分享码的人都能读取所有消息。像密码一样保管它。
- **创建者必须保持在线** — 如果创建者在其他人加入之前断开连接，房间就消失了。需要在创建者保持连接的同时，在另一个终端 join。
- **`room not found` 错误** — 房间已被销毁（所有人都离开了）。需要重新创建。
- **跨平台互通** — CLI 客户端（Go）和 Web 客户端（React）完全互操作。你可以在网页上创建房间，用 CLI 加入；反之亦然。

---

## 使用自托管服务器

如果你部署了自己的 Arthas 服务器：

```bash
# 本地开发
./arthas-cli create --server ws://localhost:8080/ws --name "Alice"

# 生产环境（带 TLS）
./arthas-cli create --server wss://arthas.yourdomain.com/ws --name "Alice"
```

服务器部署请参考 [自托管部署指南](self-hosting.md)。

---

## 从源码编译

需要 Go 1.23+：

```bash
cd arthas-cli
go build -o arthas-cli ./cmd/arthas-cli

# 交叉编译
GOOS=linux GOARCH=amd64 go build -o arthas-cli-linux ./cmd/arthas-cli
GOOS=windows GOARCH=amd64 go build -o arthas-cli.exe ./cmd/arthas-cli
```
