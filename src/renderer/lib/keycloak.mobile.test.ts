// keycloak.ts inside the mobile app: the app's Keycloak client, the native
// adapter, and an auth-error handler that never reopens the sign-in sheet.
// The browser side is covered in keycloak.test.ts; this file checks both
// branches of the shell switch, since the module reads it once at load.

import { afterEach, describe, expect, it, vi } from 'vitest';

const shellState = vi.hoisted(() => ({ isMobileShell: false }));
vi.mock('./mobileShell', () => ({
  get isMobileShell() { return shellState.isMobileShell; },
}));

const instance = vi.hoisted(() => ({
  onAuthError: undefined as undefined | (() => void),
  login: vi.fn(),
  clearToken: vi.fn(),
}));
const KeycloakCtor = vi.hoisted(() => vi.fn(function () { return instance; }));
vi.mock('keycloak-js', () => ({ default: KeycloakCtor }));
vi.mock('../cowork/lib/liveAppPreview', () => ({
  closeLiveAppPreviews: vi.fn(async () => {}),
  closeLiveAppPreviewsForSignOut: vi.fn(async () => {}),
}));

async function load(isMobileShell: boolean) {
  shellState.isMobileShell = isMobileShell;
  KeycloakCtor.mockClear();
  instance.login.mockClear();
  instance.clearToken.mockClear();
  vi.resetModules();
  return import('./keycloak');
}

describe('keycloak.ts client selection', () => {
  afterEach(() => { shellState.isMobileShell = false; });

  it('uses public-client and redirects on an auth error in a browser', async () => {
    const mod = await load(false);
    expect(KeycloakCtor).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'public-client', realm: 'mindsdb' }));
    expect(mod.mobileShellAdapter).toBeNull();

    instance.onAuthError?.();
    expect(instance.clearToken).toHaveBeenCalled();
    expect(instance.login).toHaveBeenCalledTimes(1);
  });

  it('uses cowork-mobile with the native adapter in the app', async () => {
    const mod = await load(true);
    expect(KeycloakCtor).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'cowork-mobile', realm: 'mindsdb' }));
    expect(mod.mobileShellAdapter).not.toBeNull();
    expect(typeof mod.mobileShellAdapter?.login).toBe('function');
  });

  it('never reopens the sheet on an auth error in the app', async () => {
    await load(true);
    instance.onAuthError?.();
    instance.onAuthError?.();
    expect(instance.clearToken).toHaveBeenCalledTimes(2);
    expect(instance.login).not.toHaveBeenCalled();
  });
});
