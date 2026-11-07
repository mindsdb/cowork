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
  providerInitOptions: null as unknown,
  shellRoot: null as null | { shell: unknown; initOptions: unknown },
  handoffAtProvider: null as string | null,
  app: false,
  identityRequired: false,
  identityToken: null as string | null,
  identityReadyAtApp: false,
  iconAtApp: null as string | null,
};

// Mirrors @react-keycloak/core's provider: LoadingComponent until init resolves.
const keycloakState = { initialized: true };
const skinState = { skin: 'normal', seed: () => {} };
const brandState = { brand: null as { iconUrl: string } | null };

vi.mock('@react-keycloak/web', () => ({
  ReactKeycloakProvider: ({ children, onTokens, LoadingComponent, initOptions }: {
    children?: unknown;
    onTokens?: (tokens: { token?: string }) => void;
    LoadingComponent?: unknown;
    initOptions?: unknown;
  }) => {
    rendered.provider = true;
    rendered.providerInitOptions = initOptions;
    rendered.handoffAtProvider = window.sessionStorage.getItem('anton.consoleHandoff');
    if (!keycloakState.initialized && LoadingComponent) return LoadingComponent;
    onTokens?.({ token: 'initial-token' });
    return children ?? null;
  },
}));

vi.mock('./App', () => ({
  default: () => {
    rendered.app = true;
    rendered.identityReadyAtApp = rendered.identityToken === 'initial-token';
    rendered.iconAtApp = document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null;
    return null;
  },
}));

// The app's root (ENG-4023) has its own tests; here only which root renders.
vi.mock('./MobileShellRoot', () => ({
  MobileShellRoot: ({ children, shell, initOptions }: { children?: unknown; shell: unknown; initOptions: unknown }) => {
    rendered.shellRoot = { shell, initOptions };
    return children ?? null;
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
// keycloak.ts builds the app's adapter only inside the app; null in a browser.
const adapterState = vi.hoisted(() => ({ adapter: null as null | { login: () => void } }));
vi.mock('./lib/keycloak', () => ({
  keycloak: { onAuthError: null },
  get mobileShellAdapter() { return adapterState.adapter; },
}));
vi.mock('./lib/skins', () => ({
  loadSkin: () => skinState.skin,
  seedBrandDefaults: () => skinState.seed(),
}));
vi.mock('./lib/deploymentBrand', () => ({
  get DEPLOYMENT_BRAND() { return brandState.brand; },
  productName: (stock: string) => stock,
}));
vi.mock('./cowork/styles/tailwind.css', () => ({}));
vi.mock('./cowork/styles/globals.css', () => ({}));
vi.mock('./cowork/styles/skin-8bit.css', () => ({}));
vi.mock('./styles.css', () => ({}));

async function renderOnHost(hostname: string, search = '') {
  rendered.provider = false;
  rendered.providerInitOptions = null;
  rendered.shellRoot = null;
  rendered.handoffAtProvider = null;
  rendered.app = false;
  rendered.identityRequired = false;
  rendered.identityToken = null;
  rendered.identityReadyAtApp = false;
  rendered.iconAtApp = null;

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

  // Outside the app the login is exactly as before ENG-4023: on load, by
  // redirect, with the web page as the redirect URI.
  it('initializes Keycloak with the unchanged web options in a browser', async () => {
    const r = await renderOnHost('cowork.mindshub.ai');
    expect(r.shellRoot).toBeNull();
    expect(r.providerInitOptions).toStrictEqual({
      onLoad: 'login-required',
      pkceMethod: 'S256',
      checkLoginIframe: false,
      redirectUri: 'https://cowork.mindshub.ai/',
    });
    expect(document.documentElement.dataset.shell).toBeUndefined();
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

describe('web-main deployment brand', () => {
  const realLocation = window.location;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.querySelectorAll('link').forEach((link) => link.remove());
    document.head.innerHTML += '<link rel="icon" type="image/svg+xml" href="/minds-icon.svg">';
    keycloakState.initialized = true;
  });

  afterEach(() => {
    brandState.brand = null;
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
  });

  it("puts the brand's icon in the tab before the app renders", async () => {
    brandState.brand = { iconUrl: '/brand/icon.png' };
    const r = await renderOnHost('cowork.mindshub.ai');
    expect(r.app).toBe(true);
    expect(r.iconAtApp).toBe('/brand/icon.png');
  });

  it('leaves the stock icon without a brand', async () => {
    const r = await renderOnHost('cowork.mindshub.ai');
    expect(r.iconAtApp).toBe('/minds-icon.svg');
  });

  it("applies the brand's defaults before reading the theme and style", async () => {
    window.localStorage.setItem('anton.theme', 'dark');
    skinState.seed = () => {
      window.localStorage.setItem('anton.theme', 'light');
      skinState.skin = 'acme';
    };
    try {
      await renderOnHost('cowork.mindshub.ai');
      expect(document.body.dataset.theme).toBe('light');
      expect(document.body.dataset.skin).toBe('acme');
    } finally {
      skinState.seed = () => {};
      skinState.skin = 'normal';
      window.localStorage.removeItem('anton.theme');
    }
  });
});

describe('web-main inside the mobile app (ENG-4023)', () => {
  const realLocation = window.location;
  const realUserAgent = window.navigator.userAgent;

  function setUserAgent(value: string) {
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, get: () => value });
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.querySelectorAll('meta[name="viewport"]').forEach((meta) => meta.remove());
    document.head.innerHTML += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    keycloakState.initialized = true;
  });

  afterEach(() => {
    setUserAgent(realUserAgent);
    delete document.documentElement.dataset.shell;
    document.head.querySelectorAll('meta[name="viewport"]').forEach((meta) => meta.remove());
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
  });

  it('renders the app root, marks the page, and covers the viewport', async () => {
    setUserAgent(`${realUserAgent} MindsHubCowork-iOS/1.0.0`);
    adapterState.adapter = { login: () => {} };
    const r = await renderOnHost('cowork.mindshub.ai');
    adapterState.adapter = null;

    expect(r.app).toBe(true);
    expect(r.provider).toBe(false);
    expect(r.shellRoot?.shell).toEqual({ platform: 'ios', version: '1.0.0' });
    // No login on load: the app's sign-in screen opens the sheet on a tap.
    expect(r.shellRoot?.initOptions).toStrictEqual({ pkceMethod: 'S256', checkLoginIframe: false, adapter: expect.anything() });
    expect(r.identityRequired).toBe(true);
    expect(document.documentElement.dataset.shell).toBe('ios');
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content'))
      .toBe('width=device-width, initial-scale=1.0, viewport-fit=cover');
  });

  it('leaves a plain mobile browser on the web login and viewport', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile/15E148');
    const r = await renderOnHost('cowork.mindshub.ai');

    expect(r.shellRoot).toBeNull();
    expect(r.provider).toBe(true);
    expect(document.documentElement.dataset.shell).toBeUndefined();
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content'))
      .toBe('width=device-width, initial-scale=1.0');
  });
});
