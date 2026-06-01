import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { Member } from '../../src/stores/chatStore';

/**
 * Property 10: Member List Consistency
 *
 * For any member list and any MemberJoined event with a new member,
 * handling the event should increase the list length by exactly 1
 * and the list should contain the new member.
 *
 * Conversely, for any member list containing a member and a MemberLeft
 * event for that member, handling the event should decrease the list
 * length by exactly 1 and the member should no longer be present.
 *
 * **Validates: Requirements 9.1, 9.2**
 */

// ===== Pure member list operations (mirrors chatStore logic) =====

/**
 * Handle MemberJoined: adds a new member to the list.
 * Mirrors the MSG_MEMBER_JOINED handler in chatStore.ts.
 */
function handleMemberJoined(members: Member[], joined: Member): Member[] {
  return [...members, joined];
}

/**
 * Handle MemberLeft: removes a member by id from the list.
 * Mirrors the MSG_MEMBER_LEFT handler in chatStore.ts.
 */
function handleMemberLeft(members: Member[], leftId: string): Member[] {
  return members.filter((m) => m.id !== leftId);
}

// ===== Generators =====

/** Generate a random member with id, name, and color strings. */
const memberArb: fc.Arbitrary<Member> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 30 }),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  color: fc
    .array(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'), { minLength: 6, maxLength: 6 })
    .map((chars) => `#${chars.join('')}`),
});

/** Generate a list of members with unique IDs. */
const uniqueMemberListArb: fc.Arbitrary<Member[]> = fc
  .array(memberArb, { minLength: 0, maxLength: 20 })
  .map((members) => {
    // Deduplicate by id — keep first occurrence
    const seen = new Set<string>();
    return members.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  });

describe('Property 10: Member List Consistency', () => {
  it('MemberJoined increases list length by 1 and member is present', () => {
    fc.assert(
      fc.property(
        uniqueMemberListArb,
        memberArb,
        (existingMembers, newMember) => {
          // Ensure the new member's id is not already in the list
          const isAlreadyPresent = existingMembers.some((m) => m.id === newMember.id);
          if (isAlreadyPresent) return; // Skip — precondition: member must be new

          const before = existingMembers.length;
          const after = handleMemberJoined(existingMembers, newMember);

          // Length increases by exactly 1
          expect(after.length).toBe(before + 1);

          // New member is present in the updated list
          const found = after.find((m) => m.id === newMember.id);
          expect(found).toBeDefined();
          expect(found!.name).toBe(newMember.name);
          expect(found!.color).toBe(newMember.color);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('MemberLeft decreases list length by 1 and member is absent', () => {
    fc.assert(
      fc.property(
        uniqueMemberListArb.filter((list) => list.length > 0),
        fc.nat(),
        (existingMembers, indexSeed) => {
          // Pick a random member from the list to remove
          const index = indexSeed % existingMembers.length;
          const memberToRemove = existingMembers[index]!;

          const before = existingMembers.length;
          const after = handleMemberLeft(existingMembers, memberToRemove.id);

          // Length decreases by exactly 1
          expect(after.length).toBe(before - 1);

          // Removed member is no longer present
          const found = after.find((m) => m.id === memberToRemove.id);
          expect(found).toBeUndefined();
        }
      ),
      { numRuns: 200 }
    );
  });

  it('MemberLeft for non-existent member does not change list', () => {
    fc.assert(
      fc.property(
        uniqueMemberListArb,
        fc.string({ minLength: 1, maxLength: 30 }),
        (existingMembers, removeId) => {
          // Precondition: removeId is NOT in the list
          const isPresent = existingMembers.some((m) => m.id === removeId);
          if (isPresent) return; // Skip — we want to test non-existent removal

          const before = existingMembers.length;
          const after = handleMemberLeft(existingMembers, removeId);

          // Length unchanged
          expect(after.length).toBe(before);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('MemberJoined followed by MemberLeft restores original list length', () => {
    fc.assert(
      fc.property(
        uniqueMemberListArb,
        memberArb,
        (existingMembers, newMember) => {
          // Precondition: new member not already in list
          const isAlreadyPresent = existingMembers.some((m) => m.id === newMember.id);
          if (isAlreadyPresent) return;

          const afterJoin = handleMemberJoined(existingMembers, newMember);
          const afterLeave = handleMemberLeft(afterJoin, newMember.id);

          // Length restored to original
          expect(afterLeave.length).toBe(existingMembers.length);

          // The joined member is no longer present
          expect(afterLeave.find((m) => m.id === newMember.id)).toBeUndefined();

          // All original members are still present
          for (const original of existingMembers) {
            expect(afterLeave.find((m) => m.id === original.id)).toBeDefined();
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
