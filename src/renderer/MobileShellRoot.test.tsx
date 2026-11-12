import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type Keycloak from 'keycloak-js';

// The provider is replaced by a stand-in that exposes what the root does with
// it: whether init is still running, failed, or finished signed in or out.
const providerState = vi.hoisted(() => ({
  phase: 'ready' as 'loading' | 'ready' | 'error',
  authenticated: false,
  initOptions: null as unknown,
  events: [] as string[],
  tokens: null as null | { token?: string; refreshToken?: string; idToken?: string },
}));

vi.mock('@react-keycloak/web', async () => {
  const React = await import('react');
  const Ctx = React.createContext<{ keycloak: unknown } | null>(null);
  return {
    ReactKeycloakProvider: ({ children, authClient, initOptions, LoadingComponent, onEvent, onTokens }: {
      children: React.ReactNode;
      authClient: unknown;
      initOptions: unknown;
      LoadingComponent: React.ReactNode;
      onEvent?: (event: string) => void;
      onTokens?: (tokens: { token?: string; refreshToken?: string; idToken?: string }) => void;
    }) => {
      providerState.initOptions = initOptions;
      React.useEffect(() => {
        if (providerState.phase === 'error') onEvent?.('onInitError');
        for (const event of providerState.events) onEvent?.(event);
        if (providerState.tokens) onTokens?.(providerState.tokens);
        // Once, as keycloak-js would on init.
      }, []);
      if (providerState.phase !== 'ready') return LoadingComponent;
      return React.createElement(Ctx.Provider, { value: { keycloak: authClient } }, children);
    },
    useKeycloak: () => {
      const value = React.useContext(Ctx);
      return { initialized: true, keycloak: value!.keycloak };
    },
  };
});

const pushMock = vi.hoisted(() => ({ signedIn: vi.fn() }));
vi.mock('./lib/mobilePush', () => ({
  mobilePush: () => null,
  mobilePushSignedIn: pushMock.signedIn,
}));

import { MobileShellRoot, ShellSignIn, ShellUpdateRequired, type MobileShellSession } from './MobileShellRoot';
import type { RestoreResult } from './lib/mobileSession';

function client(overrides: Partial<{ login: () => Promise<void>; register: () => Promise<void> }> = {}) {
  return {
    get authenticated() { return providerState.authenticated; },
    subject: 'user-1',
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    ...overrides,
  };
}

function sessionWith(result: RestoreResult) {
  return {
    restore: vi.fn(async () => result),
    save: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
  } satisfies MobileShellSession;
}

function renderRoot(auth = client(), version = '1.0.0', session: MobileShellSession | null = null) {
  return render(
    <MobileShellRoot
      shell={{ platform: 'ios', version }}
      authClient={auth as unknown as Keycloak}
      initOptions={{ pkceMethod: 'S256' }}
      session={session}
    >
      <div data-testid="app">app</div>
    </MobileShellRoot>,
  );
}

afterEach(() => {
  cleanup();
  providerState.phase = 'ready';
  providerState.authenticated = false;
  providerState.initOptions = null;
  providerState.events = [];
  providerState.tokens = null;
  pushMock.signedIn.mockClear();
});

describe('MobileShellRoot', () => {
  it('shows the sign-in screen, not the app, when signed out', () => {
    renderRoot();
    expect(screen.getByTestId('shell-sign-in')).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('renders the app once signed in', () => {
    providerState.authenticated = true;
    renderRoot();
    expect(screen.getByTestId('app')).toBeTruthy();
    expect(screen.queryByTestId('shell-sign-in')).toBeNull();
  });

  it('hands the signed-in user to push registration, and nobody while signed out', () => {
    renderRoot();
    expect(pushMock.signedIn).not.toHaveBeenCalled();
    cleanup();
    providerState.authenticated = true;
    renderRoot();
    expect(pushMock.signedIn).toHaveBeenCalledWith('user-1');
  });

  it('holds the welcome view while init runs', () => {
    providerState.phase = 'loading';
    renderRoot();
    expect(screen.queryByTestId('shell-sign-in')).toBeNull();
    expect(document.body.textContent).toContain('Welcome to');
  });

  it('offers a retry instead of loading forever when init fails', async () => {
    providerState.phase = 'error';
    await act(async () => { renderRoot(); });
    expect(screen.getByTestId('shell-sign-in')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('did not finish');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('shows only the update screen for a shell below the minimum', () => {
    providerState.authenticated = true;
    renderRoot(client(), '0.9.0');
    expect(screen.getByTestId('shell-update-required')).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
    expect(providerState.initOptions).toBeNull();
  });
});

describe('MobileShellRoot saved session', () => {
  const restored = { token: 'at', refreshToken: 'rt', idToken: 'id' };

  it('starts Keycloak with the restored tokens', async () => {
    providerState.authenticated = true;
    await act(async () => { renderRoot(client(), '1.0.0', sessionWith({ kind: 'restored', session: restored })); });
    expect(providerState.initOptions).toEqual({ pkceMethod: 'S256', ...restored });
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('starts signed out with nothing to restore', async () => {
    await act(async () => { renderRoot(client(), '1.0.0', sessionWith({ kind: 'none' })); });
    expect(providerState.initOptions).toEqual({ pkceMethod: 'S256' });
    expect(screen.getByTestId('shell-sign-in')).toBeTruthy();
  });

  it('holds the welcome view, without starting Keycloak, until the restore settles', async () => {
    let settle: (result: RestoreResult) => void = () => {};
    const session = sessionWith({ kind: 'none' });
    session.restore.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
    renderRoot(client(), '1.0.0', session);
    expect(document.body.textContent).toContain('Welcome to');
    expect(providerState.initOptions).toBeNull();
    await act(async () => { settle({ kind: 'none' }); });
    expect(screen.getByTestId('shell-sign-in')).toBeTruthy();
  });

  it('offers a retry, without signing out, when Keycloak cannot be reached', async () => {
    const session = sessionWith({ kind: 'unavailable' });
    await act(async () => { renderRoot(client(), '1.0.0', session); });
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(providerState.initOptions).toBeNull();
    expect(session.forget).not.toHaveBeenCalled();
  });

  it('saves new tokens and forgets the session on sign-out', async () => {
    const session = sessionWith({ kind: 'none' });
    providerState.tokens = restored;
    providerState.events = ['onAuthLogout'];
    await act(async () => { renderRoot(client(), '1.0.0', session); });
    expect(session.save).toHaveBeenCalledWith(restored);
    expect(session.forget).toHaveBeenCalledTimes(1);
  });

  it('does not restore for a shell that must update', async () => {
    const session = sessionWith({ kind: 'restored', session: restored });
    await act(async () => { renderRoot(client(), '0.9.0', session); });
    expect(session.restore).not.toHaveBeenCalled();
    expect(screen.getByTestId('shell-update-required')).toBeTruthy();
  });
});

describe('ShellSignIn', () => {
  it('signs in and signs up through the client', async () => {
    const auth = client();
    render(<ShellSignIn auth={auth} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in with MindsHub' })); });
    expect(auth.login).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create account' })); });
    expect(auth.register).toHaveBeenCalledTimes(1);
  });

  it('stays put, with no error, when the user closes the sheet', async () => {
    // The adapter resolves without signing in on a cancel.
    const auth = client();
    render(<ShellSignIn auth={auth} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in with MindsHub' })); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Sign in with MindsHub' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says so when sign-in fails, and lets the user try again', async () => {
    const auth = client({ login: vi.fn(async () => { throw new Error('boom'); }) });
    render(<ShellSignIn auth={auth} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in with MindsHub' })); });
    expect(screen.getByRole('alert').textContent).toContain('could not sign you in');
    expect((screen.getByRole('button', { name: 'Sign in with MindsHub' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ShellUpdateRequired', () => {
  it('names the store for the platform', () => {
    const { rerender } = render(<ShellUpdateRequired platform="ios" />);
    expect(document.body.textContent).toContain('from the App Store');
    rerender(<ShellUpdateRequired platform="android" />);
    expect(document.body.textContent).toContain('from Google Play');
  });

  it('cannot be dismissed', () => {
    render(<ShellUpdateRequired platform="ios" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
