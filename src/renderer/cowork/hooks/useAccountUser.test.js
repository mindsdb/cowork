import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const hostMock = vi.hoisted(() => ({ getAccessToken: vi.fn() }));
vi.mock('../../platform/host', () => hostMock);
const tokenMock = vi.hoisted(() => ({ accountUserFromToken: (token) => (token ? { orgId: token, sub: 'u1' } : null) }));
vi.mock('../lib/accountUser', () => tokenMock);
const changes = vi.hoisted(() => ({ subscribed: 0, unsubscribed: 0 }));
vi.mock('../lib/organizationChanges', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    subscribeOrganizationChanges: (listener) => {
      changes.subscribed += 1;
      const off = actual.subscribeOrganizationChanges(listener);
      return () => { changes.unsubscribed += 1; off(); };
    },
  };
});

import { useAccountUser } from './useAccountUser';
import { notifyOrganizationChanged } from '../lib/organizationChanges';

describe('useAccountUser', () => {
  it('re-reads the token after an in-place organization switch (ENG-4333)', async () => {
    hostMock.getAccessToken.mockResolvedValue('org-personal');
    const { result } = renderHook(() => useAccountUser());
    await waitFor(() => expect(result.current?.orgId).toBe('org-personal'));

    hostMock.getAccessToken.mockResolvedValue('org-f');
    act(() => { notifyOrganizationChanged('u1'); });
    await waitFor(() => expect(result.current?.orgId).toBe('org-f'));
  });

  it('neither reads nor listens while inactive', () => {
    hostMock.getAccessToken.mockClear();
    const before = changes.subscribed;
    const { result } = renderHook(() => useAccountUser(false, { active: false }));
    act(() => { notifyOrganizationChanged('u1'); });
    expect(result.current).toBeNull();
    expect(hostMock.getAccessToken).not.toHaveBeenCalled();
    expect(changes.subscribed).toBe(before);
  });

  it('keeps the newer read when the first one resolves late', async () => {
    let resolveFirst;
    hostMock.getAccessToken.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    hostMock.getAccessToken.mockResolvedValueOnce('org-f');
    const { result } = renderHook(() => useAccountUser());
    act(() => { notifyOrganizationChanged('u1'); });
    await waitFor(() => expect(result.current?.orgId).toBe('org-f'));

    await act(async () => { resolveFirst('org-personal'); });
    expect(result.current?.orgId).toBe('org-f');
  });

  it('stops listening once unmounted', () => {
    hostMock.getAccessToken.mockResolvedValue('org-personal');
    const { unmount } = renderHook(() => useAccountUser());
    const before = changes.unsubscribed;
    unmount();
    expect(changes.unsubscribed).toBe(before + 1);
  });
});
