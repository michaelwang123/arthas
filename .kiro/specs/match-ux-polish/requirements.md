# Requirements: Random Match UX Polish

## Introduction

Random Match 核心流程已验证通过：匹配 → 密钥交换 → 房间创建 → E2EE 双向消息收发均正常工作。本 spec 针对剩余 UX 缺陷和技术债务进行打磨。

**已确认正常工作（无需修复）：**
- ✅ 匹配配对、密钥生成/交换、自动创建房间
- ✅ 双向 E2EE 消息收发（自己的消息右对齐紫色，对方消息左对齐灰色）
- ✅ MatchRoom 渲染（MessageList + MessageInput + Report/Next 按钮）
- ✅ App.tsx 路由优先级（match 状态优先于 roomId）

**待修复的真实问题：**
- ⚠️ 两个用户名称都是 "Anonymous"，消息气泡和成员列表无法区分谁是谁
- ⚠️ 点击 "Next" 或离开后，chatStore 中旧消息/roomKey 未清理，会泄漏到下一次匹配
- ⚠️ MatchRoom 无头部信息（无 E2EE 图标、无阅后即焚指示、无到期倒计时）
- ⚠️ 房间过期时 matchStore 状态未联动（UI 卡死在 'in-room'）
- ⚠️ server_test.go 因 wire format 变更未完全适配而失败（非功能阻塞）

## Requirements

### Requirement 1: Distinguishable User Identities

**User Story:** As a match participant, I want to see a unique name for my partner that differs from mine, so that I can tell who sent which message.

#### Acceptance Criteria

1. WHEN two users are joined to a Match_Room, EACH SHALL have a distinct display name generated server-side (e.g., random animal names: "🐱 Cat" / "🦊 Fox", or "Stranger A" / "Stranger B").
2. THE generated names SHALL be deterministic per room position (Client A always gets the first name, Client B gets the second) so both sides see consistent naming.
3. THE name SHALL appear in: (a) member list, (b) message bubble sender label, (c) MatchRoom header partner name.
4. THE name generation logic SHALL reside in `JoinClientToRoom` (server-side) replacing the current hardcoded `"Anonymous"`.

### Requirement 2: MatchRoom Session Lifecycle Cleanup

**User Story:** As a user who finishes or exits a match session, I want all previous session state to be cleared, so that my next match starts fresh.

#### Acceptance Criteria

1. WHEN a user clicks "Next", THE client SHALL reset chatStore (roomId=null, roomKey=null, members=[], messages=[], typingMembers cleared) BEFORE sending MSG_MATCH_NEXT to re-enter the queue.
2. WHEN a user navigates back to Hub (via handleBackToHub or browser back), THE client SHALL reset both chatStore and matchStore to initial state.
3. WHEN the server sends MSG_ROOM_CLOSED (room expired) while matchStore.status is 'in-room', THE matchStore SHALL transition to a dedicated 'expired' state (distinct from the queue 'timeout' state) and THE chatStore SHALL be reset. THE UI SHALL display a "room expired" message with options to re-match or return to Hub.
4. WHEN the partner disconnects and the user clicks "Next" or "Back to Hub", stale state from the previous session SHALL NOT appear in subsequent sessions.

### Requirement 3: MatchRoom Header and Expiry Countdown

**User Story:** As a match participant, I want to see room context (encryption status, time remaining, partner info) at a glance, so I understand the session parameters.

#### Acceptance Criteria

1. THE MatchRoom SHALL render a header bar containing: (a) 🔒 E2EE lock icon, (b) ⏱️ ephemeral duration label (e.g., "60s"), (c) expiry countdown showing remaining room lifetime.
2. THE expiry countdown SHALL use the existing `ExpiryCountdown` component with `matchStore.matchExpiresAt` as the timestamp.
3. THE header SHALL display the partner's generated name (from Requirement 1) or "Waiting for partner..." if only one member is present.
4. THE header SHALL NOT display room ID, share code, or "Leave Room" button (match-specific navigation is handled by Report/Next in the bottom bar).
5. WHEN remaining time reaches 0, THE countdown SHALL display an expired state consistent with Requirement 2.3.

### Requirement 4: Server Test Compatibility (Tech Debt — Non-blocking)

**User Story:** As a developer, I want all match server tests to pass, so that CI is green and future changes can be validated.

#### Acceptance Criteria

1. ALL tests in `internal/match/server_test.go` SHALL pass by updating assertions from old `[type_byte][payload]` format to the new `{type, data}` msgpack envelope decoded via `decodeMatchMsg` helper.
2. ALL tests in `internal/match/hub_integration_test.go` SHALL pass.
3. THE `decodeMatchMsg` helper (already added) SHALL be used consistently across all test assertions that inspect sent messages.
4. Property-based tests (`TestProperty_DisconnectionCleanup`) SHALL pass with the new format.

**Priority:** Non-blocking for user-facing release. Can be addressed after Requirements 1-3.
