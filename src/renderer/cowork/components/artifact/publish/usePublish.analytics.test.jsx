// What the Share panel's saves send to analytics: a first share, a change or a
// pull-back, each once, and never for a save that failed or changed nothing.
// artifact_published keeps firing only on the first publish, as before.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { setOrgMode } from '../../../../lib/orgMode';
import { SHARE_ORG_REQUIRED_CODE } from '../../../lib/sharingContract';

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

const analytics = vi.hoisted(() => ({
  trackArtifactPublished: vi.fn(),
  trackArtifactAccessChanged: vi.fn(),
  trackArtifactAccessChangeFailed: vi.fn(),
  trackArtifactDownloaded: vi.fn(),
  trackArtifactLinkCopied: vi.fn(),
  trackArtifactShareOpened: vi.fn(),
}));
vi.mock('../../../lib/analytics', () => analytics);

const wsMock = vi.hoisted(() => ({
  canUseArtifactWorkspace: vi.fn(() => true),
  loadArtifactAccess: vi.fn(),
  setArtifactAccess: vi.fn(),
}));
vi.mock('../../../lib/artifactWorkspaceApi', () => wsMock);

import { usePublish } from './usePublish';

const ID = '7db94eb8f0a54c7e9c1d2b3a4f5e6d70';
const changed = () => analytics.trackArtifactAccessChanged.mock.calls.map(([props]) => props);

beforeEach(() => {
  vi.clearAllMocks();
  wsMock.canUseArtifactWorkspace.mockReturnValue(true);
});

describe('on Web, an artifact published automatically as "only me"', () => {
  const AUTOPUBLISHED = {
    id: ID, projectId: 'proj-1', type: 'html',
    publishedUrl: 'https://share/abc', accessMode: 'restricted', ownerOnly: null,
  };

  beforeEach(() => {
    setOrgMode(true);
    wsMock.loadArtifactAccess.mockResolvedValue({
      accessMode: 'restricted', accessEmails: [], orgAllowed: false, ownerOnly: true,
      allowedTeamIds: [], allowedUserIds: [],
    });
  });
  afterEach(() => setOrgMode(false));

  async function openPanel() {
    const hook = renderHook(() => usePublish(AUTOPUBLISHED, { enabled: true }));
    await waitFor(() => expect(hook.result.current.accessLoaded).toBe(true));
    return hook;
  }

  it('records sharing it with someone as a first share, and leaves artifact_published alone', async () => {
    wsMock.setArtifactAccess.mockResolvedValue({
      url: 'https://share/abc', report_id: 'rep-1', accessMode: 'restricted',
      accessEmails: ['alice@x.com'], orgAllowed: false, ownerOnly: false,
    });
    const { result } = await openPanel();

    await act(async () => {
      await result.current.publish({ mode: 'restricted', allowed_emails: ['alice@x.com'], notify: { emails: ['alice@x.com'] } });
    });

    expect(changed()).toEqual([expect.objectContaining({
      artifactId: ID, artifactType: 'html', entry: 'viewer', reportId: 'rep-1', notified: true,
      before: expect.objectContaining({ shared: false, audience: 'only_me' }),
      after: expect.objectContaining({ shared: true, audience: 'specific', peopleCount: 1 }),
    })]);
    expect(JSON.stringify(changed())).not.toMatch(/alice/);
    // It already had a link, so this is not a first publish.
    expect(analytics.trackArtifactPublished).not.toHaveBeenCalled();
  });

  it('records nothing when the same access is saved again', async () => {
    wsMock.setArtifactAccess.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'restricted',
      accessEmails: [], orgAllowed: false, ownerOnly: true,
    });
    const { result } = await openPanel();

    await act(async () => { await result.current.publish({ mode: 'restricted', owner_only: true }); });

    expect(analytics.trackArtifactAccessChanged).not.toHaveBeenCalled();
  });

  it('records a refused share as refused, and nothing as shared', async () => {
    wsMock.setArtifactAccess.mockRejectedValue(
      Object.assign(new Error('Only admins can share with everyone.'), { code: SHARE_ORG_REQUIRED_CODE }),
    );
    const { result } = await openPanel();

    await act(async () => { await result.current.publish({ mode: 'restricted', org_allowed: true }); });

    expect(analytics.trackArtifactAccessChanged).not.toHaveBeenCalled();
    expect(analytics.trackArtifactAccessChangeFailed).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: ID, entry: 'viewer', reason: 'share_org_not_allowed',
    }));
  });
});

describe('on Desktop', () => {
  const LOCAL = { id: ID, type: 'html', path: '/p/.anton/artifacts/r/index.html', accessMode: 'public' };

  it('records a first publish as a first share, beside artifact_published', async () => {
    apiMock.publishArtifact.mockResolvedValue({ url: 'https://share/new', accessMode: 'public', report_id: 'rep-2' });
    const { result } = renderHook(() => usePublish(LOCAL, { enabled: true }));

    await act(async () => { await result.current.publish({ mode: 'public' }); });

    expect(changed()).toEqual([expect.objectContaining({
      entry: 'viewer', reportId: 'rep-2',
      before: expect.objectContaining({ shared: false, audience: 'unpublished' }),
      after: expect.objectContaining({ shared: true, audience: 'public' }),
    })]);
    expect(analytics.trackArtifactPublished).toHaveBeenCalledTimes(1);
  });

  it('records a later change of access as a change', async () => {
    apiMock.publishArtifact.mockResolvedValue({ url: 'https://share/x', accessMode: 'password' });
    const published = { ...LOCAL, publishedUrl: 'https://share/x', accessMode: 'public' };
    const { result } = renderHook(() => usePublish(published, { enabled: true }));

    await act(async () => { await result.current.publish({ mode: 'password', password: 'pw' }); });

    expect(changed()).toEqual([expect.objectContaining({
      before: expect.objectContaining({ shared: true, audience: 'public' }),
      after: expect.objectContaining({ shared: true, audience: 'password' }),
    })]);
    expect(JSON.stringify(changed())).not.toMatch(/"pw"/);
  });

  it('records Stop sharing as a pull-back', async () => {
    apiMock.unpublishArtifact.mockResolvedValue({});
    const published = { ...LOCAL, publishedUrl: 'https://share/x', accessMode: 'public' };
    const { result } = renderHook(() => usePublish(published, { enabled: true }));

    await act(async () => { await result.current.unpublish(); });

    expect(changed()).toEqual([expect.objectContaining({
      before: expect.objectContaining({ shared: true }),
      after: expect.objectContaining({ shared: false, audience: 'unpublished' }),
    })]);
  });

  it('records nothing when a save fails, except the failure', async () => {
    apiMock.publishArtifact.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => usePublish(LOCAL, { enabled: true }));

    await act(async () => { await result.current.publish({ mode: 'public' }); });

    expect(analytics.trackArtifactAccessChanged).not.toHaveBeenCalled();
    expect(analytics.trackArtifactPublished).not.toHaveBeenCalled();
    expect(analytics.trackArtifactAccessChangeFailed).toHaveBeenCalledWith(expect.objectContaining({ reason: 'error' }));
  });
});
