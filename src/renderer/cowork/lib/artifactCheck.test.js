// Preview checks (ENG-4207): every check is answered exactly once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetArtifactChecks,
  answerArtifactCheck,
  handleArtifactCheckEvent,
  parseArtifactCheck,
  registerPreviewCheckTarget,
} from './artifactCheck';

const check = (extra = {}) => ({
  type: 'response.artifact_check',
  check_id: 'acheck:abc',
  artifact_slug: 'clock',
  timeout_s: 30,
  ...extra,
});

const ERROR = { type: 'error', message: 'ReferenceError: x is not defined', file: 'app.js', line: 3, url: '' };

// Lets the check's promise chain run to its answer.
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('artifact checks', () => {
  let submit;
  let clock;
  const now = () => clock;

  beforeEach(() => {
    _resetArtifactChecks();
    submit = vi.fn().mockResolvedValue({ ok: true });
    clock = 1000;
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetArtifactChecks();
  });

  it('parses the event and ignores every other one', () => {
    expect(parseArtifactCheck(check())).toEqual({ checkId: 'acheck:abc', slug: 'clock', timeoutS: 30 });
    expect(parseArtifactCheck(check({ timeout_s: 'x' })).timeoutS).toBe(30);
    expect(parseArtifactCheck(check({ check_id: '' }))).toBeNull();
    expect(parseArtifactCheck({ type: 'response.ask_user' })).toBeNull();
    expect(handleArtifactCheckEvent({ type: 'response.output_text.delta', delta: 'hi' }, { submit })).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it('answers "unavailable" at once when no viewer shows the artifact', async () => {
    registerPreviewCheckTarget('another-artifact', { run: vi.fn() });

    expect(handleArtifactCheckEvent(check(), { submit, now })).toBe(true);
    await flush();

    expect(submit).toHaveBeenCalledWith('acheck:abc', { status: 'unavailable', errors: [], ms: 0 });
  });

  it('answers "passed" when the reloaded preview reported nothing', async () => {
    const run = vi.fn(async () => { clock += 3200; return { status: 'passed' }; });
    registerPreviewCheckTarget('clock', { run });

    handleArtifactCheckEvent(check(), { submit, now });
    await flush();

    expect(run).toHaveBeenCalledWith({ deadlineMs: 1000 + 29000 });
    expect(submit).toHaveBeenCalledWith('acheck:abc', { status: 'passed', errors: [], ms: 3200 });
  });

  it('answers "failed" with the errors the reloaded preview reported', async () => {
    registerPreviewCheckTarget('clock', { run: async () => ({ status: 'failed', errors: [ERROR] }) });

    handleArtifactCheckEvent(check(), { submit, now });
    await flush();

    expect(submit).toHaveBeenCalledWith('acheck:abc', { status: 'failed', errors: [ERROR], ms: 0 });
  });

  it('answers "unavailable" when the viewer closes mid-check', async () => {
    let finish;
    const unregister = registerPreviewCheckTarget('clock', {
      run: () => new Promise((resolve) => { finish = resolve; }),
    });

    handleArtifactCheckEvent(check(), { submit, now });
    await flush();
    expect(submit).not.toHaveBeenCalled();

    unregister();
    await flush();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][1].status).toBe('unavailable');

    // The orphaned run finishing later answers nothing more.
    finish({ status: 'passed' });
    await flush();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('answers a replayed check once', async () => {
    const run = vi.fn(async () => ({ status: 'passed' }));
    registerPreviewCheckTarget('clock', { run });

    expect(handleArtifactCheckEvent(check(), { submit, now })).toBe(true);
    expect(handleArtifactCheckEvent(check(), { submit, now })).toBe(true);
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('skips a check replayed after its timeout instead of reloading the preview', async () => {
    const run = vi.fn(async () => ({ status: 'passed' }));
    registerPreviewCheckTarget('clock', { run });
    clock = 100000;

    handleArtifactCheckEvent(check({ at_ms: 1000 }), { submit, now });
    await flush();

    expect(run).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('answers "unavailable" when the preview outlives the check', async () => {
    vi.useFakeTimers();
    registerPreviewCheckTarget('clock', { run: () => new Promise(() => {}) });

    handleArtifactCheckEvent(check({ timeout_s: 5 }), { submit, now });
    await vi.advanceTimersByTimeAsync(3999);
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(submit.mock.calls[0][1].status).toBe('unavailable');
  });

  it('treats a run that throws as unavailable', async () => {
    registerPreviewCheckTarget('clock', { run: async () => { throw new Error('boom'); } });

    handleArtifactCheckEvent(check(), { submit, now });
    await flush();

    expect(submit.mock.calls[0][1].status).toBe('unavailable');
  });

  it('ignores a failed answer: the server times the check out on its own', async () => {
    submit.mockRejectedValue(new Error('offline'));
    registerPreviewCheckTarget('clock', { run: async () => ({ status: 'passed' }) });

    handleArtifactCheckEvent(check(), { submit, now });
    await flush();

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('a newer viewer of the same slug takes over, and the older one leaving does not unregister it', async () => {
    const older = vi.fn(async () => ({ status: 'failed', errors: [ERROR] }));
    const newer = vi.fn(async () => ({ status: 'passed' }));
    const unregisterOlder = registerPreviewCheckTarget('clock', { run: older });
    registerPreviewCheckTarget('clock', { run: newer });
    unregisterOlder();

    handleArtifactCheckEvent(check(), { submit, now });
    await flush();

    expect(older).not.toHaveBeenCalled();
    expect(submit.mock.calls[0][1].status).toBe('passed');
  });

  // A quick edit's check_request (ENG-4227) arrives on its own stream, with
  // the same fields and no event type, and is answered by the same viewer.
  describe('answerArtifactCheck', () => {
    const request = { check_id: 'acheck:quick', artifact_slug: 'clock', timeout_s: 20 };

    it('runs the open preview and posts what it saw', async () => {
      const run = vi.fn(async () => ({ status: 'failed', errors: [ERROR] }));
      registerPreviewCheckTarget('clock', { run });

      await expect(answerArtifactCheck(request, { submit, now })).resolves.toBe('failed');

      expect(run).toHaveBeenCalledWith({ deadlineMs: 1000 + 19000 });
      expect(submit).toHaveBeenCalledWith('acheck:quick', { status: 'failed', errors: [ERROR], ms: 0 });
    });

    it('answers "unavailable" when no preview of the artifact is open', async () => {
      await expect(answerArtifactCheck(request, { submit, now })).resolves.toBe('unavailable');

      expect(submit).toHaveBeenCalledWith('acheck:quick', { status: 'unavailable', errors: [], ms: 0 });
    });

    it('answers a check once, and ignores one without an id', async () => {
      registerPreviewCheckTarget('clock', { run: async () => ({ status: 'passed' }) });

      await answerArtifactCheck(request, { submit, now });
      await expect(answerArtifactCheck(request, { submit, now })).resolves.toBeNull();
      await expect(answerArtifactCheck({ artifact_slug: 'clock' }, { submit, now })).resolves.toBeNull();

      expect(submit).toHaveBeenCalledTimes(1);
    });
  });
});
