import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const apiMock = vi.hoisted(() => ({ fetchHubUsage: vi.fn() }));
vi.mock('../api', () => apiMock);

import { useHubUsage } from './useHubUsage';

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
});
