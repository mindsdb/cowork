// Runs web-main with the real ReactKeycloakProvider. The provider calls init()
// on mount with no unmount cleanup, and keycloak-js rejects a second init(), so
// a StrictMode double mount around the provider would report a false failure.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

const client = vi.hoisted(() => ({
  onAuthError: null as unknown,
  token: undefined as string | undefined,
  idToken: undefined as string | undefined,
  init: vi.fn(),
}));

vi.mock('./lib/keycloak', () => ({ keycloak: client }));
vi.mock('./App', () => ({ default: () => null }));
vi.mock('./cowork/lib/organizationCacheIdentity', () => ({
  requireWebOrganizationCacheIdentity: () => {},
  pinWebOrganizationCacheIdentity: () => 'pinned',
}));
vi.mock('./cowork/lib/organizationTransition', () => ({
  prepareForOrganizationReload: vi.fn(),
  isOrganizationReloadBlocked: () => false,
  subscribeOrganizationReloadBlocked: () => () => {},
}));
vi.mock('./lib/skins', () => ({ loadSkin: () => 'normal' }));
vi.mock('./cowork/styles/tailwind.css', () => ({}));
vi.mock('./cowork/styles/globals.css', () => ({}));
vi.mock('./cowork/styles/skin-8bit.css', () => ({}));
vi.mock('./styles.css', () => ({}));

describe('web-main with the real Keycloak provider', () => {
  const realLocation = window.location;

  beforeEach(() => {
    document.body.innerHTML = '';
    client.init.mockReset();
    let calls = 0;
    // Same contract as keycloak-js: the first call stays pending, any later one rejects.
    client.init.mockImplementation(() => {
      calls += 1;
      return calls === 1
        ? new Promise(() => {})
        : Promise.reject(new Error("A 'Keycloak' instance can only be initialized once."));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { protocol: 'https:', host: 'cowork.mindshub.ai', hostname: 'cowork.mindshub.ai', pathname: '/', search: '', reload: vi.fn() },
    });
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    });
    vi.restoreAllMocks();
  });

  it('starts Keycloak once and keeps the loading view while init is pending', async () => {
    vi.resetModules();
    await act(async () => {
      await import('./web-main');
    });
    await act(async () => {});

    const text = document.getElementById('root')?.textContent ?? '';
    expect(client.init).toHaveBeenCalledTimes(1);
    expect(text).toContain('Welcome to MindsHub Cowork');
    expect(text).not.toContain("Couldn't sign you in");
  });
});
