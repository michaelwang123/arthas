/**
 * @file websocket.ts — Extension-specific WebSocket client with reconnection logic
 *
 * Manages the WebSocket connection lifecycle for the Chrome extension popup.
 * Key differences from arthas-client:
 * - Tracks ConnectionState with status and consecutiveFailures
 * - Stops retrying after 5 consecutive failures (status → 'failed')
 * - Exposes onStateChange for store subscription
 * - Exposes calculateBackoff for testability
 *
 * Reference: arthas-client/src/network/websocket.ts
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import { encode, decode } from '@msgpack/msgpack';
import { MSG_PING, MSG_PONG, type Message } from './protocol';

// ===== Configuration =====

const MAX_CONSECUTIVE_FAILURES = 5;

// ===== Types =====

export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
  consecutiveFailures: number;
}

// ===== State =====

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let messageHandler: ((msg: Message) => void) | null = null;
let shouldReconnect = true;
let currentUrl = '';

/** Set of state change listeners (supports multiple subscribers). */
const stateChangeListeners = new Set<(state: ConnectionState) => void>();

let connectionState: ConnectionState = {
  status: 'disconnected',
  consecutiveFailures: 0,
};

// ===== Public API =====

/**
 * Calculate exponential backoff delay for a given number of consecutive failures.
 * Formula: min(2^(n-1) × 1000, 30000) ms where n = failures count.
 * Exported for testability (Property 8).
 */
export function calculateBackoff(failures: number): number {
  if (failures <= 0) return 1000;
  const delay = Math.pow(2, failures - 1) * 1000;
  return Math.min(delay, 30000);
}

/**
 * Establish a WebSocket connection to the given URL.
 * Sets shouldReconnect=true so dropped connections trigger auto-reconnect.
 */
export function connect(url: string): void {
  currentUrl = url;
  shouldReconnect = true;

  // Clear any pending reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Close existing connection if any
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    ws.close();
    ws = null;
  }

  updateState({
    status: 'connecting',
    consecutiveFailures: connectionState.consecutiveFailures,
  });

  try {
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      updateState({
        status: 'connected',
        consecutiveFailures: 0,
      });
    };

    ws.onmessage = (event: MessageEvent) => {
      handleRawMessage(event.data as ArrayBuffer);
    };

    ws.onclose = () => {
      ws = null;
      if (shouldReconnect) {
        const failures = connectionState.consecutiveFailures + 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          updateState({ status: 'failed', consecutiveFailures: failures });
        } else {
          updateState({ status: 'reconnecting', consecutiveFailures: failures });
          scheduleReconnect();
        }
      } else {
        updateState({ status: 'disconnected', consecutiveFailures: 0 });
      }
    };

    ws.onerror = () => {
      // Error is always followed by onclose, so we handle state there.
      // Just log for debugging.
      console.error('[WS] Connection error');
    };
  } catch {
    ws = null;
    if (shouldReconnect) {
      const failures = connectionState.consecutiveFailures + 1;
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        updateState({ status: 'failed', consecutiveFailures: failures });
      } else {
        updateState({ status: 'reconnecting', consecutiveFailures: failures });
        scheduleReconnect();
      }
    } else {
      updateState({ status: 'disconnected', consecutiveFailures: 0 });
    }
  }
}

/**
 * Explicitly disconnect. Sets shouldReconnect=false to prevent auto-reconnect.
 * Used when the user intentionally leaves a room or navigates away.
 */
export function disconnect(): void {
  shouldReconnect = false;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.onopen = null;
    ws.close();
    ws = null;
  }

  updateState({ status: 'disconnected', consecutiveFailures: 0 });
}

/**
 * Send a message over the WebSocket connection.
 * Encodes the {type, data} envelope using MessagePack binary format.
 * Silently drops if not connected.
 */
export function send(type: number, data: unknown): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const msg: Message = { type, data };
  const encoded = encode(msg);
  ws.send(encoded);
}

/**
 * Register a handler for incoming messages (decoded from MessagePack).
 * Only one handler is active at a time; calling again replaces the previous.
 */
export function onMessage(handler: (msg: Message) => void): void {
  messageHandler = handler;
}

/**
 * Register a handler for connection state changes.
 * Supports multiple listeners. Returns an unsubscribe function.
 */
export function onStateChange(handler: (state: ConnectionState) => void): () => void {
  stateChangeListeners.add(handler);
  return () => { stateChangeListeners.delete(handler); };
}

/**
 * Get the current connection state (status + failure count).
 */
export function getConnectionState(): ConnectionState {
  return { ...connectionState };
}

// ===== Internal Logic =====

/**
 * Update connection state and notify all subscribers.
 */
function updateState(newState: ConnectionState): void {
  connectionState = { ...newState };
  const snapshot = getConnectionState();
  for (const listener of stateChangeListeners) {
    listener(snapshot);
  }
}

/**
 * Handle raw binary WebSocket message: decode MessagePack → handle Ping → dispatch.
 */
function handleRawMessage(raw: ArrayBuffer): void {
  try {
    const msg = decode(new Uint8Array(raw)) as Message;

    // Auto-reply to Ping with Pong (same timestamp)
    if (msg.type === MSG_PING) {
      const pingData = msg.data as { t: number };
      send(MSG_PONG, { t: pingData.t });
      return;
    }

    // Dispatch to registered handler
    if (messageHandler) {
      messageHandler(msg);
    }
  } catch (err) {
    console.error('[WS] Failed to decode message:', err);
  }
}

/**
 * Schedule a reconnection attempt using exponential backoff.
 * Backoff formula: min(2^(n-1) × 1000, 30000) ms where n = consecutiveFailures.
 */
function scheduleReconnect(): void {
  if (reconnectTimer) return;

  const delay = calculateBackoff(connectionState.consecutiveFailures);
  console.log(`[WS] Reconnecting in ${delay / 1000}s (attempt ${connectionState.consecutiveFailures})...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(currentUrl);
  }, delay);
}
