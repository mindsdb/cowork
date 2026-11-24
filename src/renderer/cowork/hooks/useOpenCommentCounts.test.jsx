import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listCommentThreads: vi.fn() }));
vi.mock('../api', () => api);

import {
  countsOpenComments, forgetOpenCommentCount, openThreadCount, resetOpenCommentCounts, useOpenCommentCounts,
} from './useOpenCommentCounts';

// The Artifacts page counts open comments on the caller's own artifacts, one
// read per artifact, a few at a time, kept for the session (ENG-4560).
const hex = (n) => n.toString(16).padStart(32, '0');
const card = (n, extra = {}) => ({
  id: hex(n), path: `/p/${n}/index.html`, title: `A${n}`, mtime: 10, ...extra,
});
const keyOf = (n) => {
  const h = hex(n);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const threads = (...statuses) => ({ threads: statuses.map((status, i) => ({ id: `t${i}`, status })) });

afterEach(() => { resetOpenCommentCounts(); api.listCommentThreads.mockReset(); });

describe('useOpenCommentCounts', () => {
  it('counts only the caller\'s own artifacts that can hold comments', () => {
    expect(countsOpenComments(card(1))).toBe(true);
    expect(countsOpenComments(card(2, { capabilities: { role: 'owner' } }))).toBe(true);
    expect(countsOpenComments(card(3, { capabilities: { role: 'reviewer' } }))).toBe(false);
    expect(countsOpenComments({ path: '/p/x/index.html', id: 'short' })).toBe(false);
    expect(countsOpenComments(card(4, { artifactKey: 'artifact/abc', id: '' }))).toBe(true);
  });

  it('counts what the viewer\'s badge counts: neither resolved nor dismissed', () => {
    expect(openThreadCount(threads('open', 'resolved', 'dismissed', 'open').threads)).toBe(2);
    expect(openThreadCount(undefined)).toBe(0);
  });

  it('reads each eligible card\'s open threads once, by its comment key', async () => {
    api.listCommentThreads.mockResolvedValue(threads('open', 'open', 'resolved'));
    const list = [card(1), card(2, { capabilities: { role: 'reviewer' } })];
    const { result, rerender } = renderHook(({ items }) => useOpenCommentCounts(items), { initialProps: { items: list } });

    await waitFor(() => expect(result.current(list[0])).toBe(2));
    expect(api.listCommentThreads).toHaveBeenCalledTimes(1);
    expect(api.listCommentThreads).toHaveBeenCalledWith('artifact', keyOf(1), 'open');
    expect(result.current(list[1])).toBeNull();

    rerender({ items: [...list] });
    const again = renderHook(() => useOpenCommentCounts(list));
    expect(again.result.current(list[0])).toBe(2);
    expect(api.listCommentThreads).toHaveBeenCalledTimes(1);
  });

  it('reads again once the artifact changes', async () => {
    api.listCommentThreads.mockResolvedValue(threads('open'));
    const { result, rerender } = renderHook(({ items }) => useOpenCommentCounts(items), { initialProps: { items: [card(1)] } });
    await waitFor(() => expect(result.current(card(1))).toBe(1));
    rerender({ items: [card(1, { mtime: 11 })] });
    await waitFor(() => expect(api.listCommentThreads).toHaveBeenCalledTimes(2));
  });

  it('keeps at most four reads out at once', async () => {
    const pending = [];
    let peak = 0;
    let out = 0;
    api.listCommentThreads.mockImplementation(() => new Promise((resolve) => {
      out += 1;
      peak = Math.max(peak, out);
      pending.push(() => { out -= 1; resolve(threads('open')); });
    }));
    const list = Array.from({ length: 9 }, (_, i) => card(i + 1));
    const { result } = renderHook(() => useOpenCommentCounts(list));

    await waitFor(() => expect(api.listCommentThreads).toHaveBeenCalledTimes(4));
    while (pending.length) {
      await act(async () => { pending.shift()(); });
    }
    await waitFor(() => expect(list.every((a) => result.current(a) === 1)).toBe(true));
    expect(api.listCommentThreads).toHaveBeenCalledTimes(9);
    expect(peak).toBe(4);
  });

  it('draws nothing for a read that failed, and does not keep asking', async () => {
    api.listCommentThreads.mockRejectedValue(Object.assign(new Error('nope'), { status: 403 }));
    const { result, rerender } = renderHook(({ items }) => useOpenCommentCounts(items), { initialProps: { items: [card(1)] } });
    await waitFor(() => expect(api.listCommentThreads).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(result.current(card(1))).toBeNull();
    rerender({ items: [card(1)] });
    await act(async () => {});
    expect(api.listCommentThreads).toHaveBeenCalledTimes(1);
  });

  it('reads one artifact again after it is forgotten', async () => {
    api.listCommentThreads.mockResolvedValueOnce(threads('open', 'open')).mockResolvedValueOnce(threads('open'));
    const list = [card(1)];
    const { result, rerender } = renderHook(({ refresh }) => useOpenCommentCounts(list, { refresh }), { initialProps: { refresh: 0 } });
    await waitFor(() => expect(result.current(list[0])).toBe(2));
    forgetOpenCommentCount(list[0]);
    // The last answer still shows while the new read is out.
    expect(result.current(list[0])).toBe(2);
    rerender({ refresh: 1 });
    await waitFor(() => expect(result.current(list[0])).toBe(1));
  });

  it('reads nothing when off', async () => {
    const { result } = renderHook(() => useOpenCommentCounts([card(1)], { enabled: false }));
    await act(async () => {});
    expect(api.listCommentThreads).not.toHaveBeenCalled();
    expect(result.current(card(1))).toBeNull();
  });
});
