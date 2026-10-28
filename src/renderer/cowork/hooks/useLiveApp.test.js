import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../api', () => ({ fetchMyLiveApps: vi.fn() }));
import { fetchMyLiveApps } from '../api';
import { useLiveApp } from './useLiveApp';

const running = { state: 'running', launchId: 'first' };
const artifact = { projectId: 'p', slug: 'app' };
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
beforeEach(() => {
  vi.useFakeTimers();
  fetchMyLiveApps.mockResolvedValue(new Map([['p/app', running]]));
});
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it('polls a running pane and observes a stopped or replacement launch', async () => {
  const { result, unmount } = renderHook(() => useLiveApp(artifact, { enabled: true }));
  await settle();
  expect(result.current.state).toBe(running);
  const stopped = { state: 'stopped', launchId: 'first' };
  fetchMyLiveApps.mockResolvedValue(new Map([['p/app', stopped]]));
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(result.current.state).toBe(stopped);
  const replacement = { state: 'running', launchId: 'second' };
  fetchMyLiveApps.mockResolvedValue(new Map([['p/app', replacement]]));
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(result.current.state).toBe(replacement);
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetchMyLiveApps).toHaveBeenCalledTimes(3);
});

it('keeps a good read on a transient failure but closes on loss of authorization', async () => {
  const { result } = renderHook(() => useLiveApp(artifact, { enabled: true }));
  await settle();
  fetchMyLiveApps.mockRejectedValue(Object.assign(new Error('offline'), { status: 503 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(result.current.state).toBe(running);
  fetchMyLiveApps.mockRejectedValue(Object.assign(new Error('signed out'), { status: 401 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(result.current.status).toBe('failed');
  expect(result.current.state).toBeUndefined();
});

it('never exposes the previous artifact while the next read is pending', async () => {
  const { result, rerender } = renderHook(({ item }) => useLiveApp(item, { enabled: true }), {
    initialProps: { item: artifact },
  });
  await settle();
  let complete;
  fetchMyLiveApps.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  rerender({ item: { projectId: 'p', slug: 'other' } });
  expect(result.current).toEqual({ status: 'loading' });
  await act(async () => { complete(new Map()); });
  expect(result.current.state).toBeUndefined();
});

it('turns off immediately and cancels further polling', async () => {
  const { result, rerender } = renderHook(({ enabled }) => useLiveApp(artifact, { enabled }), {
    initialProps: { enabled: true },
  });
  await settle();
  rerender({ enabled: false });
  expect(result.current).toEqual({ status: 'off' });
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(fetchMyLiveApps).toHaveBeenCalledTimes(1);
});
