import { describe, it, expect } from 'vitest';
import { initialStreamState, reduceAll, reduceStream } from './responseStreamAdapter';
import { splitTurnSegments } from './turnSegments';
import { hydrateMessagesFromServerEvents } from './conversationHistory';

// A message the person sent while the turn ran (ENG-4194), as the stream and
// the app both report it.
const addon = (state, extra = {}) => ({ type: 'response.addon', addon_id: 'ad1', text: 'use the sales DB', state, decided_by: 'jev', at_ms: 30, ...extra });
const tool = (id, at_ms) => ({
  type: 'response.in_progress', thought_role: 'thought.tool_call.start', tool_use_id: id, tool_name: 'query', at_ms,
});

describe('responseStreamAdapter — response.addon', () => {
  it('adds an Addon step at the point it joined the turn', () => {
    const state = reduceAll([tool('t1', 10), addon('added'), tool('t2', 40)]);
    const badges = state.steps.map((s) => s.badge);
    expect(badges.indexOf('Addon')).toBe(1);
    expect(state.steps[1]).toMatchObject({ status: 'completed', startedAt: 30, data: { addon_id: 'ad1', state: 'added', text: 'use the sales DB' } });
  });

  it('follows the message from added to read, and ignores a replay', () => {
    let state = reduceAll([addon('added'), addon('read')]);
    expect(state.steps.map((s) => s.data.state)).toEqual(['read']);
    const again = reduceStream(state, addon('added'));
    expect(again).toBe(state);
  });

  it('does not clear a model-wait line', () => {
    const wait = { type: 'response.in_progress', thought_role: 'thought.progress', phase: 'model_wait', message: 'Waiting on the model', eta_seconds: 60, at_ms: 5 };
    const before = reduceStream(initialStreamState(), wait);
    expect(before.currentThought?.kind).toBe('model_wait');
    expect(reduceStream(before, addon('added')).currentThought).toBe(before.currentThought);
  });

  it('splits the turn around the added message', () => {
    const state = reduceAll([tool('t1', 10), addon('added'), tool('t2', 40)]);
    const segments = splitTurnSegments(state.steps, { startedAt: 0 });
    expect(segments.map((s) => s.kind)).toEqual(['steps', 'addon', 'steps']);
    expect(segments[1].step.data.text).toBe('use the sales DB');
  });
});

describe('hydrateMessagesFromServerEvents — saved add-ons', () => {
  it('folds a saved add-on into the turn it joined, without doubling one the events already show', () => {
    const events = [
      { type: 'response.created', response: { id: 'resp_1' }, at_ms: 1 },
      tool('t1', 10),
      addon('added'),
      addon('read'),
      { type: 'response.completed', at_ms: 50 },
    ];
    const out = hydrateMessagesFromServerEvents([
      { id: 'u1', role: 'user', content: 'build the report' },
      { id: 'u2', role: 'user', content: 'use the sales DB', metadata: { addon_of_turn: 'resp_1', decided_by: 'jev' } },
      { id: 'a1', role: 'assistant', content: 'done', events },
    ]);
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1']);
    expect(out[1].steps.filter((s) => s.badge === 'Addon').map((s) => s.data.state)).toEqual(['read']);
  });
});
