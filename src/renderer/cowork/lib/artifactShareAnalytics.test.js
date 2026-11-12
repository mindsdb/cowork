import { beforeEach, describe, expect, it, vi } from 'vitest';

const analytics = vi.hoisted(() => ({
  trackArtifactAccessChanged: vi.fn(),
  trackArtifactAccessChangeFailed: vi.fn(),
  trackArtifactDownloaded: vi.fn(),
  trackArtifactLinkCopied: vi.fn(),
  trackArtifactShareOpened: vi.fn(),
}));
vi.mock('./analytics', () => analytics);

import {
  isReportableAccessChange,
  reportAccessChanged,
  reportDownloaded,
  shareSnapshot,
} from './artifactShareAnalytics';

const URL = 'https://view.example/r/1';
const restricted = (fields) => ({
  publishedUrl: URL,
  accessMode: 'restricted',
  accessEmails: [],
  orgAllowed: false,
  allowedTeamIds: [],
  allowedUserIds: [],
  ownerOnly: false,
  ...fields,
});

beforeEach(() => vi.clearAllMocks());

describe('shareSnapshot', () => {
  it('an artifact without a link reaches nobody', () => {
    expect(shareSnapshot({ id: 'a' })).toMatchObject({ shared: false, audience: 'unpublished' });
    expect(shareSnapshot(null)).toMatchObject({ shared: false, audience: 'unpublished' });
  });

  it('public and password links reach others', () => {
    expect(shareSnapshot({ publishedUrl: URL, accessMode: 'public' })).toMatchObject({ shared: true, audience: 'public' });
    expect(shareSnapshot({ publishedUrl: URL, accessProtected: true })).toMatchObject({ shared: true, audience: 'password' });
  });

  it('"only me" is published but reaches nobody else', () => {
    expect(shareSnapshot(restricted({ ownerOnly: true }))).toMatchObject({
      shared: false, audience: 'only_me', teamCount: 0, peopleCount: 0,
    });
  });

  it('counts teams and people without naming them, and reads the default team as everyone', () => {
    const teams = [{ id: 'everyone', is_default: true }, { id: 't1' }];
    expect(shareSnapshot(restricted({
      allowedTeamIds: ['t1'], allowedUserIds: ['u1'], accessEmails: ['x@out.example'],
    }), { teams })).toEqual(expect.objectContaining({
      shared: true, audience: 'specific', orgWide: false, teamCount: 1, peopleCount: 2,
    }));
    expect(shareSnapshot(restricted({ allowedTeamIds: ['everyone', 't1'] }), { teams })).toEqual(expect.objectContaining({
      shared: true, audience: 'organization', orgWide: true, teamCount: 1,
    }));
    expect(shareSnapshot(restricted({ orgAllowed: true }))).toMatchObject({ audience: 'organization', orgWide: true });
  });

  it('is unknown when the card does not say who a restricted artifact reaches', () => {
    expect(shareSnapshot(restricted({ accessEmails: null }))).toMatchObject({ shared: null, audience: 'unknown', fingerprint: null });
  });
});

describe('isReportableAccessChange', () => {
  const onlyMe = shareSnapshot(restricted({ ownerOnly: true }));
  const people = shareSnapshot(restricted({ accessEmails: ['a@x.example', 'b@x.example'] }));
  const unpublished = shareSnapshot(null);

  it('reports a first share, a change and a pull-back', () => {
    expect(isReportableAccessChange(onlyMe, people)).toBe(true);
    expect(isReportableAccessChange(unpublished, shareSnapshot({ publishedUrl: URL }))).toBe(true);
    expect(isReportableAccessChange(people, shareSnapshot({ publishedUrl: URL }))).toBe(true);
    expect(isReportableAccessChange(people, onlyMe)).toBe(true);
    expect(isReportableAccessChange(people, unpublished)).toBe(true);
  });

  it('does not report the same access saved again, whatever the order or case of the names', () => {
    const same = shareSnapshot(restricted({ accessEmails: ['B@x.example', 'a@x.example'] }));
    expect(isReportableAccessChange(people, same)).toBe(false);
  });

  it('reports a new password as a change', () => {
    const before = shareSnapshot({ publishedUrl: URL, accessMode: 'password', accessPassword: 'one' });
    const after = shareSnapshot({ publishedUrl: URL, accessMode: 'password', accessPassword: 'two' });
    expect(isReportableAccessChange(before, after)).toBe(true);
    expect(isReportableAccessChange(before, before)).toBe(false);
  });

  it('does not report a save that leaves it reaching only its owner', () => {
    expect(isReportableAccessChange(unpublished, onlyMe)).toBe(false);
    expect(isReportableAccessChange(onlyMe, unpublished)).toBe(false);
  });

  it('reports a save from an unknown audience, which can be a pull-back', () => {
    const unknown = shareSnapshot(restricted({ accessEmails: null }));
    expect(isReportableAccessChange(unknown, onlyMe)).toBe(true);
  });
});

describe('reporting', () => {
  const artifact = { id: '0123456789abcdef0123456789abcdef', type: 'html' };

  it('sends the change as categories and counts, never a recipient, and says whether people were emailed', () => {
    reportAccessChanged(artifact, {
      entry: 'viewer',
      before: shareSnapshot(restricted({ ownerOnly: true })),
      after: shareSnapshot(restricted({ accessEmails: ['secret.person@x.example'], allowedUserIds: ['u-secret'] })),
      reportId: 'r1',
      access: { notify: { user_ids: ['u-secret'], emails: [] } },
    });

    expect(analytics.trackArtifactAccessChanged).toHaveBeenCalledTimes(1);
    const sent = analytics.trackArtifactAccessChanged.mock.calls[0][0];
    expect(sent).toMatchObject({
      artifactId: '0123456789abcdef0123456789abcdef', artifactType: 'html', entry: 'viewer', reportId: 'r1', notified: true,
    });
    expect(sent.after).toMatchObject({ shared: true, peopleCount: 2 });
    expect(sent.before).not.toHaveProperty('fingerprint');
    expect(JSON.stringify(sent)).not.toMatch(/secret/);
  });

  it('sends nothing for the same access saved again', () => {
    const snap = shareSnapshot({ publishedUrl: URL, accessMode: 'public' });
    expect(reportAccessChanged(artifact, { entry: 'viewer', before: snap, after: snap })).toBe(false);
    expect(analytics.trackArtifactAccessChanged).not.toHaveBeenCalled();
  });

  it('never lets an analytics failure reach the action it reports on', () => {
    analytics.trackArtifactDownloaded.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => reportDownloaded(artifact, { entry: 'list' })).not.toThrow();
  });
});
