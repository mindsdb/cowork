// The viewer's side of a preview check (ENG-4207): reload, wait for load and
// settle, report what the reloaded page said.
import { useState } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreviewCheckTarget } from './usePreviewCheckTarget';
import { _resetArtifactChecks, handleArtifactCheckEvent } from '../../lib/artifactCheck';

const OLD_ERROR = { type: 'error', message: 'old document error', file: '', line: 0, url: '' };
const NEW_ERROR = { type: 'http', message: 'GET /api/items → 500: boom', file: '', line: 0, url: '/api/items' };

let api;
function Harness({ slug = 'clock', enabled = true, initialErrors = [] }) {
  const [iframeReady, setIframeReady] = useState(true);
  const [errors, setErrors] = useState(initialErrors);
  const [reloads, setReloads] = useState(0);
  const reload = () => {
    setIframeReady(false);
    setErrors((prev) => (prev.length ? [] : prev));
    setReloads((n) => n + 1);
  };
  api = { setIframeReady, setErrors, reloads };
  usePreviewCheckTarget({ slug, enabled, reload, iframeReady, errors });
  return null;
}

const check = (id = 'acheck:1', slug = 'clock') => ({
  type: 'response.artifact_check', check_id: id, artifact_slug: slug, timeout_s: 30,
});

describe('usePreviewCheckTarget', () => {
  let submit;
  beforeEach(() => {
    vi.useFakeTimers();
    _resetArtifactChecks();
    submit = vi.fn().mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    _resetArtifactChecks();
  });

  const start = (ev = check()) => act(() => { handleArtifactCheckEvent(ev, { submit }); });

  it('reloads, waits for load plus the settle period, and passes a quiet page', async () => {
    render(<Harness initialErrors={[OLD_ERROR]} />);

    start();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(api.reloads).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    // Not loaded yet: nothing answered, however long it takes (within the timeout).
    expect(submit).not.toHaveBeenCalled();

    act(() => api.setIframeReady(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(submit).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    // The previous document's error is not counted against the reloaded one.
    expect(submit).toHaveBeenCalledWith('acheck:1', expect.objectContaining({ status: 'passed', errors: [] }));
  });

  it('fails with what the reloaded page reported, before or after load', async () => {
    render(<Harness />);

    start();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => api.setErrors([NEW_ERROR]));
    act(() => api.setIframeReady(true));
    // The page restarts itself: the list clears, and a console error follows.
    const consoleError = { type: 'console', message: 'TypeError: a is undefined', file: 'app.js', line: 9, url: '' };
    act(() => api.setErrors([]));
    act(() => api.setErrors([consoleError]));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(submit).toHaveBeenCalledWith('acheck:1', expect.objectContaining({
      status: 'failed',
      errors: [NEW_ERROR, consoleError],
    }));
  });

  it('answers "unavailable" when the viewer unmounts mid-check', async () => {
    const view = render(<Harness />);

    start();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][1].status).toBe('unavailable');
  });

  it('answers "unavailable" when the reloaded preview never loads', async () => {
    render(<Harness />);

    start();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][1].status).toBe('unavailable');
  });

  it('is not registered while disabled, so the check answers "unavailable" at once', async () => {
    render(<Harness enabled={false} />);

    start();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(api.reloads).toBe(0);
    expect(submit).toHaveBeenCalledWith('acheck:1', { status: 'unavailable', errors: [], ms: 0 });
  });

  it('reloads once for a check the stream replays', async () => {
    render(<Harness />);

    start();
    start();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => api.setIframeReady(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(api.reloads).toBe(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
