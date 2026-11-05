import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type Keycloak from 'keycloak-js';

// The provider is replaced by a stand-in that exposes what the root does with
// it: whether init is still running, failed, or finished signed in or out.
const providerState = vi.hoisted(() => ({
  phase: 'ready' as 'loading' | 'ready' | 'error',
  authenticated: false,
  initOptions: null as unknown,
}));

vi.mock('@react-keycloak/web', async () => {
  const React = await import('react');
  const Ctx = React.createContext<{ keycloak: unknown } | null>(null);
  return {
    ReactKeycloakProvider: ({ children, authClient, initOptions, LoadingComponent, onEvent }: {
      children: React.ReactNode;
      authClient: unknown;
      initOptions: unknown;
      LoadingComponent: React.ReactNode;
      onEvent?: (event: string) => void;
    }) => {
      providerState.initOptions = initOptions;
      React.useEffect(() => {
        if (providerState.phase === 'error') onEvent?.('onInitError');
      }, [onEvent]);
      if (providerState.phase !== 'ready') return LoadingComponent;
      return React.createElement(Ctx.Provider, { value: { keycloak: authClient } }, children);
    },
    useKeycloak: () => {
      const value = React.useContext(Ctx);
      return { initialized: true, keycloak: value!.keycloak };
    },
  };
});

import { MobileShellRoot, ShellSignIn, ShellUpdateRequired } from './MobileShellRoot';

function client(overrides: Partial<{ login: () => Promise<void>; register: () => Promise<void> }> = {}) {
  return {
    get authenticated() { return providerState.authenticated; },
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    ...overrides,
  };
}

function renderRoot(auth = client(), version = '1.0.0') {
  return render(
    <MobileShellRoot
      shell={{ platform: 'ios', version }}
      authClient={auth as unknown as Keycloak}
      initOptions={{ pkceMethod: 'S256' }}
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
