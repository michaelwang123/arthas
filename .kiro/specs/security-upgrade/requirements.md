# Requirements Document: Security Upgrade (Phase 8)

## Introduction

本文档定义 Arthas 加密聊天系统的安全升级需求（Phase 8）。包含两项增强：

1. **加密 Typing 状态** — 使用 AES-256-GCM + Room_Key 加密输入状态事件，消除服务器对"谁在输入"的元数据观察能力。
2. **Ed25519 消息签名** — 为消息添加数字签名，接收方可验证消息确实来自声称的发送者，防止服务器伪造消息。

两项增强均保持 Web 客户端和 CLI 客户端的完全互操作性，保留服务器零知识中转架构，且不需要服务器端协议变更。

## Glossary

- **Room_Key**: 通过分享码在房间成员间共享的 AES-256 对称密钥，用于加密/解密所有消息内容。
- **Typing_Payload**: 替代当前明文 typing 布尔值的加密数据结构，包含输入状态。
- **Signing_Keypair**: 每客户端每会话生成的 Ed25519 非对称密钥对（私钥用于签名，公钥用于验证）。
- **Signature**: 64 字节 Ed25519 数字签名，计算覆盖加密前的完整 payload（去除 `sig` 字段后的 JSON）。
- **Public_Key_Announcement**: 包含客户端 Ed25519 公钥的加密消息，加入房间时广播给其他成员。
- **Signed_Payload**: AES-256-GCM 加密前的 JSON 结构，包含 `text`、可选 `sig`、可选 `reply`、可选 `type` 字段。
- **Signable_Bytes**: 签名计算的输入字节——Signed_Payload 中去除 `sig` 字段后，按 key 字母序排列的 JSON 的 UTF-8 编码。
- **TOFU**: Trust On First Use，首次信任模型——信任第一次收到的公钥，不做额外验证。
- **Web_Client**: 基于浏览器的 Arthas 客户端，使用 Web Crypto API。
- **CLI_Client**: 基于 Go 的终端 Arthas 客户端，使用 Go 标准库 crypto 包。
- **Server**: Go WebSocket 中转服务器，路由消息但不解密内容。

## Requirements

### Requirement 1: 加密 Typing 状态

**User Story:** As a user, I want my typing status to be encrypted, so that the server cannot observe who is typing or when.

#### Acceptance Criteria

1. WHEN a user starts or stops typing, THE Web_Client SHALL encrypt the Typing_Payload using AES-256-GCM with the Room_Key before transmission.
2. THE Typing_Payload SHALL be a JSON object `{"typing": true}` or `{"typing": false}`, serialized to UTF-8 before encryption.
3. THE Web_Client SHALL generate a unique 96-bit random IV for each encrypted typing message.
4. THE Web_Client SHALL transmit encrypted typing data using the existing MSG_TYPING (0x05) message type, with `iv` and `ciphertext` fields in the data object.
5. WHEN an encrypted typing message (containing `iv` + `ciphertext` fields) is received, THE Web_Client SHALL decrypt the Typing_Payload using the Room_Key and update the typing indicator UI.
6. WHEN an encrypted typing message is received, THE CLI_Client SHALL silently discard it (CLI does not display typing indicators and does not send typing events due to line-based input).
7. THE Server SHALL relay MSG_TYPING messages with arbitrary data fields without validation (zero-knowledge preserved).
8. IF a client receives a typing message containing a plaintext `typing` field (from an older client without encryption), THEN THE Web_Client SHALL fall back to treating it as a plaintext typing event for backward compatibility.

> **注**: CLI 客户端不发送 typing 事件（终端行输入模式无法检测"正在输入"状态），因此 CLI 只需处理接收路径。

---

### Requirement 2: 生成 Ed25519 签名密钥对

**User Story:** As a user, I want my client to generate a unique signing keypair per session, so that my messages can be cryptographically attributed to me.

#### Acceptance Criteria

1. WHEN a user creates or joins a room, THE Web_Client SHALL generate a new Ed25519 Signing_Keypair using the Web Crypto API (`crypto.subtle.generateKey` with `Ed25519` algorithm).
2. WHEN a user creates or joins a room, THE CLI_Client SHALL generate a new Ed25519 Signing_Keypair using the Go `crypto/ed25519.GenerateKey` function.
3. THE Signing_Keypair SHALL be stored in memory only (not persisted to localStorage, sessionStorage, or disk).
4. THE Signing_Keypair private key (seed) SHALL consist of 32 bytes from a cryptographically secure random source.
5. THE Signing_Keypair public key SHALL be the corresponding 32-byte Ed25519 public key derived from the seed.
6. WHEN the user leaves the room or the session ends, THE Web_Client SHALL discard the Signing_Keypair from memory.
7. WHEN the user leaves the room or the session ends, THE CLI_Client SHALL zero-fill and discard the Signing_Keypair from memory.

---

### Requirement 3: 公钥广播与交换

**User Story:** As a user, I want my public key shared with room members, so that they can verify my message signatures.

#### Acceptance Criteria

1. WHEN a user successfully joins a room (receives RoomJoined), THE client SHALL broadcast a Public_Key_Announcement containing its Ed25519 public key, encrypted with the Room_Key.
2. THE Public_Key_Announcement SHALL be transmitted as a standard encrypted message (MSG_SEND_MESSAGE 0x03) with the Signed_Payload containing `{"type": "pubkey", "text": "", "pubkey": "<base64url-encoded-32-byte-public-key>"}`.
3. WHEN a Public_Key_Announcement is received and decrypted, THE client SHALL store the sender's public key in an in-memory map keyed by sender ID.
4. WHEN a Public_Key_Announcement is received, THE client SHALL NOT display it in the chat message list (suppress from UI).
5. WHEN a new member joins (MemberJoined event), existing members SHALL NOT re-broadcast their public keys. Instead, the new member's own Public_Key_Announcement (sent per AC-1) is sufficient — existing members' keys will be verified via TOFU when their next signed message arrives.
6. IF a signed message is received from a sender whose public key is not yet known, THE client SHALL store the message and defer verification until the sender's Public_Key_Announcement arrives (or display without verification indicator).
7. THE Web_Client and CLI_Client SHALL use base64url encoding (no padding) for the public key within the announcement payload.

> **设计决策**: 不采用"所有成员重新广播"策略，避免 N 人房间每次有人加入产生 N 条公钥消息的广播风暴。新成员只需广播自己的公钥，现有成员的公钥通过 TOFU 模型在首次签名验证时建立信任。

---

### Requirement 4: 消息签名

**User Story:** As a user, I want my messages to include a digital signature, so that recipients can verify the message was sent by me and not forged by the server.

#### Acceptance Criteria

1. WHEN sending a chat message, THE client SHALL compute an Ed25519 signature over the Signable_Bytes.
2. THE Signable_Bytes SHALL be defined as: the UTF-8 encoding of the JSON serialization of the Signed_Payload object with the `sig` field removed, and remaining keys sorted alphabetically. Specifically: `JSON.stringify({reply?, text, type?}, Object.keys(obj).sort())` in JS, or equivalent canonical JSON in Go.
3. THE client SHALL include the 64-byte signature as a base64url-encoded string in the `sig` field of the Signed_Payload, BEFORE AES-256-GCM encryption.
4. THE complete Signed_Payload (including `sig`) SHALL then be serialized to UTF-8 JSON and encrypted with AES-256-GCM using the Room_Key.
5. IF the sender's Signing_Keypair is not available (error condition), THEN THE client SHALL send the message without a `sig` field and log a warning.
6. THE signature SHALL cover ALL payload fields (text, reply, type) — not just the text field — to prevent metadata tampering by the server.

> **安全属性**: 签名覆盖完整 payload（去除 sig 本身），确保服务器无法在不被检测的情况下修改任何字段（包括 reply 引用、type 标记等）。

---

### Requirement 5: 签名验证

**User Story:** As a user, I want to verify that received messages were actually sent by the claimed sender, so that I can detect server-forged messages.

#### Acceptance Criteria

1. WHEN a message containing a `sig` field is received and the sender's public key is known, THE client SHALL verify the Ed25519 signature by: (a) removing the `sig` field from the decrypted payload, (b) computing Signable_Bytes using the same canonical JSON algorithm as the sender, (c) verifying the signature against the Signable_Bytes using the sender's public key.
2. WHEN signature verification succeeds, THE Web_Client SHALL display the message with a subtle verified indicator (e.g., a small ✓ icon or green lock).
3. WHEN signature verification succeeds, THE CLI_Client SHALL display the message normally (no additional indicator — terminal space is limited).
4. WHEN signature verification fails, THE Web_Client SHALL display the message with a warning indicator (⚠️) and a tooltip: "Signature verification failed — this message may have been tampered with."
5. WHEN signature verification fails, THE CLI_Client SHALL display the message with a `[⚠ unverified]` prefix before the sender name.
6. IF the sender's public key is not yet known (announcement not received), THEN THE client SHALL display the message without any verification indicator and attempt verification when the key becomes available.
7. IF a message does not contain a `sig` field (sent by an older client without signing support), THEN THE client SHALL display the message normally without any verification indicator (backward compatible).

---

### Requirement 6: Signed Payload 格式与序列化

**User Story:** As a developer, I want a well-defined encrypted payload format, so that both clients can interoperate on signing and verification.

#### Acceptance Criteria

1. THE Signed_Payload SHALL be a JSON object with the following fields:
   - `text` (string, required): 消息文本内容
   - `sig` (string, optional): base64url 编码的 64 字节 Ed25519 签名
   - `reply` (object, optional): 引用回复元数据（与现有 reply 功能兼容）
   - `type` (string, optional): 特殊消息类型标识（如 `"pubkey"` 表示公钥广播）
   - `pubkey` (string, optional): base64url 编码的 32 字节公钥（仅 type="pubkey" 时存在）
2. THE Signed_Payload SHALL be serialized to UTF-8 JSON before AES-256-GCM encryption.
3. THE Web_Client SHALL extend the existing `buildPayload/parsePayload` functions to handle the new `sig`, `type`, and `pubkey` fields.
4. THE CLI_Client SHALL extend the existing `MessagePayload` struct to include `Sig`, `Type`, and `PubKey` fields with appropriate `json` tags and `omitempty`.
5. FOR ALL valid Signed_Payload objects, serializing to JSON then parsing back SHALL produce an equivalent object (round-trip property).
6. IF the decrypted payload is not valid JSON or missing the `text` field, THE client SHALL fall back to treating the entire plaintext as the message text (backward compatibility with pre-envelope clients).
7. THE Web_Client and CLI_Client SHALL use identical base64url encoding (RFC 4648 §5, no padding) for signatures and public keys.

> **与现有代码的关系**: 此格式是对现有 `MessagePayload` / `buildPayload` 的扩展（新增 `sig`、`type`、`pubkey` 字段），不是替换。现有的 `text` 和 `reply` 字段保持不变。

---

### Requirement 7: 跨客户端互操作

**User Story:** As a user, I want the Web client and CLI client to fully interoperate on encrypted typing and message signing, so that mixed-client rooms work seamlessly.

#### Acceptance Criteria

1. WHEN the Web_Client sends a signed message, THE CLI_Client SHALL successfully verify the Ed25519 signature.
2. WHEN the CLI_Client sends a signed message, THE Web_Client SHALL successfully verify the Ed25519 signature.
3. WHEN the Web_Client sends an encrypted typing event, any client with the Room_Key SHALL successfully decrypt the Typing_Payload.
4. THE Web_Client and CLI_Client SHALL produce identical Signable_Bytes for the same payload content (canonical JSON with sorted keys, UTF-8 encoding, no BOM, no trailing newline).
5. THE Web_Client and CLI_Client SHALL use identical base64url encoding (no padding) for public keys and signatures.
6. A cross-client integration test SHALL verify that a message signed by one client type can be verified by the other.

---

## Known Limitations

### TOFU (Trust On First Use) 信任模型

当前设计采用 TOFU 模型：客户端信任第一次收到的公钥广播。这意味着：

- **威胁**: 如果恶意服务器在首次公钥广播时替换为自己的公钥，可以对后续消息进行中间人攻击（MITM）。
- **缓解**: 服务器是开源的，用户可以自托管；公钥广播本身是加密的（服务器无法读取内容来精确替换）。
- **未来改进**: Phase 8 后续迭代可引入 SAS 验证（Short Authentication String），让用户通过带外渠道验证对方公钥指纹。

### CLI 不发送 Typing 事件

CLI 客户端使用行输入模式（bufio.Scanner），无法检测"正在输入"状态。因此：
- CLI 不发送加密 typing 事件
- CLI 接收到 typing 事件时静默丢弃
- 这不影响 Web 客户端之间的 typing 指示器功能

## Design Notes (设计阶段注意事项)

### Canonical JSON 跨平台一致性

Signable_Bytes 要求两端产生完全相同的字节序列。实现注意：

- **JavaScript**: `JSON.stringify(obj, Object.keys(obj).sort())` 可确保 key 按字母序输出
- **Go**: `json.Marshal` 对 struct 按字段声明顺序输出（不是字母序）。需要自定义序列化：使用 `map[string]interface{}` + 排序 keys，或定义 struct 字段顺序与字母序一致

设计文档必须提供 2-3 个 **Test Vectors**（固定输入 → 固定输出字节），作为跨客户端互操作的验证基准：

```
Test Vector 1 (纯文本):
  Input:  {"text": "Hello"}
  Signable JSON: {"text":"Hello"}
  Signable Bytes (hex): 7b2274657874223a2248656c6c6f227d

Test Vector 2 (带 reply):
  Input:  {"reply": {"preview": "Hi", "senderName": "A", "stableId": "x:1"}, "text": "World"}
  Signable JSON: {"reply":{"preview":"Hi","senderName":"A","stableId":"x:1"},"text":"World"}

Test Vector 3 (pubkey announcement):
  Input:  {"pubkey": "dGVzdC1wdWJsaWMta2V5LWJhc2U2NHVybA", "text": "", "type": "pubkey"}
  Signable JSON: {"pubkey":"dGVzdC1wdWJsaWMta2V5LWJhc2U2NHVybA","text":"","type":"pubkey"}
```

### 公钥缺失窗口的用户体验

新成员加入后，现有成员的历史消息无法验证签名（因为新成员还没有他们的公钥）。处理策略：

- 新成员收到的第一批消息显示为"未验证"状态（无 ✓ 图标）
- 当现有成员发送下一条签名消息时，新成员通过 TOFU 建立信任
- 不显示"等待验证"的加载状态（避免 UI 噪音）
- 如果后续收到该成员的 Public_Key_Announcement（如成员重新加入），更新公钥并重新验证缓存的消息

### 属性测试要求

设计阶段应定义以下可测试属性：

1. **Canonical JSON 一致性**: 对于相同的 payload 对象，Web 和 CLI 产生完全相同的 Signable_Bytes
2. **签名往返**: 对于任意 payload，sign(payload) 后 verify(payload, sig, pubkey) 始终成功
3. **篡改检测**: 修改 payload 任意字段后，verify 失败
4. **Typing 加密往返**: 对于任意 Room_Key 和 typing 状态，encrypt 后 decrypt 还原原始状态

## Out of Scope

- **密钥轮换（踢人后）** — 需要更复杂的密钥管理协议，留待后续迭代
- **SAS 验证** — 需要 UI 设计和带外通信渠道，留待后续迭代
- **签名覆盖文件传输** — 文件分片的签名机制更复杂，本次只覆盖聊天消息
- **公钥持久化** — 密钥对仅存在于会话内存中，不跨会话持久化
- **公钥请求机制** — 如果错过公钥广播，当前无法主动请求（通过 TOFU 在下次签名时建立信任）
