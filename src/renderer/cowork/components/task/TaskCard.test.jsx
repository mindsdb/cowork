import { describe, it, expect } from 'vitest';
import { turnsCount } from './TaskCard';

describe('turnsCount', () => {
  it('uses the explicit count when the task carries one', () => {
    expect(turnsCount({ turns: 7, messages: [] })).toBe(7);
  });

  it('is unknown for a task not loaded at all (messages: [])', () => {
    expect(turnsCount({ messages: [] })).toBeNull();
  });

  it('counts user messages once the full history has loaded (hasMoreMessages: false)', () => {
    const task = {
      hasMoreMessages: false,
      messages: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ],
    };
    expect(turnsCount(task)).toBe(2);
  });

  it('is unknown for a partially-loaded task (ENG-2768) even though messages is non-empty', () => {
    // Only the most recent page is loaded — the count would be wrong, not
    // just incomplete, so this must not show a number at all.
    const task = {
      hasMoreMessages: true,
      messages: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }],
    };
    expect(turnsCount(task)).toBeNull();
  });

  it('is unknown when hasMoreMessages has never been set, even with messages present', () => {
    // A task whose pagination status is simply unknown (not yet fetched via
    // /items at all) must not be read as "definitely no more".
    const task = { messages: [{ role: 'user', content: 'q1' }] };
    expect(turnsCount(task)).toBeNull();
  });
});
