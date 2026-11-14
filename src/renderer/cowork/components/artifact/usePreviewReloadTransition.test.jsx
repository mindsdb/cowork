// The quick-edit reload cover (ENG-4227): in, reload behind it, out on the
// new document's load or after the cap; nothing with reduced motion.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { COVER_MS, MAX_WAIT_MS, REVEAL_MS, SETTLE_MS, usePreviewReloadTransition } from './usePreviewReloadTransition';

let api;
function Probe({ enabled = true, iframeReady }) {
  api = usePreviewReloadTransition({ enabled, iframeReady });
  return <div data-testid="phase">{api.phase}</div>;
}
const phase = (view) => view.getByTestId('phase').textContent;
const advance = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const reducedMotion = (on) => {
  window.matchMedia = vi.fn((query) => ({ matches: on && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
};

describe('usePreviewReloadTransition', () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => { vi.useFakeTimers(); reducedMotion(false); });
  afterEach(() => { vi.useRealTimers(); window.matchMedia = originalMatchMedia; });

  it('covers, reloads behind the cover, and reveals after the load plus a settle', async () => {
    const trigger = vi.fn();
    const view = render(<Probe iframeReady />);
    let done = false;
    act(() => { api.reload(trigger).then(() => { done = true; }); });

    expect(phase(view)).toBe('covering');
    expect(trigger).not.toHaveBeenCalled();
    await advance(COVER_MS);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(phase(view)).toBe('waiting');

    // The reload drops the frame's ready state, then the new document loads.
    view.rerender(<Probe iframeReady={false} />);
    await advance(1000);
    expect(phase(view)).toBe('waiting');
    view.rerender(<Probe iframeReady />);
    await advance(SETTLE_MS);
    expect(phase(view)).toBe('revealing');
    await advance(REVEAL_MS);
    expect(phase(view)).toBe('idle');
    expect(done).toBe(true);
  });

  it('reveals after the cap when the page never loads', async () => {
    const view = render(<Probe iframeReady />);
    act(() => { void api.reload(vi.fn()); });
    await advance(COVER_MS);
    view.rerender(<Probe iframeReady={false} />);
    await advance(MAX_WAIT_MS - 1);
    expect(phase(view)).toBe('waiting');
    await advance(1);
    expect(phase(view)).toBe('revealing');
    await advance(REVEAL_MS);
    expect(phase(view)).toBe('idle');
  });

  it('joins a reload already running instead of reloading twice', async () => {
    const trigger = vi.fn();
    render(<Probe iframeReady />);
    let first;
    let second;
    act(() => { first = api.reload(trigger); second = api.reload(trigger); });
    expect(second).toBe(first);
    await advance(COVER_MS + MAX_WAIT_MS + REVEAL_MS);
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it('reloads at once with no cover under reduced motion', async () => {
    reducedMotion(true);
    const trigger = vi.fn();
    const view = render(<Probe iframeReady />);
    await act(async () => { await api.reload(trigger); });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(phase(view)).toBe('idle');
  });

  it('reloads at once with no cover when no framed preview is on screen', async () => {
    const trigger = vi.fn();
    const view = render(<Probe enabled={false} iframeReady />);
    await act(async () => { await api.reload(trigger); });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(phase(view)).toBe('idle');
  });

  it('shows the cover under StrictMode, which mounts twice', async () => {
    const view = render(<StrictMode><Probe iframeReady /></StrictMode>);
    act(() => { void api.reload(vi.fn()); });
    expect(phase(view)).toBe('covering');
    await advance(COVER_MS + MAX_WAIT_MS + REVEAL_MS);
    expect(phase(view)).toBe('idle');
  });
});

