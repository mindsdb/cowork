import { describe, it, expect } from 'vitest';
import { initialStreamState, reduceStream, reduceAll } from './responseStreamAdapter';

const ASK = {
  type: 'response.ask_user',
  question_id: 'ask:1',
  prompt: 'Which database?',
  select: 'one',
  allow_custom: true,
  timeout_s: 300,
  options: [
    { value: 'pg', label: 'postgres', detail: 'primary' },
    { value: 'my', label: 'mysql', detail: '' },
  ],
};

const ANSWERED = {
  type: 'response.ask_user_answered',
  question_id: 'ask:1',
  status: 'answered',
  values: ['pg'],
  text: '',
};

const question = (state) => state.steps.find((s) => s.badge === 'AskUser');

describe('responseStreamAdapter — ask_user', () => {
  it('creates a badged step carrying the whole question', () => {
    const state = reduceStream(initialStreamState(), ASK);
    const step = question(state);
    expect(step).toBeTruthy();
    expect(step.badge).toBe('AskUser');
    expect(step.status).toBe('in_progress');
    expect(step._questionKey).toBe('ask:1');
    expect(step.data.prompt).toBe('Which database?');
    expect(step.data.select).toBe('one');
    expect(step.data.allow_custom).toBe(true);
    expect(step.data.options.map((o) => o.value)).toEqual(['pg', 'my']);
    expect(step.data.answer).toBeNull();
  });

  it('is idempotent — a replayed duplicate does not add a second card', () => {
    const once = reduceStream(initialStreamState(), ASK);
    const twice = reduceStream(once, ASK);
    expect(twice.steps.filter((s) => s.badge === 'AskUser')).toHaveLength(1);
  });

  it('marks the question answered in place', () => {
    const state = reduceAll([ASK, ANSWERED]);
    const step = question(state);
    expect(state.steps.filter((s) => s.badge === 'AskUser')).toHaveLength(1);
    expect(step.status).toBe('completed');
    expect(step.data.answer).toEqual({ status: 'answered', values: ['pg'], text: '' });
  });

  it('records a skip as cancelled', () => {
    const state = reduceAll([ASK, { ...ANSWERED, status: 'cancelled', values: [] }]);
    expect(question(state).data.answer.status).toBe('cancelled');
  });

  it('replaying a finished exchange yields an answered card, never live buttons', () => {
    // This is the /tail-from-seq-0 case: the reducer runs over the whole
    // buffer, so an already-answered question must not come back clickable.
    let state = initialStreamState();
    for (const ev of [ASK, ANSWERED]) {
      state = reduceStream(state, ev, Date.now, { replay: true });
    }
    expect(question(state).status).toBe('completed');
    expect(question(state).data.answer.status).toBe('answered');
  });

  it('an answer for an unknown question is ignored rather than throwing', () => {
    const state = reduceStream(initialStreamState(), ANSWERED);
    expect(state.steps).toHaveLength(0);
  });

  it('leaves state untouched for an unknown event type', () => {
    // Documents the silent-drop behaviour the server-side kill switch exists
    // to protect against.
    const before = initialStreamState();
    expect(reduceStream(before, { type: 'response.some_future_thing' })).toBe(before);
  });

});
