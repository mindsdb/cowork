// Reimport the actual web entry to test hostname-based routing rather than reproducing its
// predicate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

const rendered = {
  provider: false,
  app: false,
  identityRequired: false,
  identityToken: null as string | null,
  identityReadyAtApp: false,
};

vi.mock('@react-keycloak/web', () => ({
  ReactKeycloakProvider: ({ children, onTokens }: {
    children?: unknown;
    onTokens?: (tokens: { token?: string }) => void;
  }) => {
    rendered.provider = true;
    onTokens?.({ token: 'initial-token' });
    return children ?? null;
  },
}));

vi.mock('./App', () => ({
  default: () => {
    rendered.app = true;
    rendered.identityReadyAtApp = rendered.identityToken === 'initial-token';
    return null;
  },
}));

vi.mock('./cowork/lib/organizationCacheIdentity', () => ({
  requireWebOrganizationCacheIdentity: () => { rendered.identityRequired = true; },
  pinWebOrganizationCacheIdentity: (token?: string) => {
    rendered.identityToken = token ?? null;
    return 'pinned';
  },
}));

vi.mock('./cowork/lib/organizationTransition', () => ({
  prepareForOrganizationReload: vi.fn(),
}));

// Mock Keycloak, browser and CSS dependencies while retaining the routing wrapper.
vi.mock('./lib/keycloak', () => ({ keycloak: { onAuthError: null } }));
vi.mock('./lib/skins', () => ({ loadSkin: () => 'default' }));
vi.mock('./cowork/styles/tailwind.css', () => ({}));
vi.mock('./cowork/styles/globals.css', () => ({}));
vi.mock('./cowork/styles/skin-8bit.css', () => ({}));
vi.mock('./styles.css', () => ({}));

async function renderOnHost(hostname: string, search = '') {
  rendered.provider = false;
  rendered.app = false;
  rendered.identityRequired = false;
  rendered.identityToken = null;
  rendered.identityReadyAtApp = false;

  // happy-dom's location is read-only; replace the descriptor for the case.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { protocol: 'https:', host: hostname, hostname, pathname: '/', search },
  });

  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);

  // createRoot().render() is asynchronous in React 19 — without act() the
  // import resolves before the tree has been committed and nothing is recorded.
  vi.resetModules();
  await act(async () => {
    await import('./web-main');
  });
  return { ...rendered };
}

describe('web-main auth wrapper selection', () => {
  const realLocation = window.location;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    });
  });

  // Legacy per-user hosts cannot use SPA Keycloak login: its redirect URI is invalid there.
  it('renders WITHOUT the Keycloak provider on a legacy cw- instance host', async () => {
    const r = await renderOnHost('cw-9a9e789c.4nton.ai');
    expect(r.app).toBe(true);
    expect(r.provider).toBe(false);
    expect(rendered.identityRequired).toBe(false);
    expect(rendered.identityToken).toBeNull();
  });

  // The canonical multitenant host must retain client-side Keycloak authentication.
  it('renders WITH the Keycloak provider on the canonical cowork host', async () => {
    const r = await renderOnHost('cowork.mindshub.ai');
    expect(r.app).toBe(true);
    expect(r.provider).toBe(true);
    expect(rendered.identityRequired).toBe(true);
    expect(rendered.identityReadyAtApp).toBe(true);
  });

  it('renders WITH the Keycloak provider on localhost dev', async () => {
    const r = await renderOnHost('localhost');
    expect(r.app).toBe(true);
    expect(r.provider).toBe(true);
    expect(rendered.identityRequired).toBe(true);
    expect(rendered.identityReadyAtApp).toBe(true);
  });

  it('renders the development Code fixture without the Keycloak provider', async () => {
    const r = await renderOnHost('localhost', '?codeFixture=completed');
    expect(r.app).toBe(true);
    expect(r.provider).toBe(false);
    expect(r.identityRequired).toBe(false);
  });
});
