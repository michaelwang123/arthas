/**
 * Message ID utilities for React keys and cross-client stable IDs.
 */

let counter = 0;

/**
 * Generate a locally-unique message ID for React keys.
 * Uses an incrementing counter with a random suffix for uniqueness.
 */
export function generateMessageId(): string {
  const id = `msg-${counter++}-${Math.random().toString(36).slice(2, 8)}`;
  return id;
}

/**
 * Generate a cross-client stable ID for future reply/reaction support.
 * Format: "{senderId}:{timestamp}"
 */
export function makeStableId(senderId: string, timestamp: number): string {
  return `${senderId}:${timestamp}`;
}
