import { describe, it, expect, vi } from 'vitest';

// minds-auth transitively imports server-process → electron; stub it the
// same way minds-auth.refresh.test.ts does.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isPackaged: false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {},
}));
vi.mock('./token-store', () => ({
  saveTokens: vi.fn(),
  getRefreshToken: vi.fn(),
  clearTokens: vi.fn(),
  getTokenStoreVersion: vi.fn(),
  // The successful refresh handoff rereads the token store; stub that read to avoid unrelated
  // unhandled rejections.
  getAccessToken: vi.fn(),
  isAccessTokenExpired: vi.fn(() => false),
}));

import {
  KEYCLOAK_AUTH_URL,
  KEYCLOAK_REGISTRATION_URL,
  SIGNUP_CALLBACK_TIMEOUT_MS,
} from './minds-auth';

// Registration must use the same realm and flow as login.
describe('Keycloak endpoint family (ENG-917)', () => {
  it('registration entry is the auth endpoint with only the last segment swapped', () => {
    expect(KEYCLOAK_AUTH_URL.endsWith('/protocol/openid-connect/auth')).toBe(true);
    expect(KEYCLOAK_REGISTRATION_URL).toBe(
      KEYCLOAK_AUTH_URL.replace(/\/auth$/, '/registrations'),
    );
  });

  it('signup callback window matches the Keycloak auth-session lifespan (30 min)', () => {
    // Shorter forfeits legitimate email-verification resumes; longer waits
    // on a server-side session that has already expired.
    expect(SIGNUP_CALLBACK_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});
