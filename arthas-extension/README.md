# Arthas Chrome Extension

[中文](README.zh.md) | English

> E2EE ephemeral chat in your browser toolbar. Same protocol as the web app and CLI — fully interoperable.

---

## Architecture

<p align="center">
  <img src="docs/architecture.svg" alt="Extension Architecture" width="800"/>
</p>

---

## Features

| Feature | Description |
|---------|-------------|
| 🔒 E2EE | AES-256-GCM + Ed25519, keys never leave the popup |
| 💬 Real-time Chat | WebSocket + MessagePack binary protocol |
| 🔄 Session Resume | Close popup, reopen — auto-reconnect to room |
| 🌐 i18n | English / Chinese / Japanese |
| 🤝 Interoperable | Same room works across web, CLI, and extension |

---

## Known Limitations

| Limitation | Reason | Workaround |
|-----------|--------|------------|
| Messages missed while popup closed | WebSocket disconnects when popup closes (Chrome platform constraint) | Use the [web app](https://arthas-blush.vercel.app/) for persistent connections |
| Single session per browser | Extension shares one `chrome.storage` instance | Use web app in incognito for second user |
| No offline message queue | Server stores nothing by design (zero-knowledge) | Keep popup open during active conversation |

---

## Build from Source

### Prerequisites

- Node.js 18+
- npm 9+

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/michaelwang123/arthas.git
cd arthas/arthas-extension

# 2. Install dependencies
npm install

# 3. Build production bundle
npm run build

# 4. Output in dist/ — ready to load into Chrome
```

### Development Mode

```bash
# Start Vite dev server with HMR (for development)
npm run dev
```

Then load the root `arthas-extension/` directory (not `dist/`) as an unpacked extension — `@crxjs/vite-plugin` handles HMR for the popup.

---

## Install in Chrome

<table>
<tr>
<td width="40"><strong>1</strong></td>
<td>Open <code>chrome://extensions/</code></td>
</tr>
<tr>
<td><strong>2</strong></td>
<td>Enable <strong>Developer mode</strong> (top-right toggle)</td>
</tr>
<tr>
<td><strong>3</strong></td>
<td>Click <strong>Load unpacked</strong></td>
</tr>
<tr>
<td><strong>4</strong></td>
<td>Select the <code>arthas-extension/dist/</code> folder</td>
</tr>
<tr>
<td><strong>5</strong></td>
<td>Click the extension icon in toolbar → Settings ⚙️ → Set server URL</td>
</tr>
</table>

**Server URL for the public demo server:**

```
wss://arthas100-arthas-server.hf.space/ws
```

---

## Usage

1. Enter a nickname (1–20 characters)
2. Click **Create Room** — generates AES-256 key locally, connects to server
3. Copy the share code → send to another person
4. They join via web app, CLI, or another extension instance
5. Chat with end-to-end encryption

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 18 + TypeScript |
| State | Zustand |
| Styling | Tailwind CSS |
| Build | Vite 5 + @crxjs/vite-plugin |
| Crypto | Web Crypto API (AES-256-GCM, Ed25519) |
| Protocol | WebSocket + MessagePack |
| Storage | chrome.storage.session (keys) + chrome.storage.local (settings) |

---

## Project Structure

```
arthas-extension/
├── src/
│   ├── popup/          # Popup entry point (HTML)
│   ├── pages/          # React page components (Home, Chat, Settings)
│   ├── components/     # Shared UI components
│   ├── stores/         # Zustand store (chatStore)
│   ├── crypto/         # AES-256-GCM + Ed25519 wrappers
│   ├── network/        # WebSocket client + protocol definitions
│   ├── i18n/           # Internationalization strings
│   ├── utils/          # Chrome storage helpers
│   └── background/     # Service worker (minimal)
├── public/             # Extension icons
├── dist/               # Build output (load this in Chrome)
├── manifest.json       # Chrome extension manifest (MV3)
├── vite.config.ts      # Vite + CRXJS config
└── package.json
```

---

## License

AGPL-3.0 — same as the main Arthas project.
