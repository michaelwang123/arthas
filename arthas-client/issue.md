# QR 码分享 & 房间链接过期 — 代码优化清单

## 状态说明
- ⬜ 待处理
- 🔄 进行中
- ✅ 已完成
- ⏭️ 延后处理（需要更大范围重构）

---

## 🔴 P0 — 并发安全

### 1. cleanupExpiredRooms 在 RLock 下修改 client 字段
- **文件**: `arthas-server/internal/network/hub.go`
- **问题**: `client.activeTransferID = ""` 和 `client.RoomID = ""` 在 `h.mu.RLock()` 下执行，属于数据竞争（readPump goroutine 可能同时读写这些字段）
- **影响**: 遵循项目现有模式（handleClientDisconnect 也如此），属于全局架构债务
- **状态**: ⏭️ 延后处理 — 需要全局引入 per-client mutex，涉及 20+ 调用点，影响范围大

---

## 🟡 P1 — 可测试性 & 可维护性

### 2. NowFunc 未被 cleanupExpiredRooms 使用
- **文件**: `arthas-server/internal/network/hub.go`
- **问题**: `cleanupExpiredRooms` 直接调用 `time.Now().Unix()` 而非 `h.roomManager.NowFunc()`
- **修复**: 改为 `now := h.roomManager.NowFunc()`
- **状态**: ✅ 已完成

### 3. timeFormat.ts 硬编码 locale 字符串，与 i18n JSON 重复
- **文件**: `arthas-client/src/utils/timeFormat.ts`
- **问题**: `formatRemainingTime` 用 switch-case 硬编码了 `还剩 X 小时` 等文案，而 locale JSON 中已有 `room.countdown.hours` / `room.countdown.minutes`
- **修复**: 重构为接受可选 `translator` 函数参数，传入时使用 i18n key，不传时使用内置 fallback（向后兼容）
- **状态**: ✅ 已完成

### 4. QRCodeModal useEffect 依赖 `t` 函数导致不必要重新生成
- **文件**: `arthas-client/src/components/QRCodeModal.tsx`
- **问题**: QR 生成 effect 依赖 `[shareCode, t]`，切换语言时 `t` 引用变化触发 QR 重新生成
- **修复**: 移除 `t` 依赖，error 状态存储标记字符串，渲染时通过 `t()` 本地化
- **状态**: ✅ 已完成

---

## 🟢 P2 — 代码质量改进

### 5. ExpiryCountdown timer 嵌套 setInterval 逻辑脆弱
- **文件**: `arthas-client/src/components/ExpiryCountdown.tsx`
- **问题**: 60s interval 内部创建新的 1s interval，存在两个 interval 同时运行的风险窗口
- **修复**: 改用 `setTimeout` 递归模式，每次 tick 自然选择正确延迟，消除频率切换复杂性
- **状态**: ✅ 已完成

### 6. Room.ExpiresAt 导出字段缺乏封装
- **文件**: `arthas-server/internal/room/room.go`
- **问题**: 设计声明 ExpiresAt 只读，但导出字段允许任何代码修改
- **修复**: 改为私有字段 `expiresAt` + `GetExpiresAt() int64` getter，编译期强制只读
- **状态**: ✅ 已完成

### 7. parseNonNegativeInt 的 MAX_SAFE_INTEGER 检查不完整
- **文件**: `arthas-client/src/crypto/shareKey.ts`
- **问题**: `/^\d+$/` 匹配的纯数字串经 `Number()` 转换后不会报 Infinity，但超过 15 位会有精度丢失
- **修复**: 加 `value.length > 15` 前置检查，空字符串也提前拒绝
- **状态**: ✅ 已完成

### 8. QRCodeModal 关闭按钮 aria-label 语义不准确
- **文件**: `arthas-client/src/components/QRCodeModal.tsx`
- **问题**: 关闭按钮的 `aria-label` 使用了 `t('share.qr.title')`（"扫码加入房间"），应为"关闭"
- **修复**: 改为 `aria-label="Close"`
- **状态**: ✅ 已完成

---

## 🔵 P3 — 性能与 UX 优化

### 9. GetExpiredRooms O(n) 线性扫描
- **文件**: `arthas-server/internal/room/manager.go`
- **问题**: 每 60s 遍历所有房间，当前规模可接受，但数千房间时可能成为瓶颈
- **修复**: 新增 `expiringRooms map[string]int64` 索引，仅追踪有过期时间的房间。`GetExpiredRooms` 只遍历此子集，将扫描范围从 O(所有房间) 降为 O(有过期时间的房间)。新增 `ForEachExpiring` 回调遍历方法。
- **状态**: ✅ 已完成

### 10. 无服务器端过期预警
- **文件**: `arthas-server/internal/network/hub.go`
- **问题**: 房间过期时立即踢出所有成员，正在输入的消息丢失
- **修复**: 新增 `warnApproachingExpiry(now int64)` 方法，在 expiryTicker 中 cleanupExpiredRooms 之后调用。对剩余 ≤ 5 分钟的房间发送系统预警消息（使用 `warnedExpiry map[string]bool` 确保幂等性）。
- **状态**: ✅ 已完成

---

## 执行总结

本次优化完成了 **9/10 项改进**（#2-#10），仅跳过 #1（per-client mutex，需要全局重构 20+ 调用点）。

### 验证结果
- Go Server: `go build ./...` ✅ 编译通过
- Go Server: `go test ./...` ✅ 全部通过（5 packages）
- Go CLI: `go test ./...` ✅ 全部通过
- Frontend: `npm test` ✅ 343/344 通过（1 个预存在的 typing test 失败，与本次改动无关）
- TypeScript 诊断: 所有修改文件 0 错误

### 改动文件清单

| 文件 | 改动类型 |
|------|----------|
| `arthas-server/internal/room/room.go` | `ExpiresAt` → 私有 `expiresAt` + `GetExpiresAt()` getter |
| `arthas-server/internal/room/manager.go` | 新增 `expiringRooms` 索引 + `ForEachExpiring` 方法 + 优化 `GetExpiredRooms` |
| `arthas-server/internal/network/hub.go` | `NowFunc()` 替代 `time.Now()` + `warnedExpiry` + `warnApproachingExpiry` |
| `arthas-server/internal/room/room_property_test.go` | 重建（编码修复 + `GetExpiresAt()` 适配） |
| `arthas-server/internal/network/hub_expiry_test.go` | 重建（编码修复 + `GetExpiresAt()` 适配 + NowFunc 注入） |
| `arthas-client/src/utils/timeFormat.ts` | 新增可选 `translator` 参数 |
| `arthas-client/src/components/QRCodeModal.tsx` | 移除 `t` effect 依赖 + 修复 aria-label |
| `arthas-client/src/components/ExpiryCountdown.tsx` | 重写为 `setTimeout` 递归模式 |
| `arthas-client/src/crypto/shareKey.ts` | `parseNonNegativeInt` 加 length 前置检查 |
