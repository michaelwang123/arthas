# OpenClaw Channel Plugin — Issue 跟踪

> 代码审查日期: 2026-05-28
> 模块: `packages/openclaw-channel/`

## 🔴 严重 (Critical)

### ISSUE-1: 文件传输跨客户端兼容性 Bug
- **文件:** `src/file-transfer.ts`
- **问题:** `FileSender` 使用 `latin1→UTF-8` 编码 hack 加密二进制数据，与 Web 客户端的直接 ArrayBuffer 加密不兼容
- **影响:** 本插件加密的文件 Web 客户端无法解密，反之亦然
- **修复:** 新增 `encryptBuffer()` / `decryptBuffer()` 函数直接操作 Buffer
- **状态:** ✅ 已修复

## 🟡 中等 (Medium)

### ISSUE-2: FileReceiver 无传输超时（内存泄漏风险）
- **文件:** `src/file-transfer.ts`
- **问题:** 发送方中途断开（未发送 CANCEL）时，chunk 缓冲区永久驻留内存
- **修复:** 添加 5 分钟传输超时，自动清理过期传输
- **状态:** ✅ 已修复

### ISSUE-3: 重连缺少随机抖动（Jitter）
- **文件:** `src/reconnect.ts`
- **问题:** 多实例部署时所有 Agent 同时重连（惊群效应）
- **修复:** 在退避延迟上添加 ±20% 随机抖动
- **状态:** ✅ 已修复

### ISSUE-4: crypto.ts 缺少密钥长度验证
- **文件:** `src/crypto.ts`
- **问题:** encrypt/decrypt 不验证 key 是否为 32 字节，错误时得到 OpenSSL 晦涩报错
- **修复:** 在函数入口添加显式长度检查
- **状态:** ✅ 已修复

### ISSUE-5: client.ts 事件监听器泄漏
- **文件:** `src/client.ts`
- **问题:** connect() 失败时 `on('error')` 监听器仍挂在已死的 WebSocket 上
- **修复:** 在 reject 路径中清理 WebSocket 和监听器
- **状态:** ✅ 已修复

## 🟢 小问题 (Minor)

### ISSUE-6: adapter.ts 中 `await broadcastPublicKey()` 无效
- **文件:** `src/adapter.ts`
- **问题:** `broadcastPublicKey()` 返回 void，await 无意义
- **修复:** 去掉 await
- **状态:** ✅ 已修复

### ISSUE-7: publicKeyMap 无界增长且未使用
- **文件:** `src/adapter.ts`
- **问题:** v1 不做签名验证但仍收集公钥，Map 无限增长
- **修复:** 添加 maxSize 限制（最多 50 个条目）
- **状态:** ✅ 已修复

### ISSUE-8: adapter.ts 未使用的 import
- **文件:** `src/adapter.ts`
- **问题:** `ArthasChannelConfig` 被 import 但未使用
- **修复:** 移除未使用的 import
- **状态:** ✅ 已修复

## 🔵 Polish（二次审查发现）

### ISSUE-9: file-transfer.ts 未使用的 import
- **文件:** `src/file-transfer.ts`
- **问题:** `MSG_SEND_FILE_CANCEL` 和 `SendFileCancelData` 被 import 但未使用
- **修复:** 移除未使用的 import
- **状态:** ✅ 已修复

### ISSUE-10: handleComplete 不完整路径未清理定时器
- **文件:** `src/file-transfer.ts`
- **问题:** chunks 不完整时 `transfers.delete()` 但没 `clearTimeout()`，定时器会空触发
- **修复:** 在 early return 前添加 `clearTimeout(state.timeoutTimer)`
- **状态:** ✅ 已修复

### ISSUE-11: 文件传输消息缺少 userName
- **文件:** `src/adapter.ts` + `src/file-transfer.ts`
- **问题:** `handleFileComplete` 构造 IncomingMessage 时 `userName: ''`，因为 COMPLETE 消息不含 senderName
- **修复:** 在 TransferState 中缓存 META 消息的 senderName，ReceivedFile 暴露该字段
- **状态:** ✅ 已修复

### ISSUE-12: decrypt/decryptBuffer 未验证 IV 长度
- **文件:** `src/crypto.ts`
- **问题:** 畸形消息（IV 非 12 字节）会导致 OpenSSL 晦涩错误
- **修复:** 在 decrypt 和 decryptBuffer 入口添加 `iv.length !== 12` 检查
- **状态:** ✅ 已修复
