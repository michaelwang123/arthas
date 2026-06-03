import { describe, it, expect } from 'vitest';
import { generateMessageId, makeStableId } from '../../src/utils/messageId';

describe('generateMessageId', () => {
  it('returns a non-empty string', () => {
    const id = generateMessageId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('returns unique IDs on successive calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateMessageId());
    }
    expect(ids.size).toBe(100);
  });

  it('starts with "msg-" prefix', () => {
    const id = generateMessageId();
    expect(id.startsWith('msg-')).toBe(true);
  });
});

describe('makeStableId', () => {
  it('formats as senderId:timestamp', () => {
    const result = makeStableId('user123', 1700000000000);
    expect(result).toBe('user123:1700000000000');
  });

  it('handles empty senderId', () => {
    const result = makeStableId('', 0);
    expect(result).toBe(':0');
  });

  it('handles special characters in senderId', () => {
    const result = makeStableId('abc-def_123', 999);
    expect(result).toBe('abc-def_123:999');
  });
});
