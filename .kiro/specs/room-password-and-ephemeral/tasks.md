# Implementation Plan: 房间密码保护 + 阅后即焚 (Phase 6.2 + 6.4)

## Overview

实现房间密码保护（前后端协同）和阅后即焚模式（纯前端）。密码使用 SHA-256 hash 传输，阅后即焚使用客户端定时删除。

## Tasks

- [x] 1. 后端：密码 + 阅后即焚支持
  - [x] 1.1 修改 `internal/room/room.go`
    - Room 结构新增 `PasswordHash string` 和 `Ephemeral int` 字段
    - NewRoom 签名变更为 `NewRoom(id, passwordHash string, ephemeral int) *Room`
    - _Requirements: 3.6_

  - [x] 1.2 修改 `internal/room/manager.go`
    - `CreateRoom` 签名变更为 `CreateRoom(roomId, passwordHash string, ephemeral int) *Room`
    - 传递 passwordHash 和 ephemeral 给 NewRoom
    - _Requirements: 3.6_

  - [x] 1.3 修改 `internal/network/protocol.go`
    - `CreateRoomData` 新增 `Password string` 和 `Ephemeral int` 字段
    - `JoinRoomData` 新增 `Password string` 字段
    - `RoomJoinedData` 新增 `HasPassword bool` 和 `Ephemeral int` 字段
    - 新增 `ErrCodeWrongPassword = "E006"`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 1.4 修改 `internal/network/hub.go` — handleCreateRoom
    - 从 dataMap 解析 `password`（string）和 `ephemeral`（int64/uint64，需处理两种类型）
    - 密码长度验证：非空时必须 4-20 字符（hash 后为 64 字符 hex），否则返回 E005
    - 传递给 `roomManager.CreateRoom(roomId, password, ephemeral)`
    - `RoomJoinedData` 响应中包含 `HasPassword` 和 `Ephemeral`
    - _Requirements: 1.1, 1.2, 1.7, 3.1, 3.2, 4.7_

  - [x] 1.5 修改 `internal/network/hub.go` — handleJoinRoom
    - 从 dataMap 解析 `password`（string）
    - 查找房间后，如果 `room.PasswordHash != ""` 且 `password != room.PasswordHash`，返回 E006
    - `RoomJoinedData` 响应中包含 `HasPassword` 和 `Ephemeral`
    - _Requirements: 1.3, 1.4, 1.5, 3.3, 3.5_

  - [x] 1.6 后端验证
    - `go build ./...` 无错误
    - `go vet ./...` 无问题
    - _Requirements: 1.3, 1.4_

- [x] 2. 前端：协议 + 工具
  - [x] 2.1 创建 `src/utils/crypto.ts`
    - `hashPassword(password: string): Promise<string>` — Web Crypto SHA-256 → hex string
    - 空字符串输入返回空字符串（无密码）
    - _Requirements: 4.1_

  - [x] 2.2 修改 `src/network/protocol.ts`
    - `CreateRoomData` 新增 `password?: string` 和 `ephemeral?: number`
    - `JoinRoomData` 新增 `password?: string`
    - `RoomJoinedData` 新增 `hasPassword: boolean` 和 `ephemeral: number`
    - 新增 `ERR_WRONG_PASSWORD = 'E006'`
    - 错误消息映射新增 E006: '房间密码错误'
    - _Requirements: 3.1-3.5_

  - [x] 2.3 修改 `src/crypto/shareKey.ts`
    - `encodeShareKey` 新增可选参数 `ephemeral?: number`
    - 格式：`roomId:keyEncoded:ephemeral`（ephemeral=0 时省略第三段）
    - `decodeShareKey` 返回值新增 `ephemeral: number`
    - 向后兼容：旧格式（无第三段）解析为 ephemeral=0
    - _Requirements: 2.11_

- [x] 3. 前端：Store + 逻辑
  - [x] 3.1 修改 `chatStore.ts` — 状态扩展
    - 新增 `hasPassword: boolean` 和 `ephemeral: number` state
    - `createRoom` action 新增 `password` 和 `ephemeral` 参数
    - `joinRoom` action 新增 `password` 参数
    - `MSG_ROOM_JOINED` handler 中读取 `hasPassword` 和 `ephemeral`
    - _Requirements: 1.1, 1.2, 2.11_

  - [x] 3.2 修改 `chatStore.ts` — 阅后即焚逻辑
    - 消息添加到 messages 数组后，如果 `ephemeral > 0 && !msg.isSystem`：
      - `setTimeout(() => removeMessage(msg.id), ephemeral * 1000)`
    - 新增 `removeMessage(id)` 内部函数：从 messages 数组中移除
    - 同时适用于发送的消息和接收的消息
    - _Requirements: 2.2, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.3 修改 `chatStore.ts` — 密码 hash
    - `createRoom` 中：如果有密码，调用 `hashPassword(password)` 后发送 hash
    - `joinRoom` 中：如果有密码，调用 `hashPassword(password)` 后发送 hash
    - _Requirements: 4.1_

- [x] 4. 前端：UI
  - [x] 4.1 修改 `src/pages/Home.tsx`
    - 创建房间区域：新增"🔐 设置密码"链接按钮，点击展开密码输入框（type=password，4-20 字符验证）
    - 创建房间区域：新增阅后即焚 checkbox（⏱️ 阅后即焚）+ 时间选择 select（10s/30s/60s/5min）
    - 加入房间区域：新增密码输入框（type=password，placeholder="房间密码（如有）"）
    - 加入房间区域：解析分享码后如果包含 ephemeral，显示"⏱️ 此房间为阅后即焚模式（Ns）"提示
    - 密码前端验证：非空时 4-20 字符
    - 传递 password 和 ephemeral 给 createRoom/joinRoom
    - _Requirements: 1.9, 1.10, 2.1, 2.10, 2.12, 4.6, 4.7_

  - [x] 4.2 修改 `src/pages/ChatRoom.tsx` — Header 图标
    - 从 store 读取 `hasPassword` 和 `ephemeral`
    - 显示 🔐（有密码）或 🔒（无密码）
    - ephemeral > 0 时显示 ⏱️ + tooltip 显示消失时间
    - _Requirements: 1.10, 2.8_

  - [x] 4.3 修改 `src/components/MessageList.tsx` — 倒计时进度条
    - 如果 `ephemeral > 0`，每条非系统消息下方显示倒计时进度条
    - 进度条使用 **CSS animation**（`shrink-bar` keyframe，GPU 加速，不阻塞主线程）
    - `animation-duration` 通过 inline style 设置为 `${ephemeral}s`
    - 消息即将消失前 **200ms** 添加淡出 + 高度收缩动画（`opacity-0 max-h-0 transition-all duration-200`）
    - 动画尊重 prefers-reduced-motion（`motion-reduce:hidden`）
    - _Requirements: 2.3, 2.9, 4.3, 4.4_

  - [x] 4.4 在 `tailwind.config.js` 添加动画
    - `shrink-bar` keyframes：`{ from: { width: '100%' }, to: { width: '0%' } }`
    - _Requirements: 2.3_

- [x] 5. 集成验证
  - [x] 5.1 验证密码保护
    - 创建有密码的房间 → 分享码不含密码
    - 用错误密码加入 → 收到"密码错误"提示
    - 用正确密码加入 → 成功进入
    - 无密码房间 → 行为不变（向后兼容）
    - _Requirements: 1.1-1.10_

  - [x] 5.2 验证阅后即焚
    - 创建阅后即焚房间（30秒）→ header 显示 ⏱️
    - 发送消息 → 消息下方有倒计时进度条
    - 30秒后 → 消息淡出消失
    - 系统消息不消失
    - _Requirements: 2.1-2.11_

  - [x] 5.3 构建验证
    - `go build ./...` + `go vet ./...` 无错误
    - `npm run build` 无错误
    - _Requirements: 4.2_

## Notes

- **密码是完全可选的** — 不设密码的房间行为与当前完全一致（向后兼容）
- 密码使用 SHA-256 hash 传输和存储（不是明文）
- 密码验证在服务端（客户端无法绕过）
- 密码长度 4-20 字符，前后端双重验证
- 阅后即焚纯客户端实现（服务器不参与，本来就不存储消息）
- 分享码格式向后兼容（旧格式无第三段 = ephemeral=0）
- 消失时间预设 4 个选项（10s/30s/60s/5min），不支持自定义
- 倒计时使用 CSS animation（GPU 加速，不阻塞主线程）
- Room 结构的 PasswordHash 和 Ephemeral 随房间销毁消失（内存中）
- msgpack 反序列化数字为 int64/uint64，Go handler 需处理两种类型
- 加入前解析分享码显示阅后即焚提示（用户知情后再加入）

## Task Dependency Graph

```
Task 1.1 (room.go) → 1.2 (manager.go) → 1.3 (protocol.go) → 1.4/1.5 (hub.go) → 1.6 (验证)
                                                                    │
Task 2.1 (crypto.ts) ──────────────────────────────────────────────┤
Task 2.2 (protocol.ts) ───────────────────────────────────────────┤
Task 2.3 (shareKey.ts) ───────────────────────────────────────────┤
                                                                    │
Task 3.1 (store state) → 3.2 (ephemeral logic) → 3.3 (hash) ────┤
                                                                    │
Task 4.1 (Home UI) ───────────────────────────────────────────────┤──→ Task 5
Task 4.2 (ChatRoom header) ──────────────────────────────────────┤
Task 4.3 (MessageList timer) ─────────────────────────────────────┤
Task 4.4 (tailwind animation) ────────────────────────────────────┘
```

**执行顺序：**
1. Wave 1（并行）：Task 1.1 + 2.1 + 2.2
2. Wave 2（并行）：Task 1.2 + 1.3 + 2.3
3. Wave 3：Task 1.4 + 1.5 + 1.6（后端完成）
4. Wave 4（并行）：Task 3.1 + 3.2 + 3.3 + 4.4
5. Wave 5（并行）：Task 4.1 + 4.2 + 4.3
6. Wave 6：Task 5（验证）
