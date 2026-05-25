# Implementation Plan: QR 码分享 & 房间链接过期

## Overview

本实现计划将 QR 码分享和房间链接过期功能分解为增量式编码任务。从服务器端协议和数据模型扩展开始，逐步构建过期清理逻辑、前端分享码编解码、QR 码生成、倒计时显示，最后完成集成和 CLI 客户端同步更新。

**设计约束：**
- 每个 wave 结束后代码必须可编译（无中间断裂）
- 前后端分享码格式变更与 CLI 同步推进（避免跨客户端兼容性窗口）
- `IsExpired(now int64)` 采用纯函数设计，便于属性测试注入时间

## Tasks

- [x] 1. 服务器端协议与数据模型扩展
  - [x] 1.1 扩展协议定义，新增 expiry/expiresAt 字段和 E007 错误码
    - 在 `arthas-server/internal/network/protocol.go` 中新增 `ErrCodeRoomExpired = "E007"` 常量
    - 在 CreateRoomData 结构体中新增 `Expiry int` 字段（msgpack tag: "expiry"）
    - 在 RoomCreatedData 结构体中新增 `ExpiresAt int64` 字段（msgpack tag: "expiresAt"）
    - 在 RoomJoinedData 结构体中新增 `ExpiresAt int64` 字段（msgpack tag: "expiresAt"）
    - 在 RoomClosedData 结构体中新增 `Reason string` 字段（msgpack tag: "reason,omitempty"）
    - 所有新增字段必须包含 GoDoc 注释说明用途和取值范围
    - _Requirements: 5.4, 5.5, 6.4, 7.1_

  - [x] 1.2 扩展 Room 结构体、RoomManager，并同步更新调用方
    - 在 `arthas-server/internal/room/room.go` 中为 Room 结构体新增 `ExpiresAt int64` 字段
    - 实现 `IsExpired(now int64) bool` 方法：`return r.ExpiresAt > 0 && now > r.ExpiresAt`（纯函数，便于测试）
    - 更新 `NewRoom` 函数签名，接受 `expiresAt int64` 参数
    - 在 `arthas-server/internal/room/manager.go` 中定义 `maxExpiryDuration int64 = 604800`
    - 更新 `CreateRoom` 方法签名，接受 `expiresAt int64` 参数，传递给 NewRoom
    - 实现 `GetExpiredRooms(now int64) []string` 方法（使用 RLock 读取快照，调用 room.IsExpired(now)）
    - 添加 `NowFunc func() int64` 字段到 RoomManager（默认 `time.Now().Unix()`），用于测试注入
    - **同步更新调用方**：在 `hub.go` 的 `handleCreateRoom` 中将 `h.roomManager.CreateRoom(roomId, password, ephemeral)` 改为 `h.roomManager.CreateRoom(roomId, password, ephemeral, 0)`（临时传入 0，task 2.1 实现完整逻辑）
    - 添加 📚 学习要点注释解释 IsExpired 纯函数设计和 ExpiresAt 只读语义
    - _Requirements: 4.4, 4.5, 5.1, 5.2, 6.1, 6.2, 6.5_

  - [x] 1.3 编写 Room.IsExpired 和 RoomManager.GetExpiredRooms 的属性测试
    - **Property 3: ExpiresAt computation** — 验证正 expiry 值产生正确的 expiresAt
    - **Property 4: Expiry checker correctness** — 验证 GetExpiredRooms 正确过滤过期/未过期房间
    - **Property 8: Empty room destruction invariant** — 验证所有成员离开后房间被销毁
    - **Property 9: Expiry input sanitization** — 验证负数→0、超大值→截断
    - 注意：IsExpired(now) 为纯函数，测试时直接传入任意 now 值即可，无需 mock time
    - **Validates: Requirements 5.1, 5.2, 5.3, 6.2, 6.5, NFR-7**

- [x] 2. 服务器端过期处理逻辑
  - [x] 2.1 实现 handleCreateRoom 中的 expiry 输入清洗和 expiresAt 计算
    - 在 `arthas-server/internal/network/hub.go` 的 handleCreateRoom 中解析 `expiry` 字段
    - 实现输入清洗：负数→0，超过 maxExpiryDuration→截断为 maxExpiryDuration
    - 计算 expiresAt：expiry > 0 时为 `time.Now().Unix() + int64(expiry)`，否则为 0
    - 将 expiresAt 传递给 RoomManager.CreateRoom（替换 task 1.2 中的临时 `0` 值）
    - 在 RoomCreated 响应中包含 expiresAt 字段
    - 添加 📚 学习要点注释解释防御性输入清洗策略
    - _Requirements: 4.3, 4.4, 4.5, 5.1, 5.2, 5.4_

  - [x] 2.2 实现 handleJoinRoom 中的过期检查
    - 在 `arthas-server/internal/network/hub.go` 的 handleJoinRoom 中，GetRoom 成功后、密码验证前插入过期检查
    - 调用 `room.IsExpired(time.Now().Unix())`，若为 true 则返回 E007 错误
    - 在 RoomJoined 响应中包含 expiresAt 字段
    - 添加 📚 学习要点注释解释双重防线（Expiry_Checker + JoinRoom 实时检查）
    - _Requirements: 7.1, 7.3, 5.5_

  - [x] 2.3 实现 cleanupExpiredRooms 方法和 expiryTicker
    - 在 Hub.Run() 中新增 `expiryTicker` (60s 间隔)，与 staleTransferTicker 模式一致
    - 实现 `cleanupExpiredRooms()` 方法：
      - 调用 GetExpiredRooms(time.Now().Unix()) 获取快照
      - 对每个过期房间：GetRoom 检查存在性 → 重新验证 room.IsExpired(now) → 广播 FILE_CANCEL → 广播 MsgRoomClosed(reason="expired") → 清除成员 RoomID → RemoveRoom
    - 实现 `broadcastFileCancelForExpiry(client, room)` 辅助函数：
      - 与 `broadcastFileCancelForDisconnect` 不同，过期场景需要通知**所有成员**（含发送方）
      - 使用遍历 room.GetMembers() 逐一发送，而非 r.Broadcast(excludeID)
      - 添加 📚 学习要点注释解释两种 FILE_CANCEL 广播的区别
    - defer expiryTicker.Stop() 确保资源释放
    - 添加 📚 学习要点注释解释 TOCTOU 双重检查模式
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 2.4 编写 handleJoinRoom 过期检查和 cleanupExpiredRooms 的属性测试
    - **Property 5: Join expired room error** — 验证过期房间的 join 请求返回 E007
    - **Property 10: Join-during-expiry consistency** — 验证 IsExpired(now)=true 时 join 被拒绝，无论 Expiry_Checker 是否已运行
    - **Validates: Requirements 7.1**

  - [x] 2.5 编写服务器端集成测试
    - 测试创建带过期的房间 → 注入 NowFunc 跳过等待 → 验证房间被销毁
    - 测试 CreateRoom expiry=-1 → expiresAt=0（负数清洗）
    - 测试 CreateRoom expiry=999999 → expiresAt=now+604800（超大值截断）
    - 测试过期房间有活跃传输 → FILE_CANCEL 被广播给所有成员（含发送方）→ **断言发送方也收到 RelayFileCancel 消息**
    - 测试 JoinRoom 到过期房间 → 返回 E007
    - _Requirements: 4.4, 4.5, 6.2, 6.3, 7.1_

- [x] 3. Checkpoint - 服务器端功能验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 前端分享码编解码扩展 & CLI 同步更新
  - [x] 4.1 扩展 shareKey.ts 支持 4 段分享码格式
    - 在 `arthas-client/src/crypto/shareKey.ts` 中定义 `ShareCodeComponents` 接口（含 expiresAt 字段）
    - 修改 `encodeShareKey` 函数：expiresAt > 0 时输出 4 段（ephemeral 显式包含）
    - 修改 `decodeShareKey` 函数：支持 2/3/4 段解析，验证 roomId 长度=21、key 长度=43、ephemeral/expiresAt 为有效非负整数
    - **Breaking change**: 旧实现对无效 ephemeral 静默接受（`parseInt(x) || 0`），新实现必须严格验证并返回 null。在代码注释中标注此行为变更。
    - 无效输入返回 null
    - 添加详细 JSDoc 注释说明各段格式和验证规则
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 4.2 扩展 CLI 的 ShareCode 解析支持 4 段格式
    - 在 `arthas-cli/internal/crypto/sharecode.go` 中为 ShareCode 结构体新增 `ExpiresAt int64` 字段
    - 更新 `ParseShareCode` 支持 2/3/4 段格式：修改 `len(parts) > 3` 为 `len(parts) > 4`
    - 第 4 段解析为 expiresAt（非负整数，无效则返回 error）
    - 更新 `BuildShareCode` 支持 expiresAt 参数：expiresAt > 0 时输出 4 段
    - CLI 仅解析 expiresAt，不显示倒计时（静默处理）
    - _Requirements: 9.3, 9.4, NFR-4_

  - [x] 4.3 编写分享码编解码的属性测试（前端 + CLI）
    - 安装 `fast-check` 作为 devDependency（如尚未安装，锁定精确版本）
    - **Property 7: Share code round-trip (TypeScript)** — 验证任意有效组件经 encode→decode 后等价
    - **Property 2: Invalid share code rejection (TypeScript)** — 验证不合规字符串被 decodeShareKey 拒绝（返回 null）
    - **Property 7 (Go variant): Share code round-trip** — 验证 BuildShareCode→ParseShareCode 的 round-trip 一致性（使用 `pgregory.net/rapid`）
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 3.4**

- [x] 5. 前端 QR 码生成模块
  - [x] 5.1 创建 QR_Generator 模块和 buildJoinURL 函数
    - 安装 `qrcode` npm 包作为 bundled 依赖（锁定精确版本，如 `qrcode@1.5.4`）
    - 创建 `arthas-client/src/qr/generator.ts`
    - 实现 `generateQRCode(text, options?)` 函数：调用 qrcode 库生成 data URL，默认 errorCorrectionLevel='M'、margin=4
    - 实现 `buildJoinURL(shareCode)` 函数：
      - 优先使用 `import.meta.env.VITE_APP_URL`，fallback 到 `window.location.origin`
      - **去除 base URL 尾部斜杠**（`base.replace(/\/+$/, '')`），防止双斜杠
      - 拼接 `/#/join/{shareCode}`
    - 添加文件级注释说明模块职责和 QR 库选择理由
    - _Requirements: 1.1, 1.2, 1.3, 1.4, NFR-1, NFR-6_

- [x] 6. 前端扫码加入路由
  - [x] 6.1 实现 parseJoinRoute 和 URL hash 路由处理
    - 在 `arthas-client/src/pages/Home.tsx` 中实现 `parseJoinRoute(hash)` 函数
    - 解析 `#/join/{shareCode}` 格式，提取 shareCode
    - 在 Home 组件挂载时检查 URL hash，匹配则预填分享码到加入输入框
    - 无效 shareCode 显示本地化错误消息，允许手动输入
    - shareCode 中 expiresAt 已过期时显示警告（仍允许尝试加入）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 6.2 编写 buildJoinURL 的属性测试
    - **Property 1: Join URL round-trip** — 验证 buildJoinURL(shareCode) 生成的 URL 经 parseJoinRoute 解析后还原原始 shareCode
    - 注意：此测试依赖 task 6.1 中的 parseJoinRoute 实现
    - **Validates: Requirements 1.2, 3.1**

- [x] 7. 前端 QR 码 Modal 组件
  - [x] 7.1 创建 QRCodeModal 组件
    - 创建 `arthas-client/src/components/QRCodeModal.tsx`
    - 实现 QR 码模态框：接收 open、onClose、shareCode props
    - 使用 useEffect + state 缓存 QR data URL（shareCode 为依赖）
    - 响应式尺寸：viewport < 640px 时 200px，>= 640px 时 256px
    - 始终使用黑色模块 + 白色背景（暗色主题兼容）
    - 支持 Escape 键、点击外部、关闭按钮关闭
    - 包含 accessible alt text（使用 i18n key `share.qr.alt`）
    - QR 生成失败时显示 fallback 错误文本
    - 添加 📚 学习要点注释解释 QR 缓存策略
    - _Requirements: 1.1, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3_

  - [x] 7.2 在 Share_Panel 中集成 QR 码按钮和 Modal
    - 在现有分享面板组件中添加"显示 QR 码"按钮
    - 点击按钮打开 QRCodeModal，传入当前 shareCode
    - 确保分享码文本仍可复制（QR 码是补充，不是替代）
    - _Requirements: 1.1, 1.7_

- [x] 8. 前端过期倒计时与时间格式化
  - [x] 8.1 创建时间格式化工具函数
    - 创建 `arthas-client/src/utils/timeFormat.ts`
    - 实现 `formatRemainingTime(remainingSeconds, locale)` 函数：
      - remaining > 3600: 显示小时数
      - remaining <= 3600: 显示分钟数
    - 实现 `isExpiryWarning(remainingSeconds)` 函数：remaining <= 300 返回 true
    - 支持 zh/en/ja 三种 locale 的格式化输出
    - _Requirements: 8.3, 8.4, 8.5, 10.1_

  - [x] 8.2 编写时间格式化的属性测试
    - **Property 6: Remaining time formatting** — 验证 >3600s 输出小时格式，<=3600s 输出分钟格式
    - **Validates: Requirements 8.3, 8.4**

  - [x] 8.3 创建 ExpiryCountdown 组件
    - 创建 `arthas-client/src/components/ExpiryCountdown.tsx`
    - 实现倒计时逻辑：remaining > 1h 每 60s 更新，remaining <= 1h 每秒更新
    - **Timer 切换逻辑**：当 60s timer 触发后发现 remaining <= 3600s，立即清除 60s interval 并启动 1s interval（防止跨越 1h 边界时出现更新延迟）
    - expiresAt=0 时不渲染
    - remaining <= 5min 时使用警告色高亮
    - 监听 visibilitychange 事件，tab 恢复前台时立即重新计算并重新评估 timer 频率
    - 倒计时到零时不主动断开，等待服务器 MsgRoomClosed
    - 添加 📚 学习要点注释解释 tab 可见性处理、时钟偏差和 timer 频率切换
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [x] 9. 前端状态管理与 WebSocket 消息处理
  - [x] 9.1 扩展 chatStore 状态，新增 expiresAt 字段
    - 在 `arthas-client/src/stores/chatStore.ts` 中新增 `expiresAt: number` 状态字段（默认 0）
    - 处理 RoomCreated 消息：提取 expiresAt 存入 store
    - 处理 RoomJoined 消息：提取 expiresAt 存入 store
    - 处理 MsgRoomClosed 消息：检查 reason 字段，"expired" 时显示专用过期消息
    - 处理 E007 错误码：显示本地化"房间链接已过期"消息
    - 更新 encodeShareKey 调用，传入 expiresAt 参数
    - leaveRoom 时重置 expiresAt 为 0
    - _Requirements: 5.4, 5.5, 6.4, 7.2, 8.1, 8.8, 9.1, 9.2_

  - [x] 9.2 在房间头部区域集成 ExpiryCountdown 组件
    - 在房间视图的 header 区域渲染 ExpiryCountdown，传入 store 中的 expiresAt
    - 使用服务器提供的 expiresAt 作为权威来源
    - _Requirements: 8.1, 8.2, 8.6_

- [x] 10. 前端房间创建过期选择器
  - [x] 10.1 在创建房间表单中添加过期时间选择器
    - 在创建房间的 UI 中添加 Expiry_Duration 选择器（1h/24h/7d/never）
    - 默认选中"never"（向后兼容）
    - 选择后将秒数值（3600/86400/604800/0）包含在 CreateRoom 消息的 expiry 字段中
    - 使用 i18n key 显示选项标签
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 11. 国际化字符串
  - [x] 11.1 添加 QR 码和过期相关的 i18n 字符串
    - 在 zh/en/ja 三个 locale 文件中添加所有新增 i18n key：
      - `share.qr.*` (button, title, alt, error)
      - `room.expiry.*` (label, 1h, 24h, 7d, never)
      - `room.countdown.*` (hours, minutes)
      - `error.roomExpired`, `error.roomMayExpired`
      - `system.roomExpired`
    - 确保 key 命名遵循 `{module}.{context}.{variant}` 模式
    - _Requirements: 10.1, 10.2_

- [x] 12. Checkpoint - 前端功能验证
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. 集成与端到端验证
  - [x] 13.1 端到端集成：确保前后端消息格式一致
    - 验证前端 CreateRoom 消息包含 expiry 字段且服务器正确解析
    - 验证服务器 RoomCreated/RoomJoined 响应中的 expiresAt 被前端正确存储
    - 验证 MsgRoomClosed reason="expired" 被前端正确处理并显示专用消息
    - 验证 E007 错误码被前端正确映射到本地化错误消息
    - 验证 QR 码生成的 Join_URL 能被 parseJoinRoute 正确解析
    - 验证 CLI 能正确解析 4 段分享码（前端生成 → CLI 解析）
    - _Requirements: 5.4, 5.5, 6.4, 7.1, 7.2, 1.2, 3.1, NFR-4_

  - [x] 13.2 编写前端集成测试
    - 测试旧格式分享码（2/3 段）在新客户端中正确解析（向后兼容）
    - 测试 QR 码 Modal 打开/关闭/响应式尺寸
    - 测试 ExpiryCountdown 在 expiresAt=0 时不渲染
    - 测试 ExpiryCountdown timer 频率切换（>1h → <=1h 边界）
    - 测试 parseJoinRoute 对各种 URL hash 格式的处理
    - _Requirements: 9.4, 2.1, 2.2, 2.3, 8.6, 8.7, 3.1_

- [x] 14. Final checkpoint - 全部测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- 服务器端使用 Go，前端使用 TypeScript (React + Zustand)，CLI 使用 Go
- 属性测试库：前端使用 `fast-check`（锁定精确版本），Go 使用 `pgregory.net/rapid`（项目已有）
- QR 码库使用 `qrcode` npm 包（锁定精确版本，bundled，无运行时网络请求）
- `IsExpired(now int64)` 为纯函数设计，测试时直接传入任意时间值，无需 mock
- `broadcastFileCancelForExpiry` 与 `broadcastFileCancelForDisconnect` 的区别：前者通知所有成员（含发送方），后者排除已断线的发送方
- Task 4.1 中 decodeShareKey 的验证行为变更（静默接受 → 严格拒绝）是 breaking change，需在注释中标注

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "4.1", "4.2"] },
    { "id": 2, "tasks": ["2.1", "4.3", "5.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "6.1", "8.1"] },
    { "id": 4, "tasks": ["2.4", "2.5", "6.2", "7.1", "8.2", "8.3"] },
    { "id": 5, "tasks": ["7.2", "9.1", "10.1", "11.1"] },
    { "id": 6, "tasks": ["9.2", "13.1"] },
    { "id": 7, "tasks": ["13.2"] }
  ]
}
```

### Wave 依赖说明

| Wave | 关键依赖关系 |
|------|-------------|
| 0 | 1.1（协议）+ 1.2（Room/RoomManager + 调用方临时修复）— 确保编译通过 |
| 1 | 1.3 依赖 1.2；4.1/4.2 独立于服务器但需同步推进分享码格式 |
| 2 | 2.1 依赖 1.1+1.2（完整实现 expiry 逻辑）；5.1 独立 |
| 3 | 2.2/2.3 依赖 2.1；6.1 依赖 4.1（decodeShareKey）；8.1 独立 |
| 4 | 6.2 依赖 5.1+6.1（buildJoinURL + parseJoinRoute 都已就绪）；7.1/8.3 依赖各自前置 |
| 5 | 9.1 依赖 4.1+8.3（encodeShareKey 新签名 + ExpiryCountdown 组件）|
| 6 | 13.1 依赖所有前端+后端功能完成 |
| 7 | 13.2 依赖 13.1 |
