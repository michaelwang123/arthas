# Requirements Document

## Introduction

Room Activity Ranking adds sorting and filtering capabilities to the Arthas Hub page so users can discover the most active, most popular, or newest public rooms. The server tracks message relay events per room using a sliding window counter (without accessing message content, preserving zero-knowledge E2EE), and exposes activity metrics via the Hub API. The frontend provides a tab-based sort mode switcher integrated with the existing HubFilters component and displays a global online count.

## Glossary

- **Hub_API**: The HTTP GET endpoint (`/api/hub`) that returns paginated public room listings to the frontend.
- **Hub_Page**: The React page component (`Hub.tsx`) that displays the public room directory with search, filters, and room cards.
- **HubFilters_Component**: The React component (`HubFilters.tsx`) providing search and tag filter UI for the Hub page.
- **Activity_Tracker**: A server-side module that counts message relay events per room within a 5-minute sliding window.
- **Sliding_Window**: A time-based counter mechanism that tracks event counts within the most recent 5 minutes, discarding older data.
- **Sort_Mode**: One of four display orderings for rooms: "active" (message volume), "people" (online member count), "newest" (creation time), or "default" (current behavior).
- **Hub_Registry**: The in-memory registry (`HubRegistry`) storing public room metadata and serving listing queries.
- **Message_Relay_Event**: The server-side event triggered each time a `MsgSendMessage` is routed to a public room registered in the Hub_Registry, counted without accessing encrypted content.
- **Online_Count**: The total number of currently connected WebSocket clients across all rooms (public and private), displayed as a global statistic on the Hub page to indicate overall community presence.
- **Public_Room**: A room registered in the Hub_Registry that appears in the Hub directory listing.

## Requirements

### Requirement 1: Server-Side Message Activity Tracking

**User Story:** As a Hub visitor, I want to see which rooms have the most chat activity, so that I can join conversations that are actively happening.

#### Acceptance Criteria

1. WHEN a Message_Relay_Event occurs in a Public_Room, THE Activity_Tracker SHALL increment the message count for that room.
2. THE Activity_Tracker SHALL maintain a Sliding_Window of 5 minutes for each room's message count.
3. WHEN 5 minutes have elapsed since a Message_Relay_Event, THE Activity_Tracker SHALL no longer include that event in the room's message count.
4. THE Activity_Tracker SHALL store only event timestamps and counts, without accessing or storing any message content.
5. WHEN a room is removed from the Hub_Registry, THE Activity_Tracker SHALL discard the activity data for that room.
6. THE Activity_Tracker SHALL operate with O(1) amortized time complexity per increment operation.
7. THE Activity_Tracker SHALL only track rooms that are registered in the Hub_Registry (Public_Rooms). Private rooms SHALL NOT be tracked.
8. THE Activity_Tracker SHALL NOT count `MsgSendReaction` events toward the message count, because reactions have no rate limiting and could be used to artificially inflate activity rankings.

### Requirement 2: Hub API Activity Metrics

**User Story:** As a frontend developer, I want the Hub API to return activity metrics alongside room data, so that I can implement sort modes on the client.

#### Acceptance Criteria

1. THE Hub_API SHALL include a `messageCount5min` integer field in each room listing response, representing the current Sliding_Window message count for that room.
2. THE Hub_API SHALL accept a `sort` query parameter with values: `active`, `people`, `newest`, or empty (default behavior).
3. WHEN the `sort` parameter is `active`, THE Hub_API SHALL return rooms ordered by `messageCount5min` descending, with ties broken by `memberCount` descending.
4. WHEN the `sort` parameter is `people`, THE Hub_API SHALL return rooms ordered by `memberCount` descending, with ties broken by `messageCount5min` descending.
5. WHEN the `sort` parameter is `newest`, THE Hub_API SHALL return rooms ordered by `createdAt` descending.
6. WHEN the `sort` parameter is empty or absent, THE Hub_API SHALL use the existing default sort order (memberCount descending, then createdAt descending).
7. IF the `sort` parameter contains an unrecognized value, THEN THE Hub_API SHALL ignore it and use the default sort order.
8. IF the Activity_Tracker has recently restarted or is otherwise unavailable, THE Hub_API SHALL return `messageCount5min` as 0 for all rooms (graceful degradation).

### Requirement 3: Hub API Global Online Count

**User Story:** As a Hub visitor, I want to see how many people are online across all rooms, so that I can gauge community activity at a glance.

#### Acceptance Criteria

1. THE Hub_API SHALL include a `totalOnline` integer field in the listing response, representing the total number of currently connected WebSocket clients across all rooms (both public and private).
2. THE Hub_API SHALL compute `totalOnline` at request time from the Hub's connected client count.
3. WHEN no clients are connected, THE Hub_API SHALL return `totalOnline` as 0.
4. NOTE: `totalOnline` intentionally includes all connected clients (public and private rooms) to represent overall community presence. This is acceptable because it does not reveal which rooms are private or how many users are in any specific private room.

### Requirement 4: Frontend Sort Mode Switcher

**User Story:** As a Hub visitor, I want to switch between different sort modes using visible tabs, so that I can discover rooms based on what matters to me.

#### Acceptance Criteria

1. THE HubFilters_Component SHALL display a row of sort mode buttons with labels: 🔥 Most Active, 👥 Most People, 🆕 Newest, and All (default).
2. WHEN a user clicks a sort mode button, THE Hub_Page SHALL send a request to the Hub_API with the corresponding `sort` parameter value.
3. THE HubFilters_Component SHALL visually indicate the currently active sort mode button with a distinct selected style.
4. WHEN the Hub_Page loads initially, THE HubFilters_Component SHALL display the "All" sort mode as active.
5. WHEN a user switches sort mode, THE Hub_Page SHALL reset pagination to the first page.
6. THE sort mode selection SHALL persist across the 30-second polling cycle, so that subsequent polls use the same sort mode.
7. THE sort mode buttons SHALL use `aria-pressed` attribute to indicate active state for screen reader accessibility.
8. WHEN a sort mode change occurs, THE Hub_Page SHALL announce the change to assistive technologies via an `aria-live` region.

### Requirement 5: Global Online Count Display

**User Story:** As a Hub visitor, I want to see a "N people online now" indicator on the Hub page, so that I know the community is active.

#### Acceptance Criteria

1. THE Hub_Page SHALL display the `totalOnline` value from the Hub_API response as a visible statistic near the page header.
2. THE Hub_Page SHALL update the displayed online count each time the 30-second polling cycle completes.
3. WHEN `totalOnline` is 0, THE Hub_Page SHALL display "0" with appropriate text rather than hiding the indicator.
4. THE Hub_Page SHALL display the online count with an appropriate icon (such as a green dot or people icon) for visual clarity.

### Requirement 6: Internationalization Support

**User Story:** As a user who speaks Chinese, English, or Japanese, I want the sort mode labels and online count text to appear in my language, so that the feature is accessible to me.

#### Acceptance Criteria

1. THE Hub_Page SHALL display sort mode button labels using i18n translation keys for zh, en, and ja locales.
2. THE Hub_Page SHALL display the online count text using i18n translation keys that support interpolation (using `{{count}}` syntax) for the count value.
3. WHEN a new locale is active, THE Hub_Page SHALL render all sort-related and online-count text in the active locale without page reload.

### Requirement 7: Integration with Existing Polling Mechanism

**User Story:** As a developer, I want the activity ranking feature to work within the existing 30-second polling mechanism, so that no additional WebSocket infrastructure is needed for the Hub page.

#### Acceptance Criteria

1. THE Hub_Page SHALL use the existing 30-second polling interval to refresh room listings with activity data.
2. THE Hub_Page SHALL include the current sort mode in each polling request to the Hub_API.
3. THE Activity_Tracker SHALL update its counters in real-time as messages are relayed, so that the next poll response reflects current activity.
4. THE Hub_Page SHALL NOT establish a WebSocket connection for activity data; the existing HTTP polling mechanism SHALL be the sole data transport for Hub listings.

### Requirement 8: Sliding Window Memory Management

**User Story:** As a server operator, I want the activity tracking to use bounded memory, so that the server remains stable regardless of message volume.

#### Acceptance Criteria

1. THE Activity_Tracker SHALL discard event timestamps older than 5 minutes during each count query or periodic cleanup.
2. WHILE a room has zero message activity for more than 5 minutes, THE Activity_Tracker SHALL report a count of 0 for that room.
3. THE Activity_Tracker SHALL use at most O(N) memory where N is the number of events within the current 5-minute window across all tracked rooms.
4. IF a room accumulates more than 10,000 events within 5 minutes, THEN THE Activity_Tracker SHALL evict the oldest timestamp and insert the newest timestamp (ring buffer semantics), maintaining exactly 10,000 stored timestamps and reporting the count as 10,000.
5. THE ring buffer eviction strategy ensures that the sliding window always reflects the most recent 10,000 events, preserving accuracy for highly active rooms even during sustained bursts.
