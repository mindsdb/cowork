// ENG-1304 (PR #580 review): the skipped empty bubble and the orphan rule
// must agree, or a failed turn loses its delete affordance.
import { describe, it, expect } from 'vitest';
import { isSkippedFailedAssistant, isOrphanUser, lastVisibleTurnIdx } from './turnVisibility';

const user = (content = 'hi') => ({ role: 'user', content });
const assistant = (over = {}) => ({ role: 'assistant', content: '', ...over });
const error = (code = 'token_limit') => ({ role: 'error', code });

describe('isSkippedFailedAssistant', () => {
  it('skips an empty assistant followed by an error row', () => {
    const msgs = [user(), assistant(), error()];
    expect(isSkippedFailedAssistant(msgs, 1)).toBe(true);
  });

  it('skips an empty assistant followed by provider_required', () => {
    const msgs = [user(), assistant(), { role: 'provider_required' }];
    expect(isSkippedFailedAssistant(msgs, 1)).toBe(true);
  });

  it('keeps an assistant that produced content or steps', () => {
    expect(isSkippedFailedAssistant([user(), assistant({ content: 'partial' }), error()], 1)).toBe(false);
    expect(isSkippedFailedAssistant([user(), assistant({ steps: [{}] }), error()], 1)).toBe(false);
  });

  it('keeps an empty assistant not followed by an error', () => {
    expect(isSkippedFailedAssistant([user(), assistant()], 1)).toBe(false);
  });
});

describe('isOrphanUser', () => {
  it('a user whose only assistant is skipped keeps the delete affordance', () => {
    const msgs = [user(), assistant(), error()];
    expect(isOrphanUser(msgs, 0)).toBe(true);
  });

  it('a user with a real assistant bubble is not an orphan', () => {
    const msgs = [user(), assistant({ content: 'answer' })];
    expect(isOrphanUser(msgs, 0)).toBe(false);
  });

  it('a user with no following assistant is an orphan', () => {
    expect(isOrphanUser([user()], 0)).toBe(true);
    expect(isOrphanUser([user(), user()], 0)).toBe(true);
  });
});

describe('lastVisibleTurnIdx', () => {
  it('points at the user message when the final turn failed with a skipped bubble', () => {
    const msgs = [user(), assistant({ content: 'answer' }), user(), assistant(), error()];
    expect(lastVisibleTurnIdx(msgs)).toBe(2);
  });

  it('points at the last real assistant bubble', () => {
    const msgs = [user(), assistant({ content: 'answer' })];
    expect(lastVisibleTurnIdx(msgs)).toBe(1);
  });

  it('returns -1 when nothing renders', () => {
    expect(lastVisibleTurnIdx([])).toBe(-1);
    expect(lastVisibleTurnIdx([{ role: 'activity' }])).toBe(-1);
  });
});
