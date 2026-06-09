[中文](activity-ranking.md)

# Activity Ranking

## Overview

Activity Ranking is a discovery enhancement for the Hub page that helps users find the most interesting rooms quickly.

**Core capabilities:**

- **Sort modes** — Multiple ways to reorder the room list
- **Global online count** — Real-time indicator of platform activity
- **Activity tracking** — 5-minute sliding window message counting

## Sort Modes

The Hub page provides four sort modes, accessible via tabs at the top of the room list:

| Mode | Icon | Description |
|------|------|-------------|
| Most Active | 🔥 | Sort by message count in the last 5 minutes (descending) |
| Most People | 👥 | Sort by current member count (descending) |
| Newest | 🆕 | Sort by room creation time (descending) |
| All | — | Default sort order (member count priority) |

Each mode provides a different perspective on the available rooms, allowing users to discover rooms based on their preference for activity, popularity, or recency.

## Global Online Count

- **Display position:** Shown in the Hub page header area, visible at all times
- **Real-time updates:** The count refreshes every 30 seconds via polling
- **Scope:** Represents the total number of users currently connected across all Hub rooms

The online count gives users an immediate sense of platform activity before browsing individual rooms.

## Technical Details

### 5-Minute Sliding Window

The activity tracking system uses a 5-minute sliding window to calculate message activity:

- Only relay events (message forwards) are counted — the server never inspects message content
- Events older than 5 minutes are automatically discarded from the window
- The count reflects real-time activity without exposing any private data

### Privacy Protection

- The server counts relay events only; it cannot read encrypted message content
- No message content is stored or analyzed for ranking purposes
- Activity data is ephemeral and not persisted to disk

### Memory Limits

- Each room maintains a maximum of 10,000 activity records in the sliding window
- Oldest records are evicted when the limit is reached
- This prevents unbounded memory growth for highly active rooms

## Usage Guide

1. **Navigate to the Hub page** — Open the Arthas Hub to view the public room directory
2. **Click a sort mode Tab** — Select 🔥 Most Active, 👥 Most People, 🆕 Newest, or All
3. **View the sorted results** — The room list reorders according to the selected mode
4. **Observe the online count indicator** — Check the header for the current global online count

## Flow Diagram

<img src="../docs/diagrams/activity-ranking-flow.svg" alt="Activity Ranking Flow" width="900"/>

---

## Next Steps

- [Getting Started](getting-started.en.md) — Run Arthas locally
- [FAQ](faq.en.md) — Learn more about the Hub and public rooms
