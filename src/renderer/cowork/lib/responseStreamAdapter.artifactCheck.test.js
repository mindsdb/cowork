// A preview check the agent asks for (ENG-4207) is answered by
// lib/artifactCheck and never becomes a chat step.
import { describe, it, expect } from 'vitest';
import { initialStreamState, reduceAll, reduceStream } from './responseStreamAdapter';

const CHECK = {
  type: 'response.artifact_check',
  check_id: 'acheck:1',
  artifact_slug: 'clock-7db94eb8',
  timeout_s: 30,
  at_ms: 100,
};

describe('response.artifact_check', () => {
  it('is not a step and leaves the state untouched', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' }, conversation_id: 'c1' },
    ]);

    expect(reduceStream(state, CHECK)).toBe(state);
  });

  it('does not appear in the steps of a whole turn, live or replayed', () => {
    const events = [
      { type: 'response.created', response: { id: 'r1' }, conversation_id: 'c1' },
      CHECK,
      CHECK,
      { type: 'response.completed', response: { id: 'r1', status: 'completed' } },
    ];

    expect(reduceAll(events).steps).toEqual([]);
    const replayed = events.reduce((s, e) => reduceStream(s, e, Date.now, { replay: true }), initialStreamState());
    expect(replayed.steps).toEqual([]);
  });

  it('keeps a model-wait line: a check is not news from the model', () => {
    const waiting = { text: 'Waiting for the model', startedAt: 100, kind: 'model_wait' };
    const state = { ...initialStreamState(), currentThought: waiting };

    expect(reduceStream(state, CHECK).currentThought).toBe(waiting);
  });
});
