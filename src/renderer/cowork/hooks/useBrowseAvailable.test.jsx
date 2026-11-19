import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fetchBrowseStatus = vi.fn();
vi.mock('../api', () => ({ fetchBrowseStatus: (...args) => fetchBrowseStatus(...args) }));

/* Main's word that the local server took the in-app browser's registration. */
const registered = vi.hoisted(() => new Set());
vi.mock('../../platform/host', () => ({
  onInAppBrowserRegistered: (cb) => {
    registered.add(cb);
    return () => registered.delete(cb);
  },
}));

import { RETRY_DELAYS_MS, useBrowseAvailable } from './useBrowseAvailable';
import { READ_TIMEOUT_MS } from '../lib/browseStatus';

const AVAILABLE = { enabled: true, available: true, status: 'none' };
const UNAVAILABLE = { enabled: true, available: false, status: 'unavailable' };

function refusal(status) {
  return Object.assign(new Error(`API /browse/status returned ${status}`), { status });
}

/* A read whose connection stalls: no answer and no error until the limit it
   was given passes, when it rejects as api.js's abort does. */
function stalls({ timeoutMs }) {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new DOMException('The operation was aborted.', 'AbortError')), timeoutMs);
  });
}

async function flush() {
  await act(async () => {});
}

describe('useBrowseAvailable', () => {
  beforeEach(() => {
    fetchBrowseStatus.mockReset();
    registered.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is false until the server answers, then follows `available`', async () => {
    let answer;
    fetchBrowseStatus.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const { result } = renderHook(() => useBrowseAvailable('ok'));
    expect(result.current).toBe(false);
    answer(AVAILABLE);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it.each([
    ['not offered', () => fetchBrowseStatus.mockResolvedValue(UNAVAILABLE)],
    ['turned off by the organization', () => fetchBrowseStatus.mockResolvedValue({ enabled: true, available: false, status: 'organization_off' })],
    ['a server with no status route', () => fetchBrowseStatus.mockRejectedValue(refusal(404))],
  ])('is false when the answer is %s', async (_name, arrange) => {
    arrange();
    const { result } = renderHook(() => useBrowseAvailable('ok'));
    await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalled());
    await flush();
    expect(result.current).toBe(false);
  });

  it.each([
    ['an offline read', () => new Error('offline')],
    ['a server that could not confirm the browser', () => refusal(424)],
    ['a MindsHub outage', () => refusal(503)],
  ])('keeps the switch on after %s with no answer yet', async (_name, failure) => {
    fetchBrowseStatus.mockRejectedValue(failure());
    const { result } = renderHook(() => useBrowseAvailable('ok'));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it.each([
    ['available', AVAILABLE, true],
    ['not available', UNAVAILABLE, false],
  ])('keeps the last answer (%s) through a failed read', async (_name, first, expected) => {
    fetchBrowseStatus.mockResolvedValueOnce(first);
    const { result, rerender } = renderHook(({ key }) => useBrowseAvailable(key), { initialProps: { key: 'offline' } });
    await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalledTimes(1));
    await flush();
    expect(result.current).toBe(expected);
    fetchBrowseStatus.mockRejectedValueOnce(refusal(424));
    rerender({ key: 'ok' });
    await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalledTimes(2));
    await flush();
    expect(result.current).toBe(expected);
  });

  it('asks again after a failed read, a little later each time, until one answers', async () => {
    vi.useFakeTimers();
    fetchBrowseStatus.mockRejectedValue(refusal(424));
    const { result } = renderHook(() => useBrowseAvailable('ok'));
    await flush();
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] - 1); });
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1] - 1); });
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);

    fetchBrowseStatus.mockResolvedValue(UNAVAILABLE);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(3);
    expect(result.current).toBe(false);
    // An answer ends the retries.
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(3);
  });

  it('gives up on a read that never answers, then backs off and asks on focus again', async () => {
    vi.useFakeTimers();
    fetchBrowseStatus.mockResolvedValueOnce(AVAILABLE);
    const { result } = renderHook(() => useBrowseAvailable('ok'));
    await flush();
    expect(result.current).toBe(true);

    // A focus ask whose connection stalls.
    fetchBrowseStatus.mockImplementationOnce(stalls);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS - 1); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);

    // At the limit the read has failed: the last answer stays, and the backoff starts.
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current).toBe(true);
    fetchBrowseStatus.mockResolvedValueOnce(UNAVAILABLE);
    await act(async () => { await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]); });
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(3);
    expect(result.current).toBe(false);

    fetchBrowseStatus.mockResolvedValueOnce(AVAILABLE);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await flush();
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(4);
    expect(result.current).toBe(true);
  });

  it('asks again on focus and when the tab is visible again, with one read for both', async () => {
    fetchBrowseStatus.mockResolvedValueOnce(UNAVAILABLE);
    const { result } = renderHook(() => useBrowseAvailable('ok'));
    await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalledTimes(1));
    await flush();
    expect(result.current).toBe(false);

    // The same key, a new answer: the organization turned the browser on.
    fetchBrowseStatus.mockResolvedValueOnce(AVAILABLE);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await flush();
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(true);

    fetchBrowseStatus.mockResolvedValueOnce(UNAVAILABLE);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(3);
    expect(result.current).toBe(false);

    let answer;
    fetchBrowseStatus.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(4);
    await act(async () => { answer(AVAILABLE); });
    expect(result.current).toBe(true);
  });

  it("asks again when main says the server took the in-app browser's registration", async () => {
    // A cold boot: the first read lands before the started hook registers the browser.
    fetchBrowseStatus.mockResolvedValueOnce(UNAVAILABLE);
    const { result } = renderHook(() => useBrowseAvailable('ok:true'));
    await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalledTimes(1));
    await flush();
    expect(result.current).toBe(false);
    fetchBrowseStatus.mockResolvedValueOnce(AVAILABLE);
    act(() => { registered.forEach((cb) => cb()); });
    await waitFor(() => expect(result.current).toBe(true));
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps only the newest answer when an older one lands after it', async () => {
    let first;
    fetchBrowseStatus.mockReturnValueOnce(new Promise((resolve) => { first = resolve; }));
    const { result } = renderHook(() => useBrowseAvailable('ok:true'));
    fetchBrowseStatus.mockResolvedValueOnce(AVAILABLE);
    act(() => { registered.forEach((cb) => cb()); });
    await waitFor(() => expect(result.current).toBe(true));
    await act(async () => { first(UNAVAILABLE); });
    expect(result.current).toBe(true);
  });

  it('asks again when its key changes, and stops listening when it unmounts', async () => {
    fetchBrowseStatus.mockResolvedValueOnce(UNAVAILABLE);
    const { result, rerender, unmount } = renderHook(({ key }) => useBrowseAvailable(key), { initialProps: { key: 'offline' } });
    await waitFor(() => expect(fetchBrowseStatus).toHaveBeenCalledTimes(1));
    fetchBrowseStatus.mockResolvedValueOnce(AVAILABLE);
    rerender({ key: 'ok' });
    await waitFor(() => expect(result.current).toBe(true));
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
    expect(registered.size).toBe(1);
    unmount();
    expect(registered.size).toBe(0);
    window.dispatchEvent(new Event('focus'));
    expect(fetchBrowseStatus).toHaveBeenCalledTimes(2);
  });
});
