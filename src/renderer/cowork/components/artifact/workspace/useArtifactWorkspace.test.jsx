import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ isWeb: false }));
const api = vi.hoisted(() => ({
  enableDraftComments: vi.fn(),
  loadArtifactReview: vi.fn(),
  loadArtifactRevision: vi.fn(),
  loadArtifactSource: vi.fn(),
  loadArtifactRevisions: vi.fn(),
  saveArtifactSource: vi.fn(),
  decideAgentRepair: vi.fn(),
  loadAgentRepair: vi.fn(),
  cancelAgentRepair: vi.fn(),
  releaseAgentRepairs: vi.fn(),
}));

vi.mock('../../../../platform/host', () => ({ host: platform }));
vi.mock('../../../lib/artifactWorkspaceApi', () => ({
  // Mirrors the real predicate: a full UUID, bare hex or dashed.
  canUseArtifactWorkspace: (artifact) => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
    .test(artifact?.id || ''),
  enableDraftComments: (...args) => api.enableDraftComments(...args),
  loadArtifactReview: (...args) => api.loadArtifactReview(...args),
  loadArtifactSource: (...args) => api.loadArtifactSource(...args),
  releaseAgentRepairs: (...args) => api.releaseAgentRepairs(...args),
  loadArtifactRevisions: (...args) => api.loadArtifactRevisions(...args),
  cancelAgentRepair: (...args) => api.cancelAgentRepair(...args),
  decideAgentRepair: (...args) => api.decideAgentRepair(...args),
  loadAgentRepair: (...args) => api.loadAgentRepair(...args),
  loadArtifactRevision: (...args) => api.loadArtifactRevision(...args),
  requestAgentRepair: vi.fn(),
  restoreArtifactRevision: vi.fn(),
  saveArtifactSource: (...args) => api.saveArtifactSource(...args),
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
  api.decideAgentRepair.mockReset();
  api.loadAgentRepair.mockReset();
  api.cancelAgentRepair.mockReset();
  api.releaseAgentRepairs.mockReset().mockResolvedValue({ released: [] });
  // Auto-open is remembered per session, so one test must not suppress another.
  window.sessionStorage.clear();
  api.saveArtifactSource.mockReset();
});

// The server answers 409 for two unrelated situations, and only one of them is
// something the user can resolve by reloading.
describe('useArtifactWorkspace save conflicts', () => {
  const editConflict = () => {
    const error = new Error('Artifact changed since it was loaded');
    error.status = 409;
    error.detail = { message: 'stale', currentRevision: { id: 'rev-2' } };
    return error;
  };

  const identityConflict = () => {
    const error = new Error('Two artifacts share id 7db94eb8…: pick one and remove the other');
    error.status = 409;
    error.detail = 'Two artifacts share id 7db94eb8…: pick one and remove the other';
    return error;
  };

  const openAndEdit = async () => {
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setDraft('<h1>Edited</h1>'));
    return result;
  };

  it('offers the reload banner for a stale revision', async () => {
    api.saveArtifactSource.mockRejectedValue(editConflict());
    const result = await openAndEdit();

    await act(() => result.current.save());

    expect(result.current.status).toBe('conflict');
    expect(result.current.conflict).toEqual({ id: 'rev-2' });
  });

  it('reports an identity conflict as an error instead', async () => {
    // Reloading cannot resolve two folders claiming one id, so the banner must
    // not tell the user to reload — it has to say what the server said.
    api.saveArtifactSource.mockRejectedValue(identityConflict());
    const result = await openAndEdit();

    await act(() => result.current.save());

    expect(result.current.status).toBe('error');
    expect(result.current.conflict).toBeNull();
    expect(result.current.error).toContain('share id');
  });
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

describe('useArtifactWorkspace agent repair decisions', () => {
  const readyRepair = {
    id: 'repair-1',
    status: 'ready',
    path: 'index.html',
    revisionId: 'rev-1',
    commentThreadId: 'thread-1',
  };

  it('reports a decision that landed even after the workspace reloaded', async () => {
    // The POST has already happened by the time the generation moves, so a
    // silent null would tell the caller nothing happened when it did.
    api.loadArtifactSource.mockResolvedValue({ ...source, repair: null });
    api.loadArtifactRevisions.mockResolvedValue({ revisions: [] });
    const decision = deferred();
    api.decideAgentRepair.mockReturnValue(decision.promise);
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    api.loadArtifactSource.mockResolvedValue({
      ...source,
      repair: { ...readyRepair },
    });
    await act(async () => { await result.current.load(); });
    await waitFor(() => expect(result.current.repair?.id).toBe('repair-1'));

    let outcome;
    await act(async () => {
      const pending = result.current.decideRepair('accepted');
      await result.current.load();
      decision.resolve({ ...readyRepair, status: 'accepted' });
      outcome = await pending;
    });

    expect(outcome.decided).toBe(true);
    expect(outcome.repair.status).toBe('accepted');
  });

  it('says so instead of going quiet when the comparison outlived its repair', async () => {
    api.loadArtifactSource.mockResolvedValue({ ...source, repair: null });
    api.loadArtifactRevisions.mockResolvedValue({ revisions: [] });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome;
    await act(async () => { outcome = await result.current.decideRepair('accepted'); });

    expect(outcome).toEqual({ decided: false, reason: 'missing-repair' });
    expect(result.current.error)
      .toBe('That suggestion is no longer open, so there was nothing to decide.');
    expect(api.decideAgentRepair).not.toHaveBeenCalled();
  });

  const behindAMovedHead = () => {
    api.loadArtifactSource.mockResolvedValue({
      ...source,
      revision: { id: 'rev-9' },
      repair: { ...readyRepair },
    });
    api.loadArtifactRevisions.mockResolvedValue({ revisions: [] });
    api.loadAgentRepair.mockResolvedValue({ repair: readyRepair, compare: null });
  };

  it('sends no head on an unconfirmed reject, so the server refuses it', async () => {
    // Sending the current head unconditionally would satisfy the server's
    // guard every time and quietly restore over the owner's later work.
    behindAMovedHead();
    api.decideAgentRepair.mockResolvedValue({ ...readyRepair, status: 'rejected' });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.repair?.id).toBe('repair-1'));

    await act(async () => { await result.current.decideRepair('rejected'); });

    expect(api.decideAgentRepair).toHaveBeenCalledWith(
      artifact, 'repair-1', 'rejected', { expectedHeadRevisionId: null },
    );
  });

  it('sends the head the user confirmed against on a confirmed reject', async () => {
    behindAMovedHead();
    api.decideAgentRepair.mockResolvedValue({ ...readyRepair, status: 'rejected' });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.repair?.id).toBe('repair-1'));

    await act(async () => {
      await result.current.decideRepair('rejected', { confirmedHeadRevisionId: 'rev-9' });
    });

    expect(api.decideAgentRepair).toHaveBeenCalledWith(
      artifact, 'repair-1', 'rejected', { expectedHeadRevisionId: 'rev-9' },
    );
  });

  it('sends the head it was shown on accept, which writes no content', async () => {
    behindAMovedHead();
    api.decideAgentRepair.mockResolvedValue({ ...readyRepair, status: 'accepted' });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.repair?.id).toBe('repair-1'));

    await act(async () => { await result.current.decideRepair('accepted'); });

    expect(api.decideAgentRepair).toHaveBeenCalledWith(
      artifact, 'repair-1', 'accepted', { expectedHeadRevisionId: 'rev-9' },
    );
  });

  it('keeps the artifact open when a stale repair cannot be fetched', async () => {
    // agent_repair_detail answers 404 once the base revision is pruned, and
    // the source catch reads 404 as "this artifact predates editing".
    api.loadArtifactSource.mockResolvedValue({ ...source, repair: { ...readyRepair } });
    api.loadArtifactRevisions.mockResolvedValue({ revisions: [] });
    api.loadAgentRepair.mockRejectedValue(httpError(404, 'Revision not found'));
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.unsupportedReason).toBe('');
    expect(result.current.source.content).toBe(source.content);
    expect(result.current.error).toBe('Revision not found');
  });

  it('surfaces a restore that has no source to write into', async () => {
    api.loadArtifactSource.mockRejectedValue(httpError(403, 'Reviewer'));
    api.loadArtifactReview.mockResolvedValue({ capabilities: reviewerCapabilities });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let returned;
    await act(async () => { returned = await result.current.restoreRevision('rev-0'); });

    expect(returned).toBeNull();
    expect(result.current.error).toBe('This artifact has no editable source to restore into');
  });
});

describe('useArtifactWorkspace agent repair auto-open', () => {
  const compare = { before: { id: 'rev-0' }, after: { id: 'rev-1' } };
  const repairAt = (over = {}) => ({
    id: 'repair-1',
    status: 'ready',
    path: 'index.html',
    revisionId: 'rev-1',
    commentThreadId: 'thread-1',
    superseded: false,
    ...over,
  });

  beforeEach(() => {
    api.loadArtifactRevisions.mockResolvedValue({ revisions: [] });
    api.loadAgentRepair.mockResolvedValue({ repair: repairAt(), compare });
  });

  it('opens the comparison for a decision still waiting on this file', async () => {
    api.loadArtifactSource.mockResolvedValue({ ...source, repair: repairAt() });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.comparison?.kind).toBe('agent');
  });

  it('opens a given comparison at most once, not on every reopen', async () => {
    // A decision left pending should not take the canvas again every time the
    // artifact is reopened for something unrelated.
    api.loadArtifactSource.mockResolvedValue({ ...source, repair: repairAt() });
    const { result, rerender } = renderHook(
      ({ isOpen }) => useArtifactWorkspace(artifact, { open: isOpen }),
      { initialProps: { isOpen: true } },
    );
    await waitFor(() => expect(result.current.comparison?.kind).toBe('agent'));

    rerender({ isOpen: false });
    rerender({ isOpen: true });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.comparison).toBeNull();
    expect(result.current.repair?.id).toBe('repair-1');
  });

  it('leaves a current repair reachable after its one auto-open', async () => {
    // Auto-open fires once, so a comparison closed without a decision must
    // still be reported as pending or it silently gates the file all session.
    api.loadArtifactSource.mockResolvedValue({ ...source, repair: repairAt() });
    const { result, rerender } = renderHook(
      ({ isOpen }) => useArtifactWorkspace(artifact, { open: isOpen }),
      { initialProps: { isOpen: true } },
    );
    await waitFor(() => expect(result.current.comparison?.kind).toBe('agent'));

    rerender({ isOpen: false });
    rerender({ isOpen: true });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.comparison).toBeNull();
    expect(result.current.repairPending).toBe(true);
    expect(result.current.repairSuperseded).toBe(false);
  });

  it('does not spend the one auto-open on a fetch that failed', async () => {
    api.loadArtifactSource.mockResolvedValue({ ...source, repair: repairAt() });
    api.loadAgentRepair.mockRejectedValueOnce(httpError(503, 'Upstream busy'));
    const { result, rerender } = renderHook(
      ({ isOpen }) => useArtifactWorkspace(artifact, { open: isOpen }),
      { initialProps: { isOpen: true } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.comparison).toBeNull();

    api.loadAgentRepair.mockResolvedValue({ repair: repairAt(), compare });
    rerender({ isOpen: false });
    rerender({ isOpen: true });

    await waitFor(() => expect(result.current.comparison?.kind).toBe('agent'));
  });

  it('still reports supersession when the detail fetch omits the flag', async () => {
    // agent_repair_detail returns the stored record, without the server's
    // computed field, so reading the flag off it alone loses the notice.
    api.loadArtifactSource.mockResolvedValue({
      ...source,
      revision: { id: 'rev-9' },
      repair: repairAt({ superseded: true }),
    });
    api.loadAgentRepair.mockResolvedValue({
      repair: repairAt({ superseded: undefined }),
      compare: null,
    });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.repair?.id).toBe('repair-1'));
    expect(result.current.repairSuperseded).toBe(true);

    await act(async () => { await result.current.refreshRepair(); });

    expect(result.current.repairSuperseded).toBe(true);
  });

  it('does not hijack the view once the artifact moved past the suggestion', async () => {
    // The owner's own edit makes head rev-9, so the comparison would show two
    // revisions that both predate what they are looking at.
    api.loadArtifactSource.mockResolvedValue({
      ...source,
      revision: { id: 'rev-9' },
      repair: repairAt({ superseded: true }),
    });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.comparison).toBeNull();
    expect(result.current.repair.superseded).toBe(true);
    expect(api.loadAgentRepair).not.toHaveBeenCalled();
  });

  it('does not hijack the view for a repair on another file', async () => {
    api.loadArtifactSource.mockResolvedValue({
      ...source,
      repair: repairAt({ path: 'other.html' }),
    });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.comparison).toBeNull();
  });

  it('sends the discard intent so the server may drop a ready suggestion', async () => {
    api.loadArtifactSource.mockResolvedValue({
      ...source,
      revision: { id: 'rev-9' },
      repair: repairAt({ superseded: true }),
    });
    api.cancelAgentRepair.mockResolvedValue(repairAt({ status: 'discarded' }));
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.repair?.id).toBe('repair-1'));

    await act(async () => {
      await result.current.cancelRepair('repair-1', { discardReady: true });
    });

    expect(api.cancelAgentRepair).toHaveBeenCalledWith(
      artifact, 'repair-1', { discardReady: true },
    );
    expect(result.current.repair.status).toBe('discarded');
  });

  it('releases a queued repair without the discard intent', async () => {
    api.loadArtifactSource.mockResolvedValue({
      ...source,
      repair: repairAt({ status: 'queued', revisionId: null }),
    });
    api.cancelAgentRepair.mockResolvedValue(repairAt({ status: 'cancelled' }));
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.repair?.id).toBe('repair-1'));

    await act(async () => { await result.current.cancelRepair('repair-1'); });

    expect(api.cancelAgentRepair).toHaveBeenCalledWith(
      artifact, 'repair-1', { discardReady: false },
    );
  });
});

describe('useArtifactWorkspace releasing a repair on resolve', () => {
  const repairAt = (over = {}) => ({
    id: 'repair-1',
    status: 'ready',
    path: 'index.html',
    revisionId: 'rev-1',
    commentThreadId: 'thread-1',
    superseded: false,
    ...over,
  });

  beforeEach(() => {
    api.loadArtifactRevisions.mockResolvedValue({ revisions: [] });
    api.loadAgentRepair.mockResolvedValue({ repair: repairAt(), compare: null });
  });

  it('releases the repair the resolved comment was waiting on', async () => {
    api.loadArtifactSource.mockResolvedValue({ ...source, repair: repairAt() });
    api.releaseAgentRepairs.mockResolvedValue({
      released: [repairAt({ status: 'discarded' })],
    });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.repair?.id).toBe('repair-1'));

    await act(async () => { await result.current.releaseRepairsForComment('thread-1'); });

    expect(api.releaseAgentRepairs).toHaveBeenCalledWith(artifact, 'thread-1');
    expect(result.current.repair.status).toBe('discarded');
    expect(result.current.comparison).toBeNull();
  });

  it('does not call the owner-only route as a reviewer', async () => {
    api.loadArtifactSource.mockRejectedValue(httpError(403, 'Reviewer'));
    api.loadArtifactReview.mockResolvedValue({ capabilities: reviewerCapabilities });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let returned;
    await act(async () => {
      returned = await result.current.releaseRepairsForComment('thread-1');
    });

    expect(returned).toBeNull();
    expect(api.releaseAgentRepairs).not.toHaveBeenCalled();
  });

  it('leaves an unrelated repair alone', async () => {
    api.loadArtifactSource.mockResolvedValue({ ...source, repair: repairAt() });
    api.releaseAgentRepairs.mockResolvedValue({
      released: [repairAt({ id: 'repair-other', status: 'discarded' })],
    });
    const { result } = renderHook(() => useArtifactWorkspace(artifact, { open: true }));
    await waitFor(() => expect(result.current.repair?.id).toBe('repair-1'));

    await act(async () => { await result.current.releaseRepairsForComment('thread-9'); });

    expect(result.current.repair.status).toBe('ready');
  });
});
