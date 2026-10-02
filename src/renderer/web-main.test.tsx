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

const rendered = {
  provider: false,
  handoffAtProvider: null as string | null,
  app: false,
  identityRequired: false,
  identityToken: null as string | null,
  identityReadyAtApp: false,
};

// Mirrors @react-keycloak/core's provider: LoadingComponent until init resolves.
const keycloakState = {
  initialized: true,
  onEvent: null as ((event: string, error?: unknown) => void) | null,
};
const skinState = { skin: 'normal' };

vi.mock('@react-keycloak/web', () => ({
  ReactKeycloakProvider: ({ children, onTokens, onEvent, LoadingComponent }: {
    children?: unknown;
    onTokens?: (tokens: { token?: string }) => void;
    onEvent?: (event: string, error?: unknown) => void;
    LoadingComponent?: unknown;
  }) => {
    rendered.provider = true;
    keycloakState.onEvent = onEvent ?? null;
    rendered.handoffAtProvider = window.sessionStorage.getItem('anton.consoleHandoff');
    if (!keycloakState.initialized && LoadingComponent) return LoadingComponent;
    onTokens?.({ token: 'initial-token' });
    return children ?? null;
  },
}));

const appState = { throws: false };

vi.mock('./App', () => ({
  default: () => {
    if (appState.throws) throw new Error('render crash');
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

// Constructing the real Keycloak client reaches for browser APIs happy-dom
// doesn't fully provide, and this test is about the wrapper choice, not the
// client. Same for the skin loader (localStorage) and the CSS side-effect
// imports, which Vite handles in a real build but not here.
vi.mock('./lib/keycloak', () => ({ keycloak: { onAuthError: null } }));
vi.mock('./lib/skins', () => ({ loadSkin: () => skinState.skin }));
vi.mock('./cowork/styles/tailwind.css', () => ({}));
vi.mock('./cowork/styles/globals.css', () => ({}));
vi.mock('./cowork/styles/skin-8bit.css', () => ({}));
vi.mock('./styles.css', () => ({}));

async function renderOnHost(hostname: string, search = '') {
  rendered.provider = false;
  rendered.handoffAtProvider = null;
  rendered.app = false;
  rendered.identityRequired = false;
  rendered.identityToken = null;
  rendered.identityReadyAtApp = false;

  // happy-dom's location is read-only; replace the descriptor for the case.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { protocol: 'https:', host: hostname, hostname, pathname: '/', search, reload: vi.fn() },
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
    keycloakState.initialized = true;
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
    expect(rendered.identityRequired).toBe(false);
    expect(rendered.identityToken).toBeNull();
  });

  // The canonical multitenant host authenticates client-side — #473's whole
  // point. Losing the login here must not be possible without a red test.
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

describe('web-main loading view while Keycloak initializes', () => {
  const realLocation = window.location;

  beforeEach(() => {
    document.body.innerHTML = '';
    delete document.body.dataset.arcadePreset;
    keycloakState.initialized = true;
    skinState.skin = 'normal';
    window.localStorage.removeItem('anton.theme');
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    });
    window.localStorage.removeItem('anton.theme');
  });

  // A forced organization reload lands here first; an empty root reads as a crash.
  it('shows the welcome view, not an empty root, before init resolves', async () => {
    keycloakState.initialized = false;
    await renderOnHost('cowork.mindshub.ai');
    expect(rendered.app).toBe(false);
    expect(document.getElementById('root')?.textContent).toContain('Welcome to MindsHub Cowork');
  });

  it('renders App instead of the welcome view once init resolves', async () => {
    await renderOnHost('cowork.mindshub.ai');
    expect(rendered.app).toBe(true);
    expect(document.getElementById('root')?.textContent).not.toContain('Welcome to MindsHub Cowork');
  });

  it.each([
    ['normal', 'dark', 'midnight'],
    ['normal', 'light', 'daylight'],
    ['8bit', 'light', 'gameboy'],
    ['8bit', 'dark', undefined],
  ])('applies the %s %s onboarding look before App mounts', async (skin, theme, preset) => {
    skinState.skin = skin;
    window.localStorage.setItem('anton.theme', theme);
    // A preset from an earlier look must be replaced or cleared, not left behind.
    document.body.dataset.arcadePreset = 'stale';
    keycloakState.initialized = false;
    await renderOnHost('cowork.mindshub.ai');
    expect(document.body.dataset.arcadePreset).toBe(preset);
  });
});

describe('web-main Keycloak init failure', () => {
  const realLocation = window.location;

  beforeEach(() => {
    document.body.innerHTML = '';
    keycloakState.initialized = false;
    keycloakState.onEvent = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    });
    vi.restoreAllMocks();
  });

  const rootText = () => document.getElementById('root')?.textContent ?? '';

  // A forced organization reload that cannot finish signing in must not sit on
  // the loading view forever.
  it('offers a reload when init rejects', async () => {
    await renderOnHost('cowork.mindshub.ai');
    expect(rootText()).toContain('Welcome to MindsHub Cowork');

    await act(async () => {
      keycloakState.onEvent?.('onInitError', { error: 'network', error_description: 'failed' });
    });

    expect(rootText()).toContain("Couldn't sign you in");
    expect(rendered.app).toBe(false);
    const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Reload');
    expect(button).toBeDefined();
    await act(async () => { button?.click(); });
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('ignores refresh errors after init', async () => {
    await renderOnHost('cowork.mindshub.ai');

    await act(async () => {
      keycloakState.onEvent?.('onAuthRefreshError', { error: 'network', error_description: 'failed' });
      keycloakState.onEvent?.('onAuthError', { error: 'network', error_description: 'failed' });
    });

    expect(rootText()).toContain('Welcome to MindsHub Cowork');
    expect(rootText()).not.toContain("Couldn't sign you in");
  });
});

describe('web-main render error', () => {
  const realLocation = window.location;

  beforeEach(() => {
    document.body.innerHTML = '';
    keycloakState.initialized = true;
    appState.throws = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    appState.throws = false;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    });
    vi.restoreAllMocks();
  });

  it.each([
    ['the canonical host', 'cowork.mindshub.ai'],
    ['a legacy cw- host', 'cw-9a9e789c.4nton.ai'],
  ])('shows a reload notice, not an empty root, on %s', async (_label, host) => {
    await renderOnHost(host);
    expect(document.getElementById('root')?.textContent).toContain('Something went wrong');
  });
});

// The Keycloak redirect keeps only the pathname, so a console link's params
// must be saved before the provider starts the login. Without the capture call
// every other test here stays green.
describe('web-main console handoff', () => {
  const realLocation = window.location;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.sessionStorage.clear();
    keycloakState.initialized = true;
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    });
  });

  it('saves a console link before the Keycloak provider renders', async () => {
    const r = await renderOnHost(
      'cowork.mindshub.ai',
      '?from=console&mode=games&sample=classic-snake-game'
    );

    expect(r.provider).toBe(true);
    expect(JSON.parse(r.handoffAtProvider ?? 'null')).toMatchObject({
      entrySource: 'console',
      modeId: 'games',
      sampleId: 'classic-snake-game',
    });
  });

  it('saves nothing for an ordinary visit', async () => {
    const r = await renderOnHost('cowork.mindshub.ai');

    expect(r.handoffAtProvider).toBeNull();
  });
});
