import { describe, it, expect } from 'vitest';
import { selectNextQueuedTask, mergeQueuesForAdoptedId, reservationReleaseDecision, finishedCids } from './messageQueue';

const item = (id) => ({ id, text: id, attachments: [], disabledConnections: [] });

describe('selectNextQueuedTask', () => {
  it('returns null when there are no queues', () => {
    expect(selectNextQueuedTask({}, ['a'], 'a')).toBeNull();
    expect(selectNextQueuedTask(null, [], undefined)).toBeNull();
  });

  it('returns null when the only queue is empty', () => {
    expect(selectNextQueuedTask({ a: [] }, ['a'], 'a')).toBeNull();
  });

  it('prefers the finishing task when it still has queued messages (FIFO on its own follow-ups)', () => {
    const queues = { a: [item('a1')], b: [item('b1')] };
    expect(selectNextQueuedTask(queues, ['a', 'b'], 'a')).toBe('a');
  });

  // The ENG-1378 regression: a message queued for a task other than the one
  // that just finished must still be drained, not stranded at "N queued".
  it('drains another task when the finishing task has no queue', () => {
    const queues = { b: [item('b1')] };
    expect(selectNextQueuedTask(queues, ['a', 'b'], 'a')).toBe('b');
  });

  it('drains a queued task when no finishing task is given', () => {
    const queues = { b: [item('b1')] };
    expect(selectNextQueuedTask(queues, ['a', 'b'], undefined)).toBe('b');
  });

  it('skips queues whose task no longer exists so the drain loop cannot wedge', () => {
    const queues = { gone: [item('g1')], b: [item('b1')] };
    // `gone` is not in the existing-task set — it must be skipped, not selected.
    expect(selectNextQueuedTask(queues, ['a', 'b'], 'gone')).toBe('b');
    expect(selectNextQueuedTask({ gone: [item('g1')] }, ['a', 'b'], undefined)).toBeNull();
  });

  it('ignores a preferred task whose queue is empty and falls through to another', () => {
    const queues = { a: [], b: [item('b1')] };
    expect(selectNextQueuedTask(queues, ['a', 'b'], 'a')).toBe('b');
  });

  it('accepts either a Set or an array for existing task ids', () => {
    const queues = { b: [item('b1')] };
    expect(selectNextQueuedTask(queues, new Set(['a', 'b']), 'a')).toBe('b');
    expect(selectNextQueuedTask(queues, ['a', 'b'], 'a')).toBe('b');
  });
});

describe('reservationReleaseDecision', () => {
  const fresh = { cid: null, misses: 0, seen: false, lastMissAt: 0 };
  // A tally in the "server has confirmed this turn running" state, which earns
  // the fast (2-miss) release threshold instead of the wider unseen grace.
  const seen = (cid) => reservationReleaseDecision(cid, [cid], fresh);

  it('never releases when no slot is held', () => {
    expect(reservationReleaseDecision(null, [], fresh)).toEqual({ cid: null, misses: 0, seen: false, lastMissAt: 0, release: false });
    expect(reservationReleaseDecision(undefined, ['a'], fresh)).toEqual({ cid: null, misses: 0, seen: false, lastMissAt: 0, release: false });
  });

  it('resets, marks seen, and never releases while the server still lists the streaming task', () => {
    const d = reservationReleaseDecision('a', ['a', 'b'], { cid: 'a', misses: 1, seen: false, lastMissAt: 5 });
    expect(d).toEqual({ cid: 'a', misses: 0, seen: true, lastMissAt: 0, release: false });
  });

  // Replica lag needs a longer, bounded grace period before reaping an unseen task.
  it('releases a never-seen turn only after the wider unseen threshold', () => {
    let tally = fresh;
    for (let i = 1; i < 4; i += 1) {
      tally = reservationReleaseDecision('a', [], tally);
      expect(tally).toEqual({ cid: 'a', misses: i, seen: false, lastMissAt: 0, release: false });
    }
    tally = reservationReleaseDecision('a', [], tally);
    expect(tally).toEqual({ cid: 'a', misses: 4, seen: false, lastMissAt: 0, release: true });
  });

  it('protects an unseen turn whose registration is merely delayed', () => {
    // Healthy turn, registration lags a couple of polls, then appears — well
    // inside the unseen grace, so it is never reaped and resets on arrival.
    let tally = reservationReleaseDecision('a', [], fresh);
    tally = reservationReleaseDecision('a', [], tally);
    expect(tally).toEqual({ cid: 'a', misses: 2, seen: false, lastMissAt: 0, release: false });
    expect(reservationReleaseDecision('a', ['a'], tally)).toEqual({ cid: 'a', misses: 0, seen: true, lastMissAt: 0, release: false });
  });

  it('honors a custom unseenThreshold', () => {
    let tally = fresh;
    tally = reservationReleaseDecision('a', [], tally, { unseenThreshold: 2 });
    expect(tally.release).toBe(false);
    expect(reservationReleaseDecision('a', [], tally, { unseenThreshold: 2 }).release).toBe(true);
  });

  // The core bug: the slot is held for a task the server ran and then dropped.
  // One miss is tolerated (tmp->canonical swap / a blip); the second releases.
  it('releases only after two consecutive misses once the turn has been seen', () => {
    const first = reservationReleaseDecision('a', ['b'], seen('a'));
    expect(first).toEqual({ cid: 'a', misses: 1, seen: true, lastMissAt: 0, release: false });
    const second = reservationReleaseDecision('a', ['b'], first);
    expect(second).toEqual({ cid: 'a', misses: 2, seen: true, lastMissAt: 0, release: true });
  });

  it('clears the tally when a seen turn transiently reappears', () => {
    const missed = reservationReleaseDecision('a', ['b'], seen('a'));
    expect(missed.misses).toBe(1);
    expect(reservationReleaseDecision('a', ['a'], missed)).toEqual({ cid: 'a', misses: 0, seen: true, lastMissAt: 0, release: false });
  });

  it('restarts the tally when the slot moves to a different conversation', () => {
    // A new task must not inherit the previous task's seen flag or misses.
    const afterA = reservationReleaseDecision('a', ['x'], seen('a')); // { cid:'a', misses:1, seen:true }
    const b = reservationReleaseDecision('b', ['x'], afterA);
    expect(b).toEqual({ cid: 'b', misses: 1, seen: false, lastMissAt: 0, release: false });
  });

  it('honors a custom threshold', () => {
    let tally = seen('a');
    for (let i = 0; i < 2; i += 1) {
      tally = reservationReleaseDecision('a', [], tally, { threshold: 3 });
      expect(tally.release).toBe(false);
    }
    expect(reservationReleaseDecision('a', [], tally, { threshold: 3 }).release).toBe(true);
  });

  // Focus events and polling must respect the reap-check spacing.
  it('does not double-count misses from polls closer than the spacing window', () => {
    const first = reservationReleaseDecision('a', [], seen('a'), { now: 1000, minMissSpacingMs: 4000 });
    expect(first).toEqual({ cid: 'a', misses: 1, seen: true, lastMissAt: 1000, release: false });
    const tooSoon = reservationReleaseDecision('a', [], first, { now: 1500, minMissSpacingMs: 4000 });
    expect(tooSoon).toEqual({ cid: 'a', misses: 1, seen: true, lastMissAt: 1000, release: false });
    const later = reservationReleaseDecision('a', [], tooSoon, { now: 6000, minMissSpacingMs: 4000 });
    expect(later).toEqual({ cid: 'a', misses: 2, seen: true, lastMissAt: 6000, release: true });
  });

  it('disables the spacing guard when now is 0 (the default)', () => {
    // Callers that don't pass a clock get the plain consecutive-miss behavior.
    const first = reservationReleaseDecision('a', [], seen('a'));
    const second = reservationReleaseDecision('a', [], first);
    expect(second.release).toBe(true);
  });

  // Preflight absence is expected and must not clear the seen flag.
  it('never releases or accrues a miss while pre-flight, and preserves seen', () => {
    let tally = seen('a');
    for (let i = 0; i < 5; i += 1) {
      tally = reservationReleaseDecision('a', [], tally, { preflight: true });
      expect(tally).toEqual({ cid: 'a', misses: 0, seen: true, lastMissAt: 0, release: false });
    }
  });

  it('treats a non-array server list as absent (a miss) for a seen turn, not a crash', () => {
    expect(reservationReleaseDecision('a', null, seen('a'))).toEqual({ cid: 'a', misses: 1, seen: true, lastMissAt: 0, release: false });
    expect(reservationReleaseDecision('a', undefined, { cid: 'a', misses: 1, seen: true, lastMissAt: 0 }))
      .toEqual({ cid: 'a', misses: 2, seen: true, lastMissAt: 0, release: true });
  });

  // SSE data proves a turn started even before registration appears; do not reap it as unseen.
  it('never reaps an unseen turn that has produced stream events, however long it lags the list', () => {
    let tally = fresh;
    for (let i = 0; i < 8; i += 1) {
      tally = reservationReleaseDecision('a', [], tally, { producedData: true });
      expect(tally).toEqual({ cid: 'a', misses: 0, seen: false, lastMissAt: 0, release: false });
    }
    expect(reservationReleaseDecision('a', ['a'], tally, { producedData: true }))
      .toEqual({ cid: 'a', misses: 0, seen: true, lastMissAt: 0, release: false });
  });

  // Without SSE data, startup failure must still resolve within a bounded grace period.
  it('still reaps an unseen turn that produced nothing (the fast-fail path)', () => {
    let tally = fresh;
    for (let i = 1; i < 4; i += 1) {
      tally = reservationReleaseDecision('a', [], tally, { producedData: false });
      expect(tally.release).toBe(false);
    }
    expect(reservationReleaseDecision('a', [], tally, { producedData: false }).release).toBe(true);
  });

  // A previously seen task that disappears must still be reaped after producing data.
  it('reaps a seen turn that vanishes even though it produced events', () => {
    const first = reservationReleaseDecision('a', ['b'], seen('a'), { producedData: true });
    expect(first).toEqual({ cid: 'a', misses: 1, seen: true, lastMissAt: 0, release: false });
    const second = reservationReleaseDecision('a', ['b'], first, { producedData: true });
    expect(second.release).toBe(true);
  });
});

describe('finishedCids', () => {
  it('returns cids that dropped out of the server list', () => {
    expect(finishedCids(['a', 'b'], ['b'], null)).toEqual(['a']);
  });

  it('excludes the cid this tab is still actively streaming', () => {
    expect(finishedCids(['a', 'b'], ['b'], 'a')).toEqual([]);
  });

  it('still flags other dropped cids while one is excluded', () => {
    expect(finishedCids(['a', 'b', 'c'], [], 'b')).toEqual(['a', 'c']);
  });
});

describe('mergeQueuesForAdoptedId', () => {
  it('returns the input unchanged (same reference) when nothing moves', () => {
    const queues = { tmp: [] };
    // `tmp` is empty, so no pending items move — identity preserved so the
    // React setState no-ops.
    expect(mergeQueuesForAdoptedId(queues, ['tmp'], 'srv')).toBe(queues);
    const empty = {};
    expect(mergeQueuesForAdoptedId(empty, ['tmp'], 'srv')).toBe(empty);
    expect(mergeQueuesForAdoptedId(null, ['tmp'], 'srv')).toBeNull();
  });

  it('moves a tmp-id queue onto the canonical server id', () => {
    const queues = { tmp: [item('m1'), item('m2')] };
    const next = mergeQueuesForAdoptedId(queues, ['tmp'], 'srv');
    expect(next.tmp).toBeUndefined();
    expect(next.srv.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('appends migrated items after any items already under the destination id (FIFO)', () => {
    const queues = { srv: [item('s0')], tmp: [item('m1')] };
    const next = mergeQueuesForAdoptedId(queues, ['tmp'], 'srv');
    expect(next.srv.map((m) => m.id)).toEqual(['s0', 'm1']);
    expect(next.tmp).toBeUndefined();
  });

  it('ignores falsy ids and a source equal to the destination', () => {
    const queues = { srv: [item('s0')], tmp: [item('m1')] };
    // `srv` (== toId) must not be deleted or duplicated; null/undefined skipped.
    const next = mergeQueuesForAdoptedId(queues, [null, 'srv', undefined, 'tmp'], 'srv');
    expect(next.srv.map((m) => m.id)).toEqual(['s0', 'm1']);
    expect(next.tmp).toBeUndefined();
  });

  it('merges several source ids in order and de-duplicates the source list', () => {
    const queues = { a: [item('a1')], b: [item('b1')], c: [item('c1')] };
    const next = mergeQueuesForAdoptedId(queues, ['a', 'b', 'a'], 'c');
    expect(next.c.map((m) => m.id)).toEqual(['c1', 'a1', 'b1']);
    expect(next.a).toBeUndefined();
    expect(next.b).toBeUndefined();
  });

  it('returns the input unchanged for a falsy destination id (never strands under next[undefined])', () => {
    // A falsy toId would otherwise write an unreachable `next[undefined]` key
    // and lose every moved message — the ENG-1378 stranding symptom.
    const queues = { tmp: [item('m1')] };
    for (const bad of [undefined, null, '', 0]) {
      const next = mergeQueuesForAdoptedId(queues, ['tmp'], bad);
      expect(next).toBe(queues);
      expect(next.tmp.map((m) => m.id)).toEqual(['m1']);
      expect(next).not.toHaveProperty('undefined');
    }
  });
});
