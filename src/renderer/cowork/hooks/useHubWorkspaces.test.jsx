import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({
  fetchHubWorkspaces: vi.fn(),
  setActiveHubWorkspace: vi.fn(),
}));
vi.mock('../api', () => apiMock);

import { useHubWorkspaces } from './useHubWorkspaces';

const USER = { sub: 'user-1', name: 'Hazem', org: 'MindsDB' };
const OTHER_USER = { sub: 'user-2', name: 'David', org: 'MindsDB' };

const PAYLOAD = {
  enabled: true,
  reachable: true,
  workspaces: [
    { id: 'ws-default', displayName: 'Default', isDefault: true },
    { id: 'ws-client-a', displayName: 'Client A', isDefault: false },
  ],
  activeWorkspaceId: 'ws-default',
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  apiMock.fetchHubWorkspaces.mockReset();
  apiMock.setActiveHubWorkspace.mockReset();
  apiMock.fetchHubWorkspaces.mockResolvedValue(PAYLOAD);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useHubWorkspaces', () => {
  it('reads once the identity resolves', async () => {
    const { result } = renderHook(() => useHubWorkspaces(USER));

    await waitFor(() => expect(result.current.enabled).toBe(true));
    expect(result.current.workspaces).toHaveLength(2);
    expect(result.current.activeWorkspaceId).toBe('ws-default');
    expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing while signed out', () => {
    renderHook(() => useHubWorkspaces(null));

    expect(apiMock.fetchHubWorkspaces).not.toHaveBeenCalled();
  });

  it('rests dark, so the menu renders as it does today until told otherwise', () => {
    const { result } = renderHook(() => useHubWorkspaces(null));

    expect(result.current).toMatchObject({
      enabled: false,
      reachable: false,
      workspaces: [],
      activeWorkspaceId: null,
    });
  });

  it('does not re-read when the identity object is rebuilt for the same person', async () => {
    // Depend on subject, not the freshly decoded account object, to avoid redundant reads.
    const { result, rerender } = renderHook(({ user }) => useHubWorkspaces(user), {
      initialProps: { user: { ...USER } },
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    rerender({ user: { ...USER } });
    rerender({ user: { ...USER } });

    expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the person changes', async () => {
    const { result, rerender } = renderHook(({ user }) => useHubWorkspaces(user), {
      initialProps: { user: USER },
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    rerender({ user: OTHER_USER });

    await waitFor(() => expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(2));
  });

  it('drops a read that resolves after the identity moved on', async () => {
    // Otherwise the previous account's workspaces land in the new account's
    // menu, which is the worst possible place for them.
    let releaseFirst;
    apiMock.fetchHubWorkspaces
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce({ ...PAYLOAD, activeWorkspaceId: 'ws-client-a' });

    const { result, rerender } = renderHook(({ user }) => useHubWorkspaces(user), {
      initialProps: { user: USER },
    });
    rerender({ user: OTHER_USER });
    await waitFor(() => expect(result.current.activeWorkspaceId).toBe('ws-client-a'));

    // The first read lands late, carrying the previous person's answer.
    await act(async () => { releaseFirst({ ...PAYLOAD, activeWorkspaceId: 'ws-default' }); });

    expect(result.current.activeWorkspaceId).toBe('ws-client-a');
  });

  it('normalizes a malformed payload rather than passing it on', async () => {
    apiMock.fetchHubWorkspaces.mockResolvedValue({
      enabled: 'yes',
      reachable: 1,
      workspaces: 'not-a-list',
      activeWorkspaceId: undefined,
    });
    const { result } = renderHook(() => useHubWorkspaces(USER));

    await waitFor(() => expect(result.current.workspaces).toEqual([]));
    // Only a literal `true` counts, so a truthy string cannot light the surface.
    expect(result.current.enabled).toBe(false);
    expect(result.current.reachable).toBe(false);
    expect(result.current.activeWorkspaceId).toBeNull();
  });

  it('takes the switch result as the new state, applying nothing optimistically', async () => {
    apiMock.setActiveHubWorkspace.mockResolvedValue({ ...PAYLOAD, activeWorkspaceId: 'ws-client-a' });
    const { result } = renderHook(() => useHubWorkspaces(USER));
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => { await result.current.switchWorkspace('ws-client-a'); });

    expect(result.current.activeWorkspaceId).toBe('ws-client-a');
  });

  it('leaves the active workspace alone when the switch is refused, and rethrows', async () => {
    apiMock.setActiveHubWorkspace.mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => useHubWorkspaces(USER));
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await expect(
      act(async () => { await result.current.switchWorkspace('ws-client-a'); }),
    ).rejects.toThrow('403');

    expect(result.current.activeWorkspaceId).toBe('ws-default');
    expect(result.current.switching).toBe(false);
  });

  it('clears the switching flag even when the switch throws', async () => {
    apiMock.setActiveHubWorkspace.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useHubWorkspaces(USER));
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => {
      await result.current.switchWorkspace('ws-client-a').catch(() => {});
    });

    // A stuck `switching` would disable every row in the menu for the rest of
    // the session.
    expect(result.current.switching).toBe(false);
  });

  it('retries a failed read instead of staying dark for the session', async () => {
    // Retry cold-start reads that race sidecar startup so the control can appear without relaunch.
    apiMock.fetchHubWorkspaces
      .mockRejectedValueOnce(new Error('API /hub/workspaces/ returned 502'))
      .mockResolvedValue(PAYLOAD);

    const { result } = renderHook(() => useHubWorkspaces(USER));
    await waitFor(() => expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(1));
    expect(result.current.enabled).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.enabled).toBe(true);
  });

  it('retries a 200 that says the hub could not be reached', async () => {
    // Treat a 200 response with enabled:true and reachable:false as transient, not just thrown
    // transport errors.
    apiMock.fetchHubWorkspaces
      .mockResolvedValueOnce({ enabled: true, reachable: false, workspaces: [], activeWorkspaceId: null })
      .mockResolvedValue(PAYLOAD);

    const { result } = renderHook(() => useHubWorkspaces(USER));
    await waitFor(() => expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(1));
    expect(result.current.reachable).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(result.current.reachable).toBe(true);
  });

  it('treats a gate-off answer as settled, so it is never retried', async () => {
    // `enabled: false` is definite: the gate is off, or the sidecar has no such
    // route. Asking again cannot change either.
    apiMock.fetchHubWorkspaces.mockResolvedValue({
      enabled: false, reachable: false, workspaces: [], activeWorkspaceId: null,
    });

    renderHook(() => useHubWorkspaces(USER));
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });

    expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('stops retrying once unmounted', async () => {
    // Unmount must invalidate the generation too, preventing late reads from arming a post-cleanup
    // retry.
    apiMock.fetchHubWorkspaces.mockRejectedValue(new Error('down'));

    const { unmount } = renderHook(() => useHubWorkspaces(USER));
    await waitFor(() => expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });

    expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retries rather than polling forever', async () => {
    apiMock.fetchHubWorkspaces.mockRejectedValue(new Error('still down'));

    renderHook(() => useHubWorkspaces(USER));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    // The first read plus the three backoff attempts, and nothing after.
    expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(4);
  });

  it('drops a failed read that lands after the identity moved on', async () => {
    // Late failures from a previous identity must neither clear the new state nor restart its retry
    // loop.
    let rejectFirst;
    apiMock.fetchHubWorkspaces
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockResolvedValue(PAYLOAD);

    const { result, rerender } = renderHook(({ user }) => useHubWorkspaces(user), {
      initialProps: { user: USER },
    });
    rerender({ user: OTHER_USER });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => { rejectFirst(new Error('landed too late')); });

    expect(result.current.enabled).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });

    expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(2);
  });

  it('stops retrying when the person changes mid-backoff', async () => {
    apiMock.fetchHubWorkspaces.mockRejectedValue(new Error('down'));
    const { rerender } = renderHook(({ user }) => useHubWorkspaces(user), {
      initialProps: { user: USER },
    });
    await waitFor(() => expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(1));

    apiMock.fetchHubWorkspaces.mockResolvedValue(PAYLOAD);
    rerender({ user: OTHER_USER });
    await waitFor(() => expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    // The new identity's read succeeded, so the old identity's pending retry
    // must not fire on top of it.
    expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(2);
  });

  it('drops a switch that resolves after the identity moved on', async () => {
    // A write started under one account must not update the next account's menu.
    let releaseSwitch;
    apiMock.setActiveHubWorkspace.mockImplementation(
      () => new Promise((resolve) => { releaseSwitch = resolve; }),
    );
    const { result, rerender } = renderHook(({ user }) => useHubWorkspaces(user), {
      initialProps: { user: USER },
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    let pending;
    act(() => { pending = result.current.switchWorkspace('ws-client-a').catch(() => {}); });
    rerender({ user: OTHER_USER });
    await waitFor(() => expect(result.current.activeWorkspaceId).toBe('ws-default'));

    await act(async () => {
      releaseSwitch({ ...PAYLOAD, activeWorkspaceId: 'ws-client-a' });
      await pending;
    });

    expect(result.current.activeWorkspaceId).toBe('ws-default');
    expect(result.current.switching).toBe(false);
  });

  it('clears switching when the person changes with a switch in flight', async () => {
    apiMock.setActiveHubWorkspace.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ user }) => useHubWorkspaces(user), {
      initialProps: { user: USER },
    });
    await waitFor(() => expect(result.current.enabled).toBe(true));

    act(() => { result.current.switchWorkspace('ws-client-a').catch(() => {}); });
    expect(result.current.switching).toBe(true);

    rerender({ user: OTHER_USER });

    // A stuck flag would hand the next account a menu with every row disabled.
    await waitFor(() => expect(result.current.switching).toBe(false));
  });

  it('re-reads on refresh', async () => {
    const { result } = renderHook(() => useHubWorkspaces(USER));
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => { await result.current.refresh(); });

    expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(2);
  });
});
