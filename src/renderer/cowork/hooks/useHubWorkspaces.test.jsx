import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  apiMock.fetchHubWorkspaces.mockReset();
  apiMock.setActiveHubWorkspace.mockReset();
  apiMock.fetchHubWorkspaces.mockResolvedValue(PAYLOAD);
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
    // `useAccountUser` returns a fresh object every time it decodes the token,
    // so depending on the object rather than the subject would re-fetch on any
    // re-render that re-decoded the same token.
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

  it('re-reads on refresh', async () => {
    const { result } = renderHook(() => useHubWorkspaces(USER));
    await waitFor(() => expect(result.current.enabled).toBe(true));

    await act(async () => { await result.current.refresh(); });

    expect(apiMock.fetchHubWorkspaces).toHaveBeenCalledTimes(2);
  });
});
