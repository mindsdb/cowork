import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

import { useServerControl } from './useServerControl';

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
