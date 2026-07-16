import { useState, useEffect } from 'react';
import SetupScreen from './pages/arcade/SetupScreen';
import OnboardingScreen from './pages/arcade/OnboardingScreen';
import { COWORKERS } from './pages/arcade/CoworkerSelect';
import CoworkApp from './CoworkApp';
import OrbitMorph from './cowork/components/ui/OrbitMorph';
import { host } from './platform/host';
import { loadSkin, persistSkin } from './lib/skins';
import { syncSettingsToDb } from './lib/syncSettings';
import { resolveBootTarget } from './lib/bootTarget';
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

function SunIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>('loading');
  const [coworker] = useState(recallCoworker);
  const [skin, setSkin] = useState(loadSkin);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = window.localStorage.getItem('anton.theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {}
    return document.body.dataset.theme === 'light' ? 'light' : 'dark';
  });

  // Keep body skin + onboarding shell preset + persistence in sync.
  useEffect(() => {
    document.body.dataset.skin = skin;
    persistSkin(skin);
    applyArcadePreset(skin);
  }, [skin]);

  // Apply + persist the light/dark theme (mirrors CoworkApp), then refresh
  // the arcade preset since the preset depends on the active theme.
  useEffect(() => {
    try { window.localStorage.setItem('anton.theme', theme); } catch {}
    document.body.classList.remove('gf-theme-dark', 'gf-theme-light');
    document.body.classList.add(theme === 'light' ? 'gf-theme-light' : 'gf-theme-dark');
    document.body.dataset.theme = theme;
    const gf = (window as unknown as { gravityField?: { setTheme?: (t: string) => void } }).gravityField;
    if (gf && typeof gf.setTheme === 'function') gf.setTheme(theme);
    applyArcadePreset(skin);
  }, [theme, skin]);

  useEffect(() => {
    async function init() {
      const started = Date.now();
      // Boot-routing decision lives in a pure, tested unit (resolveBootTarget).
      // readSettings() is best-effort there, so a hosted-web /settings/raw 403
      // (ENG-817) can't abort the gate and strand a configured instance on the
      // auth screen; config_ready (health) drives the real decision.
      const target: Page = await resolveBootTarget(host, hasLocalTermsConsent());
      // Keep the welcome orb up briefly so it doesn't flash on fast boots.
      const elapsed = Date.now() - started;
      if (elapsed < WELCOME_MIN_MS) {
        await new Promise((r) => setTimeout(r, WELCOME_MIN_MS - elapsed));
      }
      setPage(target);
    }
    init();
  }, []);

  // Common final step for every path that leads to the chat UI:
  // push any credentials sitting in ~/.cowork/.env into the server DB so
  // config_ready is true on first mount. Called from both the already-installed
  // login path and the post-install path so the handshake is never skipped.
  const handlePostAuth = async () => {
    try {
      const saved = await host.readSettings();
      if (saved && typeof saved === 'object') {
        const lines = Object.entries(saved as Record<string, string>).map(([k, v]) => `${k}=${v}`);
        await syncSettingsToDb(lines);
      }
    } catch { /* best-effort — backend migration covers the gap on next restart */ }
    setPage('terminal');
  };

  // After login (SSO or BYOK): consent is recorded and a provider is saved.
  // Ensure the backend is installed, then run the credential handshake.
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
    await handlePostAuth();
  };

  // After install: server is up — run the same credential handshake.
  const handleInstallComplete = async () => {
    await handlePostAuth();
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

      {/* Theme + style toggles on the onboarding corner. CoworkApp hasn't
          mounted yet on these pages (no sidebar to host them), so the
          pre-app flow keeps its own floating corner toggles — namespaced
          `arcade-*` (arcade.css) so they're independent of the in-app
          sidebar footer toggle (Sidebar.jsx) that replaced the old
          shared floating-chrome buttons. The CSS stacks the style toggle
          above the theme toggle. */}
      {isArcadePage && (
        <>
          <button
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle colour theme"
            className="arcade-theme-toggle"
            style={{ zIndex: 200 }}
          >
            {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
          </button>
          <button
            onClick={() => setSkin((s) => (s === '8bit' ? 'normal' : '8bit'))}
            title={skin === '8bit' ? 'Switch 8-bit arcade style off' : 'Switch style to 8-Bit Arcade mode'}
            aria-label="Toggle 8-bit arcade style"
            className="arcade-theme-toggle arcade-skin-toggle"
            style={{ zIndex: 200 }}
          >
            <GamepadIcon size={15} />
          </button>
        </>
      )}
    </>
  );
}
