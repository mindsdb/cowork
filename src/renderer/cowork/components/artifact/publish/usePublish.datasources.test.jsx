import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  fetchPendingDatasources: vi.fn(),
  publishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
}));
const workspace = vi.hoisted(() => ({ republishArtifact: vi.fn() }));
vi.mock('../../../lib/artifactWorkspaceApi', async (importOriginal) => ({ ...(await importOriginal()), ...workspace }));
vi.mock('../../../api', async (importOriginal) => ({ ...(await importOriginal()), ...api }));

import { usePublish } from './usePublish';
import { setOrgMode } from '../../../../lib/orgMode';

const PENDING = [{ engine: 'postgres', name: 'scm', label: 'postgres/scm' }];
const ARTIFACT = { path: '/p/.anton/artifacts/app', title: 'App' };

describe('usePublish and connection approval', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.fetchPendingDatasources.mockResolvedValue(PENDING);
    api.publishArtifact.mockResolvedValue({ url: 'https://view.example/r/1', accessMode: 'restricted' });
    api.updateArtifact.mockResolvedValue({ url: 'https://view.example/r/1' });
  });

  it('loads the pending list when enabled', async () => {
    const { result } = renderHook(() => usePublish(ARTIFACT, { enabled: true }));
    await waitFor(() => expect(result.current.pendingDatasources).toEqual(PENDING));
  });

  it('reads the list again on refresh', async () => {
    const { result } = renderHook(() => usePublish(ARTIFACT, { enabled: true }));
    await waitFor(() => expect(result.current.pendingDatasources).toEqual(PENDING));
    const changed = [...PENDING, { engine: 'mysql', name: 'late', label: 'mysql/late' }];
    api.fetchPendingDatasources.mockResolvedValue(changed);
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.pendingDatasources).toEqual(changed));
  });

  it('approves only what the caller passes', async () => {
    const { result } = renderHook(() => usePublish(ARTIFACT, { enabled: true }));
    await waitFor(() => expect(result.current.pendingDatasources).toEqual(PENDING));
    await act(async () => { await result.current.update(); });
    expect(api.updateArtifact).toHaveBeenLastCalledWith(expect.any(String), { approvedDatasources: [] });
    await act(async () => { await result.current.publish({ mode: 'public' }, { approvedDatasources: PENDING }); });
    expect(api.publishArtifact).toHaveBeenLastCalledWith(expect.any(String), { mode: 'public' }, { approvedDatasources: PENDING });
  });

  it('takes the new list from a 409 and says why', async () => {
    const changed = [...PENDING, { engine: 'mysql', name: 'late', label: 'mysql/late' }];
    api.publishArtifact.mockRejectedValue(Object.assign(new Error('m'), {
      status: 409, code: 'datasource_approval_required', body: { detail: { pending: changed } },
    }));
    const { result } = renderHook(() => usePublish(ARTIFACT, { enabled: true }));
    await waitFor(() => expect(result.current.pendingDatasources).toEqual(PENDING));
    await act(async () => { await result.current.publish({ mode: 'public' }, { approvedDatasources: PENDING }); });
    expect(result.current.pendingDatasources).toEqual(changed);
    expect(result.current.error).toMatch(/haven't approved/);
  });

  it('warns about connections published without credentials', async () => {
    api.publishArtifact.mockResolvedValue({
      url: 'https://view.example/r/1', accessMode: 'restricted',
      unapprovedDatasources: [{ engine: 'mysql', name: 'late', label: 'mysql/late' }],
    });
    const { result } = renderHook(() => usePublish(ARTIFACT, { enabled: true }));
    await act(async () => { await result.current.publish({ mode: 'public' }); });
    expect(result.current.notice).toMatch(/mysql\/late/);
  });

  it('shows only the current artifact\'s list when an earlier answer lands late', async () => {
    const B = { path: '/p/.anton/artifacts/other', title: 'Other' };
    const listB = [{ engine: 'mysql', name: 'b', label: 'mysql/b' }];
    let resolveA;
    api.fetchPendingDatasources.mockImplementation((path) => (path === ARTIFACT.path
      ? new Promise((r) => { resolveA = r; })
      : Promise.resolve(listB)));
    const { result, rerender } = renderHook(({ a }) => usePublish(a, { enabled: true }), {
      initialProps: { a: ARTIFACT },
    });
    rerender({ a: B });
    expect(result.current.pendingDatasources).toEqual([]);
    await waitFor(() => expect(result.current.pendingDatasources).toEqual(listB));
    await act(async () => { resolveA(PENDING); });
    expect(result.current.pendingDatasources).toEqual(listB);
  });

  it('reads the list once on open', async () => {
    renderHook(() => usePublish(ARTIFACT, { enabled: true }));
    await waitFor(() => expect(api.fetchPendingDatasources).toHaveBeenCalled());
    expect(api.fetchPendingDatasources).toHaveBeenCalledTimes(1);
  });

  describe('in MindsHub mode', () => {
    afterEach(() => setOrgMode(false));

    it('neither reads the list nor takes one from a 409', async () => {
      setOrgMode(true);
      workspace.republishArtifact.mockRejectedValue(Object.assign(new Error('m'), {
        status: 409, code: 'datasource_approval_required', body: { detail: { pending: PENDING } },
      }));
      const { result } = renderHook(() => usePublish({ ...ARTIFACT, id: '11111111-2222-4333-8444-555555555555', projectId: 'p1' }, { enabled: true }));
      await act(async () => { await result.current.update(); });
      expect(workspace.republishArtifact).toHaveBeenCalled();
      expect(api.fetchPendingDatasources).not.toHaveBeenCalled();
      expect(result.current.pendingDatasources).toEqual([]);
    });
  });
});
