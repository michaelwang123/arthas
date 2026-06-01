// Arthas Chrome Extension - Service Worker (MV3)
// Badge management only — no persistent connections

// CRITICAL: Allow popup to access chrome.storage.session
// Without this, only the service worker can read/write session storage
chrome.storage.session.setAccessLevel({
  accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
});

// Badge color constant
const BADGE_COLOR = '#6366f1';
const BADGE_TEXT = '●';

/**
 * Set the badge to indicate an active session exists.
 */
function setBadgeActive(): void {
  chrome.action.setBadgeText({ text: BADGE_TEXT });
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
}

/**
 * Clear the badge (no active session indicator).
 */
function clearBadge(): void {
  chrome.action.setBadgeText({ text: '' });
}

/**
 * Check if a session exists and set badge accordingly.
 * NOTE: Session data is stored under the 'session' key as a nested object
 * (see src/utils/storage.ts — SESSION_KEY = 'session').
 */
async function restoreBadgeIfSessionActive(): Promise<void> {
  const result = await chrome.storage.session.get('session');
  const session = result['session'] as { roomId?: string } | undefined;
  if (session?.roomId) {
    setBadgeActive();
  }
}

// Listen for messages from popup to set/clear badge
chrome.runtime.onMessage.addListener(
  (message: { type: string; text?: string }, _sender, sendResponse) => {
    if (message.type === 'SET_BADGE') {
      chrome.action.setBadgeText({ text: message.text ?? BADGE_TEXT });
      chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    } else if (message.type === 'CLEAR_BADGE') {
      clearBadge();
    }
    sendResponse({ ok: true });
  }
);

// On install/update: set access level and check badge state
chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'
  });
  await restoreBadgeIfSessionActive();
});

// On browser startup: check if session exists and set badge
chrome.runtime.onStartup.addListener(async () => {
  await restoreBadgeIfSessionActive();
});

// Badge lifecycle via port-based popup detection:
// The popup connects a port on open; when the port disconnects (popup closed),
// the service worker sets the badge if session state exists.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    // Popup opened — clear badge
    clearBadge();

    port.onDisconnect.addListener(async () => {
      // Popup closed — set badge if session active
      await restoreBadgeIfSessionActive();
    });
  }
});
