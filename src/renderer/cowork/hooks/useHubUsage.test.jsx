import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({ fetchHubUsage: vi.fn() }));
vi.mock('../api', () => apiMock);

import { useHubUsage } from './useHubUsage';
import { usagePlanTier } from '../lib/usagePlanTier';

const USER = { sub: 'user-1' };
const VIEW = { reachable: true, isBillingOwner: true, freeTokens: { limit: 100, used: 10, remaining: 90 }, balance: null, autoTopUp: null };

beforeEach(() => {
  apiMock.fetchHubUsage.mockReset();
  apiMock.fetchHubUsage.mockResolvedValue(VIEW);
});

describe('useHubUsage', () => {
  it('is null until the first read answers, then holds the view', async () => {
    const { result } = renderHook(() => useHubUsage(USER, { pollMs: 0 }));
    expect(result.current.usage).toBeNull();
    await waitFor(() => expect(result.current.usage).toEqual(VIEW));
  });

  it('never fetches while signed out', async () => {
    const { result } = renderHook(() => useHubUsage(null, { pollMs: 0 }));
    await waitFor(() => expect(result.current.usage).toEqual({ reachable: false }));
    expect(apiMock.fetchHubUsage).not.toHaveBeenCalled();
  });

  it('keeps the same object when a refresh answers the same thing', async () => {
    const { result } = renderHook(() => useHubUsage(USER, { pollMs: 0 }));
    await waitFor(() => expect(result.current.usage).toEqual(VIEW));
    const first = result.current.usage;
    apiMock.fetchHubUsage.mockResolvedValue({ ...VIEW, freeTokens: { ...VIEW.freeTokens } });
    await act(() => result.current.refresh());
    expect(result.current.usage).toBe(first);
  });

  it('keeps the last good read through a failed poll', async () => {
    const { result } = renderHook(() => useHubUsage(USER, { pollMs: 0 }));
    await waitFor(() => expect(result.current.usage).toEqual(VIEW));
    apiMock.fetchHubUsage.mockResolvedValue({ reachable: false });
    await act(() => result.current.refresh());
    expect(result.current.usage).toEqual(VIEW);
  });

  it('reports unreachable when the first read fails', async () => {
    apiMock.fetchHubUsage.mockResolvedValue({ reachable: false });
    const { result } = renderHook(() => useHubUsage(USER, { pollMs: 0 }));
    await waitFor(() => expect(result.current.usage).toEqual({ reachable: false }));
  });

  // Analytics stamps this tier over the realm roles, so the poll must write it.
  it('records the plan tier the read names for analytics, and clears it on sign-out', async () => {
    apiMock.fetchHubUsage.mockResolvedValue({
      ...VIEW,
      plan: { tier: 'plus', status: 'active', renewsAt: null, cancelAtPeriodEnd: false, windows: [] },
    });
    const { result, rerender } = renderHook(
      ({ user }) => useHubUsage(user, { pollMs: 0 }),
      { initialProps: { user: USER } },
    );
    await waitFor(() => expect(usagePlanTier()).toBe('plus'));
    // A failed poll keeps the last good read, so sign-out is what clears it.
    rerender({ user: null });
    await waitFor(() => expect(result.current.usage).toEqual({ reachable: false }));
    expect(usagePlanTier()).toBeNull();
  });
});
