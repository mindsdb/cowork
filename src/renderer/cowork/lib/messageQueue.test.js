import { describe, it, expect } from 'vitest';
import { selectNextQueuedTask, mergeQueuesForAdoptedId, reservationReleaseDecision } from './messageQueue';

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
  // A tally in the "server has confirmed this turn running" state — the only
  // state from which an absence can count as a strand.
  const seen = (cid) => reservationReleaseDecision(cid, [cid], fresh);

  it('never releases when no slot is held', () => {
    expect(reservationReleaseDecision(null, [], fresh)).toEqual({ cid: null, misses: 0, seen: false, lastMissAt: 0, release: false });
    expect(reservationReleaseDecision(undefined, ['a'], fresh)).toEqual({ cid: null, misses: 0, seen: false, lastMissAt: 0, release: false });
  });

  it('resets, marks seen, and never releases while the server still lists the streaming task', () => {
    const d = reservationReleaseDecision('a', ['a', 'b'], { cid: 'a', misses: 1, seen: false, lastMissAt: 5 });
    expect(d).toEqual({ cid: 'a', misses: 0, seen: true, lastMissAt: 0, release: false });
  });

  // Registration-phase guard (ENG-1717): a turn the server has never listed is
  // never reaped — a lagging Redis replica reporting a just-started or
  // not-yet-propagated turn as absent must not abort it, no matter how many
  // polls miss.
  it('never accrues a miss for a turn that has not yet been seen running', () => {
    let tally = fresh;
    for (let i = 0; i < 5; i += 1) {
      tally = reservationReleaseDecision('a', [], tally);
      expect(tally).toEqual({ cid: 'a', misses: 0, seen: false, lastMissAt: 0, release: false });
    }
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
    // Server lists it again on the next poll → tally clears, still seen.
    expect(reservationReleaseDecision('a', ['a'], missed)).toEqual({ cid: 'a', misses: 0, seen: true, lastMissAt: 0, release: false });
  });

  it('restarts the tally when the slot moves to a different conversation', () => {
    // A miss accrued against a seen `a`, then the slot adopts `b`. `b` is a
    // fresh, unseen turn — it cannot inherit `a`'s count or its seen flag, so it
    // is not reaped until the server has listed it too.
    const afterA = reservationReleaseDecision('a', ['x'], seen('a')); // { cid:'a', misses:1, seen:true }
    const b = reservationReleaseDecision('b', ['x'], afterA);
    expect(b).toEqual({ cid: 'b', misses: 0, seen: false, lastMissAt: 0, release: false });
  });

  it('honors a custom threshold', () => {
    let tally = seen('a');
    for (let i = 0; i < 2; i += 1) {
      tally = reservationReleaseDecision('a', [], tally, { threshold: 3 });
      expect(tally.release).toBe(false);
    }
    expect(reservationReleaseDecision('a', [], tally, { threshold: 3 }).release).toBe(true);
  });

  // Miss-spacing guard (ENG-1717): the 5s interval and a focus refresh can fire
  // close together. Two absent polls within the spacing window count as one
  // miss, so the two-miss release window can't collapse to an instant.
  it('does not double-count misses from polls closer than the spacing window', () => {
    const first = reservationReleaseDecision('a', [], seen('a'), { now: 1000, minMissSpacingMs: 4000 });
    expect(first).toEqual({ cid: 'a', misses: 1, seen: true, lastMissAt: 1000, release: false });
    // A focus poll 500ms later — inside the window — does not advance the tally.
    const tooSoon = reservationReleaseDecision('a', [], first, { now: 1500, minMissSpacingMs: 4000 });
    expect(tooSoon).toEqual({ cid: 'a', misses: 1, seen: true, lastMissAt: 1000, release: false });
    // The next interval poll, a full window later, does — and releases.
    const later = reservationReleaseDecision('a', [], tooSoon, { now: 6000, minMissSpacingMs: 4000 });
    expect(later).toEqual({ cid: 'a', misses: 2, seen: true, lastMissAt: 6000, release: true });
  });

  it('disables the spacing guard when now is 0 (the default)', () => {
    // Callers that don't pass a clock get the plain consecutive-miss behavior.
    const first = reservationReleaseDecision('a', [], seen('a'));
    const second = reservationReleaseDecision('a', [], first);
    expect(second.release).toBe(true);
  });

  // Pre-flight: the slot is reserved but the stream (and the server's record of
  // it) hasn't started — a long attachment upload. Its absence from the server
  // list is expected, so no miss accrues and it is never released, and a seen
  // flag from before the upload survives it.
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
