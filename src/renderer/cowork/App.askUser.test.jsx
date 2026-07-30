import { describe, it, expect, vi } from 'vitest';
import {
  pendingQuestionFor,
  drainQueueToInput,
  planQueueDrain,
  resolvePendingAnswer,
} from './App';

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

describe('planQueueDrain', () => {
  const queues = { 'conv-a': [{ text: 'first' }, { text: 'second' }] };

  it('drains the queue of the task the question belongs to', () => {
    expect(planQueueDrain([askStep()], ['conv-a'], queues, new Set())).toEqual({
      taskId: 'conv-a',
      questionId: 'ask:1',
      text: 'first\nsecond',
    });
  });

  it('finds the queue under either id a stream is known by', () => {
    // A tmp- id and the server's canonical id are both in play mid-adoption.
    expect(planQueueDrain([askStep()], ['tmp-1', 'conv-a'], queues, new Set())?.taskId)
      .toBe('conv-a');
  });

  it('skips a question it has already drained for', () => {
    const drained = new Set(['ask:1']);
    expect(planQueueDrain([askStep()], ['conv-a'], queues, drained)).toBeNull();
  });

  it('is a no-op with no pending question or no queued messages', () => {
    expect(planQueueDrain([], ['conv-a'], queues, new Set())).toBeNull();
    expect(planQueueDrain([askStep()], ['conv-a'], {}, new Set())).toBeNull();
    expect(planQueueDrain([askStep()], [], queues, new Set())).toBeNull();
  });
});

describe('resolvePendingAnswer', () => {
  const call = (steps, result) => resolvePendingAnswer({
    steps,
    conversationId: 'conv-a',
    text: 'my answer',
    submit: vi.fn(async () => result),
  });

  it('sends normally when no question is pending', async () => {
    const submit = vi.fn();
    await expect(resolvePendingAnswer({ steps: [], conversationId: 'c', text: 't', submit }))
      .resolves.toEqual({ action: 'send' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('consumes the send when the answer is accepted', async () => {
    await expect(call([askStep()], { accepted: true })).resolves.toEqual({ action: 'consumed' });
  });

  it('releases and falls through when the question is gone', async () => {
    // Neither status may discard the text — it falls through to a normal send.
    await expect(call([askStep()], { status: 'not_found' }))
      .resolves.toEqual({ action: 'send', release: true });
    await expect(call([askStep()], { status: 'already_answered' }))
      .resolves.toEqual({ action: 'send', release: true });
  });

  it('reports a retryable failure for error and rejected', async () => {
    const failed = await call([askStep()], { status: 'error' });
    expect(failed.action).toBe('fail');
    expect(failed.message).toMatch(/could not send your answer/i);
    const rejected = await call([askStep()], { status: 'rejected' });
    expect(rejected.action).toBe('fail');
    expect(rejected.message).toMatch(/rejected/i);
  });

  it('releases and sends for a status it does not recognise', async () => {
    // Fail safe: a status the server grows later must not silently swallow the
    // user's text. Only a body with NO status at all is a success.
    await expect(call([askStep()], { status: 'throttled' }))
      .resolves.toEqual({ action: 'send', release: true });
    await expect(call([askStep()], { status: '' }))
      .resolves.toEqual({ action: 'consumed' });
  });

  it('submits the typed text against the pending question id', async () => {
    const submit = vi.fn(async () => ({ accepted: true }));
    await resolvePendingAnswer({
      steps: [askStep(), askStep({ question_id: 'ask:2' })],
      conversationId: 'conv-a',
      text: 'the postgres one',
      submit,
    });
    expect(submit).toHaveBeenCalledWith('conv-a', 'ask:2', { text: 'the postgres one' });
  });
});
