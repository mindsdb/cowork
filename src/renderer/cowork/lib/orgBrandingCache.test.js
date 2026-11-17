import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_IMAGE_HOST, NO_ORG_BRANDING, parseOrgBranding } from '../../lib/orgBranding';

const KEY = 'anton.orgBrandingCache';
const LOGO = `https://${AUTH_IMAGE_HOST}/v1/organizations/org-acme/branding/logo?v=1`;
const ACME = parseOrgBranding({
  enabled: true,
  logoUrl: LOGO,
  canEdit: false,
  appearance: { accent: '#112233', membersCanChoose: false },
});

function base64UrlJson(value) {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function accessToken(subject, organizationId) {
  return `${base64UrlJson({ alg: 'none' })}.${base64UrlJson({
    sub: subject,
    activate_organization: { id: organizationId },
  })}.signature`;
}

async function loadModule() {
  return import('./orgBrandingCache');
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('orgBrandingCache', () => {
  it('answers null when nothing is cached', async () => {
    const { loadCachedOrgBranding } = await loadModule();
    expect(loadCachedOrgBranding()).toBeNull();
  });

  it('round-trips the last answer', async () => {
    const { cacheOrgBranding, loadCachedOrgBranding } = await loadModule();
    cacheOrgBranding(ACME);
    expect(loadCachedOrgBranding()).toEqual(ACME);
  });

  it('keeps one answer per org on the web', async () => {
    const identity = await import('./organizationCacheIdentity');
    identity.requireWebOrganizationCacheIdentity();
    identity.pinWebOrganizationCacheIdentity(accessToken('user-1', 'org-acme'));
    const acme = await loadModule();
    acme.cacheOrgBranding(ACME);
    expect(Object.keys(localStorage).some((key) => key.startsWith(`${KEY}:`) && key.includes('org-acme'))).toBe(true);

    vi.resetModules();
    const identityB = await import('./organizationCacheIdentity');
    identityB.requireWebOrganizationCacheIdentity();
    identityB.pinWebOrganizationCacheIdentity(accessToken('user-1', 'org-globex'));
    const globex = await loadModule();
    expect(globex.loadCachedOrgBranding()).toBeNull();
  });

  it('drops an image from another host in a tampered entry', async () => {
    localStorage.setItem(KEY, JSON.stringify({
      version: 1,
      organizationEpoch: null,
      branding: { ...ACME, logoUrl: 'https://images.globex.com/logo.png' },
    }));
    const { loadCachedOrgBranding } = await loadModule();
    expect(loadCachedOrgBranding().logoUrl).toBeNull();
  });

  it.each([
    ['corrupt JSON', '{not json'],
    ['another version', JSON.stringify({ version: 2, organizationEpoch: null, branding: ACME })],
    ['a bare value', JSON.stringify([1, 2])],
  ])('answers null for %s', async (_name, raw) => {
    localStorage.setItem(KEY, raw);
    const { loadCachedOrgBranding } = await loadModule();
    expect(loadCachedOrgBranding()).toBeNull();
  });

  it('reads a cached "no branding" answer as such', async () => {
    const { cacheOrgBranding, loadCachedOrgBranding } = await loadModule();
    cacheOrgBranding(NO_ORG_BRANDING);
    expect(loadCachedOrgBranding()).toEqual(NO_ORG_BRANDING);
  });

  it('forgets the answer and refuses late writes once a switch begins', async () => {
    const { cacheOrgBranding, clearCachedOrgBranding, loadCachedOrgBranding } = await loadModule();
    cacheOrgBranding(ACME);
    clearCachedOrgBranding();
    expect(loadCachedOrgBranding()).toBeNull();
    cacheOrgBranding(ACME);
    expect(loadCachedOrgBranding()).toBeNull();
  });

  it('survives a write that throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded'); });
    const { cacheOrgBranding } = await loadModule();
    expect(() => cacheOrgBranding(ACME)).not.toThrow();
  });

  it('answers null when a read throws', async () => {
    const { cacheOrgBranding, loadCachedOrgBranding } = await loadModule();
    cacheOrgBranding(ACME);
    vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadCachedOrgBranding()).toBeNull();
  });
});
