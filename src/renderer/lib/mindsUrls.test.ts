import { describe, it, expect, vi, afterEach } from 'vitest';

// mindsUrls.ts resolves import.meta.env into module-level constants at IMPORT
// time, so each test stubs env, resetModules(), then dynamically imports a
// fresh copy.
async function importUrls() {
  vi.resetModules();
  return await import('./mindsUrls');
}

function setUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
}

afterEach(() => {
  vi.unstubAllEnvs();
  setUrl('http://localhost:3000/');
});

describe('MINDS_KEYCLOAK_URL / MINDS_REGISTER_URL', () => {
  // Regression: the packaged desktop app loads the renderer over file://, so a
  // protocol-based "isWeb" fallback misfired and pointed the sign-up link at
  // auth.dev.mindshub.ai even though the API host resolved to prod. Auth must
  // always track the *resolved* API base.
  it('defaults to prod auth host when no env is set (built prod renderer, DEV=false)', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', '');
    const { MINDS_API_BASE, MINDS_KEYCLOAK_URL, MINDS_REGISTER_URL } = await importUrls();
    expect(MINDS_API_BASE).toBe('https://api.mindshub.ai');
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth.mindshub.ai/auth');
    expect(MINDS_REGISTER_URL).toContain('https://auth.mindshub.ai/auth/realms/mindsdb');
    expect(MINDS_REGISTER_URL).not.toContain('auth.dev.mindshub.ai');
  });

  it('defaults to the dev environment in `vite dev` (DEV=true) when no env is set', async () => {
    // A bare `npm run dev` must not authenticate against production.
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', '');
    const { MINDS_API_BASE, MINDS_KEYCLOAK_URL } = await importUrls();
    expect(MINDS_API_BASE).toBe('https://api.staging.mindshub.ai');
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth.staging.mindshub.ai/auth');
  });

  it('tracks the API host when VITE_MINDS_API_URL points at dev', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', 'https://api.staging.mindshub.ai');
    const { MINDS_KEYCLOAK_URL } = await importUrls();
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth.staging.mindshub.ai/auth');
  });

  it('honours an explicit VITE_KEYCLOAK_URL override', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', 'https://auth.custom.example/auth');
    vi.stubEnv('VITE_MINDS_API_URL', 'https://api.staging.mindshub.ai');
    const { MINDS_KEYCLOAK_URL } = await importUrls();
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth.custom.example/auth');
  });
});

describe('same-origin API base derivation (VITE_MINDS_API_URL unset)', () => {
  it('derives api.<env> from a remote cowork.<env> web host (staging)', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork.staging.mindshub.ai/');
    const { MINDS_API_BASE, MINDS_KEYCLOAK_URL, MINDS_CONSOLE_URL } = await importUrls();
    expect(MINDS_API_BASE).toBe('https://api.staging.mindshub.ai');
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth.staging.mindshub.ai/auth');
    expect(MINDS_CONSOLE_URL).toBe('https://console.staging.mindshub.ai');
  });

  it('derives api.mindshub.ai from the prod cowork.mindshub.ai web host', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork.mindshub.ai/');
    const { MINDS_API_BASE, MINDS_KEYCLOAK_URL } = await importUrls();
    expect(MINDS_API_BASE).toBe('https://api.mindshub.ai');
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth.mindshub.ai/auth');
  });

  it('derives api-<pr> from a PR web host (cowork-<pr>.dev -> api-<pr>.dev)', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://cowork-pr123.dev.mindshub.ai/');
    const { MINDS_API_BASE, MINDS_KEYCLOAK_URL, MINDS_CONSOLE_URL } = await importUrls();
    expect(MINDS_API_BASE).toBe('https://api-pr123.dev.mindshub.ai');
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth-pr123.dev.mindshub.ai/auth');
    expect(MINDS_CONSOLE_URL).toBe('https://console-pr123.dev.mindshub.ai');
  });

  it('falls back to prod on an unrecognised (non-cowork) remote host', async () => {
    // A built/deployed renderer (DEV=false) on a host we cannot map: prod.
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('https://app.example.com/');
    const { MINDS_API_BASE } = await importUrls();
    expect(MINDS_API_BASE).toBe('https://api.mindshub.ai');
  });

  it('targets staging on localhost `vite dev` (no sibling api host, DEV=true)', async () => {
    // vite dev (DEV=true) with no baked URL and no cowork sibling host to
    // derive from falls through to the staging default, never prod.
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('http://localhost:5173/');
    const { MINDS_API_BASE } = await importUrls();
    expect(MINDS_API_BASE).toBe('https://api.staging.mindshub.ai');
  });

  it('falls back to prod under Electron file:// (no meaningful origin)', async () => {
    // Packaged desktop app is a prod build (DEV=false); no origin to derive.
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', '');
    setUrl('file:///Applications/Cowork.app/Contents/Resources/index-web.html');
    const { MINDS_API_BASE } = await importUrls();
    expect(MINDS_API_BASE).toBe('https://api.mindshub.ai');
  });

  it('an explicit VITE_MINDS_API_URL still wins over origin derivation', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', 'https://api.dev.mindshub.ai');
    setUrl('https://cowork.staging.mindshub.ai/');
    const { MINDS_API_BASE } = await importUrls();
    expect(MINDS_API_BASE).toBe('https://api.dev.mindshub.ai');
  });
});
