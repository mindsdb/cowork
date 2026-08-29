import { beforeEach, describe, expect, it, vi } from 'vitest';

const SETTINGS_KEY = 'anton.settingsCache';
const TRANSITION_KEY = 'anton.organizationTransition';
const epochSettingsKey = (id) => `${SETTINGS_KEY}:organization:${id}`;

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

async function bindWebIdentity(subject, organizationId) {
  const identity = await import('./organizationCacheIdentity');
  identity.requireWebOrganizationCacheIdentity();
  expect(identity.pinWebOrganizationCacheIdentity(accessToken(subject, organizationId))).toBe('pinned');
}

function setCommittedEpoch(id) {
  localStorage.setItem(TRANSITION_KEY, JSON.stringify({
    version: 1,
    id,
    phase: 'reload',
    subject: 'user-1',
    startedAt: Date.now(),
  }));
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('organization-scoped settings cache', () => {
  it('rejects an unscoped legacy value after the first organization transition', async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ greeting: 'old organization' }));
    setCommittedEpoch('new-organization');

    const { loadCachedSettings } = await import('./settingsCache');

    expect(loadCachedSettings()).toEqual({});
  });

  it('round-trips only the current organization epoch', async () => {
    setCommittedEpoch('organization-a');
    const oldModule = await import('./settingsCache');
    oldModule.cacheSettings({ greeting: 'organization A' });

    setCommittedEpoch('organization-b');
    oldModule.cacheSettings({ greeting: 'late organization A response' });
    vi.resetModules();
    const currentModule = await import('./settingsCache');

    expect(currentModule.loadCachedSettings()).toEqual({});
    expect(localStorage.getItem(epochSettingsKey('organization-a')))
      .not.toContain('late organization A response');
    currentModule.cacheSettings({ greeting: 'organization B' });
    expect(currentModule.loadCachedSettings()).toEqual({ greeting: 'organization B' });
    expect(localStorage.getItem(epochSettingsKey('organization-b')))
      .toContain('organization B');
  });

  it('does not let a waking old document delete current-epoch settings', async () => {
    setCommittedEpoch('organization-a');
    const oldModule = await import('./settingsCache');
    oldModule.cacheSettings({ greeting: 'organization A' });

    setCommittedEpoch('organization-b');
    vi.resetModules();
    const currentModule = await import('./settingsCache');
    currentModule.cacheSettings({ greeting: 'organization B' });

    oldModule.clearCachedSettings();

    expect(currentModule.loadCachedSettings()).toEqual({ greeting: 'organization B' });
  });

  it('isolates a late old-epoch write that passes its pre-write epoch check', async () => {
    setCommittedEpoch('organization-a');
    const oldModule = await import('./settingsCache');
    localStorage.setItem(
      epochSettingsKey('organization-b'),
      JSON.stringify({
        version: 1,
        organizationEpoch: 'organization-b',
        settings: { greeting: 'organization B' },
      }),
    );

    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(
      key,
      value,
    ) {
      if (key === epochSettingsKey('organization-a')) setCommittedEpoch('organization-b');
      return originalSetItem.call(this, key, value);
    });
    try {
      oldModule.cacheSettings({ greeting: 'late organization A response' });
    } finally {
      setItem.mockRestore();
    }

    expect(localStorage.getItem(epochSettingsKey('organization-b')))
      .toContain('organization B');
    expect(localStorage.getItem(epochSettingsKey('organization-a')))
      .toContain('late organization A response');
  });

  it('does not hydrate old-org settings after Cowork closes and Keycloak changes elsewhere', async () => {
    await bindWebIdentity('user-1', 'organization-a');
    const firstSession = await import('./settingsCache');
    firstSession.cacheSettings({ greeting: 'organization A' });

    vi.resetModules();
    await bindWebIdentity('user-1', 'organization-b');
    const reopenedSession = await import('./settingsCache');

    expect(reopenedSession.loadCachedSettings()).toEqual({});
    reopenedSession.cacheSettings({ greeting: 'organization B' });
    expect(reopenedSession.loadCachedSettings()).toEqual({ greeting: 'organization B' });

    vi.resetModules();
    await bindWebIdentity('user-1', 'organization-a');
    const returnedSession = await import('./settingsCache');
    expect(returnedSession.loadCachedSettings()).toEqual({ greeting: 'organization A' });
  });

  it('does not share settings between subjects in the same organization', async () => {
    await bindWebIdentity('user-1', 'shared-organization');
    const firstAccount = await import('./settingsCache');
    firstAccount.cacheSettings({ greeting: 'user 1' });

    vi.resetModules();
    await bindWebIdentity('user-2', 'shared-organization');
    const secondAccount = await import('./settingsCache');

    expect(secondAccount.loadCachedSettings()).toEqual({});
  });
});
