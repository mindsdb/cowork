import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect, useRef } from 'react';
import { act, renderHook } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({
  host: {
    isWeb: false,
    serverInfo: vi.fn(async () => ({ running: true, starting: false })),
    serverStart: vi.fn(async () => ({ running: true })),
    serverStop: vi.fn(async () => ({ running: false })),
  },
}));
vi.mock('../../platform/host', () => ({ host: hostMock.host }));

import { SERVER_WATCH_MS, useServerControl } from './useServerControl';

const mount = async (refreshDataRef = { current: vi.fn() }) => {
  let hook;
  await act(async () => { hook = renderHook(() => useServerControl({ refreshDataRef })); });
  return { ...hook, refreshDataRef };
};

beforeEach(() => {
  hostMock.host.isWeb = false;
  hostMock.host.serverInfo.mockReset().mockResolvedValue({ running: true, starting: false });
  hostMock.host.serverStart.mockReset().mockResolvedValue({ running: true });
  hostMock.host.serverStop.mockReset().mockResolvedValue({ running: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useServerControl', () => {
  it('seeds serverOnline from host.isWeb and polls to running on desktop', async () => {
    const { result } = await mount();
    expect(hostMock.host.serverInfo).toHaveBeenCalled();
    expect(result.current.serverOnline).toBe(true);
    expect(result.current.serverBusy).toBe(false);
  });

  it('does not poll in the web shell (seeded online)', async () => {
    hostMock.host.isWeb = true;
    const { result } = await mount();
    expect(hostMock.host.serverInfo).not.toHaveBeenCalled();
    expect(result.current.serverOnline).toBe(true);
  });

  it('handleServerStart flips online and re-fetches ~400ms later', async () => {
    vi.useFakeTimers();
    hostMock.host.serverInfo.mockResolvedValue({ running: false, starting: false });
    const refreshDataRef = { current: vi.fn() };
    let hook;
    act(() => { hook = renderHook(() => useServerControl({ refreshDataRef })); });

    await act(async () => { await hook.result.current.handleServerStart(); });
    expect(hostMock.host.serverStart).toHaveBeenCalled();
    expect(hook.result.current.serverOnline).toBe(true);

    expect(refreshDataRef.current).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(400); });
    expect(refreshDataRef.current).toHaveBeenCalledTimes(1);
  });

  it('handleServerStop sets stopping and flips offline', async () => {
    hostMock.host.serverInfo.mockResolvedValue({ running: false, starting: false });
    const { result } = await mount();
    await act(async () => { await result.current.handleServerStop(); });
    expect(hostMock.host.serverStop).toHaveBeenCalled();
    expect(result.current.serverBusyKind).toBe('stopping');
    expect(result.current.serverOnline).toBe(false);
  });
});

describe('useServerControl after the backend is up', () => {
  const mountUp = async (refreshDataRef = { current: vi.fn() }) => {
    vi.useFakeTimers();
    let hook;
    await act(async () => { hook = renderHook(() => useServerControl({ refreshDataRef })); });
    return { hook, refreshDataRef };
  };
  const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(SERVER_WATCH_MS); });
  // As App composes it: App re-fetches whenever the screen's online state
  // turns on, so a reload counted here is one the person gets.
  const mountAsApp = async () => {
    vi.useFakeTimers();
    const refreshDataRef = { current: vi.fn() };
    let hook;
    await act(async () => {
      hook = renderHook(() => {
        const control = useServerControl({ refreshDataRef });
        const was = useRef(false);
        useEffect(() => {
          if (control.serverOnline && !was.current) refreshDataRef.current();
          was.current = control.serverOnline;
        }, [control.serverOnline]);
        return control;
      });
    });
    refreshDataRef.current.mockClear(); // the boot's own
    return { hook, refreshDataRef };
  };

  it('notices the backend die and come back, and reloads what was on screen once', async () => {
    const { hook, refreshDataRef } = await mountAsApp();
    expect(hook.result.current.serverOnline).toBe(true);

    // Main's view after a crash: not running, a restart pending (reads as starting).
    hostMock.host.serverInfo.mockResolvedValue({ running: false, starting: true });
    await tick();
    expect(hook.result.current.serverOnline).toBe(false);
    expect(hook.result.current.serverBusy).toBe(true);
    expect(hook.result.current.serverBusyKind).toBe('starting');

    hostMock.host.serverInfo.mockResolvedValue({ running: true, starting: false });
    await tick();
    expect(hook.result.current.serverOnline).toBe(true);
    expect(hook.result.current.serverBusy).toBe(false);
    expect(refreshDataRef.current).toHaveBeenCalledTimes(1);
  });

  // Before: a restart that finished between two reads never showed as
  // starting, so the screen stayed loaded from the process that died.
  it('reloads what was on screen when the backend was replaced between two reads', async () => {
    hostMock.host.serverInfo.mockResolvedValue({ running: true, starting: false, startGeneration: 1 });
    const { hook, refreshDataRef } = await mountAsApp();
    await tick();
    expect(refreshDataRef.current).not.toHaveBeenCalled();

    hostMock.host.serverInfo.mockResolvedValue({ running: true, starting: false, startGeneration: 2 });
    await tick();
    expect(hook.result.current.serverOnline).toBe(true);
    expect(refreshDataRef.current).toHaveBeenCalledTimes(1);
    await tick();
    expect(refreshDataRef.current).toHaveBeenCalledTimes(1);
  });

  it('does not reload a second time for a backend the person stopped and started', async () => {
    hostMock.host.serverInfo.mockResolvedValue({ running: true, starting: false, startGeneration: 1 });
    const { hook, refreshDataRef } = await mountUp();
    await act(async () => { await hook.result.current.handleServerStop(); });
    hostMock.host.serverInfo.mockResolvedValue({ running: true, starting: false, startGeneration: 2 });
    await act(async () => { await hook.result.current.handleServerStart(); });
    await tick();
    expect(refreshDataRef.current).toHaveBeenCalledTimes(1); // the start's own, 400 ms after it
  });

  it('leaves the screen offline when the process runs but does not answer', async () => {
    // Found in review: every read put the screen back online, App re-fetched
    // against the stuck backend, /health failed again, and round it went.
    const { hook, refreshDataRef } = await mountAsApp();
    await tick();
    act(() => { hook.result.current.setServerOnline(false); }); // App's /health check failing
    for (let n = 0; n < 6; n += 1) await tick();
    expect(hook.result.current.serverOnline).toBe(false);
    expect(refreshDataRef.current).not.toHaveBeenCalled();
  });

  it('shows offline when main gave up restarting', async () => {
    const { hook } = await mountUp();
    hostMock.host.serverInfo.mockResolvedValue({ running: false, starting: true });
    await tick();
    hostMock.host.serverInfo.mockResolvedValue({ running: false, starting: false });
    await tick();
    expect(hook.result.current.serverOnline).toBe(false);
    expect(hook.result.current.serverBusy).toBe(false);
  });

  it('leaves a slow first boot to the seed-and-poll, without reloading when it lands', async () => {
    hostMock.host.serverInfo.mockResolvedValue({ running: false, starting: true });
    const { hook, refreshDataRef } = await mountUp();
    await tick();
    hostMock.host.serverInfo.mockResolvedValue({ running: true, starting: false });
    await tick();
    expect(hook.result.current.serverOnline).toBe(true);
    expect(refreshDataRef.current).not.toHaveBeenCalled();
  });

  it('keeps out of a manual start that owns the spinner', async () => {
    const { hook } = await mountUp();
    let finishStart;
    hostMock.host.serverStart.mockImplementation(() => new Promise((r) => { finishStart = r; }));
    let starting;
    await act(async () => { starting = hook.result.current.handleServerStart(); });
    // Main reports the start in flight, then up while the start is still
    // handing over the credential: the spinner stays until the start returns.
    hostMock.host.serverInfo.mockResolvedValue({ running: false, starting: true });
    await tick();
    hostMock.host.serverInfo.mockResolvedValue({ running: true, starting: false });
    await tick();
    expect(hook.result.current.serverBusy).toBe(true);
    await act(async () => { finishStart({ running: true }); await starting; });
    expect(hook.result.current.serverBusy).toBe(false);
  });

  it('toggles from what main says, and keeps the watcher out while it runs', async () => {
    const { hook } = await mountUp();
    // Mid-boot reads as up: the click stops the start rather than spawning a second backend.
    hostMock.host.serverInfo.mockResolvedValue({ running: false, starting: true });
    await act(async () => { await hook.result.current.handleServerToggle(); });
    expect(hostMock.host.serverStop).toHaveBeenCalledTimes(1);
    expect(hostMock.host.serverStart).not.toHaveBeenCalled();

    hostMock.host.serverInfo.mockResolvedValue({ running: false, starting: false });
    let finishStart;
    hostMock.host.serverStart.mockImplementation(() => new Promise((r) => { finishStart = r; }));
    let toggling;
    await act(async () => { toggling = hook.result.current.handleServerToggle(); });
    expect(hostMock.host.serverStart).toHaveBeenCalledTimes(1);
    // The watcher reads main mid-start; the toggle's spinner is the toggle's.
    hostMock.host.serverInfo.mockResolvedValue({ running: true, starting: false });
    await tick();
    expect(hook.result.current.serverBusy).toBe(true);
    await act(async () => { finishStart({ running: true }); await toggling; });
    expect(hook.result.current.serverBusy).toBe(false);
    expect(hook.result.current.serverOnline).toBe(true);
  });

  it('does not watch in the web shell', async () => {
    vi.useFakeTimers();
    hostMock.host.isWeb = true;
    await act(async () => { renderHook(() => useServerControl({ refreshDataRef: { current: vi.fn() } })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(SERVER_WATCH_MS * 3); });
    expect(hostMock.host.serverInfo).not.toHaveBeenCalled();
  });
});
