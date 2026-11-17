import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import Keycloak from 'keycloak-js';
import { MobileShellRoot, MOBILE_AUTH_STARTUP_TIMEOUT_MS } from './MobileShellRoot';
import { createMobileShellAdapter, keycloakInitOptions } from './lib/mobileAuth';
import { clearMobileSession, restoreMobileSession, saveMobileSession } from './lib/mobileSession';

vi.mock('./lib/mobilePush', () => ({ mobilePush: () => null, mobilePushSignedIn: vi.fn() }));

const TOKEN_URL = 'https://auth.example/auth/realms/mindsdb/protocol/openid-connect/token';
function tokens() {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `e30.${btoa(JSON.stringify({ sub: 'user-1', iat: now, exp: now + 300 }))}.sig`;
  return { token: jwt, refreshToken: jwt, idToken: jwt };
}
function response() {
  const t = tokens();
  return new Response(JSON.stringify({ access_token: t.token, refresh_token: t.refreshToken, id_token: t.idToken }));
}
async function mount() {
  let saved: string | null = JSON.stringify(tokens());
  const store = {
    loadSession: async () => ({ session: saved }),
    saveSession: vi.fn(async ({ session }: { session: string }) => { saved = session; }),
    clearSession: vi.fn(async () => { saved = null; }),
  };
  const client = new Keycloak({ url: 'https://auth.example/auth', realm: 'mindsdb', clientId: 'cowork-mobile' });
  const adapter = createMobileShellAdapter({ keycloak: client, logoutUrl: TOKEN_URL.replace('/token', '/logout') });
  await act(async () => {
    render(<MobileShellRoot
      shell={{ platform: 'ios', version: '1.0.0' }}
      authClient={client}
      initOptions={keycloakInitOptions(window.location.href, adapter)}
      session={{
        restore: () => restoreMobileSession({ store, tokenUrl: TOKEN_URL, clientId: 'cowork-mobile' }),
        save: (next) => saveMobileSession(store, next),
        forget: () => clearMobileSession(store),
      }}
    ><div data-testid="signed-in-app" /></MobileShellRoot>);
  });
  return { store, saved: () => saved };
}

beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('mobile startup with the real Keycloak provider and client', () => {
  it('offers retry when the second refresh stalls, preserving the session even if it finishes late', async () => {
    let finish!: (r: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => response())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const state = await mount();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('signed-in-app')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(MOBILE_AUTH_STARTUP_TIMEOUT_MS); });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(state.saved()).not.toBeNull();
    expect(state.store.clearSession).not.toHaveBeenCalled();
    await act(async () => { finish(response()); });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByTestId('signed-in-app')).toBeNull();
  });

  it('cancels the startup deadline after successful initialization', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    const state = await mount();
    expect(screen.getByTestId('signed-in-app')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(MOBILE_AUTH_STARTUP_TIMEOUT_MS); });
    expect(screen.getByTestId('signed-in-app')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(state.store.saveSession).toHaveBeenCalled();
  });

  it('clears a refused saved session and leaves the normal sign-in screen past the deadline', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const state = await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(MOBILE_AUTH_STARTUP_TIMEOUT_MS); });
    expect(screen.getByRole('button', { name: 'Sign in with MindsHub' })).toBeInTheDocument();
    expect(state.saved()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
