import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchBrowseStatus = vi.fn();
vi.mock('../api', () => ({ fetchBrowseStatus: (...args) => fetchBrowseStatus(...args) }));

import { useBrowseAvailable } from './useBrowseAvailable';

describe('useBrowseAvailable', () => {
  beforeEach(() => { fetchBrowseStatus.mockReset(); });

  it('is false until the server answers, then follows `available`', async () => {
    let answer;
    fetchBrowseStatus.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const { result } = renderHook(() => useBrowseAvailable('ok'));
    expect(result.current).toBe(false);
    answer({ enabled: true, available: true, status: 'none' });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it.each([
    ['not offered', () => fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status: 'unavailable' })],
    ['turned off by the organization', () => fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status: 'organization_off' })],
    ['a failed call', () => fetchBrowseStatus.mockRejectedValue(new Error('offline'))],
  ])('stays false for %s', async (_name, arrange) => {
    arrange();
    const { result } = renderHook(() => useBrowseAvailable('ok'));
    await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current).toBe(false);
  });

  it('asks again when its key changes', async () => {
    fetchBrowseStatus.mockResolvedValueOnce({ enabled: true, available: false, status: 'unavailable' });
    const { result, rerender } = renderHook(({ key }) => useBrowseAvailable(key), { initialProps: { key: 'offline' } });
    await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalledTimes(1));
    fetchBrowseStatus.mockResolvedValueOnce({ enabled: true, available: true, status: 'none' });
    rerender({ key: 'ok' });
    await waitFor(() => expect(result.current).toBe(true));
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
  });
});
