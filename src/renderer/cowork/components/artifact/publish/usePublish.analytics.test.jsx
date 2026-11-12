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

describe('on Web, a draft that is published automatically while its viewer is open', () => {
  const DRAFT = { id: ID, projectId: 'proj-1', type: 'html', publishedUrl: '' };
  const AUTOPUBLISHED = { ...DRAFT, publishedUrl: 'https://share/abc', accessMode: 'restricted', ownerOnly: null };
  // What the access route answers for a draft: the schema default, not a share.
  const DRAFT_ACCESS = {
    accessMode: 'public', accessEmails: [], orgAllowed: false, ownerOnly: false,
    allowedTeamIds: [], allowedUserIds: [],
  };
  const ONLY_ME_ACCESS = { ...DRAFT_ACCESS, accessMode: 'restricted', ownerOnly: true };

  beforeEach(() => {
    setOrgMode(true);
    wsMock.loadArtifactAccess.mockResolvedValueOnce(DRAFT_ACCESS).mockResolvedValue(ONLY_ME_ACCESS);
    wsMock.setArtifactAccess.mockResolvedValue({ url: 'https://share/abc', report_id: 'rep-1', accessMode: 'public' });
  });
  afterEach(() => setOrgMode(false));

  async function openDraftThenAutopublish() {
    const hook = renderHook(({ artifact }) => usePublish(artifact, { enabled: true }), { initialProps: { artifact: DRAFT } });
    await waitFor(() => expect(hook.result.current.accessLoaded).toBe(true));
    hook.rerender({ artifact: AUTOPUBLISHED });
    return hook;
  }

  it('records the first public share as a first share once the access is read again', async () => {
    const { result } = await openDraftThenAutopublish();
    await waitFor(() => expect(result.current.accessLoaded).toBe(true));

    await act(async () => { await result.current.publish({ mode: 'public' }); });

    expect(changed()).toEqual([expect.objectContaining({
      before: expect.objectContaining({ shared: false, audience: 'only_me' }),
      after: expect.objectContaining({ shared: true, audience: 'public' }),
    })]);
  });

  it('records the first public share with an unknown before while that read is pending', async () => {
    const { result } = await openDraftThenAutopublish();

    await act(async () => { await result.current.publish({ mode: 'public' }); });

    expect(changed()).toEqual([expect.objectContaining({
      before: expect.objectContaining({ shared: null, audience: 'unknown' }),
      after: expect.objectContaining({ shared: true, audience: 'public' }),
    })]);
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

  it('puts the page it published on the card, and takes it off on Stop sharing', async () => {
    apiMock.publishArtifact.mockResolvedValue({ url: 'https://share/new', accessMode: 'public', report_id: 'rep-2' });
    const onChange = vi.fn();
    const { result } = renderHook(() => usePublish(LOCAL, { onChange, enabled: true }));
    await act(async () => { await result.current.publish({ mode: 'public' }); });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ reportId: 'rep-2' }));

    apiMock.unpublishArtifact.mockResolvedValue({});
    const published = { ...LOCAL, publishedUrl: 'https://share/new', accessMode: 'public', reportId: 'rep-2' };
    const stopped = vi.fn();
    const hook = renderHook(() => usePublish(published, { onChange: stopped, enabled: true }));
    await act(async () => { await hook.result.current.unpublish(); });
    expect(stopped).toHaveBeenLastCalledWith(expect.objectContaining({ publishedUrl: '', reportId: '' }));
    expect(changed().at(-1)).toMatchObject({ reportId: 'rep-2' });
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

  it('records a Stop sharing that left the page live as a failed attempt, not a pull-back', async () => {
    apiMock.unpublishArtifact.mockResolvedValue({ status: 'ok', takenDown: false, liveLink: 'https://view.example/r/a', reason: 'no_owner_record' });
    const published = { ...LOCAL, publishedUrl: 'https://share/x', accessMode: 'public' };
    const { result } = renderHook(() => usePublish(published, { enabled: true }));

    await act(async () => { await result.current.unpublish(); });

    expect(analytics.trackArtifactAccessChanged).not.toHaveBeenCalled();
    expect(analytics.trackArtifactAccessChangeFailed).toHaveBeenCalledWith(expect.objectContaining({
      entry: 'viewer', reason: 'left_live',
    }));
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

describe('an artifact opened from a chat message learns its page id when the viewer opens', () => {
  // Built from the stream: it has the link but no reportId.
  const FROM_CHAT = { id: ID, type: 'html', path: '/p/.anton/artifacts/r/index.html', publishedUrl: 'https://share/x' };

  it('on Desktop, from the status read', async () => {
    apiMock.fetchArtifactStatus.mockResolvedValue({ publishedUrl: 'https://share/x', accessMode: 'public', reportId: 'rep-chat' });
    const onChange = vi.fn();
    const { result } = renderHook(() => usePublish(FROM_CHAT, { onChange, enabled: true }));
    await act(async () => { await result.current.refresh(); });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ reportId: 'rep-chat' }));
  });

  it('on Web, from the access read', async () => {
    setOrgMode(true);
    try {
      wsMock.loadArtifactAccess.mockResolvedValue({
        accessMode: 'restricted', accessEmails: [], orgAllowed: false, ownerOnly: true,
        allowedTeamIds: [], allowedUserIds: [], reportId: 'rep-web',
      });
      const onChange = vi.fn();
      // The card already matches the read in every field but the page id.
      const card = {
        ...FROM_CHAT, projectId: 'proj-1', accessMode: 'restricted', ownerOnly: true,
        accessEmails: [], orgAllowed: false, allowedTeamIds: [], allowedUserIds: [],
      };
      renderHook(() => usePublish(card, { onChange, enabled: true }));
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reportId: 'rep-web' })));
    } finally {
      setOrgMode(false);
    }
  });

  it('keeps the id it has when an older server sends none', async () => {
    apiMock.fetchArtifactStatus.mockResolvedValue({ publishedUrl: 'https://share/x', accessMode: 'password', modified: true });
    const onChange = vi.fn();
    const { result } = renderHook(() => usePublish({ ...FROM_CHAT, reportId: 'rep-had' }, { onChange, enabled: true }));
    await act(async () => { await result.current.refresh(); });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ reportId: 'rep-had' }));
  });
});
