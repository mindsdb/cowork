/* A send names the picks it goes back to the default on, so cowork-server
   clears the saved ones, while a pinned model the picker no longer offers
   goes out as no model and keeps its pin. */
import { describe, it, expect } from 'vitest';
import { turnResetPicks } from './App';
import { MODEL_ROUTER_ID } from './lib/modelCatalog';

describe('turnResetPicks', () => {
  it('resets the model when the task is on Model Router or Operator default', () => {
    expect(turnResetPicks({ model: MODEL_ROUTER_ID, reasoningEffort: 'low' })).toEqual(['model']);
  });

  it('resets the effort when the composer left it on Default', () => {
    expect(turnResetPicks({ model: 'opus-5-5', reasoningEffort: '' })).toEqual(['reasoning_effort']);
  });

  it('resets both together', () => {
    expect(turnResetPicks({ model: MODEL_ROUTER_ID, reasoningEffort: '' })).toEqual(['model', 'reasoning_effort']);
  });

  it('keeps a pinned model, which goes out as no model when the picker no longer offers it', () => {
    expect(turnResetPicks({ model: 'gpt-luna-5-6', reasoningEffort: 'high' })).toEqual([]);
  });

  it('resets nothing for a task that never picked', () => {
    expect(turnResetPicks({ model: null, reasoningEffort: null })).toEqual([]);
    expect(turnResetPicks({})).toEqual([]);
  });

  it('resets nothing a same-tick override sends', () => {
    expect(turnResetPicks(
      { model: MODEL_ROUTER_ID, reasoningEffort: '' },
      { modelOverride: 'mindshub_air', effortOverride: 'low' },
    )).toEqual([]);
  });
});
