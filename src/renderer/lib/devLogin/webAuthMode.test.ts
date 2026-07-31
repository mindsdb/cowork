import { describe, it, expect } from 'vitest';

import { resolveWebAuthMode } from './webAuthMode';

describe('resolveWebAuthMode', () => {
  it('always uses production auth in a build (isDev false), regardless of flags', () => {
    expect(
      resolveWebAuthMode({ isDev: false, devLoginEnabled: false, hasStoredTokens: false }),
    ).toBe('production');
    // The dev flags must not be able to weaken auth in a deployed bundle.
    expect(
      resolveWebAuthMode({ isDev: false, devLoginEnabled: true, hasStoredTokens: true }),
    ).toBe('production');
  });

  it('skips auth by default under vite dev (no VITE_DEV_LOGIN)', () => {
    expect(
      resolveWebAuthMode({ isDev: true, devLoginEnabled: false, hasStoredTokens: false }),
    ).toBe('skip');
  });

  it('shows the dev-login form when enabled but no cached token', () => {
    expect(
      resolveWebAuthMode({ isDev: true, devLoginEnabled: true, hasStoredTokens: false }),
    ).toBe('dev-login-form');
  });

  it('uses the cached token (patched keycloak) when enabled and present', () => {
    expect(
      resolveWebAuthMode({ isDev: true, devLoginEnabled: true, hasStoredTokens: true }),
    ).toBe('dev-login-ready');
  });
});
