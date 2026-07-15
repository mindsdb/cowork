import { describe, it, expect, vi, beforeEach } from 'vitest';

// WS2-T5 adapter label + WS5-T2 task lifecycle. Mock the analytics module so we
// can assert the content-free browser funnel events fire at the right moments.
const analyticsMock = vi.hoisted(() => ({
  trackArtifactBuilt: vi.fn(),
  trackTokenCapHit: vi.fn(),
  trackBrowserTaskStarted: vi.fn(),
  trackBrowserTaskSucceeded: vi.fn(),
  trackBrowserTaskFailed: vi.fn(),
  trackBrowserResultTime: vi.fn(),
}));

vi.mock('./analytics', () => analyticsMock);

import { initialStreamState, reduceStream } from './responseStreamAdapter';

// Helper to feed a browser tool-call start event.
function browserStart(state, { toolUseId = 't1', args = {}, at = 1000 } = {}) {
  return reduceStream(state, {
    type: 'response.in_progress',
    thought_role: 'thought.tool_call.start',
    content: 'browser_control',
    tool_use_id: toolUseId,
    args,
    at_ms: at,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('browser tool-call step labelling (WS2-T5)', () => {
  it('gives browser_control a Browser badge + search icon and uses progress_message', () => {
    let s = initialStreamState();
    s = browserStart(s, { args: { action: 'inspect', progress_message: 'Reading account list' } });
    const step = s.steps[s.steps.length - 1];
    expect(step.badge).toBe('Browser');
    expect(step.icon).toBe('search');
    expect(step.label).toBe('Reading account list');
    expect(step._isBrowserAction).toBe(true);
  });

  it('falls back to an action verb when progress_message is absent', () => {
    let s = initialStreamState();
    s = browserStart(s, { args: { action: 'follow_link' } });
    expect(s.steps[s.steps.length - 1].label).toBe('Following a link');
  });

  it('leaves non-browser tool calls as the generic Tool badge', () => {
    let s = initialStreamState();
    s = reduceStream(s, {
      type: 'response.in_progress',
      thought_role: 'thought.tool_call.start',
      content: 'run_python',
      tool_use_id: 'x',
      args: { code: 'print(1)' },
      at_ms: 5,
    });
    const step = s.steps[s.steps.length - 1];
    expect(step.badge).toBe('Tool');
    expect(step.icon).toBe('code');
    expect(step._isBrowserAction).toBe(false);
  });
});

describe('browser task lifecycle events (WS5-T2)', () => {
  it('fires started once on the first browser action and counts subsequent ones', () => {
    let s = initialStreamState();
    s = browserStart(s, { toolUseId: 'a', args: { action: 'inspect' }, at: 1000 });
    s = browserStart(s, { toolUseId: 'b', args: { action: 'scroll' }, at: 2000 });
    expect(analyticsMock.trackBrowserTaskStarted).toHaveBeenCalledTimes(1);
    expect(s._browserActionCount).toBe(2);
    expect(s._browserTaskStartedAt).toBe(1000);
  });

  it('does not start a browser task for a non-browser turn', () => {
    let s = initialStreamState();
    s = reduceStream(s, {
      type: 'response.in_progress',
      thought_role: 'thought.tool_call.start',
      content: 'run_python',
      tool_use_id: 'x',
      args: {},
      at_ms: 5,
    });
    expect(analyticsMock.trackBrowserTaskStarted).not.toHaveBeenCalled();
  });

  it('on completed of a browser turn fires succeeded(actionCount) + result_time', () => {
    let s = initialStreamState();
    s = browserStart(s, { args: { action: 'inspect' }, at: 1000 });
    s = reduceStream(s, { type: 'response.completed', at_ms: 4000 });
    expect(analyticsMock.trackBrowserTaskSucceeded).toHaveBeenCalledWith(1, undefined);
    expect(analyticsMock.trackBrowserResultTime).toHaveBeenCalledWith(3000, undefined);
    expect(analyticsMock.trackBrowserTaskFailed).not.toHaveBeenCalled();
  });

  it('on failed of a browser turn fires failed(code) + result_time, never succeeded', () => {
    let s = initialStreamState();
    s = browserStart(s, { args: { action: 'follow_link' }, at: 1000 });
    s = reduceStream(s, { type: 'response.failed', code: 'navigation_failed', at_ms: 2500 });
    expect(analyticsMock.trackBrowserTaskFailed).toHaveBeenCalledWith('navigation_failed', undefined);
    expect(analyticsMock.trackBrowserResultTime).toHaveBeenCalledWith(1500, undefined);
    expect(analyticsMock.trackBrowserTaskSucceeded).not.toHaveBeenCalled();
  });

  it('does not fire terminal events for a non-browser turn', () => {
    let s = initialStreamState();
    s = reduceStream(s, { type: 'response.completed', at_ms: 4000 });
    expect(analyticsMock.trackBrowserTaskSucceeded).not.toHaveBeenCalled();
    expect(analyticsMock.trackBrowserResultTime).not.toHaveBeenCalled();
  });

  it('respects replay: no lifecycle events fire during a historical replay', () => {
    let s = initialStreamState();
    s = reduceStream(s, {
      type: 'response.in_progress',
      thought_role: 'thought.tool_call.start',
      content: 'browser_control',
      tool_use_id: 'a',
      args: { action: 'inspect' },
      at_ms: 1000,
    }, Date.now, { replay: true });
    s = reduceStream(s, { type: 'response.completed', at_ms: 4000 }, Date.now, { replay: true });
    expect(analyticsMock.trackBrowserTaskStarted).not.toHaveBeenCalled();
    expect(analyticsMock.trackBrowserTaskSucceeded).not.toHaveBeenCalled();
  });
});

// The finished-step terminal card (BrowserResults) parses the WS3 envelope.
// step.output is generically truncated to 2048 chars, so the adapter extracts
// a compact {status, control_state?, citations?} envelope from the FULL tool
// output BEFORE truncation — a large `observed` blob must not cost the card.
describe('browser envelope extraction on tool_call.end', () => {
  function endEvent(toolUseId, content, at = 2000) {
    return {
      type: 'response.in_progress',
      thought_role: 'thought.tool_call.end',
      tool_use_id: toolUseId,
      content,
      at_ms: at,
    };
  }

  it('preserves status + citations from an envelope larger than the 2048 truncation', () => {
    let s = initialStreamState();
    s = browserStart(s, { toolUseId: 'big', args: { action: 'inspect' } });
    const envelope = JSON.stringify({
      status: 'ok',
      citations: [{ label: 'example.com', href: 'https://example.com/report' }],
      // Big transient blob pushes the JSON well past the truncation cutoff.
      observed: { text: 'x'.repeat(4000), url: 'https://example.com/report' },
    });
    expect(envelope.length).toBeGreaterThan(2048);
    s = reduceStream(s, endEvent('big', envelope));
    const step = s.steps.find((x) => x._toolUseId === 'big');
    expect(step.status).toBe('completed');
    // Generic truncation on output is unchanged…
    expect(step.output.length).toBe(2048);
    // …but the compact envelope survives, minus the transient observed blob.
    expect(step.browserEnvelope).toEqual({
      status: 'ok',
      citations: [{ label: 'example.com', href: 'https://example.com/report' }],
    });
  });

  it('preserves an error envelope and the control_state terminal field', () => {
    let s = initialStreamState();
    s = browserStart(s, { toolUseId: 'err', args: { action: 'follow_link' } });
    s = reduceStream(s, endEvent('err', JSON.stringify({
      status: 'permission_denied',
      control_state: 'stopped',
      observed: { text: 'y'.repeat(3000) },
    })));
    const step = s.steps.find((x) => x._toolUseId === 'err');
    expect(step.browserEnvelope).toEqual({ status: 'permission_denied', control_state: 'stopped' });
  });

  it('leaves non-browser steps untouched (no envelope, output truncated as before)', () => {
    let s = initialStreamState();
    s = reduceStream(s, {
      type: 'response.in_progress',
      thought_role: 'thought.tool_call.start',
      content: 'run_python',
      tool_use_id: 'py',
      args: { code: 'print(1)' },
      at_ms: 5,
    });
    const long = JSON.stringify({ status: 'ok', data: 'z'.repeat(4000) });
    s = reduceStream(s, endEvent('py', long));
    const step = s.steps.find((x) => x._toolUseId === 'py');
    expect(step.browserEnvelope).toBeUndefined();
    expect(step.output.length).toBe(2048);
  });

  it('tolerates non-JSON browser output (no envelope, generic patch only)', () => {
    let s = initialStreamState();
    s = browserStart(s, { toolUseId: 'txt', args: { action: 'inspect' } });
    s = reduceStream(s, endEvent('txt', 'plain text result'));
    const step = s.steps.find((x) => x._toolUseId === 'txt');
    expect(step.browserEnvelope).toBeUndefined();
    expect(step.output).toBe('plain text result');
    expect(step.status).toBe('completed');
  });
});
