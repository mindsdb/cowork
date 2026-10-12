import { describe, it, expect } from 'vitest';
import { nextScrollAnchor } from './scrollAnchor';

const msgs = (...ids) => ids.map((id) => ({ id }));

describe('nextScrollAnchor', () => {
  it('is not a prepend on the first call for a task (opening a conversation snaps to bottom)', () => {
    const { isPrepend, anchor } = nextScrollAnchor({
      taskId: 't1', messages: msgs('a', 'b'), previousAnchor: null, scrollHeight: 500,
    });
    expect(isPrepend).toBe(false);
    expect(anchor).toEqual({ taskId: 't1', firstKey: 'a', messageCount: 2, scrollHeight: 500 });
  });

  it('is not a prepend when switching to a different task (also snaps to bottom)', () => {
    const previousAnchor = { taskId: 't1', firstKey: 'a', messageCount: 2, scrollHeight: 500 };
    const { isPrepend } = nextScrollAnchor({
      taskId: 't2', messages: msgs('x', 'y'), previousAnchor, scrollHeight: 300,
    });
    expect(isPrepend).toBe(false);
  });

  it('is not a prepend when new content is appended at the end (same first id)', () => {
    const previousAnchor = { taskId: 't1', firstKey: 'a', messageCount: 2, scrollHeight: 500 };
    const { isPrepend } = nextScrollAnchor({
      taskId: 't1', messages: msgs('a', 'b', 'c'), previousAnchor, scrollHeight: 650,
    });
    expect(isPrepend).toBe(false);
  });

  it('is a prepend when the first id changes and the array grew — computes the scrollHeight delta', () => {
    const previousAnchor = { taskId: 't1', firstKey: 'b', messageCount: 2, scrollHeight: 500 };
    const { isPrepend, scrollHeightDelta, anchor } = nextScrollAnchor({
      taskId: 't1', messages: msgs('a', 'b', 'c'), previousAnchor, scrollHeight: 720,
    });
    expect(isPrepend).toBe(true);
    expect(scrollHeightDelta).toBe(220); // 720 - 500: exactly what the prepended content added
    expect(anchor).toEqual({ taskId: 't1', firstKey: 'a', messageCount: 3, scrollHeight: 720 });
  });

  it('is not a prepend when the first id changes but the array shrank (e.g. a delete-turn truncation)', () => {
    const previousAnchor = { taskId: 't1', firstKey: 'a', messageCount: 3, scrollHeight: 700 };
    const { isPrepend } = nextScrollAnchor({
      taskId: 't1', messages: msgs('b'), previousAnchor, scrollHeight: 200,
    });
    expect(isPrepend).toBe(false);
  });

  it('is not a prepend when the message list is empty', () => {
    const previousAnchor = { taskId: 't1', firstKey: 'a', messageCount: 2, scrollHeight: 500 };
    const { isPrepend } = nextScrollAnchor({
      taskId: 't1', messages: [], previousAnchor, scrollHeight: 0,
    });
    expect(isPrepend).toBe(false);
  });
});
