import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the keycloak-js constructor so importing this module never spins up a
// real client. The returned singleton IS the module's exported `keycloak`, so
// tests toggle `authenticated` on it to drive the two logout branches.
const instance = vi.hoisted(() => ({
  authenticated: false,
  token: null as string | null,
  onAuthError: undefined as undefined | (() => void),
  login: vi.fn(),
  logout: vi.fn(async () => {}),
  updateToken: vi.fn(async () => {}),
  clearToken: vi.fn(),
}));
vi.mock('keycloak-js', () => ({ default: vi.fn(function () { return instance; }) }));

import { logout, keycloak } from './keycloak';

beforeEach(() => {
  instance.logout.mockClear();
});

describe('keycloak logout()', () => {
  it('no-ops when there is no session (e.g. legacy tenant hosts)', async () => {
    keycloak.authenticated = false;
    await logout();
    expect(instance.logout).not.toHaveBeenCalled();
  });

  it('ends the session through the end-session endpoint when authenticated', async () => {
    keycloak.authenticated = true;
    await logout();
    expect(instance.logout).toHaveBeenCalledTimes(1);
    expect(instance.logout).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUri: expect.any(String) }),
    );
  });
});
