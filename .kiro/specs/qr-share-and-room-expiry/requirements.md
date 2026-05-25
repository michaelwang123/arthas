# Requirements Document: QR 码分享 & 房间链接过期

## Introduction

本需求文档定义 Arthas 分享体验增强功能（Phase 10），包含两个子功能：

1. **QR 码分享** — 将分享码编码为 QR 码，手机用户扫码即可加入房间，替代手动输入分享码的繁琐操作。纯前端实现，无需服务器改动。
2. **房间链接过期** — 创建房间时可设置有效期（1h/24h/7d/永不过期），服务器在过期后自动销毁房间。需要服务器端新增过期字段和定时清理机制。

当前状态：
- 分享码格式为 `{roomId}:{base64url(roomKey)}[:{ephemeral}]`（ephemeral=0 时省略第三段）
- 房间仅在所有成员离开后自动销毁，无时间维度的过期机制
- 项目规则"不引入新依赖"，但 QR 编码算法复杂度高，本功能允许引入一个纯前端 QR 生成库作为 bundled 依赖（不引入运行时网络请求）

> **安全说明：** 分享码中的 expiresAt 字段是信息性的（帮助加入者判断房间是否仍有效），服务器是过期时间的唯一权威来源。客户端不应将分享码中的 expiresAt 作为安全边界。

## Glossary

- **QR_Generator**: 前端 QR 码生成模块，使用 bundled QR 库将分享链接编码为 QR 码图像
- **Share_Panel**: 前端分享面板组件，显示分享码文本、复制按钮和 QR 码入口
- **Room_Manager**: 服务器端房间管理器（`internal/room/manager.go`），负责房间的创建、查找和销毁
- **Expiry_Checker**: 服务器端过期检查 goroutine，定期扫描并销毁过期房间
- **Share_Code**: 分享码字符串，包含加入房间所需的全部信息。完整格式见 Requirement 9（编码规则以 Req 9 为准）：
  - 无过期：`{roomId}:{base64url(roomKey)}[:{ephemeral}]`（ephemeral=0 时可省略）
  - 有过期：`{roomId}:{base64url(roomKey)}:{ephemeral}:{expiresAt}`（ephemeral 段必须显式包含）
- **Join_URL**: 完整的加入链接，格式为 `https://domain/#/join/{shareCode}`，可被手机浏览器直接打开
- **Expiry_Duration**: 房间有效期时长选项（1h/24h/7d/never），创建时由房间创建者选择
- **Hub**: 服务器端 WebSocket 连接管理器（`internal/network/hub.go`），处理消息路由和客户端生命周期

## Requirements

### Requirement 1: QR 码生成与显示

**User Story:** As a room creator, I want to display a QR code containing the join link, so that mobile users can scan to join without manually typing the share code.

#### Acceptance Criteria

1. WHEN the user clicks the QR code button in the Share_Panel, THE QR_Generator SHALL render a QR code image encoding the Join_URL within 200ms.
2. THE QR_Generator SHALL encode the Join_URL in the format `https://{currentDomain}/#/join/{shareCode}` where shareCode is the current room's Share_Code.
3. THE QR_Generator SHALL use a bundled QR generation library (e.g., `qrcode` npm package) that does not make external network requests. This is an explicit exception to the "no new dependencies" rule, justified by the algorithmic complexity of QR encoding (Reed-Solomon error correction + masking patterns).
4. THE QR_Generator SHALL use error correction level M (15% recovery capacity), balancing data density and scan reliability for screen-to-camera scenarios.
5. WHEN the QR code is displayed, THE Share_Panel SHALL show the QR code in a modal dialog with a white background and at least 4-module quiet zone for reliable scanning.
6. WHILE the application is in dark theme mode, THE QR_Generator SHALL render the QR code with black modules on a white background to ensure scanner compatibility.
7. THE Share_Panel SHALL provide an accessible alt text on the QR code image describing its purpose, and the Share_Code text SHALL remain copyable alongside the QR code.

### Requirement 2: QR 码响应式布局

**User Story:** As a mobile user showing my screen to another person, I want the QR code to display large enough for easy scanning, so that the other person can join quickly.

#### Acceptance Criteria

1. WHILE the viewport width is less than 640px, THE Share_Panel SHALL display the QR code at a minimum size of 200x200 CSS pixels within the modal.
2. WHILE the viewport width is 640px or greater, THE Share_Panel SHALL display the QR code at a size of 256x256 CSS pixels within the modal.
3. WHEN the QR code modal is open, THE Share_Panel SHALL allow the user to close the modal by clicking outside, pressing Escape, or tapping a close button.

### Requirement 3: 扫码加入路由

**User Story:** As a mobile user who scanned a QR code, I want the application to automatically parse the share code from the URL and navigate to the join flow, so that I can join the room seamlessly.

#### Acceptance Criteria

1. WHEN the application loads with a URL path matching `/#/join/{shareCode}`, THE application SHALL extract the shareCode parameter and pre-fill it in the join room input field.
2. WHEN the application loads with a URL path matching `/#/join/{shareCode}`, THE application SHALL display the join room form with the share code already populated, requiring only a nickname (and password if applicable) to proceed.
3. IF the room requires a password (detected from server error E006 on first join attempt), THEN THE application SHALL display the password input field and prompt the user to enter the room password.
4. IF the shareCode in the URL is malformed or fails validation, THEN THE application SHALL display a localized error message and allow the user to manually enter a valid share code.
5. IF the shareCode contains an expiresAt segment and the timestamp is in the past, THEN THE application SHALL display a warning indicating the room may have expired, but still allow the user to attempt joining (server is the authority).

### Requirement 4: 房间有效期选择

**User Story:** As a room creator, I want to set an expiration time when creating a room, so that the room automatically destroys itself after the specified duration even if members are still connected.

#### Acceptance Criteria

1. WHEN creating a room, THE application SHALL display an expiration duration selector with options: 1 hour, 24 hours, 7 days, and never (no expiration).
2. THE application SHALL default the expiration duration selector to "never" (no expiration) to maintain backward compatibility with existing behavior.
3. WHEN the user selects an Expiry_Duration and creates the room, THE application SHALL send the selected duration value (in seconds, 0 for "never") in the `expiry` field of the MSG_CREATE_ROOM data payload.
4. THE server SHALL enforce a maximum expiry duration of 604800 seconds (7 days); any expiry value exceeding this limit SHALL be silently truncated to 604800 seconds.
5. IF the client sends a negative expiry value, THEN THE server SHALL treat it as 0 (no expiration) without returning an error.

### Requirement 5: 服务器端过期存储与响应

**User Story:** As the system operator, I want the server to record room expiration timestamps and communicate them to clients, so that expired rooms can be identified and clients can display remaining time.

#### Acceptance Criteria

1. WHEN the Room_Manager creates a room with a non-zero `expiry` value, THE Room_Manager SHALL compute and store an `expiresAt` timestamp (Unix seconds) equal to the current server time plus the expiry duration.
2. WHEN the Room_Manager creates a room with `expiry` set to 0 (never), THE Room_Manager SHALL store a zero-value `expiresAt` indicating no expiration.
3. THE Room_Manager SHALL continue to destroy rooms when all members leave, regardless of the expiresAt value (existing behavior preserved).
4. WHEN the server sends MSG_ROOM_CREATED to the room creator, THE response SHALL include the `expiresAt` field (Unix seconds, 0 for no expiration).
5. WHEN the server sends MSG_ROOM_JOINED to a joining client, THE response SHALL include the `expiresAt` field (Unix seconds, 0 for no expiration).

### Requirement 6: 服务器端过期清理

**User Story:** As the system, I want to periodically check and destroy expired rooms, so that resources are reclaimed and expired links become invalid.

#### Acceptance Criteria

1. THE Expiry_Checker SHALL run as a background goroutine that scans all rooms at a fixed interval of 60 seconds.
2. WHEN the Expiry_Checker finds a room whose `expiresAt` timestamp is non-zero and earlier than the current server time, THE Expiry_Checker SHALL initiate room destruction.
3. BEFORE destroying an expired room, THE Expiry_Checker SHALL broadcast FILE_CANCEL for any active file transfers in the room (preventing receiver-side buffer leaks).
4. WHEN the Expiry_Checker destroys an expired room, THE Hub SHALL send a room closed notification (MsgRoomClosed) with reason "expired" to all connected members before disconnecting them. Clients SHALL use the reason field to display a localized "room expired" message distinct from the generic "room closed" message.
5. IF the Expiry_Checker encounters a room with a zero-value `expiresAt`, THEN THE Expiry_Checker SHALL skip that room (no expiration enforced).
6. THE Expiry_Checker SHALL NOT block the Hub's message processing goroutine; it SHALL run independently with its own ticker.

### Requirement 7: 加入过期房间的错误处理

**User Story:** As a user attempting to join a room via an expired link, I want to receive a clear error message, so that I understand the room is no longer available.

#### Acceptance Criteria

1. WHEN a client sends a join request for a room that has expired (expiresAt is non-zero and in the past), THEN THE Hub SHALL return error code "E007" with message "room has expired". This check SHALL occur before password verification and capacity checks, providing real-time expiry rejection even if the Expiry_Checker has not yet run its periodic scan.
2. WHEN the client receives error code "E007", THE application SHALL display a localized error message indicating the room link has expired.
3. WHEN a client sends a join request for a room that does not exist (already destroyed by Expiry_Checker or empty-room cleanup), THEN THE Hub SHALL return the existing error code "E001" with message "room not found".

### Requirement 8: 房间内过期时间显示

**User Story:** As a room member, I want to see the remaining time before the room expires, so that I know how much time is left for the conversation.

#### Acceptance Criteria

1. WHEN a user joins or creates a room that has a non-zero expiresAt (received from server in MSG_ROOM_CREATED or MSG_ROOM_JOINED), THE application SHALL display the remaining time until expiration in the room header area.
2. THE application SHALL use the server-provided `expiresAt` as the authoritative source for the countdown (not the share code's expiresAt).
3. WHILE the room has more than 1 hour remaining, THE application SHALL display the remaining time in hours (e.g., "还剩 23 小时" / "23h remaining").
4. WHILE the room has 1 hour or less remaining, THE application SHALL display the remaining time in minutes (e.g., "还剩 45 分钟" / "45min remaining").
5. WHEN the room has 5 minutes or less remaining, THE application SHALL visually highlight the remaining time indicator with a warning color (amber/red).
6. WHEN a room with no expiration (expiresAt=0) is joined, THE application SHALL not display any expiration indicator.
7. THE countdown display SHALL update at the following frequencies: every 60 seconds when remaining time > 1 hour; every second when remaining time ≤ 1 hour.
8. WHEN the countdown reaches zero while the user is in the room, THE application SHALL rely on the server's MsgRoomClosed notification to navigate the user back to the home screen (no client-side forced disconnect).

### Requirement 9: 过期信息在分享码中的编码

**User Story:** As a user receiving a share code, I want to know the room's expiration time before joining, so that I can decide whether the room is still worth joining.

#### Acceptance Criteria

1. WHEN encoding a Share_Code for a room with a non-zero expiresAt, THE application SHALL always include the ephemeral segment (even if 0) followed by the expiresAt segment. Format: `{roomId}:{base64url(roomKey)}:{ephemeral}:{expiresAt}`.
2. WHEN encoding a Share_Code for a room with no expiration (expiresAt=0), THE application SHALL use the existing format: `{roomId}:{base64url(roomKey)}[:{ephemeral}]` (expiresAt segment omitted, backward compatible).
3. WHEN decoding a Share_Code, THE decoder SHALL handle all valid segment counts:
   - 2 segments: `roomId:key` → ephemeral=0, expiresAt=0
   - 3 segments: `roomId:key:ephemeral` → expiresAt=0
   - 4 segments: `roomId:key:ephemeral:expiresAt`
4. THE Share_Code decoder SHALL maintain backward compatibility: codes generated by older clients (without expiresAt) SHALL parse correctly.
5. FOR ALL valid Share_Code strings, encoding then decoding SHALL produce equivalent roomId, keyEncoded, ephemeral, and expiresAt values (round-trip property).

### Requirement 10: 国际化支持

**User Story:** As a user of any supported locale (zh/en/ja), I want all new UI text to be properly localized, so that the experience is consistent with the rest of the application.

#### Acceptance Criteria

1. THE application SHALL provide localized strings for all new UI elements (QR code button tooltip, expiration selector labels, remaining time display, error messages E007) in Chinese, English, and Japanese.
2. WHEN the locale changes, THE application SHALL immediately update all expiration-related text without requiring a page reload.

## Non-Functional Requirements

### Performance
- NFR-1: QR 码生成 SHALL complete within 200ms for share codes up to 100 characters.
- NFR-2: Expiry_Checker 的扫描间隔为 60 秒，过期精度为 ±60 秒（可接受）。
- NFR-3: Expiry_Checker 单次扫描 SHALL complete within 10ms for up to 1000 rooms.

### Compatibility
- NFR-4: CLI 客户端的分享码解析逻辑 SHALL 同步更新以支持 4 段格式（解析 expiresAt 段），但 CLI 不显示过期倒计时（仅解析不报错）。
- NFR-5: 不引入新的 Go 依赖（服务器端）。
- NFR-6: 允许引入一个纯前端 QR 生成 npm 包（如 `qrcode`），作为 bundled 依赖。

### Security
- NFR-7: 分享码中的 expiresAt 是信息性的（advisory），服务器是唯一权威。客户端 SHALL NOT 仅依赖分享码中的 expiresAt 来判断房间是否可用。
- NFR-8: 服务器 SHALL 限制单次 CreateRoom 的 expiry 不超过 604800 秒（7 天），超出部分静默截断。负数 expiry 视为 0（无过期）。此限制防止恶意客户端创建超长生命周期房间耗尽服务器内存。

## Out of Scope

- QR 码扫描功能（依赖手机系统相机，不在 Web 应用内实现）
- 房间过期时间的修改（创建后不可更改）
- 过期前的推送通知（仅在房间内显示倒计时）
- 服务器端持久化过期信息到磁盘（内存中管理，重启后丢失）

## Constraints

- 服务器不存储任何加密密钥（零知识架构不变）
- QR 码内容是完整的 Join_URL（包含密钥），因此 QR 码本身等同于分享码的安全性
- 过期检查在服务器内存中进行，不引入外部数据库或定时任务系统
- 房间过期后，所有关联的加密数据随房间销毁（不可恢复）
