import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetOrganizationCacheIdentityForTests,
  pinWebOrganizationCacheIdentity,
  requireWebOrganizationCacheIdentity,
  storageKeyForOrganizationIdentity,
} from './organizationCacheIdentity';

function base64UrlJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function accessToken(subject, organizationId) {
  return `${base64UrlJson({ alg: 'none' })}.${base64UrlJson({
    sub: subject,
    activate_organization: { id: organizationId },
  })}.signature`;
}

beforeEach(() => {
  __resetOrganizationCacheIdentityForTests();
  localStorage.clear();
});

describe('organization cache identity', () => {
  it('keeps the existing unscoped key for desktop and legacy web', () => {
    expect(storageKeyForOrganizationIdentity('anton.cache', null)).toBe('anton.cache');
    expect(storageKeyForOrganizationIdentity('anton.cache', 'epoch-a'))
      .toBe('anton.cache:organization:epoch-a');
  });

  it('fails closed until canonical web pins a readable subject and organization', () => {
    requireWebOrganizationCacheIdentity();

    expect(storageKeyForOrganizationIdentity('anton.cache', null)).toBeNull();
    expect(pinWebOrganizationCacheIdentity('not-a-token')).toBe('unavailable');
    expect(storageKeyForOrganizationIdentity('anton.cache', null)).toBeNull();
  });

  it('combines subject, organization, and transition epoch in the web key', () => {
    requireWebOrganizationCacheIdentity();
    expect(pinWebOrganizationCacheIdentity(accessToken('user/one', 'org:a'))).toBe('pinned');

    expect(storageKeyForOrganizationIdentity('anton.cache', 'transition-1')).toBe(
      'anton.cache:subject:user%2Fone:organization:org%3Aa:epoch:transition-1',
    );
  });

  it('does not retarget a running document when a later token names another organization', () => {
    requireWebOrganizationCacheIdentity();
    pinWebOrganizationCacheIdentity(accessToken('user-1', 'org-a'));

    expect(pinWebOrganizationCacheIdentity(accessToken('user-1', 'org-b'))).toBe('changed');
    expect(storageKeyForOrganizationIdentity('anton.cache', null))
      .toBe('anton.cache:subject:user-1:organization:org-a');
  });

  it('hydrates lazily when the cache module loads before the initial token arrives', async () => {
    localStorage.setItem('anton.composerDrafts', JSON.stringify({
      new: 'unscoped previous-organization draft',
    }));
    const { getDraft } = await import('./draftStore');

    requireWebOrganizationCacheIdentity();
    pinWebOrganizationCacheIdentity(accessToken('user-1', 'org-a'));

    expect(getDraft('new')).toBe('');
  });
});
