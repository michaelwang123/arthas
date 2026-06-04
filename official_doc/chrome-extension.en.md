# Chrome Extension Guide

[中文](chrome-extension.md) | English

> End-to-end encrypted chat in your browser toolbar — same protocol as the web app and CLI.

**Quick Start:** `git clone` → `cd arthas-extension` → `npm install` → `npm run build` → Load `dist/` in Chrome → Set server URL → Chat with E2EE.

---

## Overview

The Arthas Chrome Extension brings E2EE ephemeral chat directly into your browser toolbar. Click the icon, enter a nickname, and start an encrypted conversation. No new tabs, no separate app — just a popup that connects to the same Arthas server.

<p align="center">
  <img src="../docs/diagrams/chrome-extension-usage.svg" alt="Extension Usage Flow" width="900"/>
</p>

---

## Build from Source

<p align="center">
  <img src="../docs/diagrams/chrome-extension-flow.svg" alt="Build & Install Flow" width="900"/>
</p>

### Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 18+ | JavaScript runtime |
| npm | 9+ | Package manager |
| Chrome | 116+ | Manifest V3 + chrome.storage.session |

### Step 1 — Clone & Install

```bash
git clone https://github.com/michaelwang123/arthas.git
cd arthas/arthas-extension
npm install
```

This installs all dependencies including React, Vite, and the CRXJS plugin that handles Chrome extension bundling.

### Step 2 — Build

```bash
npm run build
```

**What happens:**
1. TypeScript compiles to JavaScript (`tsc`)
2. Vite bundles the popup, background worker, and assets
3. CRXJS transforms `manifest.json` for production
4. Output lands in `dist/` (~210KB total)

### Step 3 — Load into Chrome

1. Open `chrome://extensions/`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Navigate to and select `arthas-extension/dist/`
5. The Arthas icon appears in your toolbar

### Step 4 — Configure Server

1. Click the Arthas icon → Settings ⚙️
2. Enter server URL:
   ```
   wss://arthas100-arthas-server.hf.space/ws
   ```
3. Click **Save** → **Test Connection** → should show ✓ Connected
4. Go back to home screen

---

## Usage

### Create a Room

1. Enter a nickname (1–20 characters)
2. Click **Create Room**
3. The extension generates an AES-256 key locally and connects to the server
4. A share code appears — copy it and send to your chat partner
5. Start typing — messages are encrypted before leaving the browser

### Join a Room

1. Paste the share code you received into the "Join Room" field
2. Enter your nickname
3. Click **Join**
4. You're in — all messages are end-to-end encrypted

### Interoperability

The share code works across all Arthas clients:

| Created with | Joined with | Works? |
|-------------|-------------|--------|
| Extension | Web App | ✅ |
| Extension | CLI | ✅ |
| Web App | Extension | ✅ |
| CLI | Extension | ✅ |

All clients use the same AES-256-GCM + MessagePack protocol.

---

## Session Behavior

| State | Connection | Messages |
|-------|-----------|----------|
| Popup open | ● Connected | Sending & receiving |
| Popup closed (room has 2+ members) | ○ Disconnected | Missed (not stored) |
| Popup reopened | ● Auto-rejoin | Resumes receiving |
| Popup closed (you were the only member) | ○ Disconnected | Room destroyed |

**Key points:**
- Messages sent while popup is closed **cannot be recovered** — this is by design (zero-knowledge server)
- If other members are still in the room, the room survives your disconnection
- Reopening the popup auto-reconnects and resumes the session
- For persistent connections, use the [web app](https://arthas-blush.vercel.app/) instead

---

## Development Mode

For active development with hot module replacement:

```bash
npm run dev
```

Then load the **root** `arthas-extension/` directory (not `dist/`) as an unpacked extension. The `@crxjs/vite-plugin` provides HMR — changes to popup code reflect immediately without manually reloading.

### Running Tests

```bash
npm run test        # Single run
npm run test:watch  # Watch mode
```

Tests use Vitest + Testing Library + happy-dom for component testing and fast-check for property-based crypto tests.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Chrome Extension (Manifest V3)                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  Popup   │◄──►│ chrome.storage│    │ Web Crypto   │  │
│  │  (React) │    │  .session    │    │   API        │  │
│  └────┬─────┘    │  .local      │    │ AES-256-GCM  │  │
│       │          └──────────────┘    │ Ed25519      │  │
│       │                              └──────────────┘  │
│       │ WebSocket (MessagePack)                         │
├───────┼─────────────────────────────────────────────────┤
        │
        ▼
┌───────────────┐
│ Arthas Server │  ← Only sees encrypted blobs
│  (Go relay)   │
└───────────────┘
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Create Room" does nothing | Check server URL in Settings. Test connection first. |
| "Room session expired" on reopen | Room was destroyed (you were the last member). Create a new room. |
| No console output on click | Rebuild with `npm run build`, then refresh extension in chrome://extensions/ |
| WebSocket error in console | Server may be cold-starting (HF Spaces). Wait 30s and retry. |

---

## License

AGPL-3.0 — same as the main Arthas project.
