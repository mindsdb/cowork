import { describe, it, expect } from 'vitest';
import { turnsAfter, deleteTurnTitle, deleteTurnMessage } from './deleteTurnWarning';

const user = (content) => ({ role: 'user', content });
const assistant = (content) => ({ role: 'assistant', content });

const convo = [user('a'), assistant('A'), user('b'), assistant('B'), user('c'), assistant('C')];

describe('turnsAfter', () => {
  it('counts the exchanges that go with the one being deleted', () => {
    expect(turnsAfter(convo, 0)).toBe(2);
    expect(turnsAfter(convo, 1)).toBe(1);
  });

  it('is 0 for the last exchange, which takes nothing with it', () => {
    expect(turnsAfter(convo, 2)).toBe(0);
  });

  it('counts a turn that never got an answer — it is still a question that disappears', () => {
    const stopped = [user('a'), assistant('A'), user('b')];
    expect(turnsAfter(stopped, 0)).toBe(1);
  });

  it('ignores rows that are not turns, so cards and errors never inflate the count', () => {
    const noisy = [user('a'), assistant('A'), { role: 'error' }, { role: 'provider_required' }, user('b')];
    expect(turnsAfter(noisy, 0)).toBe(1);
  });

  it('is 0 on missing or nonsensical input rather than promising a negative cut', () => {
    expect(turnsAfter(undefined, 0)).toBe(0);
    expect(turnsAfter(convo, -1)).toBe(0);
    expect(turnsAfter(convo, undefined)).toBe(0);
    expect(turnsAfter(convo, 9)).toBe(0);
  });
});

describe('the dialog text', () => {
  it('says the tail goes too, and how much of it', () => {
    expect(deleteTurnTitle(2)).toBe('Delete this exchange and everything after it?');
    expect(deleteTurnMessage(2, 'Anton')).toContain('2 exchanges below it will be removed too');
  });

  it('counts one trailing exchange in the singular', () => {
    expect(deleteTurnMessage(1, 'Anton')).toContain('The exchange below it will be removed too');
  });

  it('promises nothing extra when the exchange is the last one', () => {
    expect(deleteTurnTitle(0)).toBe('Delete this exchange?');
    const msg = deleteTurnMessage(0, 'Anton');
    expect(msg).toContain("Anton's response");
    expect(msg).not.toContain('below it');
    expect(msg).toContain('this turn');
  });

  it('always keeps the on-disk and irreversibility warnings', () => {
    for (const trailing of [0, 1, 5]) {
      expect(deleteTurnMessage(trailing, 'Anton')).toContain('stay on disk');
      expect(deleteTurnMessage(trailing, 'Anton')).toContain("This can't be undone.");
    }
  });
});
