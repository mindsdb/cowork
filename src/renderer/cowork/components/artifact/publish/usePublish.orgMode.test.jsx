// Org sharing uses artifact identity and owner-gated workspace routes instead of local
// paths/publish.
// Read access details from the owner-only endpoint because shared artifact cards withhold
// recipients/passwords.

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
    // Settle on the server's returned mode; empty restricted/password requests can normalize to
    // public.
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

    // Not `accessLoaded`: it is seeded true from the prop's own accessMode, so
    // waiting on it would return before the fetch landed and assert nothing.
    await waitFor(() => expect(result.current.accessEmails).toEqual(['alice@x.com']));

    expect(wsMock.loadArtifactAccess).toHaveBeenCalledWith(ORG_ARTIFACT);
    expect(apiMock.fetchArtifactStatus).not.toHaveBeenCalled();
    // Fed back into the prop, or the broad re-sync effect re-seeds the stale
    // empty list straight over it (the ENG-931 self-clobber).
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ accessEmails: ['alice@x.com'] }),
    );
  });

  it('survives an access read that fails', async () => {
    wsMock.loadArtifactAccess.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: true }));

    await act(async () => { await result.current.refresh(); });

    expect(result.current.error).toBe('');
    expect(result.current.accessMode).toBe('restricted');
  });

  it('does not offer update, stop-sharing or version history', async () => {
    const { result } = renderHook(() => usePublish(ORG_ARTIFACT, { enabled: false }));

    expect(result.current.supportsPublishRoutes).toBe(false);

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
    expect(result.current.supportsPublishRoutes).toBe(true);
  });
});
