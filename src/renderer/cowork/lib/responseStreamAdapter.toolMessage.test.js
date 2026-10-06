import { describe, it, expect } from 'vitest';
import { initialStreamState, reduceStream, reduceAll } from './responseStreamAdapter';
import { hydrateMessagesFromServerEvents } from './conversationHistory';

const progress = (text, at_ms) => ({
  type: 'response.in_progress',
  thought_role: 'thought.tool_call.progress',
  tool_use_id: 'ga',
  tool_name: 'generate_artifact',
  content: text,
  at_ms,
});
const message = (content, at_ms = 20) => ({
  type: 'response.in_progress',
  thought_role: 'thought.tool_call.message',
  tool_use_id: 'ga',
  tool_name: 'generate_artifact',
  content,
  at_ms,
});

describe('responseStreamAdapter — tool message', () => {
  it('appends a completed Message step carrying the markdown', () => {
    const state = reduceAll([progress('Preparing a short brief for you', 10), message('## Goal\nA clock.')]);
    const step = state.steps[state.steps.length - 1];
    expect(step).toMatchObject({
      badge: 'Message',
      status: 'completed',
      startedAt: 20,
      completedAt: 20,
      _toolUseId: 'ga',
      data: { markdown: '## Goal\nA clock.' },
    });
  });

  it('closes the progress row that produced it', () => {
    const state = reduceAll([progress('Preparing a short brief for you', 10), message('## Brief')]);
    const row = state.steps.find((s) => s.badge === 'ToolProgress');
    expect(row.status).toBe('completed');
    expect(row.completedAt).toBe(20);
  });

  it('ignores an empty message', () => {
    const before = initialStreamState();
    expect(reduceStream(before, message('   '))).toBe(before);
  });

  it('never patches a running scratchpad cell, even without a tool_use_id', () => {
    // Id-less scratchpad events patch the last open cell; a message must not.
    const state = reduceAll([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start' },
      { ...message('## Brief'), tool_use_id: undefined },
    ]);
    const cell = state.steps.find((s) => s._isScratchpad);
    expect(cell.status).toBe('in_progress');
    expect(cell.output ?? null).toBeNull();
    const msg = state.steps.find((s) => s.badge === 'Message');
    expect(msg).toMatchObject({ data: { markdown: '## Brief' }, _toolUseId: null });
    expect(state.bodyText).toBe('');
  });

  it('rebuilds the same step on replay', () => {
    const state = reduceStream(initialStreamState(), message('## Brief'), Date.now, { replay: true });
    expect(state.steps.map((s) => s.badge)).toEqual(['Message']);
  });

  it('survives a reload from the events sidecar', () => {
    const [turn] = hydrateMessagesFromServerEvents([
      { role: 'assistant', content: 'Done.', events: [message('## Brief'), { type: 'response.completed' }] },
    ]);
    expect(turn.steps.map((s) => s.badge)).toEqual(['Message']);
    expect(turn.steps[0].data.markdown).toBe('## Brief');
    expect(turn.content).toBe('Done.');
  });
});
