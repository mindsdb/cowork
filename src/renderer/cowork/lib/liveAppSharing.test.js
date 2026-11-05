import { describe, expect, it } from 'vitest';
import {
  canShareLiveApp,
  duplicateDisclaimer,
  duplicateDisclaimerTitle,
  isLiveAppCard,
  liveAppSharesFrom,
  ownerLabel,
  receivedFromLine,
  shareAudienceLabel,
  sharedByLine,
  sharedLiveAppsFrom,
} from './liveAppSharing';

const app = (overrides = {}) => ({
  slug: 'table-counts',
  projectId: 'p1',
  type: 'fullstack-stateless-app',
  capabilities: { role: 'owner', canEdit: true },
  ...overrides,
});

describe('canShareLiveApp', () => {
  it('offers sharing for an owned full-stack app when live apps are on', () => {
    expect(canShareLiveApp(app(), true)).toBe(true);
    expect(canShareLiveApp(app({ type: 'fullstack-stateful-app' }), true)).toBe(true);
  });

  it('offers nothing while live apps are off, so other deployments see no change', () => {
    expect(canShareLiveApp(app(), false)).toBe(false);
    expect(canShareLiveApp(app(), undefined)).toBe(false);
  });

  it.each([
    ['a static page', { type: 'html-app' }],
    ["someone else's app", { capabilities: { role: 'reviewer', canEdit: false } }],
    ['an app with no slug', { slug: '' }],
    ['an app with no project', { projectId: null }],
  ])('offers nothing for %s', (_label, overrides) => {
    expect(canShareLiveApp(app(overrides), true)).toBe(false);
  });
});

describe('isLiveAppCard', () => {
  it('marks an unpublished full-stack app while live apps are on', () => {
    expect(isLiveAppCard(app(), true)).toBe(true);
  });

  it.each([
    ['live apps are off', app(), false],
    ['a static page', app({ type: 'html-app' }), true],
    ['an app published before live apps were on', app({ publishedUrl: 'https://pages.example/a' }), true],
  ])('leaves the card as it was when %s', (_label, artifact, liveApps) => {
    expect(isLiveAppCard(artifact, liveApps)).toBe(false);
  });
});

describe('who shared it', () => {
  it('names the sharer by the email the server sent', () => {
    expect(ownerLabel(' ana@example.com ')).toBe('ana@example.com');
    expect(sharedByLine({ ownerEmail: 'ana@example.com' })).toBe('From ana@example.com');
  });

  it('says when the owner shared it with everyone', () => {
    expect(sharedByLine({ ownerEmail: 'ana@example.com', everyone: true })).toBe('From ana@example.com · for everyone');
  });

  it('falls back to "Another member" when the server names nobody', () => {
    expect(ownerLabel('')).toBe('Another member');
    expect(ownerLabel(undefined)).toBe('Another member');
    expect(sharedByLine({ ownerEmail: '' })).toBe('From Another member');
  });

  it('gives a copy its "received from" line and leaves every other artifact without one', () => {
    expect(receivedFromLine(app({ receivedFrom: { email: 'ana@example.com' } }))).toBe('Duplicated from ana@example.com');
    expect(receivedFromLine(app({ receivedFrom: { email: '' } }))).toBe('Duplicated from Another member');
    expect(receivedFromLine(app({ receivedFrom: null }))).toBe(null);
    expect(receivedFromLine(app())).toBe(null);
  });
});

describe('the duplicate disclaimer', () => {
  it('says who shared the app and that the copy runs with your own connections', () => {
    /*
     * "Shared", not "built": B can share on a copy of A's app, and the next
     * person's disclaimer would then credit B with code A wrote.
     */
    const shared = { name: 'Pipeline Health', slug: 'pipeline-health', ownerEmail: 'ana@example.com' };
    expect(duplicateDisclaimerTitle(shared)).toBe('Duplicate "Pipeline Health"?');
    expect(duplicateDisclaimer(shared)).toBe(
      'ana@example.com lets you duplicate this app. Your copy runs with your own connections '
      + 'and can use whatever they can use. Review it before you launch it.',
    );
  });
});

describe('sharedLiveAppsFrom', () => {
  it('keeps the entries the rail can act on, in the server order', () => {
    expect(sharedLiveAppsFrom([
      { shareId: 's2', slug: 'b', name: 'B', description: 'd', ownerEmail: 'ana@example.com', everyone: true, sharedAt: 't2',
        yourCopy: { projectId: 'p1', slug: 'b-2' } },
      { slug: 'no-share-id', name: 'Dropped' },
      { shareId: 's1', slug: 'a', yourCopy: { projectId: 'p1' } },
    ])).toEqual([
      { shareId: 's2', slug: 'b', name: 'B', description: 'd', ownerEmail: 'ana@example.com', everyone: true, sharedAt: 't2',
        yourCopy: { projectId: 'p1', slug: 'b-2' } },
      { shareId: 's1', slug: 'a', name: 'a', description: '', ownerEmail: '', everyone: false, sharedAt: '', yourCopy: null },
    ]);
  });

  it('reads anything but a list as nothing shared', () => {
    expect(sharedLiveAppsFrom(null)).toEqual([]);
    expect(sharedLiveAppsFrom({ detail: 'Not Found' })).toEqual([]);
  });
});

describe("the owner's shares", () => {
  it('keeps the shares the dialog can stop, with null for an everyone share', () => {
    expect(liveAppSharesFrom([
      { shareId: 's2', slug: 'a', email: null, everyone: true, sharedAt: 't2' },
      { slug: 'a', email: 'dropped@example.com' },
      { shareId: 's1', slug: 'a', email: 'ben@example.com', everyone: false, sharedAt: 't1' },
    ])).toEqual([
      { shareId: 's2', slug: 'a', email: null, everyone: true, sharedAt: 't2' },
      { shareId: 's1', slug: 'a', email: 'ben@example.com', everyone: false, sharedAt: 't1' },
    ]);
    expect(liveAppSharesFrom({ detail: 'Not Found' })).toEqual([]);
  });

  it('names each share by its address, or everyone on this stack', () => {
    expect(shareAudienceLabel({ email: 'ben@example.com', everyone: false })).toBe('ben@example.com');
    expect(shareAudienceLabel({ email: null, everyone: true })).toBe('Everyone on this stack');
  });
});
