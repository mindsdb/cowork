import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../api', () => ({
  fetchPublishStats: vi.fn(),
  setPublishTracking: vi.fn(),
  publishTargetPath: vi.fn((artifact) => artifact?.folder || artifact?.path || ''),
}));
vi.mock('../../../lib/artifactWorkspaceApi', () => ({
  loadArtifactStats: vi.fn(),
  setArtifactTracking: vi.fn(),
}));

import { fetchPublishStats, setPublishTracking } from '../../../api';
import { loadArtifactStats, setArtifactTracking } from '../../../lib/artifactWorkspaceApi';
import { setOrgMode } from '../../../../lib/orgMode';
import { useArtifactStats } from './useArtifactStats';

const ARTIFACT = {
  id: 'a1',
  projectId: 'p1',
  folder: '/work/.anton/artifacts/sales',
  path: '/work/.anton/artifacts/sales/index.html',
};
const OTHER = {
  ...ARTIFACT,
  id: 'a2',
  folder: '/work/.anton/artifacts/other',
  path: '/work/.anton/artifacts/other/index.html',
};
const STATS = {
  tracking: true,
  period_days: 30,
  total_views: 4,
  last_viewed: '2026-10-19T10:00:00Z',
  views_in_period: 4,
  daily: [],
  unique_viewers: 0,
  viewers: [],
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const refusal = (status, code, message) => Object.assign(new Error(message), { status, code });

beforeEach(() => {
  vi.clearAllMocks();
  setOrgMode(false);
});

afterEach(() => {
  setOrgMode(false);
});

describe('useArtifactStats loading', () => {
  it('stays idle while the panel is closed', () => {
    const { result } = renderHook(() => useArtifactStats(ARTIFACT, { enabled: false }));

    expect(fetchPublishStats).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('loads by path on desktop when the panel opens', async () => {
    const pending = deferred();
    fetchPublishStats.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useArtifactStats(ARTIFACT, { enabled: true }));

    expect(result.current.loading).toBe(true);
    expect(fetchPublishStats).toHaveBeenCalledWith('/work/.anton/artifacts/sales');

    await act(async () => { pending.resolve(STATS); });

    expect(result.current.data).toEqual(STATS);
    expect(result.current.loading).toBe(false);
  });

  it('loads by project and id in org mode', async () => {
    setOrgMode(true);
    loadArtifactStats.mockResolvedValue(STATS);

    const { result } = renderHook(() => useArtifactStats(ARTIFACT, { enabled: true }));

    await waitFor(() => expect(result.current.data).toEqual(STATS));
    expect(loadArtifactStats).toHaveBeenCalledWith(ARTIFACT);
    expect(fetchPublishStats).not.toHaveBeenCalled();
  });

  it('loads again on every open and clears the panel in between', async () => {
    fetchPublishStats.mockResolvedValue(STATS);
    const { result, rerender } = renderHook(
      ({ enabled }) => useArtifactStats(ARTIFACT, { enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(result.current.data).toEqual(STATS));

    rerender({ enabled: false });
    expect(result.current.data).toBeNull();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toEqual(STATS));
    expect(fetchPublishStats).toHaveBeenCalledTimes(2);
  });

  // Every render is recorded: the render right after a switch, before the
  // effects run, is the one that used to carry the previous artifact's state.
  it('shows no data for another artifact until its own load lands', async () => {
    const pending = deferred();
    fetchPublishStats.mockResolvedValueOnce(STATS).mockReturnValueOnce(pending.promise);
    const renders = [];
    const { result, rerender } = renderHook(({ artifact }) => {
      const stats = useArtifactStats(artifact, { enabled: true });
      renders.push([artifact.id, stats.data]);
      return stats;
    }, { initialProps: { artifact: ARTIFACT } });
    await waitFor(() => expect(result.current.data).toEqual(STATS));

    rerender({ artifact: OTHER });
    expect(renders.filter(([id, data]) => id === OTHER.id && data !== null)).toEqual([]);

    await act(async () => { pending.resolve({ ...STATS, total_views: 9 }); });
    expect(result.current.data.total_views).toBe(9);
    expect(fetchPublishStats).toHaveBeenLastCalledWith('/work/.anton/artifacts/other');
  });

  it('shows no error of the previous artifact after a switch', async () => {
    fetchPublishStats
      .mockRejectedValueOnce(refusal(409, 'stats_owned_by_other_account', 'Published under another account.'))
      .mockReturnValueOnce(new Promise(() => {}));
    const renders = [];
    const { result, rerender } = renderHook(({ artifact }) => {
      const stats = useArtifactStats(artifact, { enabled: true });
      renders.push([artifact.id, stats.error]);
      return stats;
    }, { initialProps: { artifact: ARTIFACT } });
    await waitFor(() => expect(result.current.error?.code).toBe('stats_owned_by_other_account'));

    rerender({ artifact: OTHER });

    expect(renders.filter(([id, error]) => id === OTHER.id && error !== null)).toEqual([]);
  });

  it('drops a response that lands after the panel closed', async () => {
    const pending = deferred();
    fetchPublishStats.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(
      ({ enabled }) => useArtifactStats(ARTIFACT, { enabled }),
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });
    await act(async () => { pending.resolve(STATS); });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('exposes the status and code of a failed load', async () => {
    fetchPublishStats.mockRejectedValue(
      refusal(409, 'stats_owned_by_other_account', 'Published under another account.'),
    );

    const { result } = renderHook(() => useArtifactStats(ARTIFACT, { enabled: true }));

    await waitFor(() => expect(result.current.error).toEqual({
      status: 409,
      code: 'stats_owned_by_other_account',
      message: 'Published under another account.',
    }));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('retries on reload after a failure', async () => {
    fetchPublishStats
      .mockRejectedValueOnce(refusal(503, 'stats_temporarily_unavailable', 'Try later.'))
      .mockResolvedValue(STATS);
    const { result } = renderHook(() => useArtifactStats(ARTIFACT, { enabled: true }));
    await waitFor(() => expect(result.current.error?.code).toBe('stats_temporarily_unavailable'));

    await act(async () => { await result.current.reload(); });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(STATS);
  });
});

describe('useArtifactStats tracking switch', () => {
  async function opened() {
    fetchPublishStats.mockResolvedValue(STATS);
    const hook = renderHook(() => useArtifactStats(ARTIFACT, { enabled: true }));
    await waitFor(() => expect(hook.result.current.data).toEqual(STATS));
    return hook;
  }

  it('flips the switch at once and locks it until the server answers', async () => {
    const { result } = await opened();
    const pending = deferred();
    setPublishTracking.mockReturnValue(pending.promise);

    let call;
    act(() => { call = result.current.setTracking(false); });

    expect(result.current.data.tracking).toBe(false);
    expect(result.current.trackingBusy).toBe(true);
    expect(setPublishTracking).toHaveBeenCalledWith('/work/.anton/artifacts/sales', false);

    await act(async () => {
      pending.resolve({ tracking: false });
      await call;
    });

    expect(result.current.data.tracking).toBe(false);
    expect(result.current.trackingBusy).toBe(false);
  });

  it('ignores a second change while one is saving', async () => {
    const { result } = await opened();
    setPublishTracking.mockReturnValue(new Promise(() => {}));

    act(() => {
      result.current.setTracking(false);
      result.current.setTracking(true);
    });

    expect(setPublishTracking).toHaveBeenCalledTimes(1);
  });

  it('puts the switch back and reports the error when the server refuses', async () => {
    const { result } = await opened();
    setPublishTracking.mockRejectedValue(
      refusal(503, null, 'Publishing is busy right now. Try again in a moment.'),
    );

    await act(async () => { await result.current.setTracking(false); });

    expect(result.current.data.tracking).toBe(true);
    expect(result.current.trackingBusy).toBe(false);
    expect(result.current.error).toEqual({
      status: 503,
      code: null,
      message: 'Publishing is busy right now. Try again in a moment.',
    });
  });

  it('does not lock the next artifact\'s switch while the previous one saves', async () => {
    fetchPublishStats.mockResolvedValue(STATS);
    setPublishTracking
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce({ tracking: false });
    const { result, rerender } = renderHook(
      ({ artifact }) => useArtifactStats(artifact, { enabled: true }),
      { initialProps: { artifact: ARTIFACT } },
    );
    await waitFor(() => expect(result.current.data).toEqual(STATS));
    act(() => { result.current.setTracking(false); });
    expect(result.current.trackingBusy).toBe(true);

    rerender({ artifact: OTHER });
    await waitFor(() => expect(result.current.data).toEqual(STATS));
    expect(result.current.trackingBusy).toBe(false);

    await act(async () => { await result.current.setTracking(false); });

    expect(setPublishTracking).toHaveBeenLastCalledWith('/work/.anton/artifacts/other', false);
    expect(result.current.data.tracking).toBe(false);
  });

  it('keeps the current artifact\'s load error when the previous artifact\'s change fails late', async () => {
    const putA = deferred();
    fetchPublishStats
      .mockResolvedValueOnce(STATS)
      .mockRejectedValueOnce(refusal(409, 'stats_owned_by_other_account', 'Published under another account.'));
    setPublishTracking.mockReturnValueOnce(putA.promise);
    const { result, rerender } = renderHook(
      ({ artifact }) => useArtifactStats(artifact, { enabled: true }),
      { initialProps: { artifact: ARTIFACT } },
    );
    await waitFor(() => expect(result.current.data).toEqual(STATS));
    act(() => { result.current.setTracking(false); });

    rerender({ artifact: OTHER });
    await waitFor(() => expect(result.current.error?.code).toBe('stats_owned_by_other_account'));
    await act(async () => {
      putA.reject(refusal(503, null, 'Publishing is busy right now. Try again in a moment.'));
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error?.code).toBe('stats_owned_by_other_account');
  });

  it('keeps the current artifact\'s own change error when the previous artifact\'s change fails late', async () => {
    const putA = deferred();
    fetchPublishStats.mockResolvedValue(STATS);
    setPublishTracking
      .mockReturnValueOnce(putA.promise)
      .mockRejectedValueOnce(refusal(503, null, 'Publishing is busy right now. Try again in a moment.'));
    const { result, rerender } = renderHook(
      ({ artifact }) => useArtifactStats(artifact, { enabled: true }),
      { initialProps: { artifact: ARTIFACT } },
    );
    await waitFor(() => expect(result.current.data).toEqual(STATS));
    act(() => { result.current.setTracking(false); });

    rerender({ artifact: OTHER });
    await waitFor(() => expect(result.current.data).toEqual(STATS));
    await act(async () => { await result.current.setTracking(false); });
    expect(result.current.error?.message).toBe('Publishing is busy right now. Try again in a moment.');

    await act(async () => { putA.reject(refusal(502, null, 'Could not reach MindsHub.')); });

    expect(result.current.error?.message).toBe('Publishing is busy right now. Try again in a moment.');
    expect(result.current.data.tracking).toBe(true);
  });

  it('switches through the org route in org mode', async () => {
    setOrgMode(true);
    loadArtifactStats.mockResolvedValue(STATS);
    setArtifactTracking.mockResolvedValue({ tracking: false });
    const { result } = renderHook(() => useArtifactStats(ARTIFACT, { enabled: true }));
    await waitFor(() => expect(result.current.data).toEqual(STATS));

    await act(async () => { await result.current.setTracking(false); });

    expect(setArtifactTracking).toHaveBeenCalledWith(ARTIFACT, false);
    expect(setPublishTracking).not.toHaveBeenCalled();
    expect(result.current.data.tracking).toBe(false);
  });
});
