import { describe, it, expect, vi } from 'vitest';
import { pendingQuestionFor, drainQueueToInput } from './App';

const askStep = (over = {}) => ({
  badge: 'AskUser',
  status: 'in_progress',
  data: { question_id: 'ask:1', answer: null, ...over },
});

describe('pendingQuestionFor', () => {
  it('finds an unanswered question in the live steps', () => {
    expect(pendingQuestionFor([askStep()])).toEqual({ question_id: 'ask:1' });
  });

  it('ignores an answered one', () => {
    expect(
      pendingQuestionFor([askStep({ answer: { status: 'answered', values: ['pg'] } })]),
    ).toBeNull();
  });

  it('ignores non-question steps and empty input', () => {
    expect(pendingQuestionFor([{ badge: 'Artifact' }])).toBeNull();
    expect(pendingQuestionFor([])).toBeNull();
    expect(pendingQuestionFor(undefined)).toBeNull();
  });

  it('returns the last pending question when several exist', () => {
    const steps = [askStep(), askStep({ question_id: 'ask:2' })];
    expect(pendingQuestionFor(steps)).toEqual({ question_id: 'ask:2' });
  });
});

describe('drainQueueToInput', () => {
  it('joins queued messages with newlines', () => {
    expect(
      drainQueueToInput([{ text: 'first' }, { text: 'second' }]),
    ).toBe('first\nsecond');
  });

  it('is empty for an empty queue', () => {
    expect(drainQueueToInput([])).toBe('');
    expect(drainQueueToInput(undefined)).toBe('');
  });
});
