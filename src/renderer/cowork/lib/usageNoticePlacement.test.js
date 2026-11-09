import { describe, it, expect } from 'vitest';
import { currentTurnAnchorId, usageNoticeBuckets, dropNoticesFromTurn, withUsageNotices } from './usageNoticePlacement';

const user = (id, content) => ({ role: 'user', id, content });
const assistant = (id, content) => ({ role: 'assistant', id, content });
const notice = (anchorId) => ({ kind: 'free_low', anchorId, createdAt: '2026-09-14T10:00:00Z' });

// The bucket index a notice lands in — the row it renders before.
const rowOf = (messages, n) => usageNoticeBuckets(messages, [n]).findIndex((b) => b.length > 0);

describe('currentTurnAnchorId', () => {
  it('is the id of the user message the in-flight reply answers', () => {
    expect(currentTurnAnchorId([user('u1', 'a')])).toBe('u1');
    expect(currentTurnAnchorId([user('u1', 'a'), assistant('a1', 'b'), user('u2', 'c')])).toBe('u2');
  });

  // A preflight with no provider appends the typed message locally and never
  // sends it. Anchoring to that row would strand the notice on a row that
  // hydration later drops.
  it('does not anchor to a row the server will never see', () => {
    const msgs = [
      user('u1', 'a'), assistant('a1', 'b'),
      { role: 'user', content: 'unsent', _unsent: true, id: 'unsent-1' }, { role: 'provider_required' },
      user('u2', 'c'),
    ];
    expect(currentTurnAnchorId(msgs)).toBe('u2');
  });

  it('ignores non-user rows, including the thinking placeholder', () => {
    const msgs = [user('u1', 'a'), { role: 'activity', placeholder: true }, { role: 'error' }];
    expect(currentTurnAnchorId(msgs)).toBe('u1');
  });

  it('is null with no user turn yet, which anchors nothing', () => {
    expect(currentTurnAnchorId([])).toBeNull();
    expect(currentTurnAnchorId(undefined)).toBeNull();
  });

  it('is null when the last user row has no id yet', () => {
    // A locally-echoed row can momentarily lack an id before the server
    // round-trip lands one — falls through to "nothing to anchor to" rather
    // than anchoring on undefined.
    expect(currentTurnAnchorId([{ role: 'user', content: 'a' }])).toBeNull();
  });

  it('does not fall back to an earlier turn when only the CURRENT turn lacks an id', () => {
    // A second message sent this session: the first turn is already
    // hydrated (real id), the live turn's user row is appended locally
    // before the server round-trip lands its id. A notice stamped here
    // (e.g. a threshold crossed mid-reply) must fall through to the
    // trailing bucket, not silently reattach to the finished first turn
    // and render above the live question.
    const msgs = [user('u1', 'a'), assistant('a1', 'b'), { role: 'user', content: 'c' }];
    expect(currentTurnAnchorId(msgs)).toBeNull();
  });
});

describe('usageNoticeBuckets', () => {
  const convo = [user('u1', 'a'), assistant('a1', 'b'), user('u2', 'c'), assistant('a2', 'd')];

  it('renders a notice after its own turn, before the next question', () => {
    // Anchored on u1 ("a"), so the card sits between that reply and u2.
    expect(rowOf(convo, notice('u1'))).toBe(2);
  });

  it('keeps a notice above later turns however many are added after it', () => {
    const longer = [...convo, user('u3', 'e'), assistant('a3', 'f')];
    expect(rowOf(longer, notice('u1'))).toBe(2);
    expect(rowOf(longer, notice('u2'))).toBe(4);
  });

  it('puts a notice from the current turn last, because nothing follows it yet', () => {
    expect(rowOf(convo, notice('u2'))).toBe(convo.length);
  });

  it('anchors correctly even when the array is only a partial (paginated) page', () => {
    // Unlike a counted ordinal, an id-based anchor doesn't depend on how
    // much earlier history happens to be loaded.
    const partialPage = [user('u2', 'c'), assistant('a2', 'd')];
    expect(rowOf(partialPage, notice('u2'))).toBe(partialPage.length);
  });

  it('falls back to the end when the notice carries no anchor id', () => {
    expect(rowOf(convo, { kind: 'free_low' })).toBe(convo.length);
  });

  it('renders nowhere when its anchor row is not in this array (not loaded, or removed)', () => {
    // At the end it would read as a warning about the turn just finished.
    expect(rowOf(convo, notice('some-id-not-present'))).toBe(-1);
  });

  it('comes back in place once an older page brings its anchor row in', () => {
    const newestPage = [user('u2', 'c'), assistant('a2', 'd')];
    expect(rowOf(newestPage, notice('u1'))).toBe(-1);
    expect(rowOf(convo, notice('u1'))).toBe(2);
  });

  it('keeps several crossings from one turn together, in order', () => {
    const notices = [
      { kind: 'free_low', fractionLeft: 0.18, anchorId: 'u1' },
      { kind: 'free_low', fractionLeft: 0.07, anchorId: 'u1' },
    ];
    expect(usageNoticeBuckets(convo, notices)[2]).toEqual(notices);
  });

  it('returns an empty bucket per row plus the trailing one when there are no notices', () => {
    expect(usageNoticeBuckets(convo, undefined)).toEqual([[], [], [], [], []]);
  });
});

// delete_turn always removes "this turn and everything after" — never a cut
// through the middle that leaves later turns intact — so unlike the old
// counted-ordinal design, there is no "shift the survivors down" arithmetic:
// ids don't move, a surviving anchor just keeps working.
describe('dropNoticesFromTurn (a turn delete removes a suffix of ids)', () => {
  const at = (anchorId) => ({ kind: 'free_low', anchorId });

  it('drops notices anchored to a removed id', () => {
    expect(dropNoticesFromTurn([at('u1'), at('u2'), at('u3')], ['u2', 'u3'])).toEqual([at('u1')]);
  });

  it('keeps notices anchored to a surviving id', () => {
    expect(dropNoticesFromTurn([at('u1'), at('u2')], ['u3'])).toEqual([at('u1'), at('u2')]);
  });

  it('accepts a Set as well as an array of removed ids', () => {
    expect(dropNoticesFromTurn([at('u1'), at('u2')], new Set(['u1']))).toEqual([at('u2')]);
  });

  it('leaves an unstamped notice alone rather than guessing at it', () => {
    const unstamped = { kind: 'free_low' };
    expect(dropNoticesFromTurn([unstamped, at('u3')], ['u1'])).toEqual([unstamped, at('u3')]);
  });

  it('tolerates a missing list or an empty/missing removed-id set', () => {
    expect(dropNoticesFromTurn(undefined, ['u1'])).toBeUndefined();
    expect(dropNoticesFromTurn([at('u2')], undefined)).toEqual([at('u2')]);
    expect(dropNoticesFromTurn([at('u2')], [])).toEqual([at('u2')]);
  });
});

describe('withUsageNotices', () => {
  const low = (fractionLeft, anchorId) => ({ kind: 'free_low', fractionLeft, anchorId });
  const used = (anchorId) => ({ kind: 'free_used', anchorId });
  const topUp = (anchorId) => ({ kind: 'auto_top_up_failed', anchorId });

  // A long task stepped through 20%, 10% and 5% and then ran out, and showed
  // four near-identical notices. The allowance is one figure: one notice.
  it('keeps one allowance notice, the latest, at the turn it happened in', () => {
    let notices = withUsageNotices(undefined, [low(0.18, 'u1')]);
    notices = withUsageNotices(notices, [low(0.07, 'u2')]);
    expect(notices).toEqual([low(0.07, 'u2')]);
    notices = withUsageNotices(notices, [used('u3')]);
    expect(notices).toEqual([used('u3')]);
  });

  it('keeps an auto top up failure beside the allowance notice', () => {
    const notices = withUsageNotices([low(0.18, 'u1'), topUp('u1')], [used('u2'), topUp('u2')]);
    expect(notices).toEqual([topUp('u1'), used('u2'), topUp('u2')]);
  });
});
