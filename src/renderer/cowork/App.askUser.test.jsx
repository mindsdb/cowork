import { describe, it, expect, vi } from 'vitest';
import {
  pendingQuestionFor,
  drainQueueToInput,
  drainQueueAttachments,
  planQueueDrain,
  retireQuestionFromSteps,
  resolvePendingAnswer,
} from './App';

const askStep = (over = {}) => ({
  badge: 'AskUser',
  status: 'in_progress',
  data: { question_id: 'ask:1', answer: null, ...over },
});

describe('pendingQuestionFor', () => {
  it('finds an unanswered question in the live steps', () => {
    expect(pendingQuestionFor([askStep()])).toEqual({
      question_id: 'ask:1',
      allow_custom: true,
    });
  });

  it('carries allow_custom, defaulting to true when absent', () => {
    // The composer needs it to decide whether typed text can be an answer at
    // all; absent must stay permissive (the adapter's own default).
    expect(pendingQuestionFor([askStep({ allow_custom: false })])?.allow_custom).toBe(false);
    expect(pendingQuestionFor([askStep({ allow_custom: true })])?.allow_custom).toBe(true);
    expect(pendingQuestionFor([askStep()])?.allow_custom).toBe(true);
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
    expect(pendingQuestionFor(steps)).toEqual({
      question_id: 'ask:2',
      allow_custom: true,
    });
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

describe('drainQueueAttachments', () => {
  it('returns the files every drained message was carrying', () => {
    expect(drainQueueAttachments([
      { text: 'first', attachments: [{ id: 'a1' }] },
      { text: 'second', attachments: [{ id: 'a2' }] },
    ])).toEqual([{ id: 'a1' }, { id: 'a2' }]);
  });

  it('dedupes by id — a re-queued item reuses its own list', () => {
    expect(drainQueueAttachments([
      { attachments: [{ id: 'a1' }] },
      { attachments: [{ id: 'a1' }, { id: 'a2' }] },
    ])).toEqual([{ id: 'a1' }, { id: 'a2' }]);
  });

  it('is empty for a queue that carried no files', () => {
    expect(drainQueueAttachments([{ text: 'first' }])).toEqual([]);
    expect(drainQueueAttachments([])).toEqual([]);
    expect(drainQueueAttachments(undefined)).toEqual([]);
  });
});

describe('planQueueDrain', () => {
  const queues = { 'conv-a': [{ text: 'first' }, { text: 'second' }] };

  it('drains the queue of the task the question belongs to', () => {
    expect(planQueueDrain([askStep()], ['conv-a'], queues, new Set())).toEqual({
      taskId: 'conv-a',
      queueTaskId: 'conv-a',
      questionId: 'ask:1',
      text: 'first\nsecond',
      attachments: [],
    });
  });

  it('finds the queue under either id a stream is known by', () => {
    // A tmp- id and the server's canonical id are both in play mid-adoption.
    expect(planQueueDrain([askStep()], ['tmp-1', 'conv-a'], queues, new Set())?.queueTaskId)
      .toBe('conv-a');
  });

  it('redirects to the current id even when the queue is under an alias', () => {
    // enqueueMessage filed the messages under the task's pre-adoption tmp- id;
    // adoptServerId renamed the task without re-keying the queue. The queue has
    // to be found under the dead key, but the text must be handed back to the
    // id the task has now, or ChatView will never match it.
    const plan = planQueueDrain(
      [askStep()],
      ['conv-new', 'tmp-1'],
      { 'tmp-1': [{ text: 'queued before adoption' }] },
      new Set(),
    );
    expect(plan).toEqual({
      taskId: 'conv-new',
      queueTaskId: 'tmp-1',
      questionId: 'ask:1',
      text: 'queued before adoption',
      attachments: [],
    });
  });

  it('carries the queued files out with the text', () => {
    // The caller deletes the queue entry right after this, so a plan without
    // `attachments` is the same silent file loss enqueueMessage exists to stop.
    const plan = planQueueDrain(
      [askStep()],
      ['conv-a'],
      { 'conv-a': [{ text: 'look at this', attachments: [{ id: 'a1' }] }] },
      new Set(),
    );
    expect(plan.attachments).toEqual([{ id: 'a1' }]);
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

describe('retireQuestionFromSteps', () => {
  it('removes only the named question', () => {
    // The point of the granularity: a card that 404s must not take a sibling
    // question the turn is genuinely blocked on down with it. Nothing re-arms
    // the interception — while a question is pending no stream event arrives to
    // rewrite the mirror.
    const steps = [
      askStep(),
      askStep({ question_id: 'ask:2' }),
      { badge: 'Skill', data: {} },
    ];
    const next = retireQuestionFromSteps(steps, 'ask:1');
    expect(next.filter((s) => s.badge === 'AskUser').map((s) => s.data.question_id))
      .toEqual(['ask:2']);
    // And it is still a pending question afterwards, which is what the composer
    // interception reads.
    expect(pendingQuestionFor(next)).toEqual({
      question_id: 'ask:2',
      allow_custom: true,
    });
  });

  it('keeps non-question steps', () => {
    const steps = [askStep(), { badge: 'Artifact', data: {} }];
    expect(retireQuestionFromSteps(steps, 'ask:1')).toEqual([{ badge: 'Artifact', data: {} }]);
  });

  it('falls back to a blanket clear when the caller cannot name the question', () => {
    expect(retireQuestionFromSteps([askStep()], undefined)).toEqual([]);
    expect(retireQuestionFromSteps(undefined, 'ask:1')).toEqual([]);
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

  it('blocks the send for a select-only question, without submitting', async () => {
    // allow_custom:false means the card renders nowhere to type, the server
    // rejects free text with INVALID_OPTION, and the user's words are usually
    // not an answer at all. Decided before the network call.
    const submit = vi.fn();
    const outcome = await resolvePendingAnswer({
      steps: [askStep({ allow_custom: false })],
      conversationId: 'conv-a',
      text: 'wait, show me the schema first',
      submit,
    });
    expect(outcome.action).toBe('blocked');
    expect(outcome.message).toMatch(/one of the options above/i);
    expect(outcome.message).toMatch(/skip/i);
    expect(submit).not.toHaveBeenCalled();
  });

  it('still submits typed text when the question allows it', async () => {
    const submit = vi.fn(async () => ({ accepted: true }));
    await resolvePendingAnswer({
      steps: [askStep({ allow_custom: true })],
      conversationId: 'conv-a',
      text: 'my own words',
      submit,
    });
    expect(submit).toHaveBeenCalledWith('conv-a', 'ask:1', { text: 'my own words' });
  });

  it('releases and falls through when the question is gone', async () => {
    // Neither status may discard the text — it falls through to a normal send.
    await expect(call([askStep()], { status: 'not_found' }))
      .resolves.toEqual({ action: 'send', release: true, questionId: 'ask:1' });
    await expect(call([askStep()], { status: 'already_answered' }))
      .resolves.toEqual({ action: 'send', release: true, questionId: 'ask:1' });
  });

  it('names the question to release, so the caller retires only that one', async () => {
    // Without the id the caller can only blank the whole mirror, which drops a
    // live sibling question's interception (see retireQuestionFromSteps).
    const outcome = await call(
      [askStep(), askStep({ question_id: 'ask:2' })],
      { status: 'not_found' },
    );
    expect(outcome.questionId).toBe('ask:2');
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
      .resolves.toEqual({ action: 'send', release: true, questionId: 'ask:1' });
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
