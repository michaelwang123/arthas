# Requirements Document

## Introduction

Arthas Hub is a public room directory feature that adds discoverability to the Arthas E2EE ephemeral chat application. Currently, rooms can only be found by having someone share a share code directly. Arthas Hub allows room creators to opt-in to listing their room in a publicly browsable directory, enabling anyone to discover and join public rooms without receiving a share code out-of-band. Public rooms remain fully end-to-end encrypted — the encryption key is embedded in the publicly visible share code.

**Security boundary:** Public rooms deliberately expose their share code (which contains the encryption key) to enable zero-friction joining. The encryption protects against network eavesdroppers and server inspection, not against Hub visitors. Room creators who want access control should use password protection in combination with public listing, or keep rooms private.

## Glossary

- **Hub**: The public room directory page/view where users browse listed rooms
- **Public_Room**: A room whose creator opted-in to public listing; the share code (containing the encryption key) is visible in the Hub
- **Room_Creator**: The user who creates a room and decides whether to list it publicly
- **Hub_Server**: The Go WebSocket relay server extended with Hub listing capabilities
- **Hub_Client**: The React web client extended with the Hub browsing interface
- **Room_Listing**: A data record representing a public room in the Hub directory, containing metadata (title, description, tags, member count)
- **Share_Code**: A string encoding both the room ID and the AES-256 encryption key, used to join and decrypt room messages
- **Tag**: A short category label attached to a public room for filtering purposes (e.g., "golang", "react", "ama")
- **Listing_Metadata**: The set of fields describing a public room: title, description, tags, online member count, creation time, expiry info, password-protected flag
- **Room_Title**: The display name of a public room in the Hub directory (distinct from the user's nickname `name` field in the CreateRoom message)

## Requirements

### Requirement 1: Public Listing Opt-In at Room Creation

**User Story:** As a Room_Creator, I want to opt-in to listing my room publicly when I create it, so that others can discover and join my room without needing a share code from me.

#### Acceptance Criteria

1. WHEN a Room_Creator creates a room with public listing enabled, THE Hub_Server SHALL register the room in the Hub directory with the provided Listing_Metadata.
2. WHEN a Room_Creator creates a room without enabling public listing, THE Hub_Server SHALL treat the room as private and exclude it from the Hub directory.
3. THE Hub_Server SHALL require a room title (1-50 characters) for public rooms. This is distinct from the user's `name` field (nickname).
4. THE Hub_Server SHALL accept an optional room description (0-200 characters) for public rooms.
5. THE Hub_Server SHALL accept optional tags (0-5 tags, each 1-20 characters, alphanumeric and hyphens only) for public rooms.
6. IF a Room_Creator provides invalid Listing_Metadata (title too long, too many tags, invalid tag characters), THEN THE Hub_Server SHALL reject the creation request with a descriptive error.
7. WHEN a Room_Creator creates a public room with password protection enabled, THE Hub_Server SHALL include a `hasPassword: true` flag in the Room_Listing. The room remains publicly discoverable but requires a password to join.

### Requirement 2: Hub Directory Browsing

**User Story:** As a user, I want to browse all publicly listed rooms in the Hub, so that I can discover interesting conversations to join.

#### Acceptance Criteria

1. WHEN a user requests the Hub directory, THE Hub_Server SHALL return a list of all currently active Public_Rooms with their Listing_Metadata.
2. THE Hub_Server SHALL include the following fields in each Room_Listing: room title, description, tags, online member count, creation timestamp, expiry information, and hasPassword flag.
3. THE Hub_Server SHALL include the Share_Code for each Public_Room in the Room_Listing response.
4. WHEN a Public_Room becomes empty (zero members) and is destroyed, THE Hub_Server SHALL remove the Room_Listing from the Hub directory.
5. WHEN a Public_Room expires, THE Hub_Server SHALL remove the Room_Listing from the Hub directory.
6. THE Hub_Server SHALL return Room_Listings sorted by online member count in descending order, with rooms having equal member counts sorted by creation time (newest first).
7. FOR password-protected Public_Rooms, THE Hub_Server SHALL display a 🔒 indicator in the Room_Listing. The Share_Code is still included (it contains the room ID needed to join), but the join attempt will require the password.

### Requirement 3: Hub Directory Filtering and Search

**User Story:** As a user, I want to filter and search public rooms by tags and keywords, so that I can find rooms relevant to my interests.

#### Acceptance Criteria

1. WHEN a user requests the Hub directory with a tag filter, THE Hub_Server SHALL return only Public_Rooms that have at least one matching tag.
2. WHEN a user requests the Hub directory with a search query, THE Hub_Server SHALL return Public_Rooms whose title or description contains the search term (case-insensitive).
3. WHEN a user applies both a tag filter and a search query, THE Hub_Server SHALL return only Public_Rooms matching both criteria.
4. IF no Public_Rooms match the filter criteria, THEN THE Hub_Server SHALL return an empty list.

### Requirement 4: Join Public Room from Hub

**User Story:** As a user, I want to join a public room directly from the Hub by clicking on it, so that I can participate without manually entering a share code.

#### Acceptance Criteria

1. WHEN a user selects a Public_Room from the Hub, THE Hub_Client SHALL extract the Share_Code from the Room_Listing and initiate the standard room join flow.
2. WHEN a user joins a Public_Room from the Hub, THE Hub_Client SHALL decrypt messages using the encryption key embedded in the Share_Code.
3. IF a Public_Room is full (reached MaxMembers limit) when a user attempts to join, THEN THE Hub_Client SHALL display an error message indicating the room is full.
4. IF a Public_Room no longer exists when a user attempts to join, THEN THE Hub_Client SHALL display an error message and remove the stale listing from the displayed directory.
5. IF a Public_Room is password-protected, THEN THE Hub_Client SHALL prompt the user to enter the room password before completing the join flow.

### Requirement 5: Hub Web Client Interface

**User Story:** As a user, I want a dedicated Hub page in the web client where I can browse, filter, and join public rooms with an intuitive interface.

#### Acceptance Criteria

1. THE Hub_Client SHALL provide a dedicated Hub page accessible from the main navigation (e.g., a "Hub" tab or button on the home screen).
2. THE Hub_Client SHALL display each Room_Listing as a card showing: room title, description (truncated if over 100 characters), tags as badges, online member count, time since creation, and 🔒 icon for password-protected rooms.
3. THE Hub_Client SHALL display expiry information for rooms that have an expiration time set.
4. THE Hub_Client SHALL provide a tag filter interface allowing users to select one or more tags to filter the directory.
5. THE Hub_Client SHALL provide a search input for filtering rooms by title or description keywords.
6. THE Hub_Client SHALL indicate when the room list is loading and display an empty state when no public rooms are available.
7. THE Hub_Client SHALL auto-refresh the Hub directory at a regular interval (every 30 seconds) to reflect new rooms, removed rooms, and updated member counts.
8. THE Hub_Client SHALL display the total number of public rooms currently available.

### Requirement 6: Hub Server API Endpoint

**User Story:** As a client application (web, CLI, extension), I want a well-defined API endpoint to query the Hub directory, so that all clients can implement Hub browsing consistently.

#### Acceptance Criteria

1. THE Hub_Server SHALL expose an HTTP GET endpoint at `/api/hub` that returns the list of Public_Rooms as a JSON array.
2. THE Hub_Server SHALL support optional query parameters: `tag` (string, filter by tag), `q` (string, search query), `limit` (integer, max results, default 50, max 100), and `offset` (integer, pagination offset, default 0).
3. THE Hub_Server SHALL include a `total` field in the response indicating the total number of matching rooms (for pagination).
4. THE Hub_Server SHALL respond within 100ms for directories containing up to 1000 public rooms.
5. IF the Hub_Server receives an invalid query parameter value (negative limit, limit > 100), THEN THE Hub_Server SHALL return HTTP 400 with a descriptive error message.
6. THE Hub_Server SHALL set CORS headers on the `/api/hub` endpoint to allow cross-origin requests from the configured allowed origins.

### Requirement 7: Public Room Listing Protocol Extension

**User Story:** As a developer, I want the room creation protocol to support public listing metadata, so that the server knows which rooms to include in the Hub.

#### Acceptance Criteria

1. THE Hub_Server SHALL extend the CreateRoom message (0x01) data structure to accept optional fields: `public` (boolean), `title` (string), `description` (string), `tags` (string array), and `shareCode` (string, the base64url-encoded encryption key). The existing `name` field continues to represent the user's nickname. The `shareCode` field is required when `public=true` — the client sends only the encoded key; the server constructs the complete share code by combining the server-generated roomId + key + ephemeral + expiresAt.
2. WHEN the `public` field is false or absent in the CreateRoom message, THE Hub_Server SHALL create a standard private room (backward compatible with all existing clients).
3. THE Hub_Server SHALL store public room metadata in memory alongside the existing room state.
4. WHEN a Public_Room is destroyed (empty or expired), THE Hub_Server SHALL release all associated Listing_Metadata from memory.
5. THE Hub_Server SHALL validate `title` length (1-50), `description` length (0-200), and `tags` constraints (0-5 items, each 1-20 chars, alphanumeric + hyphens) at message handling time, returning an error if invalid.

### Requirement 8: Hub Rate Limiting and Abuse Prevention

**User Story:** As a server operator, I want the Hub to be protected against abuse, so that the directory remains useful and the server stays responsive.

#### Acceptance Criteria

1. THE Hub_Server SHALL limit the total number of public rooms to a configurable maximum (default: 200, configurable via `--max-public-rooms` flag).
2. IF a Room_Creator attempts to list a room publicly when the maximum is reached, THEN THE Hub_Server SHALL reject the public listing and create the room as private, returning a descriptive error.
3. THE Hub_Server SHALL rate-limit the `/api/hub` endpoint to 30 requests per minute per IP address.
4. IF a client exceeds the rate limit, THEN THE Hub_Server SHALL return HTTP 429 with a `Retry-After` header.
5. THE Hub_Server SHALL sanitize all Listing_Metadata input (strip HTML tags, trim whitespace, reject control characters).

---

## Future Enhancements (V2 — Not in Scope for MVP)

The following capabilities are intentionally deferred to reduce MVP complexity:

- **Real-Time Hub Updates via WebSocket** — Hub subscribers receive push notifications (HubRoomAdded 0x20, HubRoomRemoved 0x21, HubRoomUpdated 0x22) instead of polling. Requires server-side "browsing mode" connection management.
- **Room Categories** — Predefined categories beyond free-form tags (e.g., "Tech", "AMA", "Support").
- **Room Pinning/Featuring** — Server operator can pin rooms to the top of the Hub.
- **Hub Analytics** — Track room views, join rates for public rooms.
