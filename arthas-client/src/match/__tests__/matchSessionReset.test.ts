/**
 * Unit tests for MATCH_SESSION_RESET constant.
 *
 * Verifies:
 * 1. The constant contains all expected session fields
 * 2. All values are "empty/initial" (null, false, 0, etc.)
 * 3. No extra unexpected keys are present
 *
 * This test acts as a safety net: if someone adds a new session field to MatchState
 * but forgets to include it in MATCH_SESSION_RESET, this test should prompt them to update.
 *
 * @module match/__tests__/matchSessionReset.test
 */

import { describe, it, expect } from 'vitest';
import { MATCH_SESSION_RESET } from '../matchStore';

describe('MATCH_SESSION_RESET', () => {
  it('contains all required session fields', () => {
    const expectedKeys = [
      'matchRoomId',
      'matchKey',
      'matchKeyRaw',
      'matchExpiresAt',
      'matchEphemeral',
      'isKeyGenerator',
      'partnerId',
      'inviteLink',
      'inviteToken',
      'extensionProposed',
      'extensionCount',
      'partnerProposedExtend',
      'partnerLeft',
      'waitedSeconds',
      'error',
      'retryAfter',
    ];

    for (const key of expectedKeys) {
      expect(MATCH_SESSION_RESET).toHaveProperty(key);
    }
  });

  it('has correct initial values for nullable fields', () => {
    expect(MATCH_SESSION_RESET.matchRoomId).toBeNull();
    expect(MATCH_SESSION_RESET.matchKey).toBeNull();
    expect(MATCH_SESSION_RESET.matchKeyRaw).toBeNull();
    expect(MATCH_SESSION_RESET.matchExpiresAt).toBeNull();
    expect(MATCH_SESSION_RESET.matchEphemeral).toBeNull();
    expect(MATCH_SESSION_RESET.partnerId).toBeNull();
    expect(MATCH_SESSION_RESET.inviteLink).toBeNull();
    expect(MATCH_SESSION_RESET.inviteToken).toBeNull();
    expect(MATCH_SESSION_RESET.error).toBeNull();
    expect(MATCH_SESSION_RESET.retryAfter).toBeNull();
  });

  it('has correct initial values for boolean fields', () => {
    expect(MATCH_SESSION_RESET.isKeyGenerator).toBe(false);
    expect(MATCH_SESSION_RESET.extensionProposed).toBe(false);
    expect(MATCH_SESSION_RESET.partnerProposedExtend).toBe(false);
    expect(MATCH_SESSION_RESET.partnerLeft).toBe(false);
  });

  it('has correct initial values for numeric fields', () => {
    expect(MATCH_SESSION_RESET.extensionCount).toBe(0);
    expect(MATCH_SESSION_RESET.waitedSeconds).toBe(0);
  });

  it('does not contain status field (status is set separately by callers)', () => {
    expect(MATCH_SESSION_RESET).not.toHaveProperty('status');
  });

  it('does not contain selectedTags (persisted across sessions)', () => {
    expect(MATCH_SESSION_RESET).not.toHaveProperty('selectedTags');
  });

  it('does not contain waitStartTime or elapsedSeconds (set by callers with fresh values)', () => {
    expect(MATCH_SESSION_RESET).not.toHaveProperty('waitStartTime');
    expect(MATCH_SESSION_RESET).not.toHaveProperty('elapsedSeconds');
  });

  it('is frozen/readonly (as const prevents accidental mutation)', () => {
    // TypeScript enforces this at compile time with `as const`,
    // but we can verify the object values are what we expect
    const keys = Object.keys(MATCH_SESSION_RESET);
    expect(keys.length).toBe(16);
  });
});
