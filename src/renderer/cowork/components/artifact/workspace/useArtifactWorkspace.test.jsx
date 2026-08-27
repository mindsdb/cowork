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
  // Mirrors the real predicate: a full UUID, bare hex or dashed.
  canUseArtifactWorkspace: (artifact) => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
    .test(artifact?.id || ''),
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
  id: '11111111111141118111111111111111',
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
  it('does not report an endless load when a legacy card has a short id', async () => {
    const { result } = renderHook(() => useArtifactWorkspace({ id: 'a1b2c3d4' }, { open: true }));

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

  it('uses history bundled with the source without a second workspace request', async () => {
    api.loadArtifactSource.mockResolvedValue({
      ...source,
      revisions: [{ id: 'rev-1', number: 1, path: 'index.html' }],
    });

    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.revisions).toEqual([
      { id: 'rev-1', number: 1, path: 'index.html' },
    ]);
    expect(api.loadArtifactRevisions).not.toHaveBeenCalled();
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

  it('loads an owner source in parallel with SaaS comments access', async () => {
    platform.isWeb = true;
    const access = deferred();
    api.enableDraftComments.mockReturnValue(access.promise);

    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(api.loadArtifactSource).toHaveBeenCalledWith(artifact));
    expect(result.current.status).toBe('loading');

    await act(async () => {
      access.resolve({
        enabled: true,
        currentRevision: source.revision,
        capabilities: source.capabilities,
      });
      await access.promise;
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('does not expose a speculative source when SaaS capabilities deny editing', async () => {
    platform.isWeb = true;
    api.enableDraftComments.mockResolvedValue({
      enabled: true,
      currentRevision: source.revision,
      capabilities: { role: 'reviewer', canPreview: true, canComment: true, canEdit: false },
    });

    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.source).toBeNull();
    expect(result.current.capabilities.canEdit).toBe(false);
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
      id: '22222222222242228222222222222222',
      projectId: artifact.projectId,
    };
    const first = deferred();
    const second = deferred();
    api.loadArtifactSource.mockImplementation((item) => (
      item.id === artifact.id ? first.promise : second.promise
    ));
    const { result, rerender } = renderHook(
      ({ item }) => useArtifactWorkspace(item, { open: true }),
      { initialProps: { item: artifact } },
    );

    rerender({ item: artifactB });
    await act(async () => {
      second.resolve({ ...source, content: '<h1>Second</h1>', artifactId: artifactB.id });
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      first.resolve({ ...source, content: '<h1>First</h1>', artifactId: artifact.id });
      await first.promise;
    });

    expect(result.current.source.artifactId).toBe(artifactB.id);
    expect(result.current.source.content).toBe('<h1>Second</h1>');
  });
});
