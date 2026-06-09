# Requirements Document

## Introduction

Random Match（随机配对聊天）是 Arthas Hub 的核心增长功能，让用户无需分享码即可与陌生人建立加密对话。用户点击"随机配对"按钮后，系统从当前匹配队列中匹配一位对等用户，自动创建临时 1v1 加密房间，双方加入后即可聊天。房间默认 30 分钟过期并启用阅后即焚，聊完即走，不留痕迹。

该功能定位为"加密版 Omegle"——在 Omegle 关闭后填补市场空白，利用 Arthas 的无注册 + E2EE + 阅后即焚优势，提供安全、匿名的随机聊天体验。

**冷启动策略：** 随机配对依赖同时在线用户的存在。在用户基数较低的阶段，系统通过邀请链接机制将"被动等待"转化为"主动拉人"，同时创造病毒传播路径。入口处的在线人数信号帮助用户在进入队列前设定合理预期。

**安全模型：** 配对成功后，由客户端 A（先入队方）生成 AES-256 密钥，服务器将密钥转发给客户端 B。服务器仅作为中转通道，不作为密钥来源方。这与普通 Arthas 房间的"客户端生成密钥"模型保持一致，确保 zero-knowledge 承诺不因匹配功能而降级。

**房间隔离：** Match_Room 是私有 1v1 房间，不注册到 HubRegistry，不出现在 Hub 公开列表，不计入 `maxPublicRooms` 配额。其 RoomManager 生命周期与普通房间一致。

## Glossary

- **Match_Queue**: 服务端维护的匹配等待队列，存储正在等待配对的客户端连接信息
- **Match_Server**: Go 服务端的匹配模块，负责队列管理、配对逻辑和房间创建协调
- **Match_Client**: React 客户端的匹配 UI 模块，负责等待界面、动画和状态管理
- **Match_Entry**: 匹配队列中的单条记录，包含客户端连接引用、兴趣标签和入队时间
- **Interest_Tag**: 用户在进入匹配前可选择的兴趣标签（如 #tech #music #random），影响匹配优先级
- **Match_Room**: 配对成功后自动创建的临时 1v1 加密房间，默认 30 分钟过期 + 阅后即焚，不注册到 HubRegistry
- **Match_Timeout**: 用户在匹配队列中等待的最大时间（60 秒），超时后触发冷启动降级路径
- **Invite_Link**: 冷启动机制——用户生成专属匹配链接，任何打开该链接的人自动与发起者配对
- **Cooldown_Period**: 用户完成一次匹配（或主动取消）后再次进入队列的最短等待时间
- **Session_Loop**: match → chat → next → match 的连续会话循环，用户无需返回 Hub 页面即可进入下一次匹配

## Requirements

### Requirement 1: Match Queue Entry

**User Story:** As a user, I want to enter the match queue by clicking a button, so that the system can find me a random chat partner.

#### Acceptance Criteria

1. WHEN a user clicks the "Random Match" button on the Hub page, THE Match_Client SHALL send a match request to the Match_Server via the WebSocket connection (establishing the connection first if not already connected).
2. THE Match_Server SHALL add the user's Match_Entry to the Match_Queue with the current timestamp and optional Interest_Tags.
3. IF the user is already in the Match_Queue, THEN THE Match_Server SHALL reject the duplicate entry request and return a descriptive error.
4. IF the user is currently in an active room, THEN THE Match_Server SHALL reject the match request and return a descriptive error indicating the user must leave the current room first.
5. WHILE a user is in the Match_Queue, THE Match_Client SHALL display a waiting state with an animated indicator and elapsed wait time.
6. WHEN a user clicks "Cancel" during the waiting state, THE Match_Client SHALL send a cancel request to the Match_Server and exit the waiting state.
7. WHEN a cancel request is received, THE Match_Server SHALL remove the user's Match_Entry from the Match_Queue immediately.

### Requirement 2: Matching Algorithm

**User Story:** As a user, I want to be paired with another online user quickly and fairly, so that I can start chatting without long waits.

#### Acceptance Criteria

1. WHEN the Match_Queue contains two or more users, THE Match_Server SHALL attempt to pair users, preferring pairs with Interest_Tag overlap (users sharing at least one common tag are preferred).
2. IF no Interest_Tag overlap exists between any queued users, THEN THE Match_Server SHALL fall back to FIFO ordering (longest-waiting user paired first).
3. WHEN a user has waited longer than 10 seconds without a tag-based match, THE Match_Server SHALL pair the user with the next available user regardless of Interest_Tags.
4. THE Match_Server SHALL execute matching checks at a regular interval (every 1 second) to minimize latency between user entry and successful pairing.
5. THE Match_Server SHALL guarantee that each user can only be matched once per queue entry (no duplicate pairings).
6. WHEN two users are paired, THE Match_Server SHALL remove both Match_Entries from the Match_Queue atomically.

### Requirement 3: Room Creation and Key Exchange on Match Success

**User Story:** As a paired user, I want the system to automatically create an encrypted room and join both participants with proper E2EE key exchange, so that we can start chatting immediately with zero-knowledge guarantees.

#### Acceptance Criteria

1. WHEN two users are successfully paired, THE Match_Server SHALL designate the user who entered the queue first as the "key generator" (Client A) and notify Client A to generate an AES-256 encryption key.
2. WHEN Client A generates the key, THE Match_Client SHALL send the base64url-encoded key to the Match_Server for relay to Client B. THE Match_Server SHALL NOT persist or log the key material.
3. THE Match_Server SHALL create a temporary room with the following defaults: 30-minute expiry, 60-second ephemeral (burn-after-read) timer, maximum 2 members. THE Match_Room SHALL NOT be registered in the HubRegistry and SHALL NOT count toward the `maxPublicRooms` quota.
4. WHEN the Match_Room is created and both clients have the key, THE Match_Server SHALL send a match-success notification to both clients containing the room ID. THE Match_Client SHALL automatically navigate the user to the Match_Room chat interface.
5. THE Match_Room SHALL function identically to a standard Arthas E2EE room (supporting text messages, reactions, typing indicators, and file transfer).
6. IF room creation or key exchange fails, THEN THE Match_Server SHALL notify both users with a descriptive error and return them to the Match_Queue (auto re-queue) rather than dumping them back to the Hub page.

### Requirement 4: Match Timeout and Cold-Start Fallback

**User Story:** As a user, I want meaningful options when no match is found, so that I am not left with a dead end.

#### Acceptance Criteria

1. WHEN a user has been in the Match_Queue for 60 seconds without a successful match, THE Match_Server SHALL remove the user's Match_Entry from the queue and send a timeout notification.
2. WHEN the Match_Client receives a timeout notification, THE Match_Client SHALL display a timeout state offering three actions: "Try Again" (re-enter queue), "Invite a Friend" (generate Invite_Link), and "Back to Hub".
3. THE Match_Client SHALL display an elapsed timer showing how long the user has been waiting, updated every second.
4. WHEN the user selects "Invite a Friend", THE Match_Client SHALL generate an Invite_Link and display sharing options (copy to clipboard, or native share API on mobile).

### Requirement 5: Interest Tag Selection

**User Story:** As a user, I want to optionally select interest tags before matching, so that I have a higher chance of being paired with someone who shares my interests.

#### Acceptance Criteria

1. THE Match_Client SHALL provide an optional interest tag selection interface before entering the match queue, with predefined tags: #tech, #music, #gaming, #random, #language, #movies.
2. THE Match_Client SHALL allow selecting 0 to 3 Interest_Tags per match request.
3. WHEN a user selects 0 tags, THE Match_Server SHALL treat the user as available for pairing with any other user (no tag preference).
4. THE Match_Client SHALL persist the user's last-selected Interest_Tags in local storage for convenience on subsequent visits.
5. THE Match_Server SHALL validate that submitted tags belong to the predefined set and contain no more than 3 tags.
6. IF submitted Interest_Tags are invalid, THEN THE Match_Server SHALL reject the match request with a descriptive error.

### Requirement 6: WebSocket Protocol Extension

**User Story:** As a developer, I want a well-defined protocol extension for match messaging, so that the feature integrates cleanly with the existing WebSocket communication layer.

#### Acceptance Criteria

1. THE Match_Server SHALL extend the WebSocket protocol with new message types for match operations: MatchRequest (client → server), MatchCancel (client → server), MatchKeyRelay (client → server, carries generated AES key), MatchFound (server → client), MatchTimeout (server → client), MatchError (server → client), and MatchGenerateKey (server → client, instructs Client A to generate key).
2. THE Match_Server SHALL assign message type IDs from currently unoccupied ranges in the protocol, verified against the existing message type registry at implementation time to avoid conflicts.
3. WHEN a MatchRequest message is received, THE Match_Server SHALL validate that the client has an active WebSocket connection and is not already in a room or queue.
4. WHEN a MatchFound message is sent, THE Match_Server SHALL include the room ID, room expiry timestamp, and ephemeral duration in the message payload. The AES key SHALL be relayed separately via MatchKeyRelay to maintain key exchange isolation.
5. THE Match_Server SHALL serialize all match-related messages using MessagePack format consistent with the existing protocol.

### Requirement 7: Rate Limiting

**User Story:** As a server operator, I want to prevent excessive match requests, so that the system remains stable and responsive.

#### Acceptance Criteria

1. THE Match_Server SHALL enforce a cooldown period of 10 seconds between consecutive match requests from the same WebSocket connection.
2. IF a client sends a MatchRequest during the cooldown period, THEN THE Match_Server SHALL reject the request with a descriptive error including the remaining cooldown time.
3. THE Match_Server SHALL rate-limit match requests to a maximum of 20 per hour per IP address.
4. IF a client exceeds the hourly match rate limit, THEN THE Match_Server SHALL reject the request and return an error with a Retry-After duration.

### Requirement 8: Report and Block System

**User Story:** As a user, I want to report abusive match partners, so that the community remains safe without requiring user accounts.

#### Acceptance Criteria

1. THE Match_Client SHALL display a "Report" button within the Match_Room interface (accessible but not prominent, to avoid accidental reports).
2. WHEN a user reports their match partner, THE Match_Client SHALL send a report request to the Match_Server containing the reported user's connection identifier and a reason category (harassment, spam, inappropriate content, other).
3. THE Match_Server SHALL atomically record the report and increment the report count for the reported IP address. WHEN an IP accumulates 3 or more reports within 24 hours, THE Match_Server SHALL add the IP to an in-memory block list.
4. THE Match_Server SHALL prevent blocked IPs from entering the Match_Queue for a configurable duration (default: 24 hours).
5. THE Match_Server SHALL limit the Match_Queue size to a configurable maximum (default: 100) to prevent memory exhaustion. IF the queue is full, THEN THE Match_Server SHALL reject new entries with a "system busy" error.

### Requirement 9: Match UI and User Experience

**User Story:** As a user, I want a polished and intuitive matching interface, so that the experience feels fun and engaging.

#### Acceptance Criteria

1. THE Match_Client SHALL display a prominent "Random Match" entry point on the Hub page with a visually distinct button or card.
2. THE Match_Client SHALL display the current totalOnline count (from Hub API) near the "Random Match" entry point, so users can gauge match likelihood before entering the queue.
3. WHILE a user is waiting for a match, THE Match_Client SHALL display an animated waiting indicator (pulsing or orbiting animation) and elapsed wait time in seconds.
4. WHEN a match is found, THE Match_Client SHALL display a "Match Found!" success animation lasting 1-2 seconds before automatically navigating to the Match_Room.
5. THE Match_Client SHALL provide a visible "Cancel" button during the waiting state, allowing users to exit the queue at any time.
6. THE Match_Client SHALL support all three locales (zh, en, ja) for all match-related UI text and notifications.
7. THE Match_Client SHALL be fully accessible with keyboard navigation (Enter to start match, Escape to cancel) and appropriate ARIA labels for screen readers.

### Requirement 10: Client Disconnection Handling

**User Story:** As a user, I want the system to handle disconnections gracefully during matching, so that abandoned entries do not pollute the queue.

#### Acceptance Criteria

1. WHEN a client disconnects while in the Match_Queue, THE Match_Server SHALL automatically remove the user's Match_Entry from the queue within 5 seconds.
2. WHEN a client disconnects after being paired but before entering the Match_Room, THE Match_Server SHALL notify the remaining partner and return them to the Match_Queue (auto re-queue) with a "partner disconnected" message.
3. WHEN a client reconnects after disconnection, THE Match_Client SHALL NOT automatically re-enter the Match_Queue (user must explicitly click the match button again).
4. IF one participant leaves the Match_Room before either user has sent a message, THEN THE Match_Client SHALL display a "partner left" message to the remaining user and offer to re-enter the match queue. IF both users have exchanged at least one message each, THE Match_Client SHALL treat the departure as a normal room leave (the match was established).

### Requirement 11: Invite Link (Cold-Start Mechanism)

**User Story:** As a user waiting in an empty queue, I want to generate an invite link that brings someone directly into a match with me, so that I can proactively find a chat partner instead of passively waiting.

#### Acceptance Criteria

1. WHEN a user is in the Match_Queue and no other users are available, THE Match_Client SHALL prominently display an "Invite a Friend" option alongside the waiting animation.
2. WHEN a user clicks "Invite a Friend", THE Match_Server SHALL generate a unique, single-use Invite_Link token and associate it with the user's Match_Entry.
3. WHEN another user opens an Invite_Link, THE Match_Client SHALL automatically connect to the server and pair with the link creator — bypassing the normal queue entirely.
4. THE Invite_Link SHALL expire after 5 minutes or upon successful use, whichever comes first.
5. IF the link creator has already been matched or left the queue when the invitee opens the link, THE Match_Client SHALL display a "link expired" message and offer to enter the regular match queue.
6. THE Match_Client SHALL provide copy-to-clipboard functionality and, where supported, the Web Share API for native sharing on mobile devices.
7. THE Invite_Link URL format SHALL be: `{baseUrl}/match/{token}` — a clean, shareable URL with no sensitive information exposed.

### Requirement 12: Session Loop ("Next" Button)

**User Story:** As a user in a match room, I want to quickly move to the next random match without returning to the Hub page, so that I can have a continuous discovery experience.

#### Acceptance Criteria

1. THE Match_Client SHALL display a "Next" button within the Match_Room interface, visually distinct from other room controls.
2. WHEN a user clicks "Next", THE Match_Client SHALL leave the current Match_Room and automatically re-enter the Match_Queue with the same Interest_Tags used for the current session.
3. WHEN a user clicks "Next", THE Match_Server SHALL handle the room leave normally (the other participant sees "partner left") and process the new match request as a standard queue entry.
4. THE "Next" button SHALL apply the same cooldown period as a regular match request (10 seconds between matches).
5. IF both participants click "Next" simultaneously, each SHALL independently re-enter the queue. THE Match_Server SHALL NOT re-match them with each other (exclude recent partners for the current session).

### Requirement 13: Room Extension (Mutual Consent)

**User Story:** As a user having a good conversation, I want to extend the match room's expiry when both parties agree, so that meaningful conversations are not interrupted by the timer.

#### Acceptance Criteria

1. WHEN the Match_Room has 5 minutes or less remaining before expiry, THE Match_Client SHALL display an "Extend" prompt to both users.
2. WHEN one user clicks "Extend", THE Match_Client SHALL notify the other user that an extension has been proposed.
3. WHEN both users have clicked "Extend" (mutual consent), THE Match_Server SHALL extend the room expiry by 30 additional minutes.
4. THE room extension SHALL be limited to a maximum of 3 extensions per Match_Room (total maximum lifetime: 2 hours).
5. IF one user does not respond to the extension proposal within 60 seconds, the proposal SHALL expire silently and the room continues with its original expiry.

### Requirement 14: Match Feature Configuration

**User Story:** As a server operator, I want to configure match feature parameters, so that I can tune the feature for my deployment's needs or disable it entirely.

#### Acceptance Criteria

1. THE Match_Server SHALL support a `--disable-random-match` flag and `DISABLE_RANDOM_MATCH` environment variable to completely disable the feature.
2. WHILE the random match feature is disabled, THE Match_Server SHALL reject all match-related messages with a "feature disabled" error.
3. WHILE the random match feature is disabled, THE Match_Client SHALL hide the "Random Match" entry point from the Hub page.
4. THE Match_Server SHALL support configurable parameters via flags/environment variables: match timeout duration (default: 60s), room expiry duration (default: 30min), ephemeral duration (default: 60s), max queue size (default: 100), hourly rate limit per IP (default: 20), cooldown period (default: 10s), block duration (default: 24h), max room extensions (default: 3).
5. THE Match_Server SHALL validate all configuration values at startup and fail-fast with descriptive error messages if any parameter is invalid.
