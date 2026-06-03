[中文](security.md) | [English](security.en.md)

# 安全模型 (Security Model)

本文档描述 Arthas 的端到端加密设计、信任模型和安全分析。

---

## 加密方案

### 分层加密

| 层级 | 方案 | 作用 |
|------|------|------|
| **传输层** | WSS (TLS 1.3) | 防中间人窃听，保护元数据 |
| **应用层** | AES-256-GCM | 消息内容端到端加密 |

### 加密参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 算法 | AES-256-GCM | AEAD 认证加密 |
| 密钥长度 | 256 bits (32 bytes) | 2^256 密钥空间 |
| IV 长度 | 96 bits (12 bytes) | GCM 推荐长度 |
| 认证标签 | 128 bits | GCM 默认 |
| 密钥生成 | `crypto.subtle.generateKey()` | 浏览器 CSPRNG |
| IV 生成 | `crypto.getRandomValues()` | 每条消息随机 |

---

## 信任模型

```
┌─────────────────────────────────────────────┐
│                 信任边界                      │
├─────────────────────────────────────────────┤
│                                             │
│  信任：                                      │
│    ✅ 浏览器环境（Web Crypto API 实现正确）   │
│    ✅ 用户通过安全渠道分享密钥                │
│    ✅ 用户设备未被恶意软件控制                │
│                                             │
│  不信任：                                    │
│    ❌ 服务器（零知识设计）                    │
│    ❌ 网络传输（TLS 保护）                   │
│    ❌ 第三方观察者                           │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 加密流程

### 密钥生成与分发

```
创建者：
  1. crypto.subtle.generateKey(AES-256-GCM) → roomKey
  2. crypto.subtle.exportKey('raw', roomKey) → 32 bytes
  3. base64url(rawKey) → 43 字符编码
  4. 组合分享码：{roomId}:{base64url(roomKey)}
  5. 通过安全渠道分享给伙伴

加入者：
  1. 解析分享码 → 提取 roomId 和 keyEncoded
  2. base64url.decode(keyEncoded) → 32 bytes
  3. crypto.subtle.importKey('raw', ...) → roomKey
  4. 发送 JoinRoom{roomId} 给服务器（不含 roomKey）
```

### 消息加密

```
发送：
  1. plaintext → TextEncoder.encode() → UTF-8 bytes
  2. iv = crypto.getRandomValues(12 bytes)
  3. crypto.subtle.encrypt({AES-GCM, iv}, roomKey, bytes) → ciphertext
  4. 发送 {iv: base64url(iv), ciphertext: base64url(ciphertext)}

接收：
  1. base64url.decode(iv) → iv bytes
  2. base64url.decode(ciphertext) → ciphertext bytes
  3. crypto.subtle.decrypt({AES-GCM, iv}, roomKey, ciphertext) → plaintext bytes
  4. TextDecoder.decode(plaintext) → 明文字符串
```

---

## 威胁分析

| 威胁 | 风险 | 防护措施 |
|------|------|----------|
| 网络窃听 | 低 | WSS (TLS 1.3) 传输加密 |
| 服务器窥探消息 | 无 | E2EE，服务器只见密文 |
| 密钥泄露（传输中） | 无 | 密钥不经过服务器 |
| 重放攻击 | 低 | 每条消息随机 96-bit IV |
| 消息篡改 | 无 | AES-GCM 认证标签 (AEAD) |
| 暴力破解密钥 | 极低 | AES-256，2^256 密钥空间 |
| 分享码泄露 | 中 | 依赖用户安全分享 |
| 服务器伪造成员 | 低 | 无法解密消息，但可注入 |
| 元数据分析 | 中 | 服务器可见 who/when/typing |

---

## 已知安全限制

| 限制 | 说明 | 风险等级 | 缓解措施 |
|------|------|----------|----------|
| 分享码不可撤销 | 泄露后任何人可加入 | 中 | 所有人离开即销毁 |
| 无前向保密 (PFS) | roomKey 泄露可解密所有消息 | 低 | 消息不持久化 |
| Typing 状态未加密 | 服务器可见谁在打字 | 低 | 不含消息内容 |
| 无消息持久化 | 断线期间消息丢失 | 中 | 明确告知用户 |
| 无身份验证 | 任何人可用任意昵称 | 低 | 临时聊天可接受 |
| NanoID 碰撞 | 21 字符碰撞概率 ~10^-36 | 极低 | 可忽略 |

---

## 服务器可见元数据

即使消息内容加密，服务器仍可观察到：

| 元数据 | 可见性 | 说明 |
|--------|--------|------|
| 房间 ID | ✅ | 路由必需 |
| 成员 ID | ✅ | 连接标识 |
| 成员昵称 | ✅ | 加入时提供 |
| 消息时间戳 | ✅ | 服务器附加 |
| 消息大小 | ✅ | 密文长度可见 |
| 输入状态 | ✅ | 未加密 |
| 在线状态 | ✅ | 连接状态 |
| 消息明文 | ❌ | 端到端加密 |
| 房间密钥 | ❌ | 仅客户端持有 |

---

## 与其他方案对比

| 特性 | Arthas | Signal | Telegram (Secret) |
|------|--------|--------|-------------------|
| E2EE | ✅ AES-256-GCM | ✅ Double Ratchet | ✅ MTProto |
| 前向保密 | ❌ | ✅ | ✅ |
| 服务器零知识 | ✅ | ✅ | 部分 |
| 消息持久化 | ❌ | ✅ (本地) | ✅ |
| 身份验证 | ❌ | ✅ (手机号) | ✅ (手机号) |
| 开源 | ✅ | ✅ | 部分 |
| 无需注册 | ✅ | ❌ | ❌ |

---

## 安全最佳实践

### 对用户

1. **通过安全渠道分享密钥** — 面对面、加密 IM（如 Signal）
2. **不要在公开场合发布分享码** — 任何人都可以加入
3. **敏感对话后离开房间** — 房间销毁后密文消失
4. **使用现代浏览器** — 确保 Web Crypto API 正确实现

### 对部署者

1. **启用 WSS (TLS)** — 保护传输层
2. **不记录消息内容** — 代码已确保，但检查日志配置
3. **限制 CORS** — 仅允许前端域名
4. **定期更新依赖** — 修复已知漏洞

---

## 已实现的安全增强

- [x] Ed25519 消息签名（v1.1.0 已实现）
- [x] 成员身份验证（密码保护房间，v1.0.0 已实现）

## 未来安全增强（路线图）

- [ ] Double Ratchet 协议（前向保密）
- [ ] 加密 typing 状态
- [ ] 踢人功能（密钥轮换）

---

## 下一步

- [架构文档](architecture.md) — 系统设计
- [协议规范](protocol.md) — 消息格式
