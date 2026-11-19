import { describe, it, expect } from 'vitest';
import { stampUserMessageId } from './stampUserMessageId';

const user = (extra = {}) => ({ role: 'user', content: 'q', ...extra });
const assistant = (extra = {}) => ({ role: 'assistant', content: 'a', ...extra });

describe('stampUserMessageId', () => {
  it('stamps the optimistic row the send just appended', () => {
    const rows = [user({ id: 'u1' }), assistant({ id: 'a1' }), user()];
    expect(stampUserMessageId(rows, 'u2')[2].id).toBe('u2');
  });

  it('never stamps a row that never reached the server', () => {
    // An `_unsent` row is what a send with no provider configured leaves
    // behind. The id belongs to a different turn, so stamping it here would
    // give that row a delete affordance that cuts a real turn server-side.
    const rows = [user({ id: 'u1' }), assistant({ id: 'a1' }), user({ _unsent: true })];
    expect(stampUserMessageId(rows, 'u2')).toBe(rows);
  });

  it('leaves an already-stamped turn alone rather than reattributing an older one', () => {
    // The stamp re-runs on every stream event, so it has to be a no-op once
    // the row has an id — and must never walk back to a finished turn.
    const rows = [user({ id: 'u1' }), assistant({ id: 'a1' }), user({ id: 'u2' })];
    expect(stampUserMessageId(rows, 'u3')).toBe(rows);
  });

  it('skips past an unsent row to find the real one behind it', () => {
    const rows = [user(), user({ _unsent: true })];
    const out = stampUserMessageId(rows, 'u1');
    expect(out[0].id).toBe('u1');
    expect(out[1].id).toBeUndefined();
  });

  it('returns the input unchanged when there is nothing to stamp', () => {
    // Identity, not equality: App.jsx compares the result against the task's
    // own array to decide whether to rebuild the task, so returning a fresh
    // array would make every stream event look like a change.
    const rows = [user({ id: 'u1' })];
    expect(stampUserMessageId(rows, null)).toBe(rows);
    const noUserRow = [assistant({ id: 'a1' })];
    expect(stampUserMessageId(noUserRow, 'u2')).toBe(noUserRow);
    expect(stampUserMessageId(undefined, 'u2')).toBeUndefined();
  });
});
