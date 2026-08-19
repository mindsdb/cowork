import { describe, it, expect } from 'vitest';
import { selectNextQueuedTask, mergeQueuesForAdoptedId } from './messageQueue';

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
