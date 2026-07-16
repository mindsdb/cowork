import { describe, it, expect, vi, afterEach } from 'vitest';

// mindsUrls.ts resolves import.meta.env into module-level constants at IMPORT
// time, so each test stubs env, resetModules(), then dynamically imports a
// fresh copy.
async function importUrls() {
  vi.resetModules();
  return await import('./mindsUrls');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('MINDS_KEYCLOAK_URL / MINDS_REGISTER_URL', () => {
  // Regression: the packaged desktop app loads the renderer over file://, so a
  // protocol-based "isWeb" fallback misfired and pointed the sign-up link at
  // auth.dev.mindshub.ai even though the API host resolved to prod. Auth must
  // always track the *resolved* API base.
  it('defaults to prod auth host when no env is set (prod build)', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', '');
    const { MINDS_API_BASE, MINDS_KEYCLOAK_URL, MINDS_REGISTER_URL } = await importUrls();
    expect(MINDS_API_BASE).toBe('https://api.mindshub.ai');
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth.mindshub.ai/auth');
    expect(MINDS_REGISTER_URL).toContain('https://auth.mindshub.ai/auth/realms/mindsdb');
    expect(MINDS_REGISTER_URL).not.toContain('auth.dev.mindshub.ai');
  });

  it('tracks the API host when VITE_MINDS_API_URL points at dev', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', 'https://api.dev.mindshub.ai');
    const { MINDS_KEYCLOAK_URL } = await importUrls();
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth.dev.mindshub.ai/auth');
  });

  it('tracks the API host when VITE_MINDS_API_URL points at staging', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', '');
    vi.stubEnv('VITE_MINDS_API_URL', 'https://api.staging.mindshub.ai');
    const { MINDS_KEYCLOAK_URL } = await importUrls();
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth.staging.mindshub.ai/auth');
  });

  it('honours an explicit VITE_KEYCLOAK_URL override', async () => {
    vi.stubEnv('VITE_KEYCLOAK_URL', 'https://auth.custom.example/auth');
    vi.stubEnv('VITE_MINDS_API_URL', 'https://api.dev.mindshub.ai');
    const { MINDS_KEYCLOAK_URL } = await importUrls();
    expect(MINDS_KEYCLOAK_URL).toBe('https://auth.custom.example/auth');
  });
});
