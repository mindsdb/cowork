import { useState, useEffect } from 'react';
import SetupScreen from './pages/arcade/SetupScreen';
import OnboardingScreen from './pages/arcade/OnboardingScreen';
import { COWORKERS } from './pages/arcade/CoworkerSelect';
import CoworkApp from './CoworkApp';
import { host } from './platform/host';
import type { SpriteName } from './pages/arcade/sprites';
import './styles.css';

// New onboarding flow:
//   loading → auth (Sign in with MindsHub OR continue without / BYOK; Terms
//             accepted implicitly by continuing) → setup (install) → terminal
//
// Agent selection and theme/skin are no longer onboarding steps — the agent
// defaults to Anton, and theme/skin are changed in-app via the Display modal
// (the bottom-right gamepad button) or Settings → Appearance.
type Page = 'loading' | 'auth' | 'setup' | 'terminal';

// Per-browser terms-consent flag (web). Desktop also records consent in
// ~/.anton/.env (ANTON_TERMS_CONSENT), written when auth completes.
const TERMS_CONSENT_KEY = 'anton.termsConsent';
const COWORKER_KEY = 'anton.coworker';

function hasLocalTermsConsent(): boolean {
  try {
    return typeof window !== 'undefined'
      && window.localStorage.getItem(TERMS_CONSENT_KEY) === 'true';
  } catch {
    return false;
  }
}

function rememberTermsConsent(): void {
  try { window.localStorage.setItem(TERMS_CONSENT_KEY, 'true'); } catch {}
}

// Agent defaults to Anton (no picker in onboarding). A previously-selected
// coworker in localStorage is still honored if present.
function recallCoworker(): { id: string; label: string; sprite: SpriteName } {
  let id = 'anton';
  try { id = window.localStorage.getItem(COWORKER_KEY) || 'anton'; } catch {}
  const cw = COWORKERS.find((c) => c.id === id && !c.locked);
  return cw
    ? { id: cw.id, label: cw.name, sprite: cw.sprite }
    : { id: 'anton', label: 'ANTON', sprite: 'anton' };
}

export default function App() {
  const [page, setPage] = useState<Page>('loading');
  const [coworker] = useState(recallCoworker);

  useEffect(() => {
    async function init() {
      try {
        const settings = await host.readSettings();
        const consented = settings.ANTON_TERMS_CONSENT === 'true' || hasLocalTermsConsent();
        const { configured } = await host.checkConfigured();
        // Not signed in / not yet agreed → the auth screen (login + terms).
        if (!consented || !configured) {
          setPage('auth');
          return;
        }
        // Returning user: ensure the backend is installed, then enter.
        const status = await host.checkInstall();
        if (!status.antonInstalled || !status.serverDepsReady) {
          setPage('setup');
          return;
        }
        setPage('terminal');
      } catch {
        setPage('auth');
      }
    }
    init();
  }, []);

  // After login (SSO or BYOK): consent is recorded and a provider is saved.
  // Now make sure the backend is installed, then enter the app.
  const handleAuthComplete = async () => {
    rememberTermsConsent();
    try { await host.restartServer(); } catch {}
    try {
      const status = await host.checkInstall();
      if (!status.antonInstalled || !status.serverDepsReady) {
        setPage('setup');
        return;
      }
    } catch {
      setPage('setup');
      return;
    }
    setPage('terminal');
  };

  const handleInstallComplete = async () => {
    // Restart the backend so it picks up the freshly-written ~/.anton/.env.
    try { await host.restartServer(); } catch {}
    setPage('terminal');
  };

  const isMac = host.isMac();
  const isArcadePage = page !== 'terminal' && page !== 'loading';

  return (
    <>
      {/* Drag overlay for the chromeless arcade pages (auth/setup). */}
      {isMac && isArcadePage && <div className="titlebar-drag" />}

      {page === 'loading' && (
        <div style={{ position: 'fixed', inset: 0, background: '#0a0a13' }} />
      )}

      {page === 'auth' && (
        <OnboardingScreen coworker={coworker} onComplete={handleAuthComplete} />
      )}

      {page === 'setup' && <SetupScreen onComplete={handleInstallComplete} />}

      {page === 'terminal' && <CoworkApp />}
    </>
  );
}
