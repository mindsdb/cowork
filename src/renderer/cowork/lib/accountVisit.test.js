// first_visit on the console arrival: whether this browser holds anything of
// the account's from an earlier Cowork web visit.
import { describe, it, expect, beforeEach } from 'vitest';
import { noteAccountVisit, isFirstVisit, firstVisitRecorded, __resetAccountVisitForTests } from './accountVisit';
import { purgeStaleAccountState } from './accountLocalState';

const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenFor = (sub) => `${b64url({ alg: 'none' })}.${b64url({ sub, activate_organization: { id: 'org-1' } })}.sig`;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  __resetAccountVisitForTests();
});

describe('account visit', () => {
  it('reads a browser that holds nothing of the account as its first visit', () => {
    noteAccountVisit(tokenFor('user-new'));
    expect(isFirstVisit('user-new')).toBe(true);
  });

  it('reads a later visit in the same browser as a return', () => {
    noteAccountVisit(tokenFor('user-a'));
    __resetAccountVisitForTests(); // a new document, in a new tab
    window.sessionStorage.clear();

    noteAccountVisit(tokenFor('user-a'));
    expect(isFirstVisit('user-a')).toBe(false);
  });

  // Cowork reloads when it clears another account's data from the browser, and
  // the console link is only taken once the composer is usable, so the arrival
  // is recorded from the reloaded page, after our mark was written.
  it("keeps a new account's first visit through the reload that clears another account's data", () => {
    window.localStorage.setItem('anton.lastAccount', 'user-a');
    window.localStorage.setItem('anton.settingsCache:subject:user-a:organization:org-1', '{}');

    noteAccountVisit(tokenFor('user-b'));
    expect(isFirstVisit('user-b')).toBe(true);
    expect(purgeStaleAccountState('user-b', 'keep')).toBe(true);

    __resetAccountVisitForTests(); // the reload: same tab, new document
    noteAccountVisit(tokenFor('user-b'));
    expect(isFirstVisit('user-b')).toBe(true);
  });

  it('stops reading a first visit back once the console link would have expired', () => {
    const t0 = 1_000_000;
    noteAccountVisit(tokenFor('user-a'), window.localStorage, window.sessionStorage, t0);
    __resetAccountVisitForTests();

    noteAccountVisit(tokenFor('user-a'), window.localStorage, window.sessionStorage, t0 + 10 * 60 * 1000 + 1);
    expect(isFirstVisit('user-a')).toBe(false);
  });

  it("does not lend one account's first visit to another account in the same tab", () => {
    noteAccountVisit(tokenFor('user-a'));
    __resetAccountVisitForTests();
    window.localStorage.setItem('anton.coworkVisited:subject:user-b', '1');

    noteAccountVisit(tokenFor('user-b'));
    expect(isFirstVisit('user-b')).toBe(false);
  });

  it('is not a first visit again once the first arrival has been recorded, even after a reload', () => {
    noteAccountVisit(tokenFor('user-a'));
    firstVisitRecorded('user-a');
    expect(isFirstVisit('user-a')).toBe(false);

    __resetAccountVisitForTests(); // the next console link, same tab
    noteAccountVisit(tokenFor('user-a'));
    expect(isFirstVisit('user-a')).toBe(false);
  });

  it("leaves another account's kept first visit alone", () => {
    // Two first visits in one tab: the later account's is the one kept.
    noteAccountVisit(tokenFor('user-a'));
    noteAccountVisit(tokenFor('user-b'));
    firstVisitRecorded('user-a');

    __resetAccountVisitForTests(); // a reload of the tab
    noteAccountVisit(tokenFor('user-b'));
    expect(isFirstVisit('user-b')).toBe(true);
  });

  it('keeps nothing in the tab for a returning account', () => {
    window.localStorage.setItem('anton.coworkVisited:subject:user-a', '1');
    noteAccountVisit(tokenFor('user-a'));
    expect(isFirstVisit('user-a')).toBe(false);
    expect(window.sessionStorage.getItem('anton.coworkFirstVisit')).toBeNull();
  });

  // An account that used Cowork web before the mark existed has these caches,
  // so it reads as returning in the first week rather than as new.
  it.each([
    ['anton.settingsCache:subject:user-a:organization:org-1'],
    ['anton.settingsCache:subject:user-a:organization:org-2:epoch:7'],
    ['anton.composerDrafts:subject:user-a:organization:org-1'],
    ['anton.orgBrandingCache:subject:user-a:organization:org-1'],
  ])('reads an account with a cache from an earlier visit (%s) as returning', (key) => {
    window.localStorage.setItem(key, '{}');
    noteAccountVisit(tokenFor('user-a'));
    expect(isFirstVisit('user-a')).toBe(false);
  });

  it('reads the account the analytics merge last recorded here as returning', () => {
    window.localStorage.setItem('cowork_identity_merged_sub', 'user-a');
    noteAccountVisit(tokenFor('user-a'));
    expect(isFirstVisit('user-a')).toBe(false);
  });

  it("does not count another account's state in the same browser", () => {
    window.localStorage.setItem('anton.settingsCache:subject:user-b:organization:org-1', '{}');
    window.localStorage.setItem('anton.coworkVisited:subject:user-b', '1');
    window.localStorage.setItem('cowork_identity_merged_sub', 'user-b');
    // A subject that merely starts with another's must not match it either.
    window.localStorage.setItem('anton.settingsCache:subject:user-ab:organization:org-1', '{}');

    noteAccountVisit(tokenFor('user-a'));
    expect(isFirstVisit('user-a')).toBe(true);
  });

  it('ignores per-browser state that is not the account\'s, such as onboarding progress', () => {
    window.localStorage.setItem('anton.onboarding.completed', '["bring-your-work"]');
    window.localStorage.setItem('anton.theme', 'dark');
    noteAccountVisit(tokenFor('user-a'));
    expect(isFirstVisit('user-a')).toBe(true);
  });

  it('keeps the first decision for the document when a refreshed token arrives', () => {
    noteAccountVisit(tokenFor('user-a'));
    noteAccountVisit(tokenFor('user-a'));
    expect(isFirstVisit('user-a')).toBe(true);
  });

  it('is unknown, not first, when storage cannot be read', () => {
    const broken = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      key: () => null,
      length: 0,
    };
    noteAccountVisit(tokenFor('user-a'), broken);
    expect(isFirstVisit('user-a')).toBeUndefined();
  });

  it('is unknown for an account never noted, and for a token without a subject', () => {
    noteAccountVisit('not-a-jwt');
    noteAccountVisit(undefined);
    expect(isFirstVisit('user-a')).toBeUndefined();
  });
});
