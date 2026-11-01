import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePublish } from './usePublish';
import { OWNED_BY_OTHER_USER_MESSAGE } from './publishErrors';
import { accessSummaryLabel } from './AccessChooser';

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Regression coverage for ENG-931: the restricted-access list must always
// reflect the server's real list — on any open, and it must never be
// self-clobbered by the re-sync effect after refresh() feeds onChange back
// into the artifact prop.

const apiMock = vi.hoisted(() => ({
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  fetchArtifactStatus: vi.fn(),
  listArtifactVersions: vi.fn(),
  activateArtifactVersion: vi.fn(),
  // Pure helper — mirror the real implementation so targetPath resolves.
  publishTargetPath: (a) => a?.folder || a?.canonicalPath || a?.file_path || a?.path || '',
}));
vi.mock('../../../api', () => apiMock);
vi.mock('../../../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));

// Server status for an already-shared restricted artifact with two recipients.
const STATUS_RESTRICTED = {
  publishedUrl: 'https://share/abc',
  modified: false,
  accessMode: 'restricted',
  accessEmails: ['alice@x.com', 'bob@x.com'],
  orgAllowed: false,
  artifactKey: 'user/report',
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.fetchArtifactStatus.mockResolvedValue(STATUS_RESTRICTED);
});

describe('usePublish — server is the source of truth for the access list (ENG-931)', () => {
  it('seeds accessLoaded=true when the prop already carries accessMode (grid/rail)', () => {
    const artifact = {
      path: '/p/a.html', publishedUrl: 'https://share/abc',
      accessMode: 'restricted', accessEmails: ['alice@x.com'],
    };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    expect(result.current.accessLoaded).toBe(true);
    expect(result.current.accessEmails).toEqual(['alice@x.com']);
  });

  it('seeds accessLoaded=true for a legacy prop carrying only accessProtected (no accessMode)', () => {
    const artifact = { path: '/p/a.html', publishedUrl: 'https://share/abc', accessProtected: true };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    expect(result.current.accessLoaded).toBe(true);
  });

  it('open refresh() fills the real list for a prop that lacks it (chat bubble)', async () => {
    const onChange = vi.fn();
    const artifact = { path: '/p/a.html' }; // no accessMode / accessEmails
    const { result } = renderHook(() => usePublish(artifact, { onChange, enabled: true }));

    // Guarded until the fetch lands.
    expect(result.current.accessLoaded).toBe(false);
    expect(result.current.accessEmails).toEqual([]);

    await waitFor(() => expect(result.current.accessLoaded).toBe(true));

    expect(apiMock.fetchArtifactStatus).toHaveBeenCalledWith('/p/a.html');
    expect(result.current.accessMode).toBe('restricted');
    expect(result.current.accessEmails).toEqual(['alice@x.com', 'bob@x.com']);
    // ⚠️ onChange must carry the access fields back (self-clobber guard).
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      accessMode: 'restricted',
      accessEmails: ['alice@x.com', 'bob@x.com'],
      orgAllowed: false,
    }));
  });

  it('refresh() applies access even when modified/publishedUrl are unchanged (early-return regression)', async () => {
    // Prop matches the status url + modified flag, so the old early return
    // would have bailed before touching the (empty) access list.
    const artifact = {
      path: '/p/a.html', publishedUrl: 'https://share/abc',
      accessMode: 'restricted', accessEmails: [],
    };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.accessEmails).toEqual(['alice@x.com', 'bob@x.com']);
  });

  it('does not self-clobber the loaded list when onChange feeds back into the prop', async () => {
    // Emulate the chat-bubble parent: onChange result becomes the next prop
    // (setPreviewArt). This is the sequence that would wipe the list if
    // onChange dropped the access fields.
    let artifact = { path: '/p/a.html' };
    const onChange = vi.fn((updated) => { artifact = updated; });
    const { result, rerender } = renderHook(
      ({ a }) => usePublish(a, { onChange, enabled: true }),
      { initialProps: { a: artifact } },
    );

    await waitFor(() => expect(result.current.accessLoaded).toBe(true));
    expect(result.current.accessEmails).toEqual(['alice@x.com', 'bob@x.com']);

    // Parent applies onChange back into the prop → re-sync effect re-seeds
    // accessEmails FROM the prop. The list must survive.
    rerender({ a: artifact });
    expect(result.current.accessEmails).toEqual(['alice@x.com', 'bob@x.com']);
  });

  // The viewer turns the key into the preview's comment bridge, so losing it
  // here flips the bridge off and back on with every refresh (ENG-3070).
  it('keeps the loaded artifactKey when onChange feeds back into the prop', async () => {
    let artifact = { path: '/p/a.html' };
    const onChange = vi.fn((updated) => { artifact = updated; });
    const { result, rerender } = renderHook(
      ({ a }) => usePublish(a, { onChange, enabled: true }),
      { initialProps: { a: artifact } },
    );

    await waitFor(() => expect(result.current.artifactKey).toBe('user/report'));
    expect(artifact.artifactKey).toBeUndefined();
    rerender({ a: artifact });
    expect(result.current.artifactKey).toBe('user/report');

    rerender({ a: { path: '/p/b.html' } });
    expect(result.current.artifactKey).toBe('');
  });

  it('publish(restricted) shows the new list immediately and marks it loaded (same-session)', async () => {
    apiMock.publishArtifact.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'restricted',
      accessEmails: ['carol@x.com'], orgAllowed: false, artifactKey: 'user/report',
    });
    const artifact = { path: '/p/a.html' };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    await act(async () => {
      await result.current.publish({ mode: 'restricted', emails: ['carol@x.com'] });
    });
    expect(result.current.accessEmails).toEqual(['carol@x.com']);
    expect(result.current.accessLoaded).toBe(true);
  });
});

describe('usePublish — ownerOnly (ENG-1769)', () => {
  it('seeds ownerOnly from the artifact prop', () => {
    const artifact = {
      path: '/p/a.html', publishedUrl: 'https://share/abc',
      accessMode: 'restricted', accessEmails: [], ownerOnly: true,
    };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    expect(result.current.ownerOnly).toBe(true);
  });

  it('defaults ownerOnly to false when the prop says nothing', () => {
    const artifact = { path: '/p/a.html' };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    expect(result.current.ownerOnly).toBe(false);
  });

  it('takes ownerOnly from the publish response', async () => {
    apiMock.publishArtifact.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'restricted',
      accessEmails: [], orgAllowed: false, ownerOnly: true, artifactKey: 'user/report',
    });
    const { result } = renderHook(() => usePublish({ path: '/p/a.html' }, { enabled: false }));
    await act(async () => {
      await result.current.publish({
        mode: 'restricted', emails: [], org_allowed: false, owner_only: true,
      });
    });
    expect(result.current.ownerOnly).toBe(true);
  });

  it('clears ownerOnly when re-publishing as public', async () => {
    apiMock.publishArtifact.mockResolvedValue({
      url: 'https://share/abc', accessMode: 'public', artifactKey: 'user/report',
    });
    const artifact = {
      path: '/p/a.html', publishedUrl: 'https://share/abc',
      accessMode: 'restricted', accessEmails: [], ownerOnly: true,
    };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    await act(async () => {
      await result.current.publish({ mode: 'public' });
    });
    expect(result.current.ownerOnly).toBe(false);
  });
});

describe('usePublish: the desktop refresh reads who the artifact reaches', () => {
  const sharedWithAlice = {
    path: '/p/a.html', publishedUrl: 'https://share/abc',
    accessMode: 'restricted', accessEmails: ['alice@x.com'], orgAllowed: false, ownerOnly: false,
  };

  /* GET /api/v1/artifacts/status of a cowork-server that sends ownerOnly,
     and of one that leaves it out. */
  it.each([
    ['a server that sends ownerOnly', { ownerOnly: true }],
    ['a server that leaves ownerOnly out', {}],
  ])('reads "Only me" once the artifact turns owner-only, from %s', async (_name, flag) => {
    apiMock.fetchArtifactStatus.mockResolvedValue({ ...STATUS_RESTRICTED, accessEmails: [], ...flag });
    const onChange = vi.fn();
    const { result } = renderHook(() => usePublish(sharedWithAlice, { onChange, enabled: false }));

    await act(async () => { await result.current.refresh(); });

    expect(result.current.ownerOnly).toBe(true);
    expect(accessSummaryLabel(result.current).title).toBe('Only me');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ accessEmails: [], ownerOnly: true }));
  });

  it("takes the server's ownerOnly over a card that left it out", async () => {
    apiMock.fetchArtifactStatus.mockResolvedValue({ ...STATUS_RESTRICTED, accessEmails: [], ownerOnly: true });
    const artifact = { path: '/p/a.html', publishedUrl: 'https://share/abc', accessMode: 'restricted', accessEmails: [], orgAllowed: false };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));
    expect(result.current.ownerOnly).toBe(false);

    await act(async () => { await result.current.refresh(); });

    expect(result.current.ownerOnly).toBe(true);
    expect(accessSummaryLabel(result.current).title).toBe('Only me');
  });

  /* A list the status leaves out reads as empty, as on the card, so the
     state's teams don't outlive the answer. */
  it.each([
    ['the status answers', { allowedTeamIds: ['team-1'], allowedUserIds: ['user-1'] }, ['team-1'], ['user-1']],
    ['as empty when the status leaves them out', {}, [], []],
  ])('takes the teams and people %s', async (_name, lists, teams, people) => {
    apiMock.fetchArtifactStatus.mockResolvedValue({ ...STATUS_RESTRICTED, accessEmails: ['alice@x.com'], ...lists });
    const artifact = { ...sharedWithAlice, allowedTeamIds: ['team-0'] };
    const onChange = vi.fn();
    const { result } = renderHook(() => usePublish(artifact, { onChange, enabled: false }));

    await act(async () => { await result.current.refresh(); });

    expect(result.current.allowedTeamIds).toEqual(teams);
    expect(result.current.allowedUserIds).toEqual(people);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ allowedTeamIds: teams, allowedUserIds: people }));
  });

  it('never reads a public artifact as owner-only', async () => {
    apiMock.fetchArtifactStatus.mockResolvedValue({
      publishedUrl: 'https://share/abc', modified: false, accessMode: 'public',
      accessEmails: [], orgAllowed: false,
    });
    const artifact = { ...sharedWithAlice, accessEmails: [], ownerOnly: true };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));

    await act(async () => { await result.current.refresh(); });

    expect(result.current.accessMode).toBe('public');
    expect(result.current.ownerOnly).toBe(false);
  });

  /* A card whose audience fields are null (the unknown audience). The
     parent feeds each report back in as the next prop, the way the
     chat-bubble preview does. */
  it('replaces a seeded unknown audience with the answer, without throwing', async () => {
    let artifact = {
      path: '/p/a.html', publishedUrl: 'https://share/abc', accessMode: 'restricted', modified: true,
      orgAllowed: null, ownerOnly: null, allowedTeamIds: null, allowedUserIds: null,
    };
    const onChange = vi.fn((updated) => { artifact = updated; });
    const { result, rerender } = renderHook(
      ({ a }) => usePublish(a, { onChange, enabled: false }),
      { initialProps: { a: artifact } },
    );
    expect(result.current.orgAllowed).toBeNull();

    await act(async () => { await result.current.refresh(); });
    expect(result.current).toMatchObject({ orgAllowed: false, ownerOnly: false, allowedTeamIds: [], allowedUserIds: [] });
    rerender({ a: artifact });

    expect(result.current).toMatchObject({
      accessEmails: ['alice@x.com', 'bob@x.com'], orgAllowed: false, ownerOnly: false,
      allowedTeamIds: [], allowedUserIds: [], modified: false,
    });
    expect(accessSummaryLabel(result.current).title).toBe('Specific people');
  });
});

describe('usePublish — a late refresh for another artifact (ENG-3070 review)', () => {
  it("drops the previous artifact's status when it lands after a switch", async () => {
    const statusA = deferred();
    const statusB = deferred();
    apiMock.fetchArtifactStatus.mockImplementation((path) => (path === '/p/b.html' ? statusB.promise : statusA.promise));
    const A = { path: '/p/a.html' };
    const B = { path: '/p/b.html' };
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ artifact, enabled }) => usePublish(artifact, { onChange, enabled }),
      { initialProps: { artifact: A, enabled: true } },
    );

    rerender({ artifact: A, enabled: false });
    rerender({ artifact: B, enabled: true });
    await act(async () => {
      statusB.resolve({ ...STATUS_RESTRICTED, publishedUrl: 'https://share/b', accessEmails: ['bob@x.com'] });
    });
    await act(async () => {
      statusA.resolve({ ...STATUS_RESTRICTED, publishedUrl: 'https://share/a', accessEmails: ['alice@x.com'] });
    });

    expect(result.current.accessEmails).toEqual(['bob@x.com']);
    expect(result.current.publishedUrl).toBe('https://share/b');
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ publishedUrl: 'https://share/a' }));
  });
});

describe('usePublish — an artifact published by another owner', () => {
  // What `req()` throws for cowork-server's 409: the server's sentence as the
  // message and its code beside it.
  const ownedElsewhere = () => Object.assign(
    new Error('This artifact was published by another owner.'),
    { status: 409, code: 'artifact_owned_by_other_user' },
  );

  it('publish() shows the owner message, not "Sharing failed"', async () => {
    apiMock.publishArtifact.mockRejectedValue(ownedElsewhere());
    const { result } = renderHook(() => usePublish({ path: '/p/a.html' }, { enabled: false }));

    let ok;
    await act(async () => { ok = await result.current.publish({ mode: 'public' }); });

    expect(ok).toBe(false);
    expect(result.current.error).toBe(OWNED_BY_OTHER_USER_MESSAGE);
    expect(result.current.publishedUrl).toBe('');
  });

  it('update() shows the same message', async () => {
    apiMock.updateArtifact.mockRejectedValue(ownedElsewhere());
    const artifact = { path: '/p/a.html', publishedUrl: 'https://share/abc', accessMode: 'public' };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));

    await act(async () => { await result.current.update(); });

    expect(result.current.error).toBe(OWNED_BY_OTHER_USER_MESSAGE);
  });

  it('keeps the existing wording for every other failure', async () => {
    apiMock.publishArtifact.mockRejectedValue(
      Object.assign(new Error('Conflict'), { status: 409, code: null }),
    );
    const { result } = renderHook(() => usePublish({ path: '/p/a.html' }, { enabled: false }));

    await act(async () => { await result.current.publish({ mode: 'public' }); });

    expect(result.current.error).toBe('Sharing failed: Conflict');
  });
});

describe('usePublish: a share with everyone refused', () => {
  // What `req()` throws for cowork-server's 403 share_org_required: MindsHub's
  // reason as the message and the code beside it.
  const REASON = 'Sharing an artifact with everyone in the organization needs the artifacts.share_org permission.';
  const refused = () => Object.assign(new Error(REASON), { status: 403, code: 'share_org_required' });

  it('publish() shows the reason once, with no "Sharing failed:" in front', async () => {
    apiMock.publishArtifact.mockRejectedValue(refused());
    const { result } = renderHook(() => usePublish({ path: '/p/a.html' }, { enabled: false }));

    let ok;
    await act(async () => { ok = await result.current.publish({ mode: 'restricted', emails: [], org_allowed: false, owner_only: true }); });

    expect(ok).toBe(false);
    expect(result.current.error).toBe(REASON);
    expect(result.current.publishedUrl).toBe('');
  });

  it('update() shows the reason the same way', async () => {
    apiMock.updateArtifact.mockRejectedValue(refused());
    const artifact = { path: '/p/a.html', publishedUrl: 'https://share/abc', accessMode: 'restricted', orgAllowed: true, modified: true };
    const { result } = renderHook(() => usePublish(artifact, { enabled: false }));

    await act(async () => { await result.current.update(); });

    expect(result.current.error).toBe(REASON);
    expect(result.current.modified).toBe(true);
  });
});
