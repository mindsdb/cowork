import { useState, useEffect } from 'react';
import SetupScreen from './pages/arcade/SetupScreen';
import OnboardingScreen from './pages/arcade/OnboardingScreen';
import { COWORKERS } from './pages/arcade/CoworkerSelect';
import CoworkApp from './CoworkApp';
import OrbitMorph from './cowork/components/ui/OrbitMorph';
import { host } from './platform/host';
import { loadSkin, persistSkin } from './lib/skins';
import type { SpriteName } from './pages/arcade/sprites';
import './styles.css';

// Onboarding flow:
//   loading (welcome orb) → auth (sign in / register / continue without) →
//   setup (install) → terminal. Agent + theme are not onboarding steps; the
//   look (arcade ↔ normal) is toggled via the corner controller button.
type Page = 'loading' | 'auth' | 'setup' | 'terminal';

// Per-browser terms-consent flag (web). Desktop also records consent in
// ~/.anton/.env (ANTON_TERMS_CONSENT), written when auth completes.
const TERMS_CONSENT_KEY = 'anton.termsConsent';
const COWORKER_KEY = 'anton.coworker';
// Minimum time the welcome orb stays up so it doesn't flash on fast boots.
// The boot veil only briefly masks the window-show moment (~140ms + ~260ms
// fade), so the animated orb is on screen almost immediately and stays for
// roughly this long before routing onward.
const WELCOME_MIN_MS = 1600;

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

// Map skin + theme → the onboarding shell's look. arcade.css reads
// body[data-arcade-preset]: 'midnight'/'daylight' = clean (Inter, no CRT),
// 'gameboy' = 8-bit light, default (no preset) = 8-bit dark CRT.
function applyArcadePreset(skin: string): void {
  const theme = document.body.dataset.theme === 'light' ? 'light' : 'dark';
  const preset = skin === '8bit'
    ? (theme === 'light' ? 'gameboy' : null)         // null → default arcade dark
    : (theme === 'light' ? 'daylight' : 'midnight'); // clean / "normal"
  if (preset) document.body.dataset.arcadePreset = preset;
  else delete document.body.dataset.arcadePreset;
}

function GamepadIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 11h4M8 9v4" /><path d="M15.5 12.5h.01M18 10h.01" />
      <path d="M17.32 6H6.68a4 4 0 0 0-3.98 3.6l-.66 5.86A2.75 2.75 0 0 0 6.8 17.6L8.5 15.5h7l1.7 2.1a2.75 2.75 0 0 0 4.76-2.14l-.66-5.86A4 4 0 0 0 17.32 6Z" />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('loading');
  const [coworker] = useState(recallCoworker);
  const [skin, setSkin] = useState(loadSkin);

  // Keep body skin + onboarding shell preset + persistence in sync.
  useEffect(() => {
    document.body.dataset.skin = skin;
    persistSkin(skin);
    applyArcadePreset(skin);
  }, [skin]);

  useEffect(() => {
    async function init() {
      const started = Date.now();
      let target: Page = 'auth';
      try {
        const settings = await host.readSettings();
        const consented = settings.ANTON_TERMS_CONSENT === 'true' || hasLocalTermsConsent();
        const { configured } = await host.checkConfigured();
        if (consented && configured) {
          const status = await host.checkInstall();
          target = (!status.antonInstalled || !status.serverDepsReady) ? 'setup' : 'terminal';
        }
      } catch {
        target = 'auth';
      }
      // Keep the welcome orb up briefly so it doesn't flash on fast boots.
      const elapsed = Date.now() - started;
      if (elapsed < WELCOME_MIN_MS) {
        await new Promise((r) => setTimeout(r, WELCOME_MIN_MS - elapsed));
      }
      setPage(target);
    }
    init();
  }, []);

  // After login (SSO or BYOK): consent is recorded and a provider is saved.
  // Ensure the backend is installed, then enter the app.
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
  const isArcadePage = page !== 'terminal';

  return (
    <>
      {/* Drag overlay for the chromeless arcade pages (auth/setup). */}
      {isMac && isArcadePage && <div className="titlebar-drag" />}

      {page === 'loading' && (
        <div
          className="arc-root welcome-loading"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20 }}
        >
          <OrbitMorph state="thinking" size={72} />
          <div className="arc-welcome-title">
            Welcome to MindsHub Cowork
          </div>
        </div>
      )}

      {page === 'auth' && (
        <OnboardingScreen coworker={coworker} onComplete={handleAuthComplete} />
      )}

      {page === 'setup' && <SetupScreen onComplete={handleInstallComplete} />}

      {page === 'terminal' && <CoworkApp />}

      {/* Arcade ↔ normal toggle on the onboarding corner — mirrors the
          in-app gamepad button. Hidden in the app (CoworkApp has its own). */}
      {isArcadePage && (
        <button
          onClick={() => setSkin((s) => (s === '8bit' ? 'normal' : '8bit'))}
          title={skin === '8bit' ? 'Switch to normal mode' : 'Switch to arcade mode'}
          aria-label="Toggle arcade / normal mode"
          className="floating-theme-toggle"
          style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 200 }}
        >
          <GamepadIcon size={15} />
        </button>
      )}
    </>
  );
}
