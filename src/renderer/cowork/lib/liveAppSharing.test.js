import { describe, expect, it } from 'vitest';
import {
  canShareLiveApp,
  duplicateDisclaimer,
  duplicateDisclaimerTitle,
  isEmailLike,
  ownerLabel,
  receivedFromLine,
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

describe('who shared it', () => {
  it('names the sharer by the email the server sent', () => {
    expect(ownerLabel(' ana@example.com ')).toBe('ana@example.com');
    expect(sharedByLine({ ownerEmail: 'ana@example.com' })).toBe('From ana@example.com');
  });

  it('says when the owner shared it with everyone', () => {
    expect(sharedByLine({ ownerEmail: 'ana@example.com', everyone: true })).toBe('From ana@example.com · shared with everyone');
  });

  it('falls back to "Another member" when the server names nobody', () => {
    expect(ownerLabel('')).toBe('Another member');
    expect(ownerLabel(undefined)).toBe('Another member');
    expect(sharedByLine({ ownerEmail: '' })).toBe('From another member');
  });

  it('gives a copy its "received from" line and leaves every other artifact without one', () => {
    expect(receivedFromLine(app({ receivedFrom: { email: 'ana@example.com' } }))).toBe('Received from ana@example.com');
    expect(receivedFromLine(app({ receivedFrom: { email: '' } }))).toBe('Received from Another member');
    expect(receivedFromLine(app({ receivedFrom: null }))).toBe(null);
    expect(receivedFromLine(app())).toBe(null);
  });
});

describe('the duplicate disclaimer', () => {
  it('says who built the app and that the copy runs with your own connections', () => {
    const shared = { name: 'Pipeline Health', slug: 'pipeline-health', ownerEmail: 'ana@example.com' };
    expect(duplicateDisclaimerTitle(shared)).toBe('Duplicate "Pipeline Health"?');
    expect(duplicateDisclaimer(shared)).toBe(
      'ana@example.com built this app. Your copy runs with your own connections '
      + 'and can read whatever they can read. Review it before you launch it.',
    );
  });
});

describe('isEmailLike', () => {
  it.each(['ben@example.com', '  ben@example.com  '])('accepts %j', (value) => {
    expect(isEmailLike(value)).toBe(true);
  });

  it.each(['', 'ben', 'ben@', '@example.com', 'ben @example.com', null])('refuses %j', (value) => {
    expect(isEmailLike(value)).toBe(false);
  });
});

describe('sharedLiveAppsFrom', () => {
  it('keeps the entries the rail can act on, in the server order', () => {
    expect(sharedLiveAppsFrom([
      { shareId: 's2', slug: 'b', name: 'B', description: 'd', ownerEmail: 'ana@example.com', everyone: true, sharedAt: 't2' },
      { slug: 'no-share-id', name: 'Dropped' },
      { shareId: 's1', slug: 'a' },
    ])).toEqual([
      { shareId: 's2', slug: 'b', name: 'B', description: 'd', ownerEmail: 'ana@example.com', everyone: true, sharedAt: 't2' },
      { shareId: 's1', slug: 'a', name: 'a', description: '', ownerEmail: '', everyone: false, sharedAt: '' },
    ]);
  });

  it('reads anything but a list as nothing shared', () => {
    expect(sharedLiveAppsFrom(null)).toEqual([]);
    expect(sharedLiveAppsFrom({ detail: 'Not Found' })).toEqual([]);
  });
});
