import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Keycloak from 'keycloak-js';
import { MobileShellRoot } from './MobileShellRoot';
import { createMobileShellAdapter, keycloakInitOptions } from './lib/mobileAuth';

vi.mock('./lib/mobilePush', () => ({ mobilePush: () => null, mobilePushSignedIn: vi.fn() }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

it('waits for a sign-in tap with the real provider and Keycloak client', async () => {
  const client = new Keycloak({ url: 'https://auth.example/auth', realm: 'mindsdb', clientId: 'cowork-mobile' });
  const authenticate = vi.fn(async (_options: { url: string; callbackScheme: string }) => {
    throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
  });
  const adapter = createMobileShellAdapter({
    keycloak: client,
    logoutUrl: 'https://auth.example/logout',
    getPlugin: () => ({ authenticate }),
  });

  render(
    <MobileShellRoot
      shell={{ platform: 'ios', version: '1.0.0' }}
      authClient={client}
      initOptions={keycloakInitOptions(window.location.href, adapter)}
    >
      <div>Signed-in app</div>
    </MobileShellRoot>,
  );

  const signIn = await screen.findByRole('button', { name: 'Sign in with MindsHub' });
  expect(authenticate).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(signIn); });
  /* createLoginUrl builds its PKCE challenge with crypto.subtle, which can
     finish after the click's act, so wait for the sheet and for the button
     to come back from busy before checking the settled screen. */
  await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(signIn).not.toBeDisabled());
  const authorize = new URL(authenticate.mock.calls[0]![0].url);
  expect(authorize.searchParams.has('prompt')).toBe(false);
  expect(screen.queryByText('Signed-in app')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});
