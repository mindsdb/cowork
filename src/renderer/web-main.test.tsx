// Guards the auth decision in web-main.tsx: WHICH wrapper renders, per host.
//
// legacyHost.test.ts covers the predicate as a pure string function, but nothing
// asserted that the predicate is wired to `window.location.hostname` or which
// branch of the ternary actually runs. That left the decision point uncovered:
// hardcoding `legacyTenant` to `true` (drop the login on EVERY host, including
// the canonical cowork.<env> hosts #473 built it for) or to `false` (silently
// revert this PR and reopen ENG-1281) both leave the entire suite green.
//
// Mutation-verified — each of these fails at least one case below:
//   `!isLegacyTenantHost(window.location.hostname)`  -> 3 fail
//   `true`                                           -> 2 fail
//   `false`                                          -> 1 fail
//
// The module runs its work as a top-level side effect, so each case needs a
// fresh `window.location.hostname` + `vi.resetModules()` before importing it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';

const rendered = { provider: false, app: false };

vi.mock('@react-keycloak/web', () => ({
  ReactKeycloakProvider: ({ children }: { children?: unknown }) => {
    rendered.provider = true;
    return children ?? null;
  },
}));

vi.mock('./App', () => ({
  default: () => {
    rendered.app = true;
    return null;
  },
}));

// Constructing the real Keycloak client reaches for browser APIs happy-dom
// doesn't fully provide, and this test is about the wrapper choice, not the
// client. Same for the skin loader (localStorage) and the CSS side-effect
// imports, which Vite handles in a real build but not here.
vi.mock('./lib/keycloak', () => ({ keycloak: { onAuthError: null } }));
vi.mock('./lib/skins', () => ({ loadSkin: () => 'default' }));
vi.mock('./cowork/styles/tailwind.css', () => ({}));
vi.mock('./cowork/styles/globals.css', () => ({}));
vi.mock('./cowork/styles/skin-8bit.css', () => ({}));
vi.mock('./styles.css', () => ({}));

async function renderOnHost(hostname: string) {
  rendered.provider = false;
  rendered.app = false;

  // happy-dom's location is read-only; replace the descriptor for the case.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { protocol: 'https:', host: hostname, hostname, pathname: '/' },
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

  // The regression this PR fixes: a Keycloak login on this host dead-ends on
  // "Invalid parameter: redirect_uri" (ENG-1281), so the wrapper must be absent.
  it('renders WITHOUT the Keycloak provider on a legacy cw- instance host', async () => {
    const r = await renderOnHost('cw-9a9e789c.4nton.ai');
    expect(r.app).toBe(true);
    expect(r.provider).toBe(false);
  });

  // The canonical multitenant host authenticates client-side — #473's whole
  // point. Losing the login here must not be possible without a red test.
  it('renders WITH the Keycloak provider on the canonical cowork host', async () => {
    const r = await renderOnHost('cowork.mindshub.ai');
    expect(r.app).toBe(true);
    expect(r.provider).toBe(true);
  });

  it('renders WITH the Keycloak provider on localhost dev', async () => {
    const r = await renderOnHost('localhost');
    expect(r.app).toBe(true);
    expect(r.provider).toBe(true);
  });
});
