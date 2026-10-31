// Sharing on Cloud (ENG-2316).
//
// Same state machine as desktop, different transport: an org deployment has no
// path the client can name, and `/publish` is local-only server-side. So the
// hook addresses the artifact by identity and re-publishes through the
// owner-gated workspace route instead.
//
// The reads matter as much as the writes. In MindsHub mode an artifact CARD carries
// no audience and no `accessPassword`. One artifacts root is shared by the whole
// organization, so a card cannot tell owner from co-member. The owner-only
// access route is the only way the audience reaches this client.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { setOrgMode } from '../../../../lib/orgMode';

const apiMock = vi.hoisted(() => ({
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  fetchArtifactStatus: vi.fn(),
  listArtifactVersions: vi.fn(),
  activateArtifactVersion: vi.fn(),
  publishTargetPath: (a) => a?.folder || a?.path || '',
}));
vi.mock('../../../api', () => apiMock);
vi.mock('../../../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));

const wsMock = vi.hoisted(() => ({
  canUseArtifactWorkspace: vi.fn(() => true),
  loadArtifactAccess: vi.fn(),
  setArtifactAccess: vi.fn(),
}));
vi.mock('../../../lib/artifactWorkspaceApi', () => wsMock);

import { usePublish } from './usePublish';

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// No `path`: an org card is addressed by identity, and relying on a path here
// is exactly the bug this guards against.
const ORG_ARTIFACT = {
  id: '7db94eb8f0a54c7e9c1d2b3a4f5e6d70',
  projectId: 'proj-1',
  publishedUrl: 'https://share/abc',
  accessMode: 'restricted',
  ownerOnly: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  wsMock.canUseArtifactWorkspace.mockReturnValue(true);
  wsMock.loadArtifactAccess.mockResolvedValue({
    accessMode: 'restricted',
    accessEmails: ['alice@x.com'],
    orgAllowed: false,
    ownerOnly: false,
    accessPassword: '',
  });
  wsMock.setArtifactAccess.mockResolvedValue({
    url: 'https://share/abc',
    accessMode: 'restricted',
    accessEmails: ['alice@x.com'],
    orgAllowed: false,
    ownerOnly: false,
  });
  setOrgMode(true);
});

afterEach(() => setOrgMode(false));

describe('usePublish on Cloud', () => {
  it('changes the audience through the workspace route, never the desktop one', async () => {
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));

    const access = { mode: 'restricted', emails: ['alice@x.com'], org_allowed: false };
    await act(async () => { await result.current.publish(access); });

    expect(wsMock.setArtifactAccess).toHaveBeenCalledWith(ORG_ARTIFACT, access);
    // `/publish` is local-only: calling it here would 4xx on a real deployment.
    expect(apiMock.publishArtifact).not.toHaveBeenCalled();
    expect(result.current.publishedUrl).toBe('https://share/abc');
    expect(result.current.accessEmails).toEqual(['alice@x.com']);
  });

  it('shares publicly through the same route', async () => {
    // The server is authoritative for the resulting mode — it degrades an empty
    // restricted/password selection back to public — so the response, not the
    // request, is what the hook settles on.
    wsMock.setArtifactAccess.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'public',
    });
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));

    await act(async () => { await result.current.publish({ mode: 'public' }); });

    expect(wsMock.setArtifactAccess).toHaveBeenCalledWith(ORG_ARTIFACT, { mode: 'public' });
    expect(result.current.accessMode).toBe('public');
  });

  it('acts on an artifact that has no path at all', async () => {
    // The desktop guard is `!targetPath`; an org card has none, so a hook that
    // still keyed on it would refuse every share on Cloud.
    expect(apiMock.publishTargetPath(ORG_ARTIFACT)).toBe('');

    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));
    await act(async () => { await result.current.publish({ mode: 'public' }); });

    expect(wsMock.setArtifactAccess).toHaveBeenCalled();
  });

  it('refuses to act when the artifact has no full identity', async () => {
    wsMock.canUseArtifactWorkspace.mockReturnValue(false);
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));

    await act(async () => {
      expect(await result.current.publish({ mode: 'public' })).toBe(false);
    });
    expect(wsMock.setArtifactAccess).not.toHaveBeenCalled();
  });

  it('loads the recipient list a card would withhold', async () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { onChange, enabled: true }));

    await waitFor(() => expect(result.current.accessLoaded).toBe(true));

    expect(result.current.accessEmails).toEqual(['alice@x.com']);
    expect(wsMock.loadArtifactAccess).toHaveBeenCalledWith(ORG_ARTIFACT);
    expect(apiMock.fetchArtifactStatus).not.toHaveBeenCalled();
    // Reported to the parent, which keeps its own copy of the artifact.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ accessEmails: ['alice@x.com'] }),
    );
  });

  it('does not re-report access the artifact already carries', async () => {
    // refresh() runs on every open and window focus. Reporting an unchanged
    // list churns the host's preview state for nothing (ENG-3070).
    const onChange = vi.fn();
    const loaded = { ...ORG_ARTIFACT, accessEmails: ['alice@x.com'], orgAllowed: false, ownerOnly: false };
    const { result } = renderHook(() => usePublish(loaded, { onChange, enabled: true }));

    await waitFor(() => expect(wsMock.loadArtifactAccess).toHaveBeenCalled());
    await act(async () => { await result.current.refresh(); });

    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.accessEmails).toEqual(['alice@x.com']);
  });

  it("drops the previous artifact's access read when it lands late", async () => {
    // Open A, close, open B; B's read lands first, then A's. The hook must not
    // put A's recipients in B's editable list (ENG-3070 review).
    const B = { ...ORG_ARTIFACT, id: 'b2c3d4e5f6a70b1c2d3e4f5a6b7c8d9e' };
    const readA = deferred();
    const readB = deferred();
    wsMock.loadArtifactAccess.mockImplementation((a) => (a.id === B.id ? readB.promise : readA.promise));
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ artifact, enabled }) => usePublish(artifact, { onChange, enabled }),
      { initialProps: { artifact: ORG_ARTIFACT, enabled: true } },
    );

    rerender({ artifact: ORG_ARTIFACT, enabled: false });
    rerender({ artifact: B, enabled: true });
    await act(async () => {
      readB.resolve({ accessMode: 'restricted', accessEmails: ['bob@x.com'], orgAllowed: false, ownerOnly: false });
    });
    await act(async () => {
      readA.resolve({ accessMode: 'restricted', accessEmails: ['alice@x.com'], orgAllowed: true, ownerOnly: false });
    });

    expect(result.current.accessEmails).toEqual(['bob@x.com']);
    expect(result.current.orgAllowed).toBe(false);
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ accessEmails: ['alice@x.com'] }));
  });

  it("drops a save's answer that lands after the viewer moved to another artifact", async () => {
    // Save on A, move to B, then A's answer arrives. It belongs to A: B keeps
    // its own card and waits for its own access read.
    const B = { ...ORG_ARTIFACT, id: 'b2c3d4e5f6a70b1c2d3e4f5a6b7c8d9e' };
    const save = deferred();
    const readB = deferred();
    wsMock.setArtifactAccess.mockReturnValue(save.promise);
    wsMock.loadArtifactAccess.mockImplementation((a) => (a.id === B.id
      ? readB.promise
      : Promise.resolve({ accessMode: 'restricted', accessEmails: ['alice@x.com'], ownerOnly: false })));
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ artifact }) => usePublish(artifact, { onChange, enabled: true }),
      { initialProps: { artifact: ORG_ARTIFACT } },
    );
    await waitFor(() => expect(result.current.accessLoaded).toBe(true));

    let saved;
    act(() => {
      saved = result.current.publish({ mode: 'restricted', allowed_emails: ['carol@x.com'], org_allowed: true });
    });
    rerender({ artifact: B });
    let ok;
    await act(async () => {
      save.resolve({
        url: 'https://share/a-moved', accessMode: 'restricted', accessEmails: ['carol@x.com'],
        orgAllowed: true, ownerOnly: false, allowedTeamIds: ['t-platform'],
      });
      ok = await saved;
    });

    expect(ok).toBe(false);
    expect(result.current.publishedUrl).toBe('https://share/abc');
    expect(result.current.accessEmails).toEqual([]);
    expect(result.current.orgAllowed).toBe(false);
    expect(result.current.allowedTeamIds).toEqual([]);
    expect(result.current.accessLoaded).toBe(false);
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ accessEmails: ['carol@x.com'] }));

    await waitFor(() => expect(wsMock.loadArtifactAccess).toHaveBeenCalledWith(B));
    await act(async () => {
      readB.resolve({ accessMode: 'restricted', accessEmails: ['bob@x.com'], ownerOnly: false });
    });
    expect(result.current.accessLoaded).toBe(true);
    expect(result.current.accessEmails).toEqual(['bob@x.com']);
  });

  it('keeps a save when an older access read answers after it', async () => {
    // A focus read starts, the person saves, the save answers first, then the
    // read answers with the access from before the save.
    const staleRead = deferred();
    wsMock.loadArtifactAccess
      .mockResolvedValueOnce({ accessMode: 'restricted', accessEmails: ['alice@x.com'], ownerOnly: false })
      .mockReturnValueOnce(staleRead.promise);
    wsMock.setArtifactAccess.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'restricted', accessEmails: ['carol@x.com'], ownerOnly: false,
    });
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: true }));
    await waitFor(() => expect(result.current.accessLoaded).toBe(true));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(wsMock.loadArtifactAccess).toHaveBeenCalledTimes(2));
    await act(async () => {
      await result.current.publish({ mode: 'restricted', allowed_emails: ['carol@x.com'] });
    });
    expect(result.current.accessEmails).toEqual(['carol@x.com']);

    await act(async () => {
      staleRead.resolve({ accessMode: 'restricted', accessEmails: ['alice@x.com'], ownerOnly: false });
    });
    expect(result.current.accessEmails).toEqual(['carol@x.com']);
  });

  /* The open-time read is still out when the person saves (Change password
     shows before the access loads). The save drops that read, so its answer
     can't undo the save; a save that then fails must ask again, or the panel
     waits on "Loading current access…" for a read nobody sends. */
  it('reads the access again when a save fails while the open read was out', async () => {
    const openRead = deferred();
    wsMock.loadArtifactAccess
      .mockReturnValueOnce(openRead.promise)
      .mockResolvedValue({ accessMode: 'password', accessPassword: 'old', ownerOnly: false });
    wsMock.setArtifactAccess.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const card = { ...ORG_ARTIFACT, accessMode: 'password' };
    const { result } = renderHook(() => usePublish(card, { enabled: true }));
    await waitFor(() => expect(wsMock.loadArtifactAccess).toHaveBeenCalledTimes(1));
    expect(result.current.accessLoaded).toBe(false);

    await act(async () => {
      expect(await result.current.publish({ mode: 'password', password: 'new' })).toBe(false);
    });
    // The dropped read's late answer is ignored either way.
    await act(async () => { openRead.resolve({ accessMode: 'password', accessPassword: 'stale', ownerOnly: false }); });

    await waitFor(() => expect(wsMock.loadArtifactAccess).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.accessLoaded).toBe(true));
    expect(result.current.accessPassword).toBe('old');
    expect(result.current.error).toMatch(/boom/);
  });

  it('asks nothing again when a save fails after the access had loaded', async () => {
    wsMock.setArtifactAccess.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: true }));
    await waitFor(() => expect(result.current.accessLoaded).toBe(true));

    await act(async () => { await result.current.publish({ mode: 'public' }); });

    expect(wsMock.loadArtifactAccess).toHaveBeenCalledTimes(1);
  });

  it("keeps a save's failure off the artifact the viewer moved to", async () => {
    const B = { ...ORG_ARTIFACT, id: 'b2c3d4e5f6a70b1c2d3e4f5a6b7c8d9e' };
    let rejectSave;
    wsMock.setArtifactAccess.mockReturnValue(new Promise((_, reject) => { rejectSave = reject; }));
    const { result, rerender } = renderHook(
      ({ artifact }) => usePublish(artifact, { enabled: true }),
      { initialProps: { artifact: ORG_ARTIFACT } },
    );
    await waitFor(() => expect(result.current.accessLoaded).toBe(true));

    let saved;
    act(() => { saved = result.current.publish({ mode: 'public' }); });
    rerender({ artifact: B });
    await act(async () => {
      rejectSave(new Error('boom'));
      await saved;
    });

    expect(result.current.error).toBe('');
  });

  it('survives an access read that fails, and says so until a retry answers', async () => {
    wsMock.loadArtifactAccess.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: true }));

    await act(async () => { await result.current.refresh(); });

    expect(result.current.error).toBe('');
    expect(result.current.accessMode).toBe('restricted');
    // The card's empty audience is never taken for the loaded one.
    expect(result.current.accessLoaded).toBe(false);
    expect(result.current.accessLoadFailed).toBe(true);

    wsMock.loadArtifactAccess.mockResolvedValue({
      accessMode: 'restricted', accessEmails: [], ownerOnly: false, allowedTeamIds: ['t-platform'],
    });
    await act(async () => { await result.current.refresh(); });

    expect(result.current.accessLoaded).toBe(true);
    expect(result.current.accessLoadFailed).toBe(false);
    expect(result.current.allowedTeamIds).toEqual(['t-platform']);
  });

  // An org card says `restricted` but carries no audience: cowork-server
  // leaves its teams, people and org flag empty. Only the access route's
  // answer is the access.
  it('does not count an org card as loaded access until the access route answers', async () => {
    const read = deferred();
    wsMock.loadArtifactAccess.mockReturnValue(read.promise);
    const card = { ...ORG_ARTIFACT, ownerOnly: false, orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] };
    const { result } = renderHook(() => usePublish(card, { enabled: true }));

    expect(result.current.accessLoaded).toBe(false);
    await waitFor(() => expect(wsMock.loadArtifactAccess).toHaveBeenCalledTimes(1));
    expect(result.current.accessLoaded).toBe(false);

    await act(async () => {
      read.resolve({ accessMode: 'restricted', accessEmails: [], ownerOnly: false, allowedTeamIds: ['t-platform'] });
    });

    expect(result.current.accessLoaded).toBe(true);
    expect(result.current.allowedTeamIds).toEqual(['t-platform']);
  });

  it('does not count an org card as loaded even before the panel opens', () => {
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));
    expect(result.current.accessLoaded).toBe(false);
  });

  it('waits again for the access route when the viewer moves to another artifact', async () => {
    // Org cards have no path, so the reset is keyed on project and id.
    const B = { ...ORG_ARTIFACT, id: 'b2c3d4e5f6a70b1c2d3e4f5a6b7c8d9e' };
    const readB = deferred();
    wsMock.loadArtifactAccess.mockImplementation((a) => (a.id === B.id
      ? readB.promise
      : Promise.resolve({ accessMode: 'restricted', accessEmails: ['alice@x.com'], ownerOnly: false })));
    const { result, rerender } = renderHook(
      ({ artifact }) => usePublish(artifact, { enabled: true }),
      { initialProps: { artifact: ORG_ARTIFACT } },
    );
    await waitFor(() => expect(result.current.accessLoaded).toBe(true));

    rerender({ artifact: B });

    await waitFor(() => expect(wsMock.loadArtifactAccess).toHaveBeenCalledWith(B));
    expect(result.current.accessLoaded).toBe(false);
    // A's loaded audience never carries over to B.
    expect(result.current.accessEmails).toEqual([]);
    await act(async () => {
      readB.resolve({ accessMode: 'restricted', accessEmails: ['bob@x.com'], ownerOnly: false });
    });
    expect(result.current.accessLoaded).toBe(true);
    expect(result.current.accessEmails).toEqual(['bob@x.com']);
  });

  it('keeps the loaded audience when the parent hands over a reloaded card', async () => {
    // The app reloads its artifacts list after every turn, and the viewer then
    // gets a fresh card for the same artifact: no audience, and `modified`
    // flipped by an edit autopublish has not caught up with yet.
    wsMock.loadArtifactAccess.mockResolvedValue({
      accessMode: 'restricted', accessEmails: ['alice@x.com'], ownerOnly: false,
      orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: ['u-ana'],
    });
    const card = { ...ORG_ARTIFACT, ownerOnly: false, orgAllowed: false, allowedTeamIds: [], allowedUserIds: [], modified: false };
    const { result, rerender } = renderHook(
      ({ artifact }) => usePublish(artifact, { enabled: true }),
      { initialProps: { artifact: card } },
    );
    await waitFor(() => expect(result.current.accessLoaded).toBe(true));

    rerender({ artifact: { ...card, modified: true } });

    expect(result.current.modified).toBe(true);
    expect(result.current.accessLoaded).toBe(true);
    expect(result.current.allowedTeamIds).toEqual(['t-platform']);
    expect(result.current.allowedUserIds).toEqual(['u-ana']);
    expect(result.current.accessEmails).toEqual(['alice@x.com']);
    expect(wsMock.loadArtifactAccess).toHaveBeenCalledTimes(1);
  });

  it('does not offer update, stop-sharing or version history', async () => {
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));

    expect(result.current.orgMode).toBe(true);

    await act(async () => {
      expect(await result.current.update()).toBe(false);
      expect(await result.current.unpublish()).toBe(false);
      await result.current.loadVersions();
    });

    expect(apiMock.updateArtifact).not.toHaveBeenCalled();
    expect(apiMock.unpublishArtifact).not.toHaveBeenCalled();
    expect(apiMock.listArtifactVersions).not.toHaveBeenCalled();
    expect(result.current.versions).toEqual([]);
  });
});

describe('usePublish on desktop is unchanged', () => {
  it('still publishes by path and never touches the workspace route', async () => {
    setOrgMode(false);
    apiMock.publishArtifact.mockResolvedValue({ url: 'https://share/xyz', accessMode: 'public' });
    const artifact = { path: '/tmp/a/index.html', publishedUrl: '' };

    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    await act(async () => { await result.current.publish({ mode: 'public' }); });

    expect(apiMock.publishArtifact).toHaveBeenCalledWith('/tmp/a/index.html', { mode: 'public' });
    expect(wsMock.setArtifactAccess).not.toHaveBeenCalled();
    expect(result.current.orgMode).toBe(false);
  });
});

describe('usePublish on Cloud — an artifact published by another owner', () => {
  it('shows the owner message when the workspace route answers 409', async () => {
    wsMock.setArtifactAccess.mockRejectedValue(Object.assign(
      new Error('This artifact was published by another owner.'),
      { status: 409, code: 'artifact_owned_by_other_user' },
    ));
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));

    await act(async () => { await result.current.publish({ mode: 'public' }); });

    expect(result.current.error).toBe('This artifact was published by another owner.');
  });
});
