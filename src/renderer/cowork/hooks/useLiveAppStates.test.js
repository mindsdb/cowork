import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../api', () => ({ fetchMyLiveApps: vi.fn() }));

import { useLiveAppStates } from './useLiveAppStates';
import { fetchMyLiveApps } from '../api';

const A = new Map([['p1/a', { state: 'running' }]]);
const B = new Map([['p1/b', { state: 'stopped' }]]);
const refusal = (status) => Object.assign(new Error('refused'), { status });

// Lets the read the hook started settle into state.
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMyLiveApps.mockResolvedValue(A);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useLiveAppStates', () => {
  it('asks nothing while live apps are off, however long it waits', async () => {
    const { result } = renderHook(() => useLiveAppStates(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetchMyLiveApps).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it('reads on mount and again each minute', async () => {
    const { result } = renderHook(() => useLiveAppStates(true));
    await settle();
    expect(fetchMyLiveApps).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(A);

    fetchMyLiveApps.mockResolvedValue(B);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMyLiveApps).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(B);
  });

  it('reads again when the refresh key changes, as when a turn ends', async () => {
    const { rerender } = renderHook(({ key }) => useLiveAppStates(true, key), { initialProps: { key: true } });
    await settle();
    rerender({ key: false });
    await settle();
    expect(fetchMyLiveApps).toHaveBeenCalledTimes(2);
  });

  it('keeps the last answer when a read fails', async () => {
    const { result } = renderHook(() => useLiveAppStates(true));
    await settle();

    fetchMyLiveApps.mockRejectedValue(refusal(500));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current).toBe(A);
    // A passing failure keeps polling.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMyLiveApps).toHaveBeenCalledTimes(3);
  });

  it('drops the lines and stops polling once the server runs no live apps', async () => {
    const { result } = renderHook(() => useLiveAppStates(true));
    await settle();

    fetchMyLiveApps.mockRejectedValue(refusal(404));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.size).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(fetchMyLiveApps).toHaveBeenCalledTimes(2);
  });

  it('stops polling on a 401 until the next refresh, and keeps the lines', async () => {
    const { result, rerender } = renderHook(({ key }) => useLiveAppStates(true, key), { initialProps: { key: 1 } });
    await settle();

    fetchMyLiveApps.mockRejectedValue(refusal(401));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(fetchMyLiveApps).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(A);

    rerender({ key: 2 });
    await settle();
    expect(fetchMyLiveApps).toHaveBeenCalledTimes(3);
  });

  it('asks nothing after unmount', async () => {
    const { unmount } = renderHook(() => useLiveAppStates(true));
    await settle();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
    expect(fetchMyLiveApps).toHaveBeenCalledTimes(1);
  });

  it('empties the lines when live apps turn off', async () => {
    const { result, rerender } = renderHook(({ on }) => useLiveAppStates(on), { initialProps: { on: true } });
    await settle();
    expect(result.current).toBe(A);

    rerender({ on: false });
    expect(result.current.size).toBe(0);
  });
});
