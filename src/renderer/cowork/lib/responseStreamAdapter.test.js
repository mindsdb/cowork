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

describe('preamble reclassification (ENG-1108 — narration before a tool call is not the answer)', () => {
  const now = () => 1000;

  it('moves answer text that precedes a scratchpad tool call into the thought line, clearing bodyText', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_text.delta', delta: "Let me verify SpaceX's status first." },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'a' },
    ], initialStreamState(), now);

    // Preamble is NOT left sitting in the answer…
    expect(state.bodyText).toBe('');
    // …it's shown as the current inner-dialogue thought instead.
    expect(state.currentThought).toEqual({
      text: "Let me verify SpaceX's status first.",
      startedAt: 1000,
      _isPreamble: true,
    });
    // And the tool call still became a real step.
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]._isScratchpad).toBe(true);
  });

  it('moves preamble before a Hermes tool_call.start too', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_text.delta', delta: 'Checking the docs.' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.start', content: 'search', tool_use_id: 'a' },
    ], initialStreamState(), now);

    expect(state.bodyText).toBe('');
    expect(state.currentThought).toEqual({
      text: 'Checking the docs.',
      startedAt: 1000,
      _isPreamble: true,
    });
  });

  it('replaces reclassified narration when genuine reasoning resumes', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_text.delta', delta: 'Checking the docs.' },
      { type: 'response.in_progress', thought_role: 'thought.tool_call.start', content: 'search', tool_use_id: 'a' },
      {
        type: 'response.in_progress',
        thought_role: 'thought.progress',
        subtype: 'reasoning',
        content: 'Analyzing the result.',
        at_ms: 2000,
      },
    ], initialStreamState(), now);

    expect(state.currentThought).toEqual({
      text: 'Analyzing the result.',
      startedAt: 2000,
    });
  });

  it('keeps the FINAL round text (no tool call after it) as the answer', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_text.delta', delta: 'First, let me check.' },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'a' },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.result', tool_use_id: 'a', content: '{"stdout":"ok"}' },
      { type: 'response.output_text.delta', delta: 'Here is the real answer.' },
      { type: 'response.completed' },
    ], initialStreamState(), now);

    // Only the final round's text survives as the answer — the preamble
    // ("First, let me check.") is gone from bodyText.
    expect(state.bodyText).toBe('Here is the real answer.');
    // Thought line is cleared once the turn completes.
    expect(state.currentThought).toBeNull();
  });

  it('seals the reasoning burst on a tool start when there is no preamble (next burst starts fresh)', () => {
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'Planning.' },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 'a' },
      { type: 'response.in_progress', thought_role: 'thought.progress', subtype: 'reasoning', content: 'New plan.' },
    ], initialStreamState(), now);

    // The tool call sealed the first burst, so the resumed reasoning is a
    // fresh burst — no "Planning." leaking into it.
    expect(state.bodyText).toBe('');
    expect(state.currentThought).toEqual({ text: 'New plan.', startedAt: 1000 });
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
