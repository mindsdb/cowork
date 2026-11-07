// The web entry's root inside the mobile app (ENG-4023).
//
// A browser logs in on load by redirecting to Keycloak (web-main.tsx). The app
// can't: that would open the system browser sheet the moment it starts. So it
// initializes Keycloak without `onLoad`, and until the user is signed in shows
// a sign-in screen whose buttons open the sheet (lib/mobileAuth.ts). A shell
// older than MIN_SHELL_VERSION gets an update screen and nothing else.

import { useEffect, useState, type ReactNode } from 'react';
import { ReactKeycloakProvider, useKeycloak } from '@react-keycloak/web';
import type Keycloak from 'keycloak-js';
import { ArcadeShell } from './pages/arcade/components';
import OrbitMorph from './cowork/components/ui/OrbitMorph';
import { productName } from './lib/deploymentBrand';
import { STOCK_PRODUCT_NAME } from '../shared/product-name';
import { MIN_SHELL_VERSION, shellNeedsUpdate, type MobileShell } from './lib/mobileShell';
import { WelcomeLoading } from './WelcomeLoading';
import { mobilePush, mobilePushSignedIn } from './lib/mobilePush';
import { MobilePushPrompt } from './MobilePushPrompt';

const SIGN_IN_FAILED = 'We could not sign you in. Please try again.';

interface SignInClient {
  login(): Promise<void>;
  register(): Promise<void>;
}

/** The app's sign-in screen: one button for sign-in, one link for sign-up. */
export function ShellSignIn({ auth, failed = false }: { auth: SignInClient; failed?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(failed ? 'Sign-in did not finish. Please try again.' : null);

  // After a failed init the Keycloak client may be unusable (no endpoints
  // loaded), so "Try again" starts the page over; the callback is already
  // gone from the URL, so this lands back here, never in a loop.
  const run = async (action: 'login' | 'register') => {
    if (busy) return;
    if (failed) {
      window.location.reload();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Resolves without signing in when the user closes the sheet: stay here.
      await auth[action]();
    } catch {
      setError(SIGN_IN_FAILED);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ArcadeShell>
      <div className="arc-stack" style={{ gap: 18, alignItems: 'center' }} data-testid="shell-sign-in">
        <OrbitMorph state="idle" size={72} />
        <div className="arc-welcome-title">{productName(STOCK_PRODUCT_NAME)}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--arc-muted)', textAlign: 'center', maxWidth: 420 }}>
          Check on your tasks, answer questions and approve next steps from anywhere.
        </div>
        {error && (
          <div role="alert" style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--arc-red)', textAlign: 'center' }}>
            {error}
          </div>
        )}
        <button type="button" className="arc-btn" style={{ width: '100%' }} disabled={busy} onClick={() => run('login')}>
          {failed ? 'Try again' : 'Sign in with MindsHub'}
        </button>
        {!failed && (
          <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--arc-muted)', textAlign: 'center' }}>
            New to MindsHub?{' '}
            <button type="button" className="arc-link" disabled={busy} onClick={() => run('register')}>
              Create account
            </button>
          </div>
        )}
      </div>
    </ArcadeShell>
  );
}

/** Shown, and never dismissed, when the native shell is too old for this web build. */
export function ShellUpdateRequired({ platform }: { platform: MobileShell['platform'] }) {
  const store = platform === 'ios' ? 'the App Store' : 'Google Play';
  return (
    <ArcadeShell>
      <div className="arc-stack" style={{ gap: 18, alignItems: 'center' }} data-testid="shell-update-required">
        <div className="arc-welcome-title">Update {productName(STOCK_PRODUCT_NAME)}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--arc-muted)', textAlign: 'center', maxWidth: 420 }}>
          This version of the app is no longer supported. Update {productName(STOCK_PRODUCT_NAME)} from {store} to continue.
        </div>
      </div>
    </ArcadeShell>
  );
}

function SignedInGate({ children }: { children: ReactNode }) {
  const { keycloak } = useKeycloak();
  const signedInAs = keycloak.authenticated ? keycloak.subject ?? null : null;
  // Push (lib/mobilePush.ts): register this phone for the signed-in user if
  // notifications are allowed; otherwise the soft prompt offers them later.
  useEffect(() => {
    if (signedInAs) mobilePushSignedIn(signedInAs);
  }, [signedInAs]);
  if (!keycloak.authenticated) return <ShellSignIn auth={keycloak} />;
  return (
    <>
      {children}
      <MobilePushPrompt controller={mobilePush()} />
    </>
  );
}

export interface MobileShellRootProps {
  shell: MobileShell;
  authClient: Keycloak;
  initOptions: Record<string, unknown>;
  onTokens?: (tokens: { token?: string }) => void;
  children: ReactNode;
}

export function MobileShellRoot({ shell, authClient, initOptions, onTokens, children }: MobileShellRootProps) {
  // The provider never leaves its loading view when init() rejects (a failed
  // code exchange, Keycloak unreachable), so catch that here.
  const [initFailed, setInitFailed] = useState(false);

  if (shellNeedsUpdate(shell.version, MIN_SHELL_VERSION)) {
    return <ShellUpdateRequired platform={shell.platform} />;
  }
  if (initFailed) return <ShellSignIn auth={authClient} failed />;

  return (
    <ReactKeycloakProvider
      authClient={authClient}
      initOptions={initOptions}
      LoadingComponent={<WelcomeLoading />}
      onTokens={onTokens}
      onEvent={(event) => {
        if (event === 'onInitError') setInitFailed(true);
      }}
    >
      <SignedInGate>{children}</SignedInGate>
    </ReactKeycloakProvider>
  );
}

export default MobileShellRoot;
