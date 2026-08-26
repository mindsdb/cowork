import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ isWeb: false }));
const api = vi.hoisted(() => ({
  enableDraftComments: vi.fn(),
  loadArtifactRevision: vi.fn(),
  loadArtifactSource: vi.fn(),
  loadArtifactRevisions: vi.fn(),
}));

vi.mock('../../../../platform/host', () => ({ host: platform }));
vi.mock('../../../lib/artifactWorkspaceApi', () => ({
  canUseArtifactWorkspace: (artifact) => !!artifact?.stableId,
  enableDraftComments: (...args) => api.enableDraftComments(...args),
  loadArtifactSource: (...args) => api.loadArtifactSource(...args),
  loadArtifactRevisions: (...args) => api.loadArtifactRevisions(...args),
  cancelAgentRepair: vi.fn(),
  decideAgentRepair: vi.fn(),
  loadAgentRepair: vi.fn(),
  loadArtifactRevision: (...args) => api.loadArtifactRevision(...args),
  requestAgentRepair: vi.fn(),
  restoreArtifactRevision: vi.fn(),
  saveArtifactSource: vi.fn(),
}));

import { useArtifactWorkspace } from './useArtifactWorkspace';

const artifact = {
  stableId: '11111111-1111-4111-8111-111111111111',
  projectId: '00000000-0000-0000-0000-000000000001',
};
const source = {
  content: '<h1>Hello</h1>',
  path: 'index.html',
  revision: { id: 'rev-1' },
  capabilities: { role: 'owner', canEdit: true, canComment: true },
};

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

beforeEach(() => {
  platform.isWeb = false;
  api.enableDraftComments.mockReset();
  api.loadArtifactRevision.mockReset().mockResolvedValue({
    id: 'rev-0', number: 0, path: 'index.html', content: '<h1>Before</h1>',
  });
  api.loadArtifactSource.mockReset().mockResolvedValue(source);
  api.loadArtifactRevisions.mockReset().mockResolvedValue({ revisions: [] });
});

describe('useArtifactWorkspace collaboration transport', () => {
  it('does not report an endless load when a legacy card has no stable identity', async () => {
    const { result } = renderHook(() => useArtifactWorkspace({ id: 'legacy-artifact' }, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('unsupported'));
    expect(result.current.supported).toBe(false);
    expect(api.loadArtifactSource).not.toHaveBeenCalled();
  });

  it('uses local review on desktop even though desktop cards have a project id', async () => {
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.commentsReady).toBe(true);
    expect(api.enableDraftComments).not.toHaveBeenCalled();
  });

  it('provisions authenticated draft review in the web SaaS', async () => {
    platform.isWeb = true;
    api.enableDraftComments.mockResolvedValue({
      enabled: true,
      currentRevision: { id: 'rev-1' },
      capabilities: source.capabilities,
    });

    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.commentsReady).toBe(true);
    expect(api.enableDraftComments).toHaveBeenCalledWith(artifact);
  });

  it('closes a comparison when the user deliberately changes workspace mode', async () => {
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(() => result.current.compareRevision('rev-0'));
    expect(result.current.comparison).not.toBeNull();

    act(() => result.current.setMode('edit'));
    expect(result.current.mode).toBe('edit');
    expect(result.current.comparison).toBeNull();
  });

  it('does not let a late response overwrite a newly opened artifact', async () => {
    const artifactB = {
      stableId: '22222222-2222-4222-8222-222222222222',
      projectId: artifact.projectId,
    };
    const first = deferred();
    const second = deferred();
    api.loadArtifactSource.mockImplementation((item) => (
      item.stableId === artifact.stableId ? first.promise : second.promise
    ));
    const { result, rerender } = renderHook(
      ({ item }) => useArtifactWorkspace(item, { open: true }),
      { initialProps: { item: artifact } },
    );

    rerender({ item: artifactB });
    await act(async () => {
      second.resolve({ ...source, content: '<h1>Second</h1>', artifactId: artifactB.stableId });
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      first.resolve({ ...source, content: '<h1>First</h1>', artifactId: artifact.stableId });
      await first.promise;
    });

    expect(result.current.source.artifactId).toBe(artifactB.stableId);
    expect(result.current.source.content).toBe('<h1>Second</h1>');
  });
});
