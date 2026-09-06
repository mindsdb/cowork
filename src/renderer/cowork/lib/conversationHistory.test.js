import { describe, it, expect, beforeEach } from 'vitest';
import {
  stripStreaming,
  removeThinkingPlaceholder,
  withThinkingPlaceholder,
  markActivityDone,
  humanizeToken,
  describeActivity,
  reconcileTaskMessages,
  readConvTurns,
  writeConvTurns,
  persistTurnState,
  mergeConvTurns,
  migrateLegacyArtifacts,
  reduceServerEvents,
  failedEventMeta,
  hydrateMessagesFromServerEvents,
  applySessionMessages,
} from './conversationHistory';

const user = (content) => ({ role: 'user', content });
const assistant = (extra = {}) => ({ role: 'assistant', content: 'hi', ...extra });
const streaming = () => ({ role: '_streaming', content: '', steps: [] });
const placeholder = () => ({ role: 'activity', content: 'Thinking…', placeholder: true, state: 'running' });

describe('stripStreaming', () => {
  it('drops _streaming rows and keeps the rest', () => {
    const out = stripStreaming([user('q'), streaming(), assistant()]);
    expect(out).toEqual([user('q'), assistant()]);
  });
});

describe('removeThinkingPlaceholder', () => {
  it('drops only placeholder activity rows', () => {
    const running = { role: 'activity', content: 'Reading file', state: 'running' };
    const out = removeThinkingPlaceholder([user('q'), placeholder(), running]);
    expect(out).toEqual([user('q'), running]);
  });
});

describe('withThinkingPlaceholder', () => {
  it('strips prior _streaming + placeholder, then appends an activity + _streaming stub', () => {
    const out = withThinkingPlaceholder([user('q'), placeholder(), streaming()]);
    expect(out[0]).toEqual(user('q'));
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ role: 'activity', placeholder: true, content: 'Thinking…' });
    expect(out[2]).toMatchObject({ role: '_streaming', streamStatus: 'thinking', _placeholderLabel: 'Thinking…' });
  });

  it('threads a caller-supplied label through both new rows', () => {
    const out = withThinkingPlaceholder([], { label: 'Creating task…' });
    expect(out[0]).toMatchObject({ role: 'activity', _label: 'Creating task…' });
    expect(out[1]).toMatchObject({ role: '_streaming', _placeholderLabel: 'Creating task…' });
  });
});

describe('markActivityDone', () => {
  it('flips running activity rows to done and leaves others untouched', () => {
    const out = markActivityDone([
      { role: 'activity', state: 'running' },
      { role: 'activity', state: 'done' },
      assistant(),
    ]);
    expect(out[0].state).toBe('done');
    expect(out[1].state).toBe('done');
    expect(out[2]).toEqual(assistant());
  });
});

describe('humanizeToken', () => {
  it('normalizes separators and whitespace', () => {
    expect(humanizeToken('tool_result-name')).toBe('tool result name');
    expect(humanizeToken('  a__b  ')).toBe('a b');
    expect(humanizeToken(null)).toBe('');
  });
});

describe('describeActivity', () => {
  it('describes a tool_result with a capitalized action', () => {
    expect(describeActivity({ type: 'tool_result', action: 'read', name: 'file_store' }))
      .toBe('Read file store');
  });
  it('prefers an explicit message', () => {
    expect(describeActivity({ message: 'Summarizing results' })).toBe('Summarizing results');
  });
  it('maps the reasoning phase to the thinking placeholder', () => {
    expect(describeActivity({ phase: 'reasoning' })).toBe('Thinking...');
  });
  it('falls back to an agent-working line', () => {
    expect(describeActivity({}, 'Ada')).toBe('Ada is working');
    expect(describeActivity({ phase: 'planning' }, 'Ada')).toBe('Ada is planning');
  });
});

describe('reconcileTaskMessages', () => {
  it('returns a live conversation untouched', () => {
    const msgs = [user('q'), streaming()];
    expect(reconcileTaskMessages(msgs, true)).toBe(msgs);
  });

  it('when the server is in-flight but nothing is rendered yet, shows a Running placeholder', () => {
    const out = reconcileTaskMessages([user('q')], false, true);
    expect(out.at(-1)).toMatchObject({ role: '_streaming', _placeholderLabel: 'Running task…' });
  });

  it('when the server is in-flight with content, leaves it alone', () => {
    const msgs = [user('q'), assistant()];
    expect(reconcileTaskMessages(msgs, false, true)).toBe(msgs);
  });

  it('when not live, drops _streaming/activity and collapses running steps + streamStatus', () => {
    const out = reconcileTaskMessages([
      user('q'),
      streaming(),
      { role: 'activity', state: 'running' },
      { role: 'assistant', streamStatus: 'streaming', steps: [{ status: 'running' }, { status: 'completed' }] },
    ], false);
    expect(out.some((m) => m.role === '_streaming' || m.role === 'activity')).toBe(false);
    const a = out.find((m) => m.role === 'assistant');
    expect(a.streamStatus).toBe('done');
    expect(a.steps[0].status).toBe('completed');
    expect(a.steps[0].completedAt).toBeTruthy();
    expect(a.steps[1].status).toBe('completed');
  });
});

describe('conversation-turn sidecar (localStorage)', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through read/write', () => {
    expect(readConvTurns('c1')).toBeNull();
    writeConvTurns('c1', { 0: { steps: [{ id: 's' }], startedAt: 1 } });
    expect(readConvTurns('c1')).toEqual({ 0: { steps: [{ id: 's' }], startedAt: 1 } });
  });

  it('persistTurnState whitelists serialisable step fields and ignores empty step lists', () => {
    persistTurnState('c1', 0, [], 1);
    expect(readConvTurns('c1')).toBeNull();
    persistTurnState('c1', 0, [{ id: 's1', status: 'completed', cellStatus: 'error', fn: () => {}, executionDurationMs: 42 }], 5);
    const saved = readConvTurns('c1')[0];
    expect(saved.startedAt).toBe(5);
    expect(saved.steps[0]).toMatchObject({ id: 's1', status: 'completed', cellStatus: 'error', executionDurationMs: 42 });
    expect(saved.steps[0]).not.toHaveProperty('fn');
  });

  it('mergeConvTurns fills persisted steps onto step-less assistant turns only', () => {
    persistTurnState('c1', 0, [{ id: 'saved', status: 'completed' }], 9);
    const out = mergeConvTurns('c1', [
      user('q'),
      assistant(),
    ]);
    expect(out[1].steps).toEqual([expect.objectContaining({ id: 'saved' })]);
  });

  it('mergeConvTurns never overwrites live steps', () => {
    persistTurnState('c1', 0, [{ id: 'saved', status: 'completed' }], 9);
    const out = mergeConvTurns('c1', [assistant({ steps: [{ id: 'live' }] })]);
    expect(out[0].steps).toEqual([{ id: 'live' }]);
  });

  it('migrateLegacyArtifacts promotes the old artifact-only sidecar and clears it', () => {
    localStorage.setItem('anton:conv-artifacts:c1', JSON.stringify({ 0: [{ id: 'art' }] }));
    migrateLegacyArtifacts('c1');
    expect(readConvTurns('c1')[0].steps).toEqual([{ id: 'art' }]);
    expect(localStorage.getItem('anton:conv-artifacts:c1')).toBeNull();
  });
});

const ASK = {
  type: 'response.ask_user',
  question_id: 'ask:1',
  prompt: 'Which database?',
  select: 'one',
  options: [{ value: 'pg', label: 'postgres' }],
};

describe('reduceServerEvents', () => {
  it('returns null for an empty log', () => {
    expect(reduceServerEvents([])).toBeNull();
    expect(reduceServerEvents(null)).toBeNull();
  });

  it('replays events into steps and a terminal done status', () => {
    const reduced = reduceServerEvents([ASK, { type: 'response.completed' }], 100);
    expect(reduced.status).toBe('done');
    expect(reduced.steps.length).toBeGreaterThan(0);
  });
});

describe('failedEventMeta', () => {
  it('is null when no response.failed is present', () => {
    expect(failedEventMeta([ASK])).toBeNull();
  });

  it('extracts the last failure with its retry hints', () => {
    const meta = failedEventMeta([
      { type: 'response.failed', code: 'rate_limited', error: 'Too many requests', reconnectable: false, retry_after: 30 },
    ]);
    expect(meta).toMatchObject({
      code: 'rate_limited',
      message: 'Too many requests',
      reconnectable: false,
      retryAfter: 30,
      resetAt: null,
    });
  });

  it('extracts the request id so a generic failure stays traceable', () => {
    const meta = failedEventMeta([
      { type: 'response.failed', code: 'anton_error', error: 'An unexpected error occurred.', request_id: 'corr-abc' },
    ]);
    expect(meta.requestId).toBe('corr-abc');
  });
});

describe('hydrateMessagesFromServerEvents', () => {
  it('passes through messages that carry no events', () => {
    const msgs = [user('q'), assistant()];
    expect(hydrateMessagesFromServerEvents(msgs)).toEqual(msgs);
  });

  it('reduces an events sidecar into steps, marks the turn complete, and drops raw events', () => {
    const out = hydrateMessagesFromServerEvents([
      { role: 'assistant', content: '', events: [ASK, { type: 'response.completed' }] },
    ]);
    expect(out[0]).not.toHaveProperty('events');
    expect(out[0]._turnComplete).toBe(true);
    expect(out[0].steps.length).toBeGreaterThan(0);
  });

  it('appends a plain error bubble after a non-config failure', () => {
    const out = hydrateMessagesFromServerEvents([
      { role: 'assistant', content: '', events: [{ type: 'response.failed', code: 'rate_limited', error: 'Too many requests' }] },
    ]);
    const err = out.find((m) => m.role === 'error');
    expect(err).toMatchObject({ content: 'Too many requests', code: 'rate_limited' });
  });

  it('carries the request id onto the error bubble', () => {
    const out = hydrateMessagesFromServerEvents([
      { role: 'assistant', content: '', events: [{ type: 'response.failed', code: 'anton_error', error: 'An unexpected error occurred.', request_id: 'corr-abc' }] },
    ]);
    const err = out.find((m) => m.role === 'error');
    expect(err.requestId).toBe('corr-abc');
  });

  it('appends a provider_required bubble after a config failure', () => {
    const out = hydrateMessagesFromServerEvents([
      { role: 'assistant', content: '', events: [{ type: 'response.failed', code: 'config_required', error: 'Configure ANTON_API_KEY' }] },
    ]);
    expect(out.some((m) => m.role === 'provider_required')).toBe(true);
  });
});

describe('applySessionMessages', () => {
  beforeEach(() => localStorage.clear());

  it('hydrates, merges the sidecar, and reconciles in one pass', () => {
    persistTurnState('c1', 0, [{ id: 'saved', status: 'completed' }], 9);
    const out = applySessionMessages('c1', [user('q'), assistant()], { isLive: false });
    expect(out.find((m) => m.role === 'assistant').steps).toEqual([expect.objectContaining({ id: 'saved' })]);
  });

  it('skips the local sidecar merge when asked', () => {
    persistTurnState('c1', 0, [{ id: 'saved', status: 'completed' }], 9);
    const out = applySessionMessages('c1', [assistant()], { skipLocalSidecar: true });
    expect(out[0]).not.toHaveProperty('steps');
  });
});
