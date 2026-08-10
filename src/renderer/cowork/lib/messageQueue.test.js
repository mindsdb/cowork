import { describe, it, expect } from 'vitest';
import { selectNextQueuedTask } from './messageQueue';

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
