import { describe, it, expect } from 'vitest';
import { currentTurnIndex, usageNoticeBuckets } from './usageNoticePlacement';

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
