import { describe, it, expect } from 'vitest';
import { currentTurnIndex, userTurnCount, usageNoticeBuckets, dropNoticesFromTurn, removeNoticeTurns } from './usageNoticePlacement';

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

  // A preflight with no provider appends the typed message locally and never
  // sends it. Counting that row put every later stamp a turn ahead, so
  // hydration dropped the row and the notice fell to the bottom.
  it('does not count a row the server will never see', () => {
    const msgs = [
      user('a'), assistant('b'),
      { role: 'user', content: 'unsent', _unsent: true }, { role: 'provider_required' },
      user('c'),
    ];
    expect(currentTurnIndex(msgs)).toBe(1);
    expect(userTurnCount(msgs)).toBe(2);
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
    // Turn 0 is a→b, so the card sits between that reply and the next question.
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

  it('places a notice the same before and after an unsent row is dropped', () => {
    // The ordinal counts server-visible turns, so hydration cannot move it.
    const beforeHydration = [
      user('a'), assistant('b'),
      { role: 'user', content: 'unsent', _unsent: true }, { role: 'provider_required' },
      user('c'), assistant('d'), user('e'),
    ];
    const afterHydration = [user('a'), assistant('b'), user('c'), assistant('d'), user('e')];
    // Stamped during turn c, which is turn 1 either way.
    expect(rowOf(beforeHydration, notice(1))).toBe(6);
    expect(rowOf(afterHydration, notice(1))).toBe(4);
    // Both indices are the row holding 'e', so the card sits in the same place.
    expect(beforeHydration[6].content).toBe('e');
    expect(afterHydration[4].content).toBe('e');
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

// The anchor is an ordinal, so deleting a turn moves the ground under it. Both
// repairs read the cut that happened, never the turn that was asked for.
describe('re-anchoring when a turn is deleted', () => {
  const at = (turnIndex) => ({ kind: 'free_low', turnIndex });

  describe('dropNoticesFromTurn (truncation: how many turns survived)', () => {
    it('drops every notice anchored past the surviving turns', () => {
      expect(dropNoticesFromTurn([at(0), at(1), at(2)], 1)).toEqual([at(0)]);
    });

    it('keeps notices anchored inside what survived', () => {
      expect(dropNoticesFromTurn([at(0), at(1)], 2)).toEqual([at(0), at(1)]);
    });

    it('leaves an unstamped notice alone rather than guessing at it', () => {
      const unstamped = { kind: 'free_low' };
      expect(dropNoticesFromTurn([unstamped, at(3)], 1)).toEqual([unstamped]);
    });

    it('tolerates a missing list or count', () => {
      expect(dropNoticesFromTurn(undefined, 1)).toBeUndefined();
      expect(dropNoticesFromTurn([at(2)], undefined)).toEqual([at(2)]);
    });
  });

  describe('removeNoticeTurns (a cut through the middle)', () => {
    it('drops the cut turns and moves later anchors down by as many', () => {
      expect(removeNoticeTurns([at(0), at(1), at(2)], 1, 1)).toEqual([at(0), at(1)]);
    });

    // The local walk counts assistant rows while the caller counts user ones,
    // so an `error` row makes it take two turns for a one-turn request.
    // Shifting by one stranded turn C's notice, which then fell to the bottom.
    it('accounts for every turn a wider-than-requested cut took', () => {
      // user A, assistant a, user B, error, user C, assistant c — delete B.
      // The cut runs from turn 1 and takes both B and C.
      expect(removeNoticeTurns([at(2)], 1, 2)).toEqual([]);
      expect(removeNoticeTurns([at(0), at(1), at(2), at(3)], 1, 2)).toEqual([at(0), at(1)]);
    });

    it('re-anchors so the notice still renders at the turn it happened in', () => {
      // Turn 2's notice must follow turn 2's messages, which are now turn 1's.
      const messages = [
        { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' },
        { role: 'user', content: 'e' }, { role: 'assistant', content: 'f' },
      ];
      const shifted = removeNoticeTurns([at(2)], 1, 1);
      expect(shifted[0].turnIndex).toBe(1);
      // Two turns left, the notice on the second: nothing follows it.
      expect(usageNoticeBuckets(messages, shifted)[messages.length]).toEqual(shifted);
    });

    it('leaves earlier and unstamped notices untouched', () => {
      const unstamped = { kind: 'free_low' };
      expect(removeNoticeTurns([at(0), unstamped], 2, 1)).toEqual([at(0), unstamped]);
    });

    it('does nothing when the cut took no turn at all', () => {
      expect(removeNoticeTurns([at(2)], 1, 0)).toEqual([at(2)]);
    });

    it('tolerates a missing list or range', () => {
      expect(removeNoticeTurns(undefined, 1, 1)).toBeUndefined();
      expect(removeNoticeTurns([at(2)], undefined, 1)).toEqual([at(2)]);
      expect(removeNoticeTurns([at(2)], 1, undefined)).toEqual([at(2)]);
    });
  });

  describe('userTurnCount', () => {
    it('counts user messages and nothing else', () => {
      expect(userTurnCount([
        { role: 'user' }, { role: 'assistant' }, { role: 'error' }, { role: 'user' },
      ])).toBe(2);
      expect(userTurnCount(undefined)).toBe(0);
    });
  });
});
