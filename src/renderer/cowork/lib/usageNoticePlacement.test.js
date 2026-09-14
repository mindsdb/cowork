import { describe, it, expect } from 'vitest';
import { currentTurnIndex, usageNoticeBuckets, dropNoticesFromTurn, shiftNoticesAfterTurn } from './usageNoticePlacement';

const user = (content) => ({ role: 'user', content });
const assistant = (content) => ({ role: 'assistant', content });
const notice = (turnIndex) => ({ kind: 'free_low', turnIndex, createdAt: '2026-09-14T10:00:00Z' });

// The bucket index a notice lands in — the row it renders before.
const rowOf = (messages, n) => usageNoticeBuckets(messages, [n]).findIndex((b) => b.length > 0);

describe('currentTurnIndex', () => {
  it('is the 0-based index of the user message the in-flight reply answers', () => {
    expect(currentTurnIndex([user('a')])).toBe(0);
    expect(currentTurnIndex([user('a'), assistant('b'), user('c')])).toBe(1);
  });

  it('ignores non-user rows, including the thinking placeholder', () => {
    const msgs = [user('a'), { role: 'activity', placeholder: true }, { role: 'error' }];
    expect(currentTurnIndex(msgs)).toBe(0);
  });

  it('is -1 with no user turn yet, which anchors nothing', () => {
    expect(currentTurnIndex([])).toBe(-1);
    expect(currentTurnIndex(undefined)).toBe(-1);
  });
});

describe('usageNoticeBuckets', () => {
  const convo = [user('a'), assistant('b'), user('c'), assistant('d')];

  it('renders a notice after its own turn, before the next question', () => {
    // Turn 0 is a→b, so the card sits between the first reply and the
    // second question — where it happened, not at the bottom.
    expect(rowOf(convo, notice(0))).toBe(2);
  });

  it('keeps a notice above later turns however many are added after it', () => {
    const longer = [...convo, user('e'), assistant('f')];
    expect(rowOf(longer, notice(0))).toBe(2);
    expect(rowOf(longer, notice(1))).toBe(4);
  });

  it('puts a notice from the current turn last, because nothing follows it yet', () => {
    expect(rowOf(convo, notice(1))).toBe(convo.length);
  });

  it('falls back to the end when the notice carries no turn stamp', () => {
    expect(rowOf(convo, { kind: 'free_low' })).toBe(convo.length);
  });

  it('keeps several crossings from one turn together, in order', () => {
    const notices = [
      { kind: 'free_low', fractionLeft: 0.18, turnIndex: 0 },
      { kind: 'free_low', fractionLeft: 0.07, turnIndex: 0 },
    ];
    expect(usageNoticeBuckets(convo, notices)[2]).toEqual(notices);
  });

  it('returns an empty bucket per row plus the trailing one when there are no notices', () => {
    expect(usageNoticeBuckets(convo, undefined)).toEqual([[], [], [], [], []]);
  });
});

// PR #978 review. The anchor is an ordinal, so deleting a turn moves the
// ground under it: a stale stamp points at a later turn, or at nothing — and
// a notice with no turn to sit at falls back to the bottom, which is the
// defect this placement exists to fix.
describe('re-anchoring when a turn is deleted', () => {
  const at = (turnIndex) => ({ kind: 'free_low', turnIndex });

  describe('dropNoticesFromTurn (server: the turn AND everything after it)', () => {
    it('drops the deleted turn and everything anchored after it', () => {
      expect(dropNoticesFromTurn([at(0), at(1), at(2)], 1)).toEqual([at(0)]);
    });

    it('keeps notices anchored before the cut', () => {
      expect(dropNoticesFromTurn([at(0), at(1)], 2)).toEqual([at(0), at(1)]);
    });

    it('leaves an unstamped notice alone rather than guessing at it', () => {
      const unstamped = { kind: 'free_low' };
      expect(dropNoticesFromTurn([unstamped, at(3)], 1)).toEqual([unstamped]);
    });

    it('tolerates a missing list or turn index', () => {
      expect(dropNoticesFromTurn(undefined, 1)).toBeUndefined();
      expect(dropNoticesFromTurn([at(2)], undefined)).toEqual([at(2)]);
    });
  });

  describe('shiftNoticesAfterTurn (local: one exchange, conversation closes up)', () => {
    it('drops the deleted turn and moves later anchors down one', () => {
      expect(shiftNoticesAfterTurn([at(0), at(1), at(2)], 1)).toEqual([at(0), at(1)]);
    });

    it('re-anchors so the notice still renders at the turn it happened in', () => {
      // The whole point: turn 2's notice must follow turn 2's messages, which
      // are now turn 1's. Without the shift it would attach to a later turn.
      const messages = [
        { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
        { role: 'user', content: 'e' }, { role: 'assistant', content: 'f' },
      ];
      const shifted = shiftNoticesAfterTurn([at(2)], 1);
      // Two turns left, the notice anchored to the second: nothing follows it.
      expect(usageNoticeBuckets(messages, shifted)[messages.length]).toEqual(shifted);
      // With the stale stamp it would also land at the bottom, but by falling
      // off the end rather than by describing the turn above it.
      expect(shifted[0].turnIndex).toBe(1);
    });

    it('leaves earlier and unstamped notices untouched', () => {
      const unstamped = { kind: 'free_low' };
      expect(shiftNoticesAfterTurn([at(0), unstamped], 2)).toEqual([at(0), unstamped]);
    });

    it('tolerates a missing list or turn index', () => {
      expect(shiftNoticesAfterTurn(undefined, 1)).toBeUndefined();
      expect(shiftNoticesAfterTurn([at(2)], undefined)).toEqual([at(2)]);
    });
  });
});
