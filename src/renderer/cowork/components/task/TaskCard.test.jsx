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

  it('is unknown for a partially-loaded task even though messages is non-empty', () => {
    // Only the most recent page is loaded — the count would be wrong, not
    // just incomplete, so this must not show a number at all.
    const task = {
      hasMoreMessages: true,
      messages: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }],
    };
    expect(turnsCount(task)).toBeNull();
  });

  it('counts directly when hasMoreMessages has never been set — a brand-new or purely local task', () => {
    // A task built up client-side this session (a new chat, or one that's
    // only ever streamed) has never been fetched via /items at all, so
    // hasMoreMessages is simply absent — but nothing else could have added
    // to its history, so `messages` already IS the complete total. Hiding
    // the count here would be a regression: every freshly-created task
    // would show no turn count until the user navigated away and back.
    const task = {
      messages: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }],
    };
    expect(turnsCount(task)).toBe(1);
  });
});
