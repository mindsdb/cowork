import { describe, it, expect } from 'vitest';
import { initialStreamState, reduceStream, reduceAll, truncateLabel } from './responseStreamAdapter';

describe('currentThought (ENG-1108 — live train of thought, not a step)', () => {
  const now = () => 1000;

  it('accumulates reasoning deltas into a single ephemeral burst, not a step', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Considering ' },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'the options.' },
    ], initialStreamState(), now);

    expect(state.currentThought).toEqual({ text: 'Considering the options.', startedAt: 1000 });
    // Never becomes a persisted step.
    expect(state.steps).toEqual([]);
  });

  it('clears the burst once body text starts streaming', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Thinking…' },
      { type: 'response.output_text.delta', delta: 'Here' },
    ], initialStreamState(), now);

    expect(state.currentThought).toBeNull();
    expect(state.bodyText).toBe('Here');
  });

  it('clears the burst when a tool call starts, and a later burst starts fresh (no leak from the earlier one)', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'First thought.' },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'a' },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Second thought.' },
    ], initialStreamState(), now);

    // Only the second burst survives — no trailing text from the first.
    expect(state.currentThought).toEqual({ text: 'Second thought.', startedAt: 1000 });
    // The tool call is a real step; reasoning never is.
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]._isScratchpad).toBe(true);
  });

  it('clears the burst when a Hermes tool call starts', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'thinking', content: 'Deciding…' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.start', content: 'search', tool_use_id: 'a' },
    ], initialStreamState(), now);

    expect(state.currentThought).toBeNull();
  });

  it('clears the burst on response.completed', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Wrapping up.' },
      { type: 'response.completed' },
    ], initialStreamState(), now);

    expect(state.currentThought).toBeNull();
    expect(state.status).toBe('done');
  });

  it('clears the burst on response.failed', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Uh oh.' },
      { type: 'response.failed', error: 'boom' },
    ], initialStreamState(), now);

    expect(state.currentThought).toBeNull();
    expect(state.status).toBe('error');
  });

  it('ignores empty reasoning content without starting a burst', () => {
    const state = reduceStream(initialStreamState(), {
      type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: '',
    }, now);
    expect(state.currentThought).toBeNull();
  });
});

describe('truncateLabel', () => {
  it('returns the last non-empty line of accumulated text', () => {
    expect(truncateLabel('First line.\nSecond line.\n\nThird line.')).toBe('Third line.');
  });

  it('falls back to a placeholder for empty text', () => {
    expect(truncateLabel('')).toBe('Reasoning…');
    expect(truncateLabel(null)).toBe('Reasoning…');
  });

  it('truncates a long line and appends an ellipsis', () => {
    const long = 'x'.repeat(120);
    const out = truncateLabel(long);
    expect(out).toBe('x'.repeat(77) + '…');
  });
});
