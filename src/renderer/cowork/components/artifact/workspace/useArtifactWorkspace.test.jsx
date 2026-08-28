import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ isWeb: false }));
const api = vi.hoisted(() => ({
  enableDraftComments: vi.fn(),
  loadArtifactReview: vi.fn(),
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
  loadArtifactReview: (...args) => api.loadArtifactReview(...args),
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

const reviewerCapabilities = {
  role: 'reviewer',
  canPreview: true,
  canComment: true,
  canEdit: false,
  canAddressWithAgent: false,
  canResolveComments: false,
};

const httpError = (statusCode, message) => {
  const error = new Error(message);
  error.status = statusCode;
  return error;
};

beforeEach(() => {
  platform.isWeb = false;
  api.enableDraftComments.mockReset();
  // The read-only entry every web mount starts from; owner by default, since
  // that is the case the rest of the suite exercises.
  api.loadArtifactReview.mockReset().mockResolvedValue({
    artifactKey: 'artifact/11111111-1111-4111-8111-111111111111',
    capabilities: source.capabilities,
    currentRevision: { id: 'rev-1' },
  });
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
    expect(api.loadArtifactReview).not.toHaveBeenCalled();
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

  // Provisioning mints an auth rule, so the server refuses it to anyone but the
  // owner. The client therefore has to learn its role from the read-only entry
  // BEFORE asking — a reviewer who provisions gets 403, which used to land as an
  // error banner with comments switched off.
  it('lets a reviewer in without asking to provision draft review', async () => {
    platform.isWeb = true;
    api.loadArtifactReview.mockResolvedValue({
      artifactKey: 'artifact/11111111-1111-4111-8111-111111111111',
      capabilities: reviewerCapabilities,
      currentRevision: { id: 'rev-7' },
    });
    api.loadArtifactSource.mockRejectedValue(
      httpError(403, 'Only the artifact owner can change this draft'),
    );

    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(api.enableDraftComments).not.toHaveBeenCalled();
    // The GET having succeeded IS the grant: nothing left to provision.
    expect(result.current.commentsReady).toBe(true);
    expect(result.current.source).toBeNull();
    expect(result.current.capabilities.canEdit).toBe(false);
    // Comments still anchor to a revision the reviewer never sees the bytes of.
    expect(result.current.currentRevision).toEqual({ id: 'rev-7' });
    expect(result.current.error).toBe('');
  });

  it('provisions on the owner\'s mount only, and once', async () => {
    platform.isWeb = true;
    api.enableDraftComments.mockResolvedValue({
      enabled: true,
      artifactKey: 'artifact/11111111-1111-4111-8111-111111111111',
      scope: 'organization',
      currentRevision: source.revision,
      capabilities: source.capabilities,
    });

    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(api.loadArtifactReview).toHaveBeenCalledWith(artifact);
    expect(api.enableDraftComments).toHaveBeenCalledTimes(1);
    expect(result.current.commentsReady).toBe(true);
    expect(result.current.source).toEqual(source);
  });

  // A draft nobody shared answers 404 on every review route on purpose: a
  // private artifact must not be distinguishable from a missing one.
  it('reads a 404 from the review entry as no access, not as a failure', async () => {
    platform.isWeb = true;
    api.loadArtifactReview.mockRejectedValue(httpError(404, 'Not Found'));
    api.loadArtifactSource.mockRejectedValue(httpError(404, 'Not Found'));

    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('unsupported'));
    expect(api.enableDraftComments).not.toHaveBeenCalled();
    expect(result.current.commentsReady).toBe(false);
    expect(result.current.error).toBe('');
    // Distinct from the legacy "created before editing existed" case.
    expect(result.current.unsupportedReason).toBe('The owner has not shared this draft for review');
  });

  it('keeps a legacy artifact\'s unsupported reason about its age', async () => {
    platform.isWeb = true;
    api.loadArtifactSource.mockRejectedValue(httpError(422, 'No editable source'));

    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('unsupported'));
    expect(result.current.unsupportedReason)
      .toBe('This artifact was created before editing was available');
  });

  // Draft review needs auth's internal API; without it the owner still edits
  // and previews, just without collaborator comments. Not an error banner.
  it('stays quiet when provisioning is unavailable', async () => {
    platform.isWeb = true;
    api.enableDraftComments.mockRejectedValue(
      httpError(503, 'Draft review access is not configured'),
    );

    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.commentsReady).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.source).toEqual(source);
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
