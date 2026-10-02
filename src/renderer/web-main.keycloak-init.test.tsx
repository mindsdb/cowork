// Runs web-main with the real ReactKeycloakProvider and a stub client that
// keeps keycloak-js's callback contract: init() runs once, and a refresh fires
// onAuthRefreshSuccess, which the provider turns into onTokens.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

const OTHER_ORGANIZATION_TOKEN = 'other-organization-token';

const client = vi.hoisted(() => ({
  onAuthError: null as unknown,
  onReady: undefined as undefined | ((authenticated: boolean) => void),
  onAuthRefreshSuccess: undefined as undefined | (() => void),
  authenticated: false,
  token: undefined as string | undefined,
  idToken: undefined as string | undefined,
  init: vi.fn(),
  updateToken: vi.fn(),
}));
const transitionMocks = vi.hoisted(() => ({ prepareForOrganizationReload: vi.fn() }));

vi.mock('./lib/keycloak', () => ({ keycloak: client }));
vi.mock('./App', () => ({ default: () => null }));
vi.mock('./cowork/lib/organizationCacheIdentity', () => ({
  requireWebOrganizationCacheIdentity: () => {},
  pinWebOrganizationCacheIdentity: (token?: string) => (
    token === OTHER_ORGANIZATION_TOKEN ? 'changed' : 'pinned'
  ),
}));
vi.mock('./cowork/lib/organizationTransition', () => ({
  prepareForOrganizationReload: transitionMocks.prepareForOrganizationReload,
  assertOrganizationTransitionClear: () => {},
  isOrganizationReloadBlocked: () => false,
  subscribeOrganizationReloadBlocked: () => () => {},
}));
vi.mock('./lib/skins', () => ({ loadSkin: () => 'normal' }));

// Unmount the previous case's root so its focus listener does not stay attached.
const mountedRoots = vi.hoisted(() => [] as Array<{ unmount: () => void }>);
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      const created = actual.createRoot(...args);
      mountedRoots.push(created);
      return created;
    },
  };
});
vi.mock('./cowork/styles/tailwind.css', () => ({}));
vi.mock('./cowork/styles/globals.css', () => ({}));
vi.mock('./cowork/styles/skin-8bit.css', () => ({}));
vi.mock('./styles.css', () => ({}));

describe('web-main with the real Keycloak provider', () => {
  const realLocation = window.location;

  beforeEach(() => {
    act(() => {
      for (const mounted of mountedRoots.splice(0)) mounted.unmount();
    });
    document.body.innerHTML = '';
    client.init.mockReset();
    client.updateToken.mockReset();
    client.authenticated = false;
    client.token = undefined;
    client.idToken = undefined;
    transitionMocks.prepareForOrganizationReload.mockReset();
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

  it('reloads when a focus refresh returns a token for another organization', async () => {
    client.init.mockImplementation(() => {
      client.authenticated = true;
      client.token = 'initial-token';
      client.idToken = 'initial-id-token';
      client.onReady?.(true);
      return Promise.resolve(true);
    });
    client.updateToken.mockImplementation(() => {
      client.token = OTHER_ORGANIZATION_TOKEN;
      client.onAuthRefreshSuccess?.();
      return Promise.resolve(true);
    });
    vi.resetModules();
    await act(async () => {
      await import('./web-main');
    });
    expect(transitionMocks.prepareForOrganizationReload).not.toHaveBeenCalled();

    await act(async () => { window.dispatchEvent(new Event('focus')); });

    expect(client.updateToken).toHaveBeenCalledWith(-1);
    expect(transitionMocks.prepareForOrganizationReload).toHaveBeenCalledTimes(1);
  });
});
